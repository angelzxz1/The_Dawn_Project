//! The Crusher's DSP: a character compressor after the classic modern
//! "distortion compressor".
//!
//! Port of `src/effects/crusher/crusherModel.ts` (`CrusherKernel`,
//! `crusherSettingsFromParams`) step for step; `tests/crusher_parity.rs`
//! holds the port to what the JavaScript renders.
//!
//! Input drives the audio into a fixed threshold (-10 dBFS) and Output sets
//! the level after; the knobs read 0-10. Ratio steps through 1:1, 2, 3, 4,
//! 6, 10, 20:1 and Nuke, the knee hardening as it rises; 2:1 releases like
//! an opto (a slow second envelope). British Mode takes over the ratio with
//! a slope past infinity:1 and a release twice as fast. Dist 2 and Dist 3
//! add mostly even and odd harmonics. The detector hears the input after
//! Input, through the HP filter and the Band emphasis, both sides linked.
//! The gain, the distortion and Mix run at twice the rate (15 samples of
//! latency).

use std::f64::consts::{LN_10, PI};

use crate::effects::glue::{Fir, fir};
use crate::instruments::js_round;
use crate::params::ParamSource;

/// Ratio steps' labels.
pub const RATIO_LABELS: [&str; 8] = ["1:1", "2:1", "3:1", "4:1", "6:1", "10:1", "20:1", "Nuke"];
const SLOPES: [f64; 8] = [
    0.0,
    1.0 / 2.0,
    2.0 / 3.0,
    3.0 / 4.0,
    5.0 / 6.0,
    9.0 / 10.0,
    19.0 / 20.0,
    1.0,
];
const KNEES: [f64; 8] = [0.0, 14.0, 10.0, 8.0, 6.0, 4.0, 2.0, 0.0];
const BRITISH_SLOPE: f64 = 1.15;
const BRITISH_KNEE: f64 = 3.0;
/// The fixed threshold Input drives into, dBFS.
pub const THRESHOLD_DB: f64 = -10.0;
/// Oversampling's latency, in samples at the base rate.
pub const LATENCY: usize = 15;

const CR_DB: f64 = LN_10 / 20.0;
const K2: f64 = 0.6;
const B2: f64 = 0.3;
const K3: f64 = 1.3;

fn clamp_step(v: f64, n: usize) -> usize {
    js_round(v).min((n - 1) as f64).max(0.0) as usize
}

fn knob(v: f64) -> f64 {
    v.clamp(0.0, 10.0) / 10.0
}

/// Input's gain, dB, for its knob.
pub fn input_db(v: f64) -> f64 {
    40.0 * knob(v) - 10.0
}
/// Output's gain, dB, for its knob.
pub fn output_db(v: f64) -> f64 {
    40.0 * knob(v) - 30.0
}
/// Attack, seconds, for its knob.
pub fn attack(v: f64) -> f64 {
    0.00005 * 600f64.powf(knob(v))
}
/// Release, seconds, for its knob.
pub fn release(v: f64) -> f64 {
    0.05 * 70f64.powf(knob(v))
}

/// The kernel's settings (`CrusherSettings`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CrusherSettings {
    pub input_db: f64,
    pub output_db: f64,
    /// Seconds.
    pub attack: f64,
    /// Seconds.
    pub release: f64,
    /// dB taken off per dB over the threshold.
    pub slope: f64,
    pub knee_db: f64,
    /// The 2:1 step's two-stage release.
    pub opto: bool,
    /// 0 Clean, 1 Dist 2, 2 Dist 3.
    pub dist: usize,
    pub det_hp: bool,
    pub det_band: bool,
    pub mix: f64,
}

impl CrusherSettings {
    /// The settings for the effect's parameters (`crusherSettingsFromParams`).
    pub fn from_params<P: ParamSource + ?Sized>(p: &P) -> Self {
        let british = p.param_or("british", 0.0) >= 0.5;
        let ratio = clamp_step(p.param_or("ratio", 3.0), SLOPES.len());
        let release = release(p.param_or("release", 5.0));
        Self {
            input_db: input_db(p.param_or("input", 5.0)),
            output_db: output_db(p.param_or("output", 5.0)),
            attack: attack(p.param_or("attack", 5.0)),
            release: if british { release / 2.0 } else { release },
            slope: if british {
                BRITISH_SLOPE
            } else {
                SLOPES[ratio]
            },
            knee_db: if british { BRITISH_KNEE } else { KNEES[ratio] },
            opto: !british && ratio == 1,
            dist: clamp_step(p.param_or("dist", 0.0), 3),
            det_hp: p.param_or("detHp", 0.0) >= 0.5,
            det_band: p.param_or("detBand", 0.0) >= 0.5,
            mix: p.param_or("mix", 1.0).clamp(0.0, 1.0),
        }
    }
}

impl Default for CrusherSettings {
    fn default() -> Self {
        Self::from_params(&[] as &[(&str, f64)])
    }
}

/// A biquad (transposed direct form II), a state per channel.
#[derive(Clone)]
struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: [f64; 2],
    z2: [f64; 2],
}

