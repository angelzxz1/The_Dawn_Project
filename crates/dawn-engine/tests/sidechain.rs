//! Sidechains in the mix: an effect keyed by another track hears that
//! track at the tap it's taken from, in the same block, however the tracks
//! are listed. A Noise Gate on a steady "bass" keyed by a "kick" that plays
//! from 0.5 s to 1 s shows it: the bass is heard only while the kick plays.
//! The master limiter delays everything by LAG frames.

use std::sync::Arc;

use dawn_engine::mix::{
    AudioData, Bus, Clip, ClipTiming, EffectSettings, EffectSpec, Engine, KeySource, KeySpec, Send,
    Song, Tap, Track,
};

const SR: f64 = 48000.0;
const LAG: usize = 240;
/// Where the kick starts (frames): in the middle of a 128-frame block.
const KICK_AT: usize = 24000;
const BLOCK: usize = 128;

fn dc(level: f32, seconds: f64) -> Arc<AudioData> {
    Arc::new(AudioData {
        channels: vec![vec![level; (seconds * SR) as usize]],
    })
}

fn clip(level: f32, offset: f64, length: f64) -> Clip {
    Clip::new(
        dc(level, length),
        SR,
        ClipTiming {
            offset,
            length,
            ..Default::default()
        },
    )
}

/// A Noise Gate (closing fully, and quickly: no hold, 10 ms release) keyed by `source` at `tap`, if anything.
fn gate(source: Option<KeySource>, tap: Tap) -> EffectSpec {
    EffectSpec {
        key: source.map(|source| KeySpec { source, tap }),
        ..EffectSpec::new(
            "gate",
            EffectSettings::from_params("gate", &[("hold", 0.0), ("release", 0.01)]).unwrap(),
        )
    }
}

/// The bass (0.25, for 2 s) through `gate`, listed first; the kick (0.5,
/// from 0.5 s to 1 s) at `kick_volume`; and a bus the bass sends to.
fn song(gate: EffectSpec, kick_volume: f64) -> Song {
    Song {
        tracks: vec![
            Track {
                clips: vec![clip(0.25, 0.0, 2.0)],
                effects: vec![gate],
                sends: vec![Send {
                    bus: 0,
                    gain: 0.0,
                    pre: false,
                }],
                ..Track::new("bass")
            },
            Track {
                clips: vec![clip(0.5, KICK_AT as f64 / SR, 0.5)],
                volume: kick_volume,
                ..Track::new("kick")
            },
        ],
        buses: vec![Bus::new("verb")],
        ..Song::default()
    }
}

/// 1.5 s of the song, a block at a time.
fn play(song: Song) -> Vec<f32> {
    let mut e = Engine::new(SR);
    e.set_song(Box::new(song.prepare(None, SR)));
    e.play(0.0, 0.0);
    let frames = (1.5 * SR) as usize;
    let (mut l, mut r) = (vec![0.0; frames], vec![0.0; frames]);
    for (bl, br) in l.chunks_mut(BLOCK).zip(r.chunks_mut(BLOCK)) {
        e.render(bl, br);
    }
    l
}

/// The output at `frame` of the timeline.
fn at(out: &[f32], frame: usize) -> f32 {
    out[frame + LAG]
}

#[test]
fn a_gate_keyed_by_another_track_opens_only_while_it_plays() {
    // The kick's fader is down: post-FX is ahead of it.
    let out = play(song(gate(Some(KeySource::Track(1)), Tap::PostFx), 0.0));
    assert!(at(&out, KICK_AT / 2).abs() < 1e-4, "closed before the kick");
    // Open in the block the kick starts in, though the bass is mixed
    // first in the list (1 ms attack: most of the way after 100 frames).
    assert!(at(&out, KICK_AT + 100) > 0.2, "open as the kick starts");
    assert!(
        (at(&out, KICK_AT + 12000) - 0.25).abs() < 1e-3,
        "open while it plays"
    );
    // Released a quarter of a second after the kick stops at 1 s.
    assert!(at(&out, 60000).abs() < 1e-4, "closed after the kick");
}

#[test]
fn a_key_taken_after_the_fader_is_as_loud_as_the_source_is_heard() {
    let out = play(song(gate(Some(KeySource::Track(1)), Tap::PostFader), 0.0));
    assert!(
        at(&out, KICK_AT + 12000).abs() < 1e-4,
        "the kick's fader is down"
    );
    // Up, the kick is heard too.
    let out = play(song(gate(Some(KeySource::Track(1)), Tap::PostFader), 1.0));
    assert!((at(&out, KICK_AT + 12000) - 0.75).abs() < 1e-3);
    assert!(at(&out, KICK_AT / 2).abs() < 1e-4);
}

#[test]
fn a_key_that_would_loop_is_left_out_and_the_gate_hears_its_own_input() {
    // The bass sends to the bus, so the bus can't key the bass.
    let out = play(song(gate(Some(KeySource::Bus(0)), Tap::PostFx), 0.0));
    assert!((at(&out, KICK_AT / 2) - 0.25).abs() < 1e-3);
    // Unkeyed, the same.
    let out = play(song(gate(None, Tap::PostFx), 0.0));
    assert!((at(&out, KICK_AT / 2) - 0.25).abs() < 1e-3);
}

#[test]
fn a_bus_can_key_a_track_mixed_after_it() {
    // The kick sends to the bus at full level; the bass's gate hears the
    // bus (the bass's own send is silent, and there's no loop once the
    // bass doesn't send).
    let mut s = song(gate(Some(KeySource::Bus(0)), Tap::PreFx), 0.0);
    s.tracks[0].sends.clear();
    s.tracks[1].sends.push(Send {
        bus: 0,
        gain: 1.0,
        pre: true,
    });
    // Not heard: its key is before its effects and fader.
    s.buses[0].volume = 0.0;
    let out = play(s);
    assert!(at(&out, KICK_AT / 2).abs() < 1e-4);
    assert!((at(&out, KICK_AT + 12000) - 0.25).abs() < 1e-3);
}

#[test]
fn the_key_waits_for_the_latent_effects_ahead_of_its_effect() {
    // A limiter's lookahead ahead of the gate: the bass is 240 frames late
    // there (and compensation holds the kick back to match), so the key
    // waits as long and the gate opens with the kick as it's heard.
    let mut s = song(gate(Some(KeySource::Track(1)), Tap::PostFx), 1.0);
    let limiter = EffectSpec::new("lim", EffectSettings::from_params("limiter", &[]).unwrap());
    s.tracks[0].effects.insert(0, limiter);
    let out = play(s);
    let heard = |frame: usize| out[frame + LAG + 240];
    assert!(heard(KICK_AT - 100).abs() < 1e-4, "not open early");
    assert!(heard(KICK_AT + 100) > 0.5, "open with the kick");
}
