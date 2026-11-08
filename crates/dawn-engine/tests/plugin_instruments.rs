//! A plugin as a MIDI track's instrument: what it's told (its clips' notes
//! and the keys played live, each on its frame; the pedal worked out
//! before it hears them; the bend and the mod wheel), what it plays coming
//! out of the track, and its processor carrying on through a new version
//! of the song until the host hands out another. The plugin here is a fake
//! that writes down what it's told and plays a constant 0.5 while any key
//! is down. The master limiter delays what's heard by LAG frames.

use std::sync::{Arc, Mutex};

use dawn_engine::mix::{
    Engine, InstrumentSpec, Note, PluginNote, PluginProcessor, PluginSettings, PluginSlot, Song,
    TimedNote, Track, track_key,
};

const SR: f64 = 48000.0;
const LAG: usize = 240;

/// What a fake plugin was told: each note at its frame on its own clock.
type Told = Arc<Mutex<Vec<(u64, PluginNote)>>>;

struct Fake {
    told: Told,
    frame: u64,
    down: [bool; 128],
    /// Set when it's dropped.
    gone: Arc<Mutex<bool>>,
}

impl PluginProcessor for Fake {
    fn process(&mut self, _l: &mut [f32], _r: &mut [f32]) {}

    fn play(&mut self, notes: &[TimedNote], l: &mut [f32], r: &mut [f32]) {
        assert!(
            l.iter().chain(r.iter()).all(|s| *s == 0.0),
            "it's given silence"
        );
        let mut next = notes.iter().peekable();
        for f in 0..l.len() {
            while let Some(n) = next.next_if(|n| n.offset as usize == f) {
                self.told
                    .lock()
                    .unwrap()
                    .push((self.frame + f as u64, n.note));
                match n.note {
                    PluginNote::On { key, .. } => self.down[key as usize] = true,
                    PluginNote::Off { key } => self.down[key as usize] = false,
                    _ => {}
                }
            }
            if self.down.iter().any(|d| *d) {
                l[f] = 0.5;
                r[f] = 0.5;
            }
        }
        assert!(next.next().is_none(), "every note is in the block");
        self.frame += l.len() as u64;
    }
}

impl Drop for Fake {
    fn drop(&mut self) {
        *self.gone.lock().unwrap() = true;
    }
}

struct Plugin {
    told: Told,
    gone: Arc<Mutex<bool>>,
}

/// A fake plugin's instrument, its processor waiting in its slot.
fn plugin() -> (InstrumentSpec, Plugin) {
    let told = Told::default();
    let gone = Arc::new(Mutex::new(false));
    let fake = Fake {
        told: told.clone(),
        frame: 0,
        down: [false; 128],
        gone: gone.clone(),
    };
    let spec = InstrumentSpec::Plugin(PluginSettings {
        slot: Arc::new(PluginSlot::new(Some(Box::new(fake)))),
        latency: 0,
    });
    (spec, Plugin { told, gone })
}

/// The same plugin in a later version of the song, its processor already
/// with the engine: an empty slot.
fn same_plugin() -> InstrumentSpec {
    InstrumentSpec::Plugin(PluginSettings {
        slot: Arc::new(PluginSlot::new(None)),
        latency: 0,
    })
}

fn note(start: f64, end: f64, key: i32) -> Note {
    Note {
        start: (start * SR) as i64,
        end: (end * SR) as i64,
        key,
        velocity: 0.75,
    }
}

fn song(instrument: InstrumentSpec, notes: Vec<Note>) -> Song {
    Song {
        tracks: vec![Track {
            instrument: Some(instrument),
            notes,
            ..Track::new("k")
        }],
        ..Song::default()
    }
}

fn render(engine: &mut Engine, seconds: f64) -> Vec<f32> {
    let n = (seconds * SR) as usize;
    let (mut l, mut r) = (vec![0.0; n], vec![0.0; n]);
    engine.render(&mut l, &mut r);
    l
}

fn frame(seconds: f64) -> u64 {
    (seconds * SR) as u64
}

