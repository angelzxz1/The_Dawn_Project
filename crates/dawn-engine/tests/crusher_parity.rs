//! The Crusher port against the JavaScript kernel: renders the cases in
//! the fixture (made by src/effects/crusher/crusherParity.test.ts) the way
//! the worklet runs the kernel, and compares samples and meters with what
//! the JavaScript rendered.

mod common;

use common::{FixtureReader, Signal};
use dawn_engine::effects::crusher::{CrusherKernel, CrusherSettings, LATENCY};

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

include!("fixtures/crusher.rs");

const DATA: &[u8] = include_bytes!("fixtures/crusher.bin");

#[test]
fn renders_what_the_javascript_kernel_renders() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    assert_eq!(sig.hash(), SIGNAL_HASH, "the test signals differ");
    let mut data = FixtureReader::new(DATA);
    for case in CASES {
        let mut k = CrusherKernel::new(SAMPLE_RATE, &CrusherSettings::from_params(case.params));
        let mut out_l = vec![0.0f32; FRAMES];
        let mut out_r = vec![0.0f32; FRAMES];
        let mut meters = vec![];
        let mut count = 0;
        for start in (0..FRAMES).step_by(BLOCK) {
            if let Some((_, params)) = case.change.filter(|(at, _)| *at == start) {
                k.set(&CrusherSettings::from_params(params));
            }
            let end = (start + BLOCK).min(FRAMES);
            let in_r = case.stereo.then(|| &sig.in_r[start..end]);
            k.process(
                Some(&sig.in_l[start..end]),
                in_r,
                &mut out_l[start..end],
                Some(&mut out_r[start..end]),
            );
            count += end - start;
            if count >= METER_INTERVAL {
                count = 0;
                meters.push(k.take_meters());
            }
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
        for (i, m) in meters.iter().enumerate() {
            for (what, ours) in [
                ("gain reduction", m.gain_reduction),
                ("output", m.output),
                ("input", m.input),
            ] {
                let theirs = data.f64();
                assert!(
                    (ours - theirs).abs() <= TOLERANCE,
                    "{}: reading {i}'s {what}: {ours} where the JavaScript has {theirs}",
                    case.name
                );
            }
        }
        println!("{}: largest difference {worst:e}", case.name);
    }
    assert!(data.is_empty(), "the fixture has more data than the cases");
}

#[test]
fn processing_in_place_is_processing_its_stereo_input() {
    let sig = Signal::new(FRAMES, SAMPLE_RATE);
    let s = CrusherSettings::from_params(&[("input", 8.0), ("dist", 1.0)]);
    let (mut a, mut b) = (
        CrusherKernel::new(SAMPLE_RATE, &s),
        CrusherKernel::new(SAMPLE_RATE, &s),
    );
    let (mut l, mut r) = (vec![0.0; 8192], vec![0.0; 8192]);
    a.process(
        Some(&sig.in_l[..8192]),
        Some(&sig.in_r[..8192]),
        &mut l,
        Some(&mut r),
    );
    let (mut il, mut ir) = (sig.in_l[..8192].to_vec(), sig.in_r[..8192].to_vec());
    b.process_in_place(&mut il, &mut ir);
    assert_eq!((l, r), (il, ir));
    assert_eq!(b.latency(), LATENCY);
}
