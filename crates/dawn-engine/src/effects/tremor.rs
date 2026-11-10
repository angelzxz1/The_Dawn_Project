//! The Tremor, Dawn's bass amp: three voices (Tube, a tube preamp; Grind, a
//! blend drive; Split, a three-band distortion with the lows kept clean),
//! each a clean path squeezed by a compressor and a dirty path driven by
//! Gain, mixed by Blend, then a three-band EQ and the voice's switches.
//! Mono, everything at 4x the rate (the Furnace's oversampling filters).
//!
//! Port of `src/effects/tremor/tremorModel.ts` (`TremorKernel`, and
//! `tremorSettingsFromParams` for what the knobs mean) step for step;
//! `tests/tremor_parity.rs` holds the port to what the JavaScript renders.
//! Like the worklet (`tremor.ts`) it plays the stereo input's mix,
//! 0.5 * (L + R), and feeds both sides.

use std::f64::consts::FRAC_1_SQRT_2;

use crate::effects::amp::{Biquad, OS, OnePole, Shape, TAPS, design_fir, triode};
use crate::instruments::js_round;
use crate::params::ParamSource;

/// Latency (frames at the base rate) of the oversampling: the amp's.
pub const LATENCY: usize = crate::effects::amp::LATENCY;

/// Middle's frequencies (`TREMOR_MID_FREQS`).
const MID_FREQS: [f64; 4] = [250.0, 500.0, 1000.0, 2000.0];

/// The kernel's settings (`TremorSettings`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TremorSettings {
    /// 0 Tube, 1 Grind, 2 Split.
    pub voice: usize,
    pub drive: f64,
    pub blend: f64,
    pub dirt_trim: f64,
    pub comp_threshold: f64,
    pub comp_ratio: f64,
    pub comp_makeup: f64,
    pub bass_db: f64,
    pub mid_db: f64,
    pub mid_hz: f64,
    pub treble_db: f64,
    pub ultra_lo: usize,
    pub ultra_hi: bool,
    pub grunt: usize,
    pub attack: usize,
    pub low_split: f64,
    pub high_split: f64,
    pub mid_level: f64,
    pub high_level: f64,
    pub output: f64,
}

/// Per voice: the drive's range (dB at Gain 0 and 10) and the dirty
/// path's trim (dB) (`VOICE_DRIVE`).
const VOICE_DRIVE: [(f64, f64, f64); 3] =
    [(0.0, 34.0, -8.0), (6.0, 48.0, -16.0), (6.0, 44.0, -6.0)];

impl TremorSettings {
    /// The settings for the effect's parameters (`tremorSettingsFromParams`).
    pub fn from_params<P: ParamSource + ?Sized>(p: &P) -> Self {
        let step = |key: &str, fallback: f64, n: usize| {
            js_round(p.param_or(key, fallback)).clamp(0.0, (n - 1) as f64) as usize
        };
        let tenth = |key: &str, fallback: f64| p.param_or(key, fallback).clamp(0.0, 10.0) / 10.0;
        let clamp_to =
            |key: &str, fallback: f64, lo: f64, hi: f64| p.param_or(key, fallback).clamp(lo, hi);
        let eq_db = |key: &str| (clamp_to(key, 5.0, 0.0, 10.0) - 5.0) * 2.4;
        let voice = step("voice", 0.0, 3);
        let (lo, hi, trim) = VOICE_DRIVE[voice];
        let comp = tenth("comp", 3.0);
        Self {
            voice,
            drive: 10f64.powf((lo + (hi - lo) * tenth("gain", 5.0)) / 20.0),
            blend: tenth("blend", 6.0),
            dirt_trim: 10f64.powf(trim / 20.0),
            comp_threshold: -10.0 - 20.0 * comp,
            comp_ratio: 1.0 + 7.0 * comp,
            comp_makeup: 9.0 * comp,
            bass_db: eq_db("bass"),
            mid_db: eq_db("mid"),
            mid_hz: MID_FREQS[step("midFreq", 1.0, MID_FREQS.len())],
            treble_db: eq_db("treble"),
            ultra_lo: step("ultraLo", 0.0, 3),
            ultra_hi: p.param_or("ultraHi", 0.0) >= 0.5,
            grunt: step("grunt", 1.0, 3),
            attack: step("attack", 1.0, 3),
            low_split: clamp_to("lowSplit", 250.0, 60.0, 500.0),
            high_split: clamp_to("highSplit", 2000.0, 800.0, 6000.0),
            mid_level: clamp_to("midLevel", 0.0, -24.0, 12.0),
            high_level: clamp_to("highLevel", -6.0, -24.0, 12.0),
            output: clamp_to("output", 0.0, -24.0, 24.0),
        }
    }
}

