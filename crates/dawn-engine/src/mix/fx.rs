//! The effects in a chain (a track's, a bus's or the master's) as the
//! engine plays them. Each lives on from one version of the song to the
//! next, by its id, so an edit doesn't reset a compressor or cut a tail; a
//! bypassed one is skipped, keeping its state, as the browser unplugs it.
//!
//! As in the browser's engine: a track's chain runs on what it plays and
//! what's routed into it, ahead of its fader; a bus's on its sends, ahead
//! of its fader; the master's after its fader, ahead of the limiter.
//!
//! A plugin (`EffectSettings::Plugin`) is run by the app's host: the host
//! puts its audio processor in a slot as the song is made, and the effect
//! takes it from there when it's made (off the audio thread). While the
//! slot is empty, the effect already playing carries on.

use std::fmt;
use std::sync::{Arc, Mutex};

use super::automation::EffectAutomation;
use super::clip::AudioData;
use super::song::MAX_BLOCK;
use crate::effects::amp::{self, AmpEffect, AmpSettings};
use crate::effects::chorus::{ChorusKernel, ChorusSettings};
use crate::effects::compressor::{CompressorKernel, CompressorSettings};
use crate::effects::delay::{DelayKernel, DelaySettings};
use crate::effects::eq_three::{EqThreeKernel, EqThreeSettings};
use crate::effects::filter::{FilterKernel, FilterSettings};
use crate::effects::gate::{GateKernel, GateSettings};
use crate::effects::glue::OS_LATENCY;
use crate::effects::glue::{GlueKernel, GlueSettings};
use crate::effects::ir_loader::{IrLoaderKernel, IrLoaderSettings};
use crate::effects::limiter::{Limiter, LimiterSettings, lookahead_frames};
use crate::effects::mb_dynamics::{MbDynamicsKernel, MbDynamicsSettings};
use crate::effects::multiband::{MultibandKernel, MultibandSettings};
use crate::effects::param_eq::{ParamEqKernel, ParamEqSettings};
use crate::effects::pitch_shift::{PitchShiftSettings, PitchShifter};
use crate::effects::reverb::{ReverbKernel, ReverbSettings};
use crate::effects::saturator::{SaturatorKernel, SaturatorSettings};
use crate::effects::tuner::{TunerKernel, TunerSettings, TunerTap};
use crate::effects::utility::{UtilityKernel, UtilitySettings};
use crate::params::ParamSource;

/// A plugin's audio processor, run by the app's host: it processes a
/// stereo block (at most `MAX_BLOCK` frames) in place, on the audio thread.
pub trait PluginProcessor: Send {
    fn process(&mut self, l: &mut [f32], r: &mut [f32]);
}

/// Where the host leaves a plugin's processor for the effect to take.
#[derive(Default)]
pub struct PluginSlot(Mutex<Option<Box<dyn PluginProcessor>>>);

impl PluginSlot {
    pub fn new(processor: Option<Box<dyn PluginProcessor>>) -> Self {
        Self(Mutex::new(processor))
    }

    /// The processor, if it's still waiting (off the audio thread).
    pub fn take(&self) -> Option<Box<dyn PluginProcessor>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).take()
    }

    pub fn is_filled(&self) -> bool {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).is_some()
    }
}

/// A plugin effect: its slot, and how late its sound comes out (frames).
#[derive(Clone)]
pub struct PluginSettings {
    pub slot: Arc<PluginSlot>,
    pub latency: usize,
}

impl fmt::Debug for PluginSettings {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PluginSettings")
            .field("latency", &self.latency)
            .finish_non_exhaustive()
    }
}

impl PartialEq for PluginSettings {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.slot, &other.slot) && self.latency == other.latency
    }
}

