//! The Pitch Shift's DSP, two ways: Studio, a phase vocoder that moves each
//! spectral peak (and the bins around it, phase-locked) to its new
//! frequency, starting the phases over on an attack and keeping the
//! pre-echo down; and Live, a delay-line shifter whose splices land where
//! the waveform matches best and which jumps to just behind each pick
//! attack. Feedback returns the output into the input; the dry path waits
//! as long as the shifted one and Dry/Wet blends them equal-power.
//!
//! Port of `src/effects/pitch-shift/pitchShiftKernel.ts` (`PitchKernel`,
//! and `pitchSettingsFromParams`) step for step, held to it by
//! `tests/pitch_shift_parity.rs`.

use std::f64::consts::PI;

use crate::instruments::js_round;
use crate::params::ParamSource;

const TWO_PI: f64 = 2.0 * PI;
/// Live's delay line and the dry path's (frames).
pub const BUFFER: usize = 65536;
const MASK: usize = BUFFER - 1;
/// Live's shortest delay (frames): room for the interpolator.
pub const LIVE_FLOOR: usize = 4;
/// Where Live plays an attack from (s).
pub const LIVE_ATTACK: f64 = 0.003;

/// Studio's frame size at a sample rate (`pitchFrameSize`).
pub fn frame_size(sample_rate: f64) -> usize {
    if sample_rate > 50000.0 { 8192 } else { 4096 }
}

/// The kernel's settings (`PitchKernelSettings`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PitchShiftSettings {
    /// 0 Live, 1 Studio.
    pub mode: u8,
    pub ratio: f64,
    /// Live's window (s).
    pub window: f64,
    pub feedback: f64,
    /// 0..1 dry/wet, equal-power.
    pub wet: f64,
}

impl PitchShiftSettings {
    /// The settings for the effect's parameters (`pitchSettingsFromParams`).
    pub fn from_params<P: ParamSource + ?Sized>(p: &P) -> Self {
        let clamp =
            |key: &str, fallback: f64, lo: f64, hi: f64| p.param_or(key, fallback).clamp(lo, hi);
        let pitch = clamp("pitch", 0.0, -24.0, 24.0);
        let fine = clamp("fine", 0.0, -100.0, 100.0);
        Self {
            mode: if p.param_or("mode", 1.0) >= 0.5 { 1 } else { 0 },
            ratio: 2f64.powf((pitch + fine / 100.0) / 12.0),
            window: clamp("window", 0.04, 0.02, 0.25),
            feedback: clamp("feedback", 0.0, 0.0, 0.9),
            wet: clamp("wet", 1.0, 0.0, 1.0),
        }
    }

    /// The frames the sound is delayed by (`pitchLatency`).
    pub fn latency(&self, sample_rate: f64) -> usize {
        if self.mode == 1 {
            frame_size(sample_rate)
        } else {
            LIVE_FLOOR + js_round(LIVE_ATTACK * sample_rate) as usize
        }
    }
}

impl Default for PitchShiftSettings {
    fn default() -> Self {
        Self::from_params(&[] as &[(&str, f64)])
    }
}

fn princarg(x: f64) -> f64 {
    x - TWO_PI * (x / TWO_PI + 0.5).floor()
}

/// In-place radix-2 complex FFT (`Fft`): forward e^-i, inverse e^+i,
/// unscaled.
struct Fft {
    n: usize,
    rev: Vec<usize>,
    cos: Vec<f64>,
    sin: Vec<f64>,
}

impl Fft {
    fn new(n: usize) -> Self {
        let bits = n.trailing_zeros();
        let rev = (0..n)
            .map(|i| {
                let mut r = 0;
                for b in 0..bits {
                    if i & (1 << b) != 0 {
                        r |= 1 << (bits - 1 - b);
                    }
                }
                r
            })
            .collect();
        let half = n / 2;
        Self {
            n,
            rev,
            cos: (0..half)
                .map(|i| (TWO_PI * i as f64 / n as f64).cos())
                .collect(),
            sin: (0..half)
                .map(|i| (TWO_PI * i as f64 / n as f64).sin())
                .collect(),
        }
    }