impl Default for TremorSettings {
    fn default() -> Self {
        Self::from_params(&[] as &[(&str, f64)])
    }
}

/// Two cascaded Butterworth sections (`Lr4`): a 24 dB/octave crossover
/// side.
#[derive(Clone, Copy, Default)]
struct Lr4 {
    a: Biquad,
    b: Biquad,
}

impl Lr4 {
    fn set(&mut self, shape: Shape, fc: f64, fs: f64) {
        self.a.set(shape, fc, FRAC_1_SQRT_2, 0.0, fs);
        self.b.set(shape, fc, FRAC_1_SQRT_2, 0.0, fs);
    }
    fn run(&mut self, x: f64) -> f64 {
        let y = self.a.run(x);
        self.b.run(y)
    }
}

/// The tube stage (`tubeClip`): biased, so it clips one side first.
fn tube_clip(u: f64) -> f64 {
    triode(u + 0.3, 1.8) - triode(0.3, 1.8)
}

/// The kernel (`TremorKernel`), mono.
pub struct TremorKernel {
    fs: f64,
    s: TremorSettings,
    h: [f64; TAPS],
    up: [f64; 2 * TAPS / OS],
    up_pos: usize,
    down: [f64; 2 * TAPS],
    down_pos: usize,
    in_hp: OnePole,
    env: f64,
    atk: f64,
    rel: f64,
    low_lp: Lr4,
    rest_hp: Lr4,
    mid_lp: Lr4,
    high_hp: Lr4,
    pre_hp: OnePole,
    pre_shelf: Biquad,
    pre_top: Biquad,
    stage_hp: OnePole,
    post_lp: Biquad,
    high_lp: OnePole,
    bass: Biquad,
    mid: Biquad,
    treble: Biquad,
    ultra_low: Biquad,
    ultra_mid: Biquad,
    ultra_high: Biquad,
    dc: OnePole,
    mid_gain: f64,
    high_gain: f64,
    out_gain: f64,
    makeup: f64,
}

impl TremorKernel {
    pub fn new(sample_rate: f64, settings: &TremorSettings) -> Self {
        let mut k = Self {
            fs: sample_rate * OS as f64,
            s: *settings,
            h: design_fir(),
            up: [0.0; 2 * TAPS / OS],
            up_pos: 0,
            down: [0.0; 2 * TAPS],
            down_pos: 0,
            in_hp: OnePole::default(),
            env: 0.0,
            atk: 0.0,
            rel: 0.0,
            low_lp: Lr4::default(),
            rest_hp: Lr4::default(),
            mid_lp: Lr4::default(),
            high_hp: Lr4::default(),
            pre_hp: OnePole::default(),
            pre_shelf: Biquad::default(),
            pre_top: Biquad::default(),
            stage_hp: OnePole::default(),
            post_lp: Biquad::default(),
            high_lp: OnePole::default(),
            bass: Biquad::default(),
            mid: Biquad::default(),
            treble: Biquad::default(),
            ultra_low: Biquad::default(),
            ultra_mid: Biquad::default(),
            ultra_high: Biquad::default(),
            dc: OnePole::default(),
            mid_gain: 1.0,
            high_gain: 1.0,
            out_gain: 1.0,
            makeup: 1.0,
        };
        k.set(settings);
        k
    }

