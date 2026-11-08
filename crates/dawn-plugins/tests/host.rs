//! Running plugins: dawn-test-plugin's gain (CLAP and VST3), made, given a
//! saved state, processing a block, and its processor taken back home; and
//! its tone, an instrument, playing the notes it's given.

mod common;

use std::sync::Arc;

use common::clap_file;
use dawn_plugins::NoteEvent;
use dawn_plugins::host::{ClapPlugin, load_entry};

const GAIN: &str = "com.dawn-project.test.gain";

#[test]
fn a_clap_effect_runs_with_its_state_and_comes_back_home() {
    let folder = std::env::temp_dir().join(format!("dawn-host-test-{}", std::process::id()));
    std::fs::create_dir_all(&folder).unwrap();
    let path = clap_file(&folder, "Dawn Test");
    // SAFETY: the test plugin is ours.
    let entry = unsafe { load_entry(&path) }.unwrap();
    let mut plugin = ClapPlugin::new(&entry, GAIN, Arc::new(|| {})).unwrap();

    // Its state: its level, a half to start with.
    assert_eq!(plugin.save_state().unwrap(), 0.5f32.to_le_bytes());
    plugin.load_state(&0.25f32.to_le_bytes()).unwrap();
    assert_eq!(plugin.save_state().unwrap(), 0.25f32.to_le_bytes());
    let ports = plugin.ports();
    assert_eq!((ports.inputs.len(), ports.outputs.len()), (1, 1));

    // Its processor scales a block by the level it was given.
    let mut processor = plugin.processor(48000.0).unwrap().expect("a processor");
    assert!(plugin.is_out());
    assert!(
        plugin.processor(48000.0).unwrap().is_none(),
        "one at a time"
    );
    let (mut l, mut r) = (vec![1.0f32; 256], vec![-0.5f32; 256]);
    processor.process(&mut l, &mut r);
    assert_eq!((l[100], r[100]), (0.25, -0.125));
    // A plugin without the latency extension says none.
    assert_eq!(plugin.latency(), 0);

    // Dropped (as the engine frees it), it goes home, and comes out again,
    // at another rate.
    drop(processor);
    plugin.reclaim();
    assert!(!plugin.is_out());
    let mut again = plugin
        .processor(44100.0)
        .unwrap()
        .expect("a processor again");
    let (mut l, mut r) = (vec![1.0f32; 64], vec![1.0f32; 64]);
    again.process(&mut l, &mut r);
    assert_eq!(l[10], 0.25, "the state carried over");
    drop(again);
    plugin.reclaim();
    drop(plugin);
    let _ = std::fs::remove_dir_all(&folder);
}

#[test]
fn a_vst3_effect_runs_with_its_state_and_its_windows_edits() {
    use dawn_plugins::vst3_host::{Vst3Plugin, load_module};
    const GAIN_ID: &str = "444157444E544553544741494E000001";
    let folder = std::env::temp_dir().join(format!("dawn-vst3-host-test-{}", std::process::id()));
    std::fs::create_dir_all(&folder).unwrap();
    let path = common::vst3_bundle(&folder, "Dawn Test");
    // SAFETY: the test plugin is ours.
    let module = unsafe { load_module(&path) }.unwrap();
    let mut plugin = Vst3Plugin::new(module, GAIN_ID).unwrap();

    // Its state: the component's (its level, a half) then the controller's.
    let state = plugin.save_state().unwrap();
    assert_eq!(&state[..8], &[4, 0, 0, 0, 0, 0, 0, 0x3f]);
    let mut quarter = state.clone();
    quarter[4..8].copy_from_slice(&0.25f32.to_le_bytes());
    plugin.load_state(&quarter).unwrap();
    assert_eq!(&plugin.save_state().unwrap()[4..8], &0.25f32.to_le_bytes());

    let mut processor = plugin.processor(48000.0).unwrap().expect("a processor");
    assert!(plugin.is_out());
    let (mut l, mut r) = (vec![1.0f32; 256], vec![-0.5f32; 256]);
    processor.process(&mut l, &mut r);
    assert_eq!((l[100], r[100]), (0.25, -0.125));
    assert_eq!(plugin.latency(), 0);

    // A knob turned in its window reaches the processor with the next
    // block, and its state is to be saved.
    plugin.edit(0, 0.75);
    assert!(plugin.take_dirty());
    let (mut l, mut r) = (vec![1.0f32; 64], vec![1.0f32; 64]);
    processor.process(&mut l, &mut r);
    assert_eq!(l[10], 0.75);

    // Home, and out again at another rate.
    drop(processor);
    plugin.reclaim();
    assert!(!plugin.is_out());
    let mut again = plugin
        .processor(44100.0)
        .unwrap()
        .expect("a processor again");
    let (mut l, mut r) = (vec![1.0f32; 64], vec![1.0f32; 64]);
    again.process(&mut l, &mut r);
    assert_eq!(l[10], 0.75, "it kept its level");
    drop(again);
    plugin.reclaim();
    drop(plugin);
    let _ = std::fs::remove_dir_all(&folder);
}