impl Biquad {
    fn new(b0: f64, b1: f64, b2: f64, a1: f64, a2: f64) -> Self {
        Self {
            b0,
            b1,
            b2,
            a1,
            a2,
            z1: [0.0; 2],
            z2: [0.0; 2],
        }
    }

    /// First-order high-pass (bilinear).
    fn highpass(f: f64, sr: f64) -> Self {
        let k = (PI * f / sr).tan();
        let n = 1.0 / (1.0 + k);
        Self::new(n, -n, 0.0, (k - 1.0) * n, 0.0)
    }

    /// A peaking boost (the cookbook's).
    fn peak(f: f64, q: f64, db: f64, sr: f64) -> Self {
        let a = 10f64.powf(db / 40.0);
        let w = 2.0 * PI * f / sr;
        let cs = w.cos();
        let alpha = w.sin() / (2.0 * q);
        let a0 = 1.0 + alpha / a;
        Self::new(
            (1.0 + alpha * a) / a0,
            (-2.0 * cs) / a0,
            (1.0 - alpha * a) / a0,
            (-2.0 * cs) / a0,
            (1.0 - alpha / a) / a0,
        )
    }

    fn run(&mut self, x: f64, c: usize) -> f64 {
        let y = self.b0 * x + self.z1[c];
        self.z1[c] = self.b1 * x - self.a1 * y + self.z2[c];
        self.z2[c] = self.b2 * x - self.a2 * y;
        y
    }
}

/// How much of "d dB past the threshold" counts, with a soft knee W dB
/// wide.
fn knee(d: f64, w: f64) -> f64 {
    if 2.0 * d >= w {
        return d;
    }
    if w > 0.0 && 2.0 * d > -w {
        return ((d + w / 2.0) * (d + w / 2.0)) / (2.0 * w);
    }
    0.0
}

/// The gain reduction (dB, >= 0) for a level `x` dB on the settings'
/// static curve (`crusherCurve`).
pub fn curve(s: &CrusherSettings, x: f64) -> f64 {
    s.slope * knee(x - THRESHOLD_DB, s.knee_db)
}

/// The meters since they were last read: gain reduction (dB, >= 0) and the
/// output and input peaks.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CrusherMeters {
    pub gain_reduction: f64,
    pub output: f64,
    pub input: f64,
}

pub struct CrusherKernel {
    sr: f64,
    hp: Biquad,
    band: Biquad,
    slow_atk: f64,
    dc_r: f64,
    dc_x: [f64; 2],
    dc_y: [f64; 2],
    gr: f64,
    slow: f64,
    gain: f64,
    smooth: f64,
    in_g: f64,
    out_g: f64,
    wet: f64,
    started: bool,
    up_l: Fir,
    up_r: Fir,
    down_l: Fir,
    down_r: Fir,
    slope: f64,
    knee: f64,
    opto: bool,
    atk: f64,
    rel: f64,
    slow_rel: f64,
    dist: usize,
    use_hp: bool,
    use_band: bool,
    in_target: f64,
    out_target: f64,
    wet_target: f64,
    meters: CrusherMeters,
}

impl CrusherKernel {
    pub fn new(sample_rate: f64, settings: &CrusherSettings) -> Self {
        let sr = sample_rate;
        let mut k = Self {
            sr,
            hp: Biquad::highpass(100.0, sr),
            band: Biquad::peak(6800f64.min(sr * 0.45), 1.4, 8.0, sr),
            slow_atk: (-1.0 / (0.4 * sr)).exp(),
            dc_r: ((-2.0 * PI * 8.0) / (2.0 * sr)).exp(),
            dc_x: [0.0; 2],
            dc_y: [0.0; 2],
            gr: 0.0,
            slow: 0.0,
            gain: 1.0,
            smooth: 1.0 - (-1.0 / (0.01 * sr)).exp(),
            in_g: 1.0,
            out_g: 1.0,
            wet: 1.0,
            started: false,
            up_l: Fir::new(),
            up_r: Fir::new(),
            down_l: Fir::new(),
            down_r: Fir::new(),
            slope: 0.0,
            knee: 0.0,
            opto: false,
            atk: 0.0,
            rel: 0.0,
            slow_rel: 0.0,
            dist: 0,
            use_hp: false,
            use_band: false,
            in_target: 1.0,
            out_target: 1.0,
            wet_target: 1.0,
            meters: CrusherMeters::default(),
        };
        k.set(settings);
        k
    }

    pub fn set(&mut self, s: &CrusherSettings) {
        let sr = self.sr;
        self.slope = s.slope;
        self.knee = s.knee_db;
        self.opto = s.opto;
        self.atk = (-1.0 / (s.attack.max(0.000005) * sr)).exp();
        self.rel = (-1.0 / (s.release.max(0.001) * sr)).exp();
        self.slow_rel = (-1.0 / ((0.5 + 4.0 * s.release) * sr)).exp();
        self.dist = s.dist;
        self.use_hp = s.det_hp;
        self.use_band = s.det_band;
        self.in_target = (s.input_db * CR_DB).exp();
        self.out_target = (s.output_db * CR_DB).exp();
        self.wet_target = s.mix.clamp(0.0, 1.0);
        if !self.started {
            self.in_g = self.in_target;
            self.out_g = self.out_target;
            self.wet = self.wet_target;
            self.started = true;
        }
    }

