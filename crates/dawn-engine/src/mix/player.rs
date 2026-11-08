//! A MIDI track's instrument as the engine plays it: the kernel (the Drum
//! Rack, the piano, the synth, or a plugin the app hosts), the notes its
//! clips have sounding, and the keys held live (with the sustain pedal,
//! pitch bend and mod wheel), which carry on from one version of the song
//! to the next.
//!
//! A plugin instrument is given its notes with each block, at their frames
//! in it (`PluginProcessor::play`). The pedal is worked out here, as for
//! the others (a key let go while it's down is let go when it lifts), so a
//! plugin hears only keys and the bend and mod wheel.
//!
//! As in the browser's engine (`audioEngine.ts`): a clip's notes start and
//! end where they sit; stopping, jumping and looping back release them
//! (`releaseAll`, which the Drum Rack ignores - its hits ring out); a key
//! played live sounds until it's let go, or until the pedal lifts if it
//! was down.

use std::sync::Arc;

use super::clip::AudioData;
use super::fx::{PluginNote, PluginProcessor, PluginSettings, TimedNote};
use super::song::MAX_BLOCK;
use crate::instruments::drums::{DrumEvent, DrumEventKind, DrumKit, Drums, PAD_COUNT};
use crate::instruments::piano::{Piano, PianoEvent, PianoEventKind, PianoSample};
use crate::instruments::synth::{Synth, SynthEvent, SynthEventKind, SynthSettings, Wavetable};

/// What plays a track's notes, with its settings.
#[derive(Clone, Debug)]
pub enum InstrumentSpec {
    Drums {
        kit: Box<DrumKit>,
        /// The sample pads' files, at the engine's rate.
        samples: [Option<Arc<AudioData>>; PAD_COUNT],
    },
    Piano {
        /// Sorted by note; none until they've arrived.
        samples: Option<Arc<[PianoSample]>>,
    },
    Synth {
        settings: Box<SynthSettings>,
        /// Oscillator 1's wavetable, oscillator 2's and the sub's shapes.
        /// It plays nothing until it has all three (as in the browser,
        /// where it starts once they're built).
        tables: [Option<Wavetable>; 3],
    },
    /// A plugin (VST3 or CLAP): its processor, in its slot until a player
    /// takes it.
    Plugin(PluginSettings),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InstrumentKind {
    Drums,
    Piano,
    Synth,
    Plugin,
}

impl InstrumentSpec {
    pub fn kind(&self) -> InstrumentKind {
        match self {
            InstrumentSpec::Drums { .. } => InstrumentKind::Drums,
            InstrumentSpec::Piano { .. } => InstrumentKind::Piano,
            InstrumentSpec::Synth { .. } => InstrumentKind::Synth,
            InstrumentSpec::Plugin(_) => InstrumentKind::Plugin,
        }
    }

    /// How late its sound comes out (frames): a plugin's own latency.
    pub fn latency(&self) -> usize {
        match self {
            InstrumentSpec::Plugin(p) => p.latency,
            _ => 0,
        }
    }
}

/// A note on a track's timeline, in frames.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Note {
    pub start: i64,
    pub end: i64,
    pub key: i32,
    /// 0-1.
    pub velocity: f64,
}

enum Kernel {
    Drums(Box<Drums>),
    Piano(Box<Piano>),
    Synth(Box<Synth>),
    Plugin(Box<PluginKernel>),
}

const KEYS: usize = 128;

/// The most notes waiting for their block; more are dropped.
const MAX_PENDING: usize = 1024;

/// A plugin instrument: its processor, and the notes for it, by their
/// frame on the engine's clock until their block comes.
struct PluginKernel {
    processor: Option<Box<dyn PluginProcessor>>,
    pending: Vec<(u64, PluginNote)>,
    block: Vec<TimedNote>,
    /// The keys it's been told are down.
    down: [bool; KEYS],
}