/// An effect's settings, made from its parameters.
#[derive(Clone, Debug, PartialEq)]
pub enum EffectSettings {
    Amp(Box<AmpSettings>),
    Chorus(Box<ChorusSettings>),
    Compressor(CompressorSettings),
    Delay(DelaySettings),
    EqThree(EqThreeSettings),
    Filter(FilterSettings),
    Gate(GateSettings),
    Glue(GlueSettings),
    IrLoader(Box<IrLoaderSettings>),
    Limiter(LimiterSettings),
    MbDynamics(Box<MbDynamicsSettings>),
    Multiband(Box<MultibandSettings>),
    ParamEq(Box<ParamEqSettings>),
    PitchShift(PitchShiftSettings),
    Plugin(PluginSettings),
    Reverb(Box<ReverbSettings>),
    Saturator(Box<SaturatorSettings>),
    Tuner(TunerSettings),
    Utility(UtilitySettings),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EffectKind {
    Amp,
    Chorus,
    Compressor,
    Delay,
    EqThree,
    Filter,
    Gate,
    Glue,
    IrLoader,
    Limiter,
    MbDynamics,
    Multiband,
    ParamEq,
    PitchShift,
    Plugin,
    Reverb,
    Saturator,
    Tuner,
    Utility,
}

impl EffectSettings {
    /// The settings for an effect of type `kind` (its saved key, as in the
    /// studio's `registry.ts`) with these parameters; None for a type the
    /// engine doesn't have. One that can take a sidechain listens to its own
    /// input until the song connects its key (`set_external`).
    pub fn from_params<P: ParamSource + ?Sized>(kind: &str, params: &P) -> Option<Self> {
        Some(match kind {
            "chorus" => Self::Chorus(Box::new(ChorusSettings::from_params(params))),
            "compressor" => Self::Compressor(CompressorSettings::from_params(params, false)),
            "delay" => Self::Delay(DelaySettings::from_params(params)),
            "distortion" => Self::Saturator(Box::new(SaturatorSettings::from_params(params))),
            "eq3" => Self::EqThree(EqThreeSettings::from_params(params)),
            "filter" => Self::Filter(FilterSettings::from_params(params)),
            "tubeAmp" => Self::Amp(Box::new(AmpSettings::from_params(params))),
            "gate" => Self::Gate(GateSettings::from_params(params, false)),
            "glue" => Self::Glue(GlueSettings::from_params(params, false)),
            "irLoader" => Self::IrLoader(Box::new(IrLoaderSettings::from_params(params))),
            "limiter" => Self::Limiter(LimiterSettings::from_params(params)),
            "mbDynamics" => {
                Self::MbDynamics(Box::new(MbDynamicsSettings::from_params(params, false)))
            }
            "multiband" => Self::Multiband(Box::new(MultibandSettings::from_params(params, false))),
            "paramEq" => Self::ParamEq(Box::new(ParamEqSettings::from_params(params))),
            "pitchShift" => Self::PitchShift(PitchShiftSettings::from_params(params)),
            "reverb" => Self::Reverb(Box::new(ReverbSettings::from_params(params))),
            "tuner" => Self::Tuner(TunerSettings::from_params(params)),
            "utility" => Self::Utility(UtilitySettings::from_params(params)),
            _ => return None,
        })
    }

    /// The frames it delays its audio by at `sample_rate` (as the browser's
    /// node reports it, for delay compensation).
    pub fn latency(&self, sample_rate: f64) -> usize {
        match self {
            Self::Amp(_) => amp::LATENCY,
            Self::Glue(s) if s.oversample => OS_LATENCY,
            Self::Limiter(_) => lookahead_frames(sample_rate),
            Self::PitchShift(s) => s.latency(sample_rate),
            Self::Plugin(s) => s.latency,
            Self::Saturator(s) => s.latency(),
            _ => 0,
        }
    }

    /// Whether its detector can listen to another track (a sidechain), as
    /// the studio's `SIDECHAIN_EFFECT_TYPES`.
    pub fn takes_key(&self) -> bool {
        matches!(
            self,
            Self::Compressor(_)
                | Self::Gate(_)
                | Self::Glue(_)
                | Self::MbDynamics(_)
                | Self::Multiband(_)
        )
    }

    /// Whether its detector listens to its key rather than its own input.
    pub fn external(&self) -> bool {
        match self {
            Self::Compressor(s) => s.key.external,
            Self::Gate(s) => s.key.external,
            Self::Glue(s) => s.key.external,
            Self::MbDynamics(s) => s.key.external,
            Self::Multiband(s) => s.key.external,
            _ => false,
        }
    }