    fn run(&self, re: &mut [f64], im: &mut [f64], inverse: bool) {
        let n = self.n;
        for i in 0..n {
            let j = self.rev[i];
            if j > i {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
        let mut size = 2;
        while size <= n {
            let half = size / 2;
            let step = n / size;
            let mut start = 0;
            while start < n {
                for k in 0..half {
                    let wr = self.cos[k * step];
                    let wi = if inverse {
                        self.sin[k * step]
                    } else {
                        -self.sin[k * step]
                    };
                    let (a, b) = (start + k, start + k + half);
                    let xr = re[b] * wr - im[b] * wi;
                    let xi = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - xr;
                    im[b] = im[a] - xi;
                    re[a] += xr;
                    im[a] += xi;
                }
                start += size;
            }
            size *= 2;
        }
    }
}

/// Studio's state for one channel (`PvChannel`).
struct PvChannel {
    in_ring: Vec<f64>,
    out_acc: Vec<f64>,
    prev_phase: Vec<f64>,
    psi: Vec<f64>,
    prev_psi: Vec<f64>,
    peaks: Vec<usize>,
    prev_peaks: Vec<usize>,
    n_prev: usize,
    prev_hfc: f64,
}

impl PvChannel {
    fn new(n: usize) -> Self {
        let bins = n / 2 + 1;
        Self {
            in_ring: vec![0.0; n],
            out_acc: vec![0.0; n],
            prev_phase: vec![0.0; bins],
            psi: vec![0.0; bins],
            prev_psi: vec![0.0; bins],
            peaks: vec![0; bins],
            prev_peaks: vec![0; bins],
            n_prev: 0,
            prev_hfc: 0.0,
        }
    }
}

/// Studio's buffers shared by the channels.
struct Scratch {
    re: Vec<f64>,
    im: Vec<f64>,
    yre: Vec<f64>,
    yim: Vec<f64>,
    mag: Vec<f64>,
    phase: Vec<f64>,
    omega: Vec<f64>,
    bound: Vec<usize>,
}

/// The phase vocoder (`Studio`).
struct Studio {
    n: usize,
    hop: usize,
    fft: Fft,
    win: Vec<f64>,
    norm: f64,
    x: Scratch,
    ch: [PvChannel; 2],
    pos: usize,
    count: usize,
}

impl Studio {
    fn new(sample_rate: f64) -> Self {
        let n = frame_size(sample_rate);
        let hop = n / 8;
        let win: Vec<f64> = (0..n)
            .map(|i| 0.5 - 0.5 * (TWO_PI * i as f64 / n as f64).cos())
            .collect();
        let mut sum = 0.0;
        for m in 0..8 {
            sum += win[m * hop] * win[m * hop];
        }
        let bins = n / 2 + 1;
        Self {
            n,
            hop,
            fft: Fft::new(n),
            norm: 1.0 / (sum * n as f64),
            win,
            x: Scratch {
                re: vec![0.0; n],
                im: vec![0.0; n],
                yre: vec![0.0; n],
                yim: vec![0.0; n],
                mag: vec![0.0; bins],
                phase: vec![0.0; bins],
                omega: vec![0.0; bins],
                bound: vec![0; bins + 1],
            },
            ch: [PvChannel::new(n), PvChannel::new(n)],
            pos: 0,
            count: 0,
        }
    }

    /// One frame of channel `which`, added into its output from the next
    /// sample on (`frame`).
    fn frame(&mut self, which: usize, ratio: f64) {
        let (n, hop, half, pos, norm) = (self.n, self.hop, self.n / 2, self.pos, self.norm);
        let hop_f = hop as f64;
        let n_f = n as f64;
        let x = &mut self.x;
        let c = &mut self.ch[which];
        let win = &self.win;
        for (i, w) in win.iter().enumerate() {
            x.re[i] = c.in_ring[(pos + i) % n] * w;
            x.im[i] = 0.0;
        }
        self.fft.run(&mut x.re, &mut x.im, false);
        let mut max_mag = 0.0f64;
        let mut hfc = 0.0;
        for k in 0..=half {
            let m = (x.re[k] * x.re[k] + x.im[k] * x.im[k]).sqrt();
            x.mag[k] = m;
            if m > max_mag {
                max_mag = m;
            }
            hfc += k as f64 * m * m;
            let ph = x.im[k].atan2(x.re[k]);
            x.phase[k] = ph;
            let kf = k as f64;
            x.omega[k] = (TWO_PI * kf) / n_f
                + princarg(ph - c.prev_phase[k] - (TWO_PI * kf * hop_f) / n_f) / hop_f;
            c.prev_phase[k] = ph;
        }
        let onset = hfc > 2.0 * c.prev_hfc && hfc > 1e-6;
        c.prev_hfc = hfc;
        let thresh = max_mag * 1e-4;
        let mut np = 0;
        let mag = &x.mag;
        for k in 2..half - 1 {
            let m = mag[k];
            if m > thresh && m > mag[k - 1] && m >= mag[k + 1] && m > mag[k - 2] && m >= mag[k + 2]
            {
                c.peaks[np] = k;
                np += 1;
            }
        }
        x.bound[0] = 0;
        for i in 1..np {
            let mut lo = c.peaks[i - 1];
            for k in c.peaks[i - 1] + 1..=c.peaks[i] {
                if mag[k] < mag[lo] {
                    lo = k;
                }
            }
            x.bound[i] = lo;
        }
        x.bound[np] = half + 1;
        x.yre.fill(0.0);
        x.yim.fill(0.0);
        let mut q = 0;
        for i in 0..np {
            let p = c.peaks[i];
            let w = ratio * x.omega[p];
            let shift = js_round((w * n_f) / TWO_PI) as i64 - p as i64;
            let dist = |a: usize| (a as i64 - p as i64).abs();
            while q + 1 < c.n_prev && dist(c.prev_peaks[q + 1]) <= dist(c.prev_peaks[q]) {
                q += 1;
            }
            let mut psi = if ratio == 1.0 || onset || c.n_prev == 0 || dist(c.prev_peaks[q]) > 2 {
                x.phase[p]
            } else {
                c.prev_psi[c.prev_peaks[q]] + hop_f * w
            };
            psi = princarg(psi);
            c.psi[p] = psi;
            let rot = psi - x.phase[p];
            for k in x.bound[i]..x.bound[i + 1] {
                let kk = k as i64 + shift;
                if kk < 1 || kk >= half as i64 {
                    continue;
                }
                let kk = kk as usize;
                let ph = x.phase[k] + rot;
                x.yre[kk] += x.mag[k] * ph.cos();
                x.yim[kk] += x.mag[k] * ph.sin();
            }
        }
        for i in 0..np {
            let p = c.peaks[i];
            c.prev_peaks[i] = p;
            c.prev_psi[p] = c.psi[p];
        }
        c.n_prev = np;
        for k in 1..half {
            x.yre[n - k] = x.yre[k];
            x.yim[n - k] = -x.yim[k];
        }
        self.fft.run(&mut x.yre, &mut x.yim, true);
        // Pre-echo: in a frame where an attack starts, the shifted sound
        // before it is brought down to the input's own level there.
        let mut onset_at = 0;
        let mut sum = 0.0;
        for b in 0..n / 64 {
            let mut e = 0.0;
            for i in b * 64..b * 64 + 64 {
                let v = c.in_ring[(pos + i) % n];
                e += v * v;
            }
            if b >= 2 && e > (10.0 * sum) / b as f64 && e > 1e-7 {
                onset_at = b * 64;
                break;
            }
            sum += e;
        }
        let mut gain = 1.0;
        if onset_at > 0 {
            let (mut want, mut got) = (0.0, 0.0);
            for (i, w) in win.iter().enumerate().take(onset_at) {
                let v = c.in_ring[(pos + i) % n] * w;
                let y = x.yre[i] / n_f;
                want += v * v;
                got += y * y;
            }
            if got > want {
                gain = (want / got).sqrt();
            }
        }
        for (i, w) in win.iter().enumerate() {
            let g = if i >= onset_at {
                1.0
            } else if i + 64 < onset_at {
                gain
            } else {
                gain + ((1.0 - gain) * (i as f64 - onset_at as f64 + 64.0)) / 64.0
            };
            let at = (pos + i) % n;
            c.out_acc[at] += x.yre[i] * g * w * norm;
        }
    }

    fn tick(&mut self, xl: f64, xr: f64, ratio: f64) -> (f64, f64) {
        let p = self.pos;
        let [a, b] = &mut self.ch;
        let yl = a.out_acc[p];
        a.out_acc[p] = 0.0;
        a.in_ring[p] = xl;
        let yr = b.out_acc[p];
        b.out_acc[p] = 0.0;
        b.in_ring[p] = xr;
        self.pos = (p + 1) % self.n;
        self.count += 1;
        if self.count == self.hop {
            self.count = 0;
            self.frame(0, ratio);
            self.frame(1, ratio);
        }
        (yl, yr)
    }
}

/// The delay line with matched splices (`Live`).
struct Live {
    sr: f64,
    buf: [Box<[f64]>; 2],
    write: usize,
    d: f64,
    d_old: f64,
    fade_len: usize,
    fade_pos: usize,
    corr: usize,
    win: f64,
    search: f64,
    pad: usize,
    fast: f64,
    slow: f64,
    hold: usize,
    a_fast: f64,
    a_slow: f64,
}

impl Live {
    fn new(sample_rate: f64) -> Self {
        Self {
            sr: sample_rate,
            buf: [
                vec![0.0; BUFFER].into_boxed_slice(),
                vec![0.0; BUFFER].into_boxed_slice(),
            ],
            write: 0,
            d: -1.0,
            d_old: 0.0,
            fade_len: 0,
            fade_pos: 0,
            corr: js_round(0.008 * sample_rate) as usize,
            win: 0.0,
            search: 0.0,
            pad: js_round(LIVE_ATTACK * sample_rate) as usize,
            fast: 0.0,
            slow: 0.0,
            hold: 0,
            a_fast: 1.0 - (-1.0 / (0.001 * sample_rate)).exp(),
            a_slow: 1.0 - (-1.0 / (0.05 * sample_rate)).exp(),
        }
    }

    fn reset(&mut self, win: f64) {
        self.win = js_round(win * self.sr);
        self.search = js_round((0.012 * self.sr).min(self.win / 4.0));
        self.d = (LIVE_FLOOR + self.pad) as f64;
        self.fade_len = 0;
        self.fade_pos = 0;
    }

    fn fade_for(&self, ratio: f64) -> usize {
        let cap = js_round(0.012 * self.sr);
        let room = ((0.45 * self.win) / (1.0 - ratio).abs()).floor();
        16f64.max(cap.min(room)) as usize
    }

    /// 4-point Hermite interpolation at `pos` (wrapping).
    fn read(buf: &[f64], pos: f64) -> f64 {
        let i = pos.floor();
        let f = pos - i;
        let i = i as i64;
        let at = |k: i64| buf[(k & MASK as i64) as usize];
        let (y0, y1, y2, y3) = (at(i - 1), at(i), at(i + 1), at(i + 2));
        let c1 = 0.5 * (y2 - y0);
        let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
        let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
        ((c3 * f + c2) * f + c1) * f + y1
    }

    /// Jumps the tap by lo..hi frames, to where the recent waveform matches
    /// best, and starts the crossfade (`splice`).
    fn splice(&mut self, lo: i64, hi: i64, fade: usize) {
        let m = MASK as i64;
        let (l, r) = (&self.buf[0], &self.buf[1]);
        let at = (self.write as f64 - self.d).floor() as i64;
        let (mut best, mut best_score) = (lo, f64::NEG_INFINITY);
        for s in lo..=hi {
            let (mut ab, mut bb) = (0.0, 0.0);
            let mut j = 0;
            while j < self.corr as i64 {
                let ia = ((at - j) & m) as usize;
                let ib = ((at - s - j) & m) as usize;
                let a = l[ia] + r[ia];
                let b = l[ib] + r[ib];
                ab += a * b;
                bb += b * b;
                j += 2;
            }
            let score = ab / (bb + 1e-12).sqrt();
            if score > best_score {
                best_score = score;
                best = s;
            }
        }
        self.d_old = self.d;
        self.d += best as f64;
        self.fade_len = fade;
        self.fade_pos = 0;
    }

    fn tick(&mut self, xl: f64, xr: f64, ratio: f64) -> (f64, f64) {
        let w = self.write;
        self.buf[0][w] = xl;
        self.buf[1][w] = xr;
        let v = 0.5 * (xl + xr).abs();
        self.fast += self.a_fast * (v - self.fast);
        self.slow += self.a_slow * (v - self.slow);
        if self.hold > 0 {
            self.hold -= 1;
        } else if ratio != 1.0 && self.fast > 3.0 * self.slow + 1e-4 {
            self.hold = js_round(0.08 * self.sr) as usize;
            let to = if ratio < 1.0 {
                (LIVE_FLOOR + self.pad) as f64
            } else {
                LIVE_FLOOR as f64
                    + self.fade_for(ratio) as f64 * (ratio - 1.0)
                    + 2.0
                    + self.win / 2.0
            };
            if self.d > to + self.pad as f64 {
                self.d_old = self.d;
                self.d = to;
                self.fade_len = self.pad;
                self.fade_pos = 0;
            }
        }
        let wf = w as f64;
        let mut yl = Self::read(&self.buf[0], wf - self.d);
        let mut yr = Self::read(&self.buf[1], wf - self.d);
        if self.fade_pos < self.fade_len {
            let g = 0.5 - 0.5 * ((PI * (self.fade_pos as f64 + 0.5)) / self.fade_len as f64).cos();
            yl = g * yl + (1.0 - g) * Self::read(&self.buf[0], wf - self.d_old);
            yr = g * yr + (1.0 - g) * Self::read(&self.buf[1], wf - self.d_old);
            self.fade_pos += 1;
            self.d_old += 1.0 - ratio;
        }
        self.d += 1.0 - ratio;
        self.write = (w + 1) & MASK;
        if self.fade_pos < self.fade_len || ratio == 1.0 {
            return (yl, yr);
        }
        let fade = self.fade_for(ratio);
        let (win, search) = (self.win as i64, self.search as i64);
        if ratio < 1.0 && self.d >= LIVE_FLOOR as f64 + self.win {
            self.splice(-win, -win + 2 * search, fade);
        } else if ratio > 1.0 && self.d <= LIVE_FLOOR as f64 + fade as f64 * (ratio - 1.0) + 1.0 {
            self.splice(win - 2 * search, win, fade);
        }
        (yl, yr)
    }
}

/// The kernel (`PitchKernel`): the shifter, the dry path waiting as long,
/// the Dry/Wet blend.
pub struct PitchShifter {
    s: Option<PitchShiftSettings>,
    studio: Box<Studio>,
    live: Box<Live>,
    dry: [Box<[f64]>; 2],
    dry_at: usize,
    last: [f64; 2],
    latency: usize,
    dry_gain: f64,
    wet_gain: f64,
}

impl PitchShifter {
    pub fn new(sample_rate: f64, settings: &PitchShiftSettings) -> Self {
        let mut k = Self {
            s: None,
            studio: Box::new(Studio::new(sample_rate)),
            live: Box::new(Live::new(sample_rate)),
            dry: [
                vec![0.0; BUFFER].into_boxed_slice(),
                vec![0.0; BUFFER].into_boxed_slice(),
            ],
            dry_at: 0,
            last: [0.0; 2],
            latency: 0,
            dry_gain: 0.0,
            wet_gain: 1.0,
        };
        k.set(settings);
        k
    }

    /// Takes new settings (on the audio thread: no allocation).
    pub fn set(&mut self, s: &PitchShiftSettings) {
        let changed = self
            .s
            .is_none_or(|prev| prev.mode != s.mode || prev.window != s.window);
        self.s = Some(*s);
        if changed {
            self.live.reset(s.window);
        }
        self.latency = if s.mode == 1 {
            self.studio.n
        } else {
            LIVE_FLOOR + self.live.pad
        };
        self.dry_gain = (s.wet * PI / 2.0).cos();
        self.wet_gain = (s.wet * PI / 2.0).sin();
    }

    /// The frames it delays its audio by (for delay compensation).
    pub fn latency(&self) -> usize {
        self.latency
    }

    /// One block of `in_l`/`in_r` (a missing right is the left, a missing
    /// left silence) into the outputs.
    pub fn process(
        &mut self,
        in_l: Option<&[f32]>,
        in_r: Option<&[f32]>,
        out_l: &mut [f32],
        out_r: &mut [f32],
    ) {
        let n = out_l.len().min(out_r.len());
        for i in 0..n {
            let l = in_l.map_or(0.0, |b| b[i] as f64);
            let r = in_r.map_or(l, |b| b[i] as f64);
            let (yl, yr) = self.tick(l, r);
            out_l[i] = yl;
            out_r[i] = yr;
        }
    }

    /// As `process`, over a stereo block in place.
    pub fn process_in_place(&mut self, left: &mut [f32], right: &mut [f32]) {
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            (*l, *r) = self.tick(*l as f64, *r as f64);
        }
    }

    fn tick(&mut self, l: f64, r: f64) -> (f32, f32) {
        let s = self.s.expect("settings are set in new");
        let xl = l + s.feedback * self.last[0];
        let xr = r + s.feedback * self.last[1];
        let (yl, yr) = if s.mode == 1 {
            self.studio.tick(xl, xr, s.ratio)
        } else {
            self.live.tick(xl, xr, s.ratio)
        };
        self.last = [yl, yr];
        self.dry[0][self.dry_at] = l;
        self.dry[1][self.dry_at] = r;
        let back = (self.dry_at + BUFFER - self.latency) & MASK;
        let out_l = (self.dry[0][back] * self.dry_gain + yl * self.wet_gain) as f32;
        let out_r = (self.dry[1][back] * self.dry_gain + yr * self.wet_gain) as f32;
        self.dry_at = (self.dry_at + 1) & MASK;
        (out_l, out_r)
    }
}
