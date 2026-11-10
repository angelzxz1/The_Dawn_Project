//! The Pitch Shift port against the worklet's kernel: renders the cases in
//! the fixture (made by src/effects/pitch-shift/pitchShiftParity.test.ts) a
//! render quantum at a time and compares the samples with what the
//! JavaScript rendered; then what the dry path and the blend do.

mod common;

use common::{FixtureReader, Signal};
use dawn_engine::effects::pitch_shift::{PitchShiftSettings, PitchShifter};

/// -100 dB, well under anything audible (the run prints the largest
/// difference per case).
const TOLERANCE: f64 = 1e-5;

type Params = &'static [(&'static str, f64)];

struct Case {
    name: &'static str,
    params: Params,
    stereo: bool,
    /// New parameters from this frame on.
    change: Option<(usize, Params)>,
}

include!("fixtures/pitch_shift.rs");

const DATA: &[u8] = include_bytes!("fixtures/pitch_shift.bin");

#[test]
fn renders_what_the_javascript_kernel_renders() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    assert_eq!(sig.hash(), SIGNAL_HASH, "the test signals differ");
    let mut data = FixtureReader::new(DATA);
    for case in CASES {
        let mut k = PitchShifter::new(SAMPLE_RATE, &PitchShiftSettings::from_params(case.params));
        let mut out_l = vec![0.0f32; FRAMES];
        let mut out_r = vec![0.0f32; FRAMES];
        for start in (0..FRAMES).step_by(BLOCK) {
            if let Some((_, p)) = case.change.filter(|(at, _)| *at == start) {
                k.set(&PitchShiftSettings::from_params(p));
            }
            let end = (start + BLOCK).min(FRAMES);
            let right = case.stereo.then(|| &sig.in_r[start..end]);
            k.process(
                Some(&sig.in_l[start..end]),
                right,
                &mut out_l[start..end],
                &mut out_r[start..end],
            );
        }
        let mut worst = 0.0f64;
        for out in [&out_l, &out_r] {
            for (j, x) in out.iter().enumerate().step_by(STRIDE) {
                let expected = data.f32();
                let d = (*x as f64 - expected as f64).abs();
                assert!(
                    d <= TOLERANCE,
                    "{}: frame {j}: {x} where the JavaScript has {expected}",
                    case.name
                );
                worst = worst.max(d);
            }
        }
        println!("{}: largest difference {worst:e}", case.name);
    }
    assert!(data.is_empty(), "the fixture has more data than the cases");
}

#[test]
fn in_place_is_the_same() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    for mode in [0.0, 1.0] {
        let s =
            PitchShiftSettings::from_params(&[("pitch", -5.0), ("feedback", 0.4), ("mode", mode)]);
        let (mut a, mut b) = (
            PitchShifter::new(SAMPLE_RATE, &s),
            PitchShifter::new(SAMPLE_RATE, &s),
        );
        let (mut l, mut r) = (vec![0.0; 9600], vec![0.0; 9600]);
        a.process(
            Some(&sig.in_l[..9600]),
            Some(&sig.in_r[..9600]),
            &mut l,
            &mut r,
        );
        let (mut il, mut ir) = (sig.in_l[..9600].to_vec(), sig.in_r[..9600].to_vec());
        b.process_in_place(&mut il, &mut ir);
        assert_eq!((l, r), (il, ir));
    }
}

#[test]
fn dry_comes_out_as_late_as_the_shifted_signal() {
    // Studio: a frame (4096 at 48 kHz); Live: where it plays attacks from.
    for (mode, latency) in [(1.0, 4096), (0.0, 4 + 144)] {
        let s = PitchShiftSettings::from_params(&[("pitch", -2.0), ("wet", 0.0), ("mode", mode)]);
        let mut node = PitchShifter::new(SAMPLE_RATE, &s);
        assert_eq!(node.latency(), latency);
        assert_eq!(s.latency(SAMPLE_RATE), latency);
        let mut l = vec![0.0; 8192];
        l[10] = 1.0;
        let mut r = l.clone();
        node.process_in_place(&mut l, &mut r);
        let hits: Vec<usize> = (0..l.len()).filter(|&i| l[i].abs() > 1e-4).collect();
        assert_eq!(hits, [10 + latency]);
        assert!((l[10 + latency] - 1.0).abs() < 1e-6 && l == r);
    }
}

#[test]
fn a_project_from_before_the_mode_switch_plays_in_studio() {
    assert_eq!(PitchShiftSettings::from_params(&[("pitch", 3.0)]).mode, 1);
}