impl PluginKernel {
    fn new(processor: Option<Box<dyn PluginProcessor>>) -> Self {
        Self {
            processor,
            pending: Vec::with_capacity(MAX_PENDING),
            block: Vec::with_capacity(MAX_PENDING),
            down: [false; KEYS],
        }
    }

    fn push(&mut self, at: u64, note: PluginNote) {
        if self.pending.len() < MAX_PENDING {
            self.pending.push((at, note));
        }
    }

    fn on(&mut self, key: usize, velocity: f64, at: u64) {
        self.down[key] = true;
        self.push(
            at,
            PluginNote::On {
                key: key as u8,
                velocity: velocity.clamp(0.0, 1.0) as f32,
            },
        );
    }

    fn off(&mut self, key: usize, at: u64) {
        if std::mem::take(&mut self.down[key]) {
            self.push(at, PluginNote::Off { key: key as u8 });
        }
    }

    /// The `n` frames from `at`, with the notes due in them (one already
    /// late plays at the block's start).
    fn render(&mut self, l: &mut [f32], r: &mut [f32], at: u64) {
        let n = l.len();
        if n == 0 {
            return;
        }
        let end = at + n as u64;
        self.block.clear();
        for &(t, note) in &self.pending {
            if t < end {
                self.block.push(TimedNote {
                    offset: t.saturating_sub(at).min(n as u64 - 1) as u32,
                    note,
                });
            }
        }
        self.pending.retain(|(t, _)| *t >= end);
        // In order, those at one frame as they came (an off before the on
        // of a key played again): an insertion sort, which keeps them so
        // and doesn't allocate.
        for i in 1..self.block.len() {
            let mut j = i;
            while j > 0 && self.block[j - 1].offset > self.block[j].offset {
                self.block.swap(j - 1, j);
                j -= 1;
            }
        }
        l.fill(0.0);
        r.fill(0.0);
        if let Some(p) = self.processor.as_mut() {
            p.play(&self.block, l, r);
        }
    }
}

pub struct Player {
    sample_rate: f64,
    kernel: Kernel,
    /// When each key's clip note ends (frames on the timeline), while one
    /// is sounding.
    clip_ends: [Option<i64>; KEYS],
    /// Keys held live.
    held: [bool; KEYS],
    sustain: bool,
    /// Keys let go while the pedal was down: released when it lifts.
    sustained: [bool; KEYS],
    out_l: Vec<f32>,
    out_r: Vec<f32>,
}

impl Player {
    /// A player for `spec`'s instrument (made off the audio thread).
    pub fn new(spec: &InstrumentSpec, sample_rate: f64) -> Self {
        let kernel = match spec {
            InstrumentSpec::Drums { .. } => Kernel::Drums(Box::new(Drums::new(sample_rate))),
            InstrumentSpec::Piano { .. } => Kernel::Piano(Box::new(Piano::new(sample_rate))),
            InstrumentSpec::Synth { .. } => Kernel::Synth(Box::new(Synth::new(sample_rate))),
            InstrumentSpec::Plugin(p) => Kernel::Plugin(Box::new(PluginKernel::new(p.slot.take()))),
        };
        let mut player = Self {
            sample_rate,
            kernel,
            clip_ends: [None; KEYS],
            held: [false; KEYS],
            sustain: false,
            sustained: [false; KEYS],
            out_l: vec![0.0; MAX_BLOCK],
            out_r: vec![0.0; MAX_BLOCK],
        };
        player.configure(spec);
        player
    }

    pub fn kind(&self) -> InstrumentKind {
        match self.kernel {
            Kernel::Drums(_) => InstrumentKind::Drums,
            Kernel::Piano(_) => InstrumentKind::Piano,
            Kernel::Synth(_) => InstrumentKind::Synth,
            Kernel::Plugin(_) => InstrumentKind::Plugin,
        }
    }