    /// Whether its detector listens to its key (connected) rather than its
    /// own input.
    pub fn set_external(&mut self, external: bool) {
        match self {
            Self::Compressor(s) => s.key.external = external,
            Self::Gate(s) => s.key.external = external,
            Self::Glue(s) => s.key.external = external,
            Self::MbDynamics(s) => s.key.external = external,
            Self::Multiband(s) => s.key.external = external,
            _ => {}
        }
    }

    /// Whether it plays a file the studio sends (the IR Loader's impulse
    /// response).
    pub fn takes_file(&self) -> bool {
        matches!(self, Self::IrLoader(_))
    }

    /// Gives it its file (decoded at the engine's rate), or none.
    pub fn set_file(&mut self, file: Option<Arc<AudioData>>) {
        if let Self::IrLoader(s) = self {
            s.file = file;
        }
    }

    /// The file it plays, if it has one.
    pub fn file(&self) -> Option<&Arc<AudioData>> {
        match self {
            Self::IrLoader(s) => s.file.as_ref(),
            _ => None,
        }
    }

    /// Where a Tuner's kernel keeps what comes in, for the studio to read
    /// its pitch from.
    pub fn tuner_tap(&self) -> Option<&Arc<TunerTap>> {
        match self {
            Self::Tuner(s) => Some(&s.tap),
            _ => None,
        }
    }

    /// Works out, off the audio thread, what its kernel needs at
    /// `sample_rate` that would take too long on it: the Chorus's LFO
    /// tables, the Reverb's and the IR Loader's impulses. `previous` is the
    /// same effect's settings in the song playing, whose impulse it keeps
    /// if it's the same (and a Tuner its tap).
    pub fn prepare(&mut self, sample_rate: f64, previous: Option<&Self>) {
        match (self, previous) {
            (Self::Chorus(s), Some(Self::Chorus(p))) => s.prepare(sample_rate, Some(p)),
            (Self::Chorus(s), _) => s.prepare(sample_rate, None),
            (Self::Reverb(s), Some(Self::Reverb(p))) => s.prepare(sample_rate, Some(p)),
            (Self::Reverb(s), _) => s.prepare(sample_rate, None),
            (Self::IrLoader(s), Some(Self::IrLoader(p))) => s.prepare(sample_rate, Some(p)),
            (Self::IrLoader(s), _) => s.prepare(sample_rate, None),
            (Self::Tuner(s), Some(Self::Tuner(p))) => s.prepare(Some(p)),
            _ => {}
        }
    }

    /// Whether what `prepare` makes for it would be what it made for
    /// `other` (an impulse's shape, an LFO's waves), so it can take them.
    pub(crate) fn prepared_alike(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Chorus(a), Self::Chorus(b)) => a.shape == b.shape && a.spread == b.spread,
            (Self::Reverb(a), Self::Reverb(b)) => a.shape == b.shape,
            (Self::IrLoader(a), Self::IrLoader(b)) => a.normalize == b.normalize,
            (a, b) => a.kind() == b.kind(),
        }
    }

    pub fn kind(&self) -> EffectKind {
        match self {
            Self::Amp(_) => EffectKind::Amp,
            Self::Chorus(_) => EffectKind::Chorus,
            Self::Compressor(_) => EffectKind::Compressor,
            Self::Delay(_) => EffectKind::Delay,
            Self::EqThree(_) => EffectKind::EqThree,
            Self::Filter(_) => EffectKind::Filter,
            Self::Gate(_) => EffectKind::Gate,
            Self::Glue(_) => EffectKind::Glue,
            Self::IrLoader(_) => EffectKind::IrLoader,
            Self::Limiter(_) => EffectKind::Limiter,
            Self::MbDynamics(_) => EffectKind::MbDynamics,
            Self::Multiband(_) => EffectKind::Multiband,
            Self::ParamEq(_) => EffectKind::ParamEq,
            Self::PitchShift(_) => EffectKind::PitchShift,
            Self::Plugin(_) => EffectKind::Plugin,
            Self::Reverb(_) => EffectKind::Reverb,
            Self::Saturator(_) => EffectKind::Saturator,
            Self::Tuner(_) => EffectKind::Tuner,
            Self::Utility(_) => EffectKind::Utility,
        }
    }
}