/// An instrument's `play`.
type Play<'a> = &'a mut dyn FnMut(&[(u32, NoteEvent)], &mut [f32], &mut [f32]);

/// A block of `n` frames from an instrument given `notes`: its left side
/// (the test tone plays the same on both).
fn played(play: Play, notes: &[(u32, NoteEvent)], n: usize) -> Vec<f32> {
    let (mut l, mut r) = (vec![0.0f32; n], vec![0.0f32; n]);
    play(notes, &mut l, &mut r);
    assert_eq!(l, r);
    l
}

/// The test tone plays a key's velocity from its note-on's frame to its
/// note-off's, so what it plays says what it was told, and when.
fn plays_its_notes_on_their_frames(play: Play) {
    let on = NoteEvent::On {
        key: 60,
        velocity: 0.75,
    };
    let out = played(play, &[(10, on), (40, NoteEvent::Off { key: 60 })], 64);
    assert!(out[..10].iter().all(|s| *s == 0.0), "{:?}", &out[..10]);
    assert!(out[10..40].iter().all(|s| *s == 0.75), "{:?}", &out[10..40]);
    assert!(out[40..].iter().all(|s| *s == 0.0));
    // A key held over blocks keeps playing; the bend and mod wheel don't
    // stop it.
    played(play, &[(63, on)], 64);
    let out = played(
        play,
        &[(0, NoteEvent::Bend(0.5)), (0, NoteEvent::ModWheel(1.0))],
        64,
    );
    assert!(out.iter().all(|s| *s == 0.75));
}

#[test]
fn a_clap_instrument_plays_the_notes_its_given() {
    use dawn_plugins::host::Notes;
    let folder = std::env::temp_dir().join(format!("dawn-clap-tone-test-{}", std::process::id()));
    std::fs::create_dir_all(&folder).unwrap();
    let path = clap_file(&folder, "Dawn Test Tone");
    // SAFETY: the test plugin is ours.
    let entry = unsafe { load_entry(&path) }.unwrap();
    let mut plugin =
        ClapPlugin::new(&entry, "com.dawn-project.test.tone", Arc::new(|| {})).unwrap();
    assert_eq!(plugin.note_dialect(), Notes::Clap);
    let mut processor = plugin.processor(48000.0).unwrap().expect("a processor");
    plays_its_notes_on_their_frames(&mut |notes, l, r| processor.play(notes, l, r));
    drop(processor);
    plugin.reclaim();
    drop(plugin);
    let _ = std::fs::remove_dir_all(&folder);
}

#[test]
fn a_vst3_instrument_plays_the_notes_its_given() {
    use dawn_plugins::vst3_host::{Vst3Plugin, load_module};
    const TONE_ID: &str = "444157444E54455354544F4E45000001";
    let folder = std::env::temp_dir().join(format!("dawn-vst3-tone-test-{}", std::process::id()));
    std::fs::create_dir_all(&folder).unwrap();
    let path = common::vst3_bundle(&folder, "Dawn Test");
    // SAFETY: the test plugin is ours.
    let module = unsafe { load_module(&path) }.unwrap();
    let mut plugin = Vst3Plugin::new(module, TONE_ID).unwrap();
    let mut processor = plugin.processor(48000.0).unwrap().expect("a processor");
    assert!(processor.takes_notes());
    plays_its_notes_on_their_frames(&mut |notes, l, r| processor.play(notes, l, r));
    drop(processor);
    plugin.reclaim();
    drop(plugin);
    let _ = std::fs::remove_dir_all(&folder);
}