    /// Takes new settings (on the audio thread: no allocation).
    pub fn set(&mut self, s: &TremorSettings) {
        self.s = *s;
        let fs = self.fs;
        self.in_hp.lowpass(25.0, fs);
        self.atk = 1.0 - (-1.0 / (0.005 * fs)).exp();
        self.rel = 1.0 - (-1.0 / (0.15 * fs)).exp();
        self.low_lp.set(Shape::Lp, s.low_split, fs);
        self.rest_hp.set(Shape::Hp, s.low_split, fs);
        self.mid_lp.set(Shape::Lp, s.high_split, fs);
        self.high_hp.set(Shape::Hp, s.high_split, fs);
        match s.voice {
            0 => {
                self.pre_hp.lowpass(40.0, fs);
                self.pre_shelf.set(Shape::LowShelf, 100.0, 0.7, 0.0, fs);
                self.pre_top.set(Shape::HighShelf, 2000.0, 0.7, 0.0, fs);
                self.stage_hp.lowpass(20.0, fs);
                self.post_lp.set(Shape::Lp, 6500.0, 0.7, 0.0, fs);
            }
            1 => {
                self.pre_hp.lowpass([280.0, 110.0, 50.0][s.grunt], fs);
                let fat = if s.grunt == 2 { 6.0 } else { 0.0 };
                self.pre_shelf.set(Shape::LowShelf, 120.0, 0.7, fat, fs);
                self.pre_top.set(
                    Shape::HighShelf,
                    2000.0,
                    0.7,
                    [-6.0, 0.0, 6.0][s.attack],
                    fs,
                );
                self.stage_hp.lowpass(30.0, fs);
                self.post_lp.set(Shape::Lp, 5500.0, 0.7, 0.0, fs);
            }
            _ => {
                self.pre_hp.lowpass(10.0, fs);
                self.pre_shelf.set(Shape::LowShelf, 100.0, 0.7, 0.0, fs);
                self.pre_top.set(Shape::HighShelf, 2000.0, 0.7, 0.0, fs);
                self.stage_hp.lowpass(20.0, fs);
                self.post_lp.set(Shape::Lp, 7000.0, 0.7, 0.0, fs);
                self.high_lp.lowpass(10000.0, fs);
            }
        }
        self.mid_gain = 10f64.powf(s.mid_level / 20.0);
        self.high_gain = 10f64.powf(s.high_level / 20.0);
        self.bass.set(Shape::LowShelf, 100.0, 0.7, s.bass_db, fs);
        self.mid.set(Shape::Peak, s.mid_hz, 0.9, s.mid_db, fs);
        self.treble
            .set(Shape::HighShelf, 4000.0, 0.7, s.treble_db, fs);
        let tube = s.voice == 0;
        if tube && s.ultra_lo == 2 {
            self.ultra_low.set(Shape::Hp, 70.0, 0.7, 0.0, fs);
        } else {
            let deep = if tube && s.ultra_lo == 1 { 4.0 } else { 0.0 };
            self.ultra_low.set(Shape::LowShelf, 45.0, 0.7, deep, fs);
        }
        let scoop = if tube && s.ultra_lo == 1 { -8.0 } else { 0.0 };
        self.ultra_mid.set(Shape::Peak, 500.0, 0.7, scoop, fs);
        let air = if tube && s.ultra_hi { 8.0 } else { 0.0 };
        self.ultra_high.set(Shape::HighShelf, 8000.0, 0.7, air, fs);
        self.dc.lowpass(10.0, fs);
        self.out_gain = 10f64.powf(s.output / 20.0);
        self.makeup = 10f64.powf(s.comp_makeup / 20.0);
    }