/// Whether an automated parameter of an effect of type `kind` steps at its
/// lane's points rather than gliding (`automation`): those that shape a
/// reverb's impulse, a chorus's LFO tables or an IR Loader's level, which
/// take too long to make as they move.
pub fn stepped(kind: &str, param: &str) -> bool {
    match kind {
        "reverb" => matches!(param, "decay" | "damping" | "early" | "width" | "mode"),
        "chorus" => matches!(param, "spread" | "waveform"),
        "irLoader" => param == "normalize",
        _ => false,
    }
}

/// Where on a track or bus a sidechain's key is taken, as the studio's
/// `SidechainTap`: before its effects, after them (ahead of its delay
/// compensation), or after its fader.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tap {
    PreFx,
    PostFx,
    PostFader,
}

/// A track or bus, by its index in the song: where a key comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeySource {
    Track(usize),
    Bus(usize),
}

/// A keyed effect's sidechain: what its detector listens to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KeySpec {
    pub source: KeySource,
    pub tap: Tap,
}

/// An effect in a chain.
#[derive(Clone, Debug, PartialEq)]
pub struct EffectSpec {
    /// The studio's id for it.
    pub id: String,
    pub settings: EffectSettings,
    /// Skipped, as if unplugged.
    pub bypass: bool,
    /// Its sidechain, for an effect that takes one (`takes_key`). The song
    /// drops one that would make a loop, and the effect then listens to its
    /// own input, as the browser's does.
    pub key: Option<KeySpec>,
    /// Its parameters' lanes, if any are drawn (a track's effects).
    pub automation: Option<Box<EffectAutomation>>,
}

impl EffectSpec {
    pub fn new(id: impl Into<String>, settings: EffectSettings) -> Self {
        Self {
            id: id.into(),
            settings,
            bypass: false,
            key: None,
            automation: None,
        }
    }
}

enum Kernel {
    Amp(Box<AmpEffect>),
    Chorus(Box<ChorusKernel>),
    Compressor(Box<CompressorKernel>),
    Delay(Box<DelayKernel>),
    EqThree(Box<EqThreeKernel>),
    Filter(Box<FilterKernel>),
    Gate(Box<GateKernel>),
    Glue(Box<GlueKernel>),
    IrLoader(Box<IrLoaderKernel>),
    /// With a copy of its input, as it doesn't work in place.
    Limiter(Box<Limiter>, Box<[f32]>, Box<[f32]>),
    MbDynamics(Box<MbDynamicsKernel>),
    Multiband(Box<MultibandKernel>),
    ParamEq(Box<ParamEqKernel>),
    PitchShift(Box<PitchShifter>),
    /// The host's processor (none: the slot was empty, and it passes the
    /// sound through).
    Plugin(Option<Box<dyn PluginProcessor>>),
    Reverb(Box<ReverbKernel>),
    Saturator(Box<SaturatorKernel>),
    Tuner(Box<TunerKernel>),
    Utility(Box<UtilityKernel>),
}

/// An effect's kernel, made off the audio thread.
pub struct Effect {
    kernel: Kernel,
}