    /// Takes the settings of a new version of the song (on the audio
    /// thread: it only copies, and the files it lets go of are still the
    /// old song's).
    pub fn configure(&mut self, spec: &InstrumentSpec) {
        match (&mut self.kernel, spec) {
            (Kernel::Drums(k), InstrumentSpec::Drums { kit, samples }) => {
                k.set_kit(**kit);
                for (pad, sample) in samples.iter().enumerate() {
                    k.set_sample(pad, sample.clone());
                }
            }
            (Kernel::Piano(k), InstrumentSpec::Piano { samples }) => k.set_samples(samples.clone()),
            (Kernel::Synth(k), InstrumentSpec::Synth { settings, tables }) => {
                k.set_settings(settings);
                for (slot, table) in tables.iter().enumerate() {
                    k.set_table(slot, table.clone());
                }
            }
            _ => {}
        }
    }

    /// The song's tempo, which the synth's synced LFOs follow (its
    /// starting tempo, as in the browser).
    pub fn set_tempo(&mut self, bpm: f64) {
        if let Kernel::Synth(k) = &mut self.kernel {
            k.set_bpm(bpm);
        }
    }

    /// The pitch bend, -1..1 of the instrument's bend range (the synth
    /// bends, and a plugin is told).
    pub fn set_bend(&mut self, bend: f64) {
        let bend = bend.clamp(-1.0, 1.0);
        match &mut self.kernel {
            Kernel::Synth(k) => k.set_bend(bend),
            // From the next block's start.
            Kernel::Plugin(k) => k.push(0, PluginNote::Bend(bend as f32)),
            _ => {}
        }
    }

    /// The mod wheel, 0..1 (the synth has a use for it, and a plugin is
    /// told).
    pub fn set_mod_wheel(&mut self, amount: f64) {
        let amount = amount.clamp(0.0, 1.0);
        match &mut self.kernel {
            Kernel::Synth(k) => k.set_mod_wheel(amount),
            Kernel::Plugin(k) => k.push(0, PluginNote::ModWheel(amount as f32)),
            _ => {}
        }
    }

    fn seconds(&self, frame: u64) -> f64 {
        frame as f64 / self.sample_rate
    }

    fn key(key: i32) -> Option<usize> {
        usize::try_from(key).ok().filter(|k| *k < KEYS)
    }

    fn on(&mut self, key: i32, vel: f64, at: u64) {
        let time = self.seconds(at);
        match &mut self.kernel {
            Kernel::Drums(k) => k.add_event(DrumEvent {
                time,
                kind: DrumEventKind::On { note: key, vel },
            }),
            Kernel::Piano(k) => k.add_event(PianoEvent {
                time,
                kind: PianoEventKind::On { note: key, vel },
            }),
            // Not until its wavetables are in.
            Kernel::Synth(k) if !(0..3).all(|slot| k.table(slot).is_some()) => {}
            Kernel::Synth(k) => k.add_event(SynthEvent {
                time,
                kind: SynthEventKind::On { note: key, vel },
            }),
            Kernel::Plugin(k) => {
                if let Some(key) = Self::key(key) {
                    k.on(key, vel, at);
                }
            }
        }
    }

    fn off(&mut self, key: i32, at: u64) {
        let time = self.seconds(at);
        match &mut self.kernel {
            // Hits ring out on their own.
            Kernel::Drums(_) => {}
            Kernel::Piano(k) => k.add_event(PianoEvent {
                time,
                kind: PianoEventKind::Off { note: key },
            }),
            Kernel::Synth(k) => k.add_event(SynthEvent {
                time,
                kind: SynthEventKind::Off { note: key },
            }),
            Kernel::Plugin(k) => {
                if let Some(key) = Self::key(key) {
                    k.off(key, at);
                }
            }
        }
    }