    /// The clean path's compressor (`compress`): a peak detector in dB,
    /// hard knee.
    fn compress(&mut self, x: f64) -> f64 {
        let s = self.s;
        if s.comp_ratio <= 1.0 {
            return x;
        }
        let level = 20.0 * (x.abs() + 1e-9).log10();
        let rate = if level > self.env { self.atk } else { self.rel };
        self.env += rate * (level - self.env);
        let over = self.env - s.comp_threshold;
        let gr = if over > 0.0 {
            over * (1.0 - 1.0 / s.comp_ratio)
        } else {
            0.0
        };
        x * 10f64.powf(-gr / 20.0) * self.makeup
    }

    /// One sample at the oversampled rate.
    fn tick(&mut self, x: f64) -> f64 {
        let s = self.s;
        let x = self.in_hp.hp(x);
        let (clean, dirty);
        if s.voice == 2 {
            clean = self.low_lp.run(x);
            let rest = self.rest_hp.run(x);
            let mid = (self.mid_lp.run(rest) * s.drive).tanh();
            let high = (self.high_hp.run(rest) * s.drive * 2.0).tanh();
            dirty = self.post_lp.run(mid) * self.mid_gain + self.high_lp.lp(high) * self.high_gain;
        } else {
            clean = x;
            let pre = self.pre_hp.hp(x);
            let pre = self.pre_shelf.run(pre);
            let mut u = self.pre_top.run(pre) * s.drive;
            if s.voice == 0 {
                u = tube_clip(u);
                u = self.stage_hp.hp(u);
                u = (1.5 * u).tanh() / 1.5;
            } else {
                u = u.tanh();
                u = self.stage_hp.hp(u);
                let v = 2.5 * u;
                u = v / (1.0 + v * v).sqrt();
            }
            dirty = self.post_lp.run(u);
        }
        let clean = self.compress(clean);
        let mut y = (1.0 - s.blend) * clean + s.blend * dirty * s.dirt_trim;
        y = self.bass.run(y);
        y = self.mid.run(y);
        y = self.treble.run(y);
        y = self.ultra_low.run(y);
        y = self.ultra_mid.run(y);
        y = self.ultra_high.run(y);
        self.dc.hp(y) * self.out_gain
    }

    /// One block of mono `input` (none: silence) into `output`.
    pub fn process(&mut self, input: Option<&[f32]>, output: &mut [f32]) {
        for (i, out) in output.iter_mut().enumerate() {
            let x = input.map_or(0.0, |b| b[i] as f64) * OS as f64;
            *out = self.sample(x);
        }
    }

    /// One base-rate sample (already scaled by the oversampling factor).
    fn sample(&mut self, x: f64) -> f32 {
        let l = TAPS / OS;
        self.up_pos = if self.up_pos == 0 {
            l - 1
        } else {
            self.up_pos - 1
        };
        self.up[self.up_pos] = x;
        self.up[self.up_pos + l] = x;
        for p in 0..OS {
            let mut v = 0.0;
            for k in 0..l {
                v += self.h[p + OS * k] * self.up[self.up_pos + k];
            }
            let y = self.tick(v);
            self.down_pos = if self.down_pos == 0 {
                TAPS - 1
            } else {
                self.down_pos - 1
            };
            self.down[self.down_pos] = y;
            self.down[self.down_pos + TAPS] = y;
        }
        let mut acc = 0.0;
        for k in 0..TAPS {
            acc += self.h[k] * self.down[self.down_pos + k];
        }
        acc as f32
    }

    /// Processes a stereo block in place, as the browser plays it: the
    /// input's mix on both sides.
    pub fn process_in_place(&mut self, left: &mut [f32], right: &mut [f32]) {
        for (a, b) in left.iter_mut().zip(right.iter_mut()) {
            let mono = 0.5 * (*a + *b);
            let y = self.sample(mono as f64 * OS as f64);
            *a = y;
            *b = y;
        }
    }
}