    /// The frames oversampling delays the audio by.
    pub fn latency(&self) -> usize {
        LATENCY
    }

    /// The gain (linear) for one sample of the detector's input.
    fn detect(&mut self, kl: f64, kr: f64) -> f64 {
        let level = kl.abs().max(kr.abs());
        let x = if level > 1e-6 {
            level.ln() / CR_DB
        } else {
            -120.0
        };
        let t = self.slope * knee(x - THRESHOLD_DB, self.knee);
        self.gr = if t > self.gr {
            t + self.atk * (self.gr - t)
        } else {
            t + self.rel * (self.gr - t)
        };
        let mut g = self.gr;
        if self.opto {
            self.slow = if t > self.slow {
                t + self.slow_atk * (self.slow - t)
            } else {
                t + self.slow_rel * (self.slow - t)
            };
            if self.slow > g {
                g = self.slow;
            }
        }
        if g > self.meters.gain_reduction {
            self.meters.gain_reduction = g;
        }
        (-g * CR_DB).exp()
    }

    /// The distortion on one (doubled-rate) sample of channel `c`.
    fn shape(&mut self, x: f64, c: usize) -> f64 {
        match self.dist {
            1 => {
                let t2 = (K2 * B2).tanh();
                let n2 = 1.0 / (K2 * (1.0 - t2 * t2));
                let y = ((K2 * (x + B2)).tanh() - t2) * n2;
                let out = y - self.dc_x[c] + self.dc_r * self.dc_y[c];
                self.dc_x[c] = y;
                self.dc_y[c] = out;
                out
            }
            2 => (K3 * x).tanh() / K3,
            _ => x,
        }
    }

    /// Processes `out_l.len()` frames of `in_l`/`in_r` (a missing left is
    /// silence, a missing right the left) into the outputs.
    pub fn process(
        &mut self,
        in_l: Option<&[f32]>,
        in_r: Option<&[f32]>,
        out_l: &mut [f32],
        mut out_r: Option<&mut [f32]>,
    ) {
        for i in 0..out_l.len() {
            let l = in_l.map_or(0.0, |b| b[i] as f64);
            let r = in_r.map_or(l, |b| b[i] as f64);
            let (yl, yr) = self.tick(l, r);
            out_l[i] = yl as f32;
            if let Some(o) = out_r.as_mut() {
                o[i] = yr as f32;
            }
        }
    }

    /// As `process`, over its stereo input.
    pub fn process_in_place(&mut self, left: &mut [f32], right: &mut [f32]) {
        for i in 0..left.len().min(right.len()) {
            let (yl, yr) = self.tick(left[i] as f64, right[i] as f64);
            left[i] = yl as f32;
            right[i] = yr as f32;
        }
    }

    fn tick(&mut self, l: f64, r: f64) -> (f64, f64) {
        let smooth = self.smooth;
        if l.abs() > self.meters.input {
            self.meters.input = l.abs();
        }
        if r.abs() > self.meters.input {
            self.meters.input = r.abs();
        }
        self.in_g += (self.in_target - self.in_g) * smooth;
        self.out_g += (self.out_target - self.out_g) * smooth;
        self.wet += (self.wet_target - self.wet) * smooth;
        let in_g = self.in_g;
        let (mut kl, mut kr) = (l * in_g, r * in_g);
        if self.use_hp {
            kl = self.hp.run(kl, 0);
            kr = self.hp.run(kr, 1);
        }
        if self.use_band {
            kl = self.band.run(kl, 0);
            kr = self.band.run(kr, 1);
        }
        let g = self.detect(kl, kr);
        // Up (zero-stuffed, x2 to keep the level), process - the dry is the
        // same upsampled input, so it stays in line - then down.
        let h = fir();
        let g_prev = self.gain;
        let w = self.wet;
        let out = self.out_g;
        let (mut yl, mut yr) = (0.0, 0.0);
        for k in 0..2 {
            self.up_l.push(if k == 0 { 2.0 * l } else { 0.0 });
            self.up_r.push(if k == 0 { 2.0 * r } else { 0.0 });
            let gk = (if k == 0 { (g_prev + g) / 2.0 } else { g }) * in_g;
            let xl = self.up_l.out(h);
            let xr = self.up_r.out(h);
            let dl = xl * (1.0 - w) + self.shape(xl * gk, 0) * out * w;
            self.down_l.push(dl);
            let dr = xr * (1.0 - w) + self.shape(xr * gk, 1) * out * w;
            self.down_r.push(dr);
            // Keep the even-phase output: an exact 15-sample delay.
            if k == 0 {
                yl = self.down_l.out(h);
                yr = self.down_r.out(h);
            }
        }
        self.gain = g;
        let a = yl.abs().max(yr.abs());
        if a > self.meters.output {
            self.meters.output = a;
        }
        (yl, yr)
    }

    pub fn take_meters(&mut self) -> CrusherMeters {
        std::mem::take(&mut self.meters)
    }
}