    /// Every note releases (`releaseAll`), at `at` on the engine's clock.
    pub fn release_all(&mut self, at: u64) {
        let time = self.seconds(at);
        match &mut self.kernel {
            // Tails keep ringing when playback stops, like a drum machine's.
            Kernel::Drums(_) => {}
            Kernel::Piano(k) => k.add_event(PianoEvent {
                time,
                kind: PianoEventKind::AllOff,
            }),
            Kernel::Synth(k) => k.add_event(SynthEvent {
                time,
                kind: SynthEventKind::AllOff,
            }),
            // Every key it's been told is down.
            Kernel::Plugin(k) => (0..KEYS).for_each(|key| k.off(key, at)),
        }
        self.clip_ends = [None; KEYS];
        self.sustained = [false; KEYS];
    }

    /// The clips' notes sounding stop, at `at` (a jump or the loop going
    /// back).
    pub fn release_clip_notes(&mut self, at: u64) {
        for key in 0..KEYS {
            if self.clip_ends[key].take().is_some() {
                self.off(key as i32, at);
            }
        }
    }

    /// The clips' notes over the timeline's frames [pos, pos + len), which
    /// the engine renders from `at` on its clock.
    pub fn schedule(&mut self, notes: &[Note], pos: i64, len: usize, at: u64) {
        let end = pos + len as i64;
        let frame = |t: i64| at + (t.max(pos) - pos) as u64;
        // Notes ending here (or already past their end).
        for key in 0..KEYS {
            if let Some(e) = self.clip_ends[key]
                && e < end
            {
                self.clip_ends[key] = None;
                self.off(key as i32, frame(e));
            }
        }
        // Notes starting here.
        let first = notes.partition_point(|n| n.start < pos);
        for n in notes[first..].iter().take_while(|n| n.start < end) {
            let Some(key) = Self::key(n.key) else {
                continue;
            };
            if self.clip_ends[key].take().is_some() {
                self.off(n.key, frame(n.start));
            }
            self.on(n.key, n.velocity, frame(n.start));
            if n.end < end {
                self.off(n.key, frame(n.end));
            } else {
                self.clip_ends[key] = Some(n.end);
            }
        }
    }

    /// A key pressed live, at `at` on the engine's clock.
    pub fn key_down(&mut self, key: i32, vel: f64, at: u64) {
        let Some(k) = Self::key(key) else {
            return;
        };
        if self.held[k] {
            return;
        }
        self.held[k] = true;
        self.sustained[k] = false;
        self.on(key, vel, at);
    }

    /// A key let go live: it releases, or waits for the pedal to lift.
    pub fn key_up(&mut self, key: i32, at: u64) {
        let Some(k) = Self::key(key) else {
            return;
        };
        if !self.held[k] {
            return;
        }
        self.held[k] = false;
        if self.sustain {
            self.sustained[k] = true;
        } else {
            self.off(key, at);
        }
    }

    /// The sustain pedal (CC64).
    pub fn set_sustain(&mut self, down: bool, at: u64) {
        self.sustain = down;
        if !down {
            for k in 0..KEYS {
                if std::mem::take(&mut self.sustained[k]) {
                    self.off(k as i32, at);
                }
            }
        }
    }

    /// Renders `n` frames from `at` on the engine's clock; returns them.
    pub fn render(&mut self, n: usize, at: u64) -> (&[f32], &[f32]) {
        let now = self.seconds(at);
        let (l, r) = (&mut self.out_l[..n], &mut self.out_r[..n]);
        match &mut self.kernel {
            Kernel::Drums(k) => k.render(l, r, now),
            Kernel::Piano(k) => {
                l.fill(0.0);
                r.fill(0.0);
                k.render(l, r, now);
            }
            Kernel::Synth(k) => k.render(l, r, now),
            Kernel::Plugin(k) => k.render(l, r, at),
        }
        (&self.out_l[..n], &self.out_r[..n])
    }
}

/// A track's id as the commands that play it live name it: 64-bit FNV-1a
/// (so a command needn't carry the id's text to the audio thread).
pub fn track_key(id: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in id.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}