impl Effect {
    pub fn new(settings: &EffectSettings, sample_rate: f64) -> Self {
        let kernel = match settings {
            EffectSettings::Amp(s) => Kernel::Amp(Box::new(AmpEffect::new(sample_rate, s))),
            EffectSettings::Chorus(s) => {
                Kernel::Chorus(Box::new(ChorusKernel::new(sample_rate, s)))
            }
            EffectSettings::Compressor(s) => {
                Kernel::Compressor(Box::new(CompressorKernel::new(sample_rate, s)))
            }
            EffectSettings::Delay(s) => Kernel::Delay(Box::new(DelayKernel::new(sample_rate, s))),
            EffectSettings::EqThree(s) => {
                Kernel::EqThree(Box::new(EqThreeKernel::new(sample_rate, s)))
            }
            EffectSettings::Filter(s) => {
                Kernel::Filter(Box::new(FilterKernel::new(sample_rate, s)))
            }
            EffectSettings::Gate(s) => Kernel::Gate(Box::new(GateKernel::new(sample_rate, s))),
            EffectSettings::Glue(s) => Kernel::Glue(Box::new(GlueKernel::new(sample_rate, s))),
            EffectSettings::IrLoader(s) => {
                Kernel::IrLoader(Box::new(IrLoaderKernel::new(sample_rate, s)))
            }
            EffectSettings::Limiter(s) => Kernel::Limiter(
                Box::new(Limiter::new(sample_rate, *s)),
                vec![0.0; MAX_BLOCK].into(),
                vec![0.0; MAX_BLOCK].into(),
            ),
            EffectSettings::MbDynamics(s) => {
                Kernel::MbDynamics(Box::new(MbDynamicsKernel::new(sample_rate, s)))
            }
            EffectSettings::Multiband(s) => {
                Kernel::Multiband(Box::new(MultibandKernel::new(sample_rate, s)))
            }
            EffectSettings::ParamEq(s) => {
                Kernel::ParamEq(Box::new(ParamEqKernel::new(sample_rate, s)))
            }
            EffectSettings::PitchShift(s) => {
                Kernel::PitchShift(Box::new(PitchShifter::new(sample_rate, s)))
            }
            EffectSettings::Plugin(s) => Kernel::Plugin(s.slot.take()),
            EffectSettings::Reverb(s) => {
                Kernel::Reverb(Box::new(ReverbKernel::new(sample_rate, s)))
            }
            EffectSettings::Saturator(s) => {
                Kernel::Saturator(Box::new(SaturatorKernel::new(sample_rate, s)))
            }
            EffectSettings::Tuner(s) => Kernel::Tuner(Box::new(TunerKernel::new(sample_rate, s))),
            EffectSettings::Utility(s) => {
                Kernel::Utility(Box::new(UtilityKernel::new(sample_rate, s)))
            }
        };
        Self { kernel }
    }

    pub fn kind(&self) -> EffectKind {
        match self.kernel {
            Kernel::Amp(_) => EffectKind::Amp,
            Kernel::Chorus(_) => EffectKind::Chorus,
            Kernel::Compressor(_) => EffectKind::Compressor,
            Kernel::Delay(_) => EffectKind::Delay,
            Kernel::EqThree(_) => EffectKind::EqThree,
            Kernel::Filter(_) => EffectKind::Filter,
            Kernel::Gate(_) => EffectKind::Gate,
            Kernel::Glue(_) => EffectKind::Glue,
            Kernel::IrLoader(_) => EffectKind::IrLoader,
            Kernel::Limiter(..) => EffectKind::Limiter,
            Kernel::MbDynamics(_) => EffectKind::MbDynamics,
            Kernel::Multiband(_) => EffectKind::Multiband,
            Kernel::ParamEq(_) => EffectKind::ParamEq,
            Kernel::PitchShift(_) => EffectKind::PitchShift,
            Kernel::Plugin(_) => EffectKind::Plugin,
            Kernel::Reverb(_) => EffectKind::Reverb,
            Kernel::Saturator(_) => EffectKind::Saturator,
            Kernel::Tuner(_) => EffectKind::Tuner,
            Kernel::Utility(_) => EffectKind::Utility,
        }
    }