#[test]
fn a_plugin_is_told_its_clips_notes_on_their_frames_and_plays_them() {
    let (spec, p) = plugin();
    let mut e = Engine::new(SR);
    e.set_song(Box::new(
        song(spec, vec![note(0.1, 0.3, 60), note(0.2, 0.25, 64)]).prepare(None, SR),
    ));
    e.play(0.0, 0.0);
    let out = render(&mut e, 0.5);
    assert_eq!(
        *p.told.lock().unwrap(),
        vec![
            (
                frame(0.1),
                PluginNote::On {
                    key: 60,
                    velocity: 0.75
                }
            ),
            (
                frame(0.2),
                PluginNote::On {
                    key: 64,
                    velocity: 0.75
                }
            ),
            (frame(0.25), PluginNote::Off { key: 64 }),
            (frame(0.3), PluginNote::Off { key: 60 }),
        ]
    );
    let at = |s: f64| out[frame(s) as usize + LAG];
    assert_eq!(at(0.05), 0.0);
    assert!((at(0.15) - 0.5).abs() < 1e-6, "{}", at(0.15));
    assert_eq!(at(0.4), 0.0);
}

#[test]
fn stopping_lets_go_of_what_it_was_told_to_play() {
    let (spec, p) = plugin();
    let mut e = Engine::new(SR);
    e.set_song(Box::new(
        song(spec, vec![note(0.0, 5.0, 60)]).prepare(None, SR),
    ));
    e.play(0.0, 0.0);
    render(&mut e, 0.1);
    e.stop();
    render(&mut e, 0.1);
    let told = p.told.lock().unwrap();
    assert_eq!(told.len(), 2);
    assert_eq!(told[1].1, PluginNote::Off { key: 60 });
}

#[test]
fn keys_played_live_reach_it_with_the_pedal_worked_out() {
    let (spec, p) = plugin();
    let mut e = Engine::new(SR);
    e.set_song(Box::new(song(spec, vec![]).prepare(None, SR)));
    let k = track_key("k");
    e.key_down(k, 62, 1.0);
    render(&mut e, 0.01);
    e.sustain(k, true);
    e.key_up(k, 62);
    e.pitch_bend(k, 0.5);
    e.mod_wheel(k, 0.25);
    render(&mut e, 0.01);
    assert_eq!(
        p.told
            .lock()
            .unwrap()
            .iter()
            .map(|t| t.1)
            .collect::<Vec<_>>(),
        vec![
            PluginNote::On {
                key: 62,
                velocity: 1.0
            },
            PluginNote::Bend(0.5),
            PluginNote::ModWheel(0.25),
        ],
        "no off while the pedal's down"
    );
    e.sustain(k, false);
    render(&mut e, 0.01);
    assert_eq!(
        p.told.lock().unwrap().last().unwrap().1,
        PluginNote::Off { key: 62 }
    );
}

#[test]
fn its_processor_plays_on_through_a_new_version_until_another_is_handed_out() {
    let (spec, first) = plugin();
    let mut e = Engine::new(SR);
    e.set_song(Box::new(song(spec, vec![]).prepare(None, SR)));
    let k = track_key("k");
    e.key_down(k, 60, 1.0);
    render(&mut e, 0.01);

    // The host had no new processor to hand out: the one playing goes on,
    // its key still down.
    let playing = song(same_plugin(), vec![]);
    let old = e.set_song(Box::new(playing.prepare(None, SR)));
    drop(old);
    assert!(!*first.gone.lock().unwrap());
    let out = render(&mut e, 0.01);
    assert!((out[out.len() - 1] - 0.5).abs() < 1e-6);
    e.key_up(k, 60);
    render(&mut e, 0.01);
    assert_eq!(
        first.told.lock().unwrap().last().unwrap().1,
        PluginNote::Off { key: 60 }
    );

    // Another plugin (or the same at another rate): its processor plays,
    // and the old one goes back with the old version.
    let (spec, second) = plugin();
    let old = e.set_song(Box::new(song(spec, vec![]).prepare(None, SR)));
    drop(old);
    assert!(*first.gone.lock().unwrap());
    e.key_down(k, 67, 1.0);
    render(&mut e, 0.01);
    assert_eq!(second.told.lock().unwrap().len(), 1);
}
