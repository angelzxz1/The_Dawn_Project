//! Running a CLAP plugin: dawn-test-plugin's gain, made, given a saved
//! state, processing a block, and its processor taken back home.

mod common;

use std::sync::Arc;

use common::clap_file;
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