    /// Takes the settings of a new version of the song (on the audio
    /// thread: it only copies).
    pub fn configure(&mut self, settings: &EffectSettings) {
        match (&mut self.kernel, settings) {
            (Kernel::Amp(k), EffectSettings::Amp(s)) => k.set(s),
            (Kernel::Chorus(k), EffectSettings::Chorus(s)) => k.set(s),
            (Kernel::Compressor(k), EffectSettings::Compressor(s)) => k.set(s),
            (Kernel::Delay(k), EffectSettings::Delay(s)) => k.set(s),
            (Kernel::EqThree(k), EffectSettings::EqThree(s)) => k.set(s),
            (Kernel::Filter(k), EffectSettings::Filter(s)) => k.set(s),
            (Kernel::Gate(k), EffectSettings::Gate(s)) => k.set(s),
            (Kernel::Glue(k), EffectSettings::Glue(s)) => k.set(s),
            (Kernel::IrLoader(k), EffectSettings::IrLoader(s)) => k.set(s),
            (Kernel::Limiter(k, ..), EffectSettings::Limiter(s)) => k.set(*s),
            (Kernel::MbDynamics(k), EffectSettings::MbDynamics(s)) => k.set(s),
            (Kernel::Multiband(k), EffectSettings::Multiband(s)) => k.set(s),
            (Kernel::ParamEq(k), EffectSettings::ParamEq(s)) => k.set(s),
            (Kernel::PitchShift(k), EffectSettings::PitchShift(s)) => k.set(s),
            (Kernel::Reverb(k), EffectSettings::Reverb(s)) => k.set(s),
            (Kernel::Saturator(k), EffectSettings::Saturator(s)) => k.set(s),
            (Kernel::Tuner(k), EffectSettings::Tuner(s)) => k.set(s),
            (Kernel::Utility(k), EffectSettings::Utility(s)) => k.set(s),
            _ => {}
        }
    }

    /// Processes a stereo block (at most `MAX_BLOCK` frames) in place;
    /// `key` is its sidechain (left, right, at least as long), heard by an
    /// effect that takes one while its settings say `external`.
    pub fn process(&mut self, l: &mut [f32], r: &mut [f32], key: Option<(&[f32], &[f32])>) {
        let n = l.len().min(r.len());
        let key = key.map(|(kl, kr)| (&kl[..n], &kr[..n]));
        match &mut self.kernel {
            Kernel::Amp(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
            Kernel::Chorus(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
            Kernel::Compressor(k) => k.process_in_place(
                &mut l[..n],
                Some(&mut r[..n]),
                key.map(|k| k.0),
                key.map(|k| k.1),
            ),
            Kernel::Delay(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
            Kernel::EqThree(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
            Kernel::Filter(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
            Kernel::Gate(k) => {
                k.process_keyed(&mut l[..n], &mut r[..n], key);
            }
            Kernel::Glue(k) => k.process_keyed(&mut l[..n], &mut r[..n], key),
            Kernel::IrLoader(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
            Kernel::Limiter(k, in_l, in_r) => {
                in_l[..n].copy_from_slice(&l[..n]);
                in_r[..n].copy_from_slice(&r[..n]);
                k.process(Some(&in_l[..n]), Some(&in_r[..n]), l, Some(r), n);
            }
            Kernel::MbDynamics(k) => k.process_keyed(&mut l[..n], &mut r[..n], key),
            Kernel::Multiband(k) => k.process_keyed(&mut l[..n], &mut r[..n], key),
            Kernel::ParamEq(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
            Kernel::PitchShift(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
            Kernel::Plugin(Some(p)) => p.process(&mut l[..n], &mut r[..n]),
            Kernel::Plugin(None) => {}
            Kernel::Reverb(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
            Kernel::Saturator(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
            Kernel::Tuner(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
            Kernel::Utility(k) => k.process_in_place(&mut l[..n], &mut r[..n]),
        }
    }
}

/// The frames a chain delays its audio by: its effects', bar the bypassed.
pub(crate) fn latency(specs: &[EffectSpec], sample_rate: f64) -> usize {
    specs
        .iter()
        .filter(|s| !s.bypass)
        .map(|s| s.settings.latency(sample_rate))
        .sum()
}

/// A chain's effects as the audio thread has them: in the order of its
/// specs, each made for this version of the song or (until the engine
/// takes it) waiting to be swapped for the one already playing.
pub(crate) type Chain = Vec<Option<Box<Effect>>>;

/// Runs a chain on a stereo block, skipping what's bypassed; `key` gives
/// the effect at an index its sidechain's key for this block, if connected.
pub(crate) fn run<'a>(
    chain: &mut Chain,
    specs: &[EffectSpec],
    l: &mut [f32],
    r: &mut [f32],
    key: impl Fn(usize) -> Option<(&'a [f32], &'a [f32])>,
) {
    for (e, (effect, spec)) in chain.iter_mut().zip(specs).enumerate() {
        if let Some(effect) = effect
            && !spec.bypass
        {
            effect.process(l, r, key(e));
        }
    }
}
