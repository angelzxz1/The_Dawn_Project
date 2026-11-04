//! Automation in the mix: a track's fader and pan follow their lanes in
//! place of their own settings, and its effects' parameters follow theirs
//! (the settings made every 50 ms along them), a keyed effect still
//! hearing its key. The tracks play a steady 0.25; the master limiter
//! delays everything by LAG frames.

use std::collections::BTreeMap;
use std::sync::Arc;

use dawn_engine::mix::{
    AudioData, Clip, ClipTiming, EffectAutomation, EffectSettings, EffectSpec, Engine, KeySource,
    KeySpec, ParamLane, Point, Song, Tap, Track,
};

const SR: f64 = 48000.0;
const LAG: usize = 240;
const BLOCK: usize = 128;

fn steady(level: f32, offset: f64, length: f64) -> Clip {
    Clip::new(
        Arc::new(AudioData {
            channels: vec![vec![level; (length * SR) as usize]],
        }),
        SR,
        ClipTiming {
            offset,
            length,
            ..Default::default()
        },
    )
}

fn lane(points: &[(f64, f64)]) -> Vec<Point> {
    points.iter().map(|&(t, v)| Point::new(t, v)).collect()
}

/// 1.5 s of the song, a block at a time: the left output and the right.
fn play(song: Song) -> (Vec<f32>, Vec<f32>) {
    let mut e = Engine::new(SR);
    e.set_song(Box::new(song.prepare(None, SR)));
    e.play(0.0, 0.0);
    let frames = (1.5 * SR) as usize;
    let (mut l, mut r) = (vec![0.0; frames], vec![0.0; frames]);
    for (bl, br) in l.chunks_mut(BLOCK).zip(r.chunks_mut(BLOCK)) {
        e.render(bl, br);
    }
    (l, r)
}

/// The output at `seconds` on the timeline.
fn at(out: &[f32], seconds: f64) -> f32 {
    out[(seconds * SR) as usize + LAG]
}

fn near(got: f32, want: f64, what: &str) {
    assert!((got as f64 - want).abs() < 2e-3, "{what}: {got} vs {want}");
}

fn one(track: Track) -> Song {
    Song {
        tracks: vec![track],
        ..Song::default()
    }
}

#[test]
fn the_fader_follows_its_lane_in_place_of_its_own_setting() {
    // The fader's own is down; the lane goes from 0 dB to -6 dB over 1 s,
    // straight in dB.
    let (l, _) = play(one(Track {
        clips: vec![steady(0.25, 0.0, 2.0)],
        volume: 0.0,
        volume_automation: lane(&[(0.0, 0.0), (1.0, -6.0206)]),
        ..Track::new("t")
    }));
    // A mono clip plays in both sides: 0.25 each, centred.
    near(at(&l, 0.1), 0.25 * 10f64.powf(-0.60206 / 20.0), "early on");
    near(at(&l, 0.5), 0.25 * 10f64.powf(-3.0103 / 20.0), "halfway");
    near(at(&l, 1.2), 0.125, "flat after the last point");
}

#[test]
fn a_bent_segment_is_heard_as_drawn() {
    let mut points = lane(&[(0.0, 0.0), (1.0, -12.0)]);
    points[0].curve = 1.0;
    let (l, _) = play(one(Track {
        clips: vec![steady(0.25, 0.0, 2.0)],
        volume_automation: points,
        ..Track::new("t")
    }));
    // Starting slow: as the studio's curveShape(0.5, 1).
    let shape = 3f64.exp_m1() / 6f64.exp_m1();
    near(at(&l, 0.5), 0.25 * 10f64.powf(-12.0 * shape / 20.0), "bent");
}

#[test]
fn the_pan_follows_its_lane() {
    let (l, r) = play(one(Track {
        clips: vec![steady(0.25, 0.0, 2.0)],
        pan_automation: lane(&[(0.0, -1.0), (1.0, -1.0), (1.01, 1.0)]),
        ..Track::new("t")
    }));
    near(at(&l, 0.5), 0.5, "all left");
    near(at(&r, 0.5), 0.0, "nothing right");
    near(at(&l, 1.2), 0.0, "then nothing left");
    near(at(&r, 1.2), 0.5, "all right");
}

/// A Utility whose gain goes from 0 dB at 0.5 s to -6 dB at 0.6 s.
fn utility() -> EffectSpec {
    let params = BTreeMap::from([("gain".to_string(), 0.0)]);
    EffectSpec {
        automation: Some(Box::new(EffectAutomation::new(
            "utility",
            params.clone(),
            vec![ParamLane {
                param: "gain".into(),
                points: lane(&[(0.5, 0.0), (0.6, -6.0206)]),
            }],
        ))),
        ..EffectSpec::new(
            "u",
            EffectSettings::from_params("utility", &params).unwrap(),
        )
    }
}

#[test]
fn an_effects_parameter_follows_its_lane() {
    let (l, _) = play(one(Track {
        clips: vec![steady(0.25, 0.0, 2.0)],
        effects: vec![utility()],
        ..Track::new("t")
    }));
    near(at(&l, 0.3), 0.25, "before the lane moves");
    let mid = at(&l, 0.58);
    assert!(mid < 0.24 && mid > 0.13, "on its way: {mid}");
    near(at(&l, 1.0), 0.125, "where it ends");
}

#[test]
fn an_automated_effect_carries_on_into_the_songs_next_version() {
    let song = || {
        one(Track {
            clips: vec![steady(0.25, 0.0, 2.0)],
            effects: vec![utility()],
            ..Track::new("t")
        })
    };
    let mut e = Engine::new(SR);
    e.set_song(Box::new(song().prepare(None, SR)));
    e.play(0.0, 0.0);
    let (mut l, mut r) = (vec![0.0; BLOCK], vec![0.0; BLOCK]);
    for _ in 0..(SR as usize / BLOCK) {
        e.render(&mut l, &mut r);
    }
    // At 1 s a new version comes (an edit elsewhere): the gain stays
    // where its lane is, not at its own setting.
    let previous = song();
    let mut next = song();
    next.prepare_effects(Some(&previous), SR);
    e.set_song(Box::new(next.prepare(Some(&previous), SR)));
    for _ in 0..8 {
        e.render(&mut l, &mut r);
    }
    near(l[BLOCK - 1], 0.125, "after the change");
}

#[test]
fn an_automated_effect_keyed_by_another_track_still_hears_its_key() {
    // A gate on the bass, its threshold drawn flat, keyed by a kick that
    // plays from 0.5 s to 1 s with its fader down: the bass is heard only
    // while the kick plays.
    let params = BTreeMap::from([("hold".to_string(), 0.0), ("release".to_string(), 0.01)]);
    let gate = EffectSpec {
        key: Some(KeySpec {
            source: KeySource::Track(1),
            tap: Tap::PostFx,
        }),
        automation: Some(Box::new(EffectAutomation::new(
            "gate",
            params.clone(),
            vec![ParamLane {
                param: "threshold".into(),
                points: lane(&[(0.0, -40.0), (1.5, -40.0)]),
            }],
        ))),
        ..EffectSpec::new("g", EffectSettings::from_params("gate", &params).unwrap())
    };
    let (l, _) = play(Song {
        tracks: vec![
            Track {
                clips: vec![steady(0.25, 0.0, 2.0)],
                effects: vec![gate],
                ..Track::new("bass")
            },
            Track {
                clips: vec![steady(0.5, 0.5, 0.5)],
                volume: 0.0,
                ..Track::new("kick")
            },
        ],
        ..Song::default()
    });
    assert!(at(&l, 0.25).abs() < 1e-4, "closed before the kick");
    near(at(&l, 0.75), 0.25, "open while it plays");
    assert!(at(&l, 1.25).abs() < 1e-4, "closed after it");
}

#[test]
fn a_new_version_of_the_song_leaves_an_automated_fader_where_it_is() {
    // The fader's own is down, the lane holds it at 0 dB: an edit while
    // playing doesn't dip it.
    let song = || {
        one(Track {
            clips: vec![steady(0.25, 0.0, 2.0)],
            volume: 0.0,
            volume_automation: lane(&[(0.0, 0.0)]),
            ..Track::new("t")
        })
    };
    let mut e = Engine::new(SR);
    e.set_song(Box::new(song().prepare(None, SR)));
    e.play(0.0, 0.0);
    let (mut l, mut r) = (vec![0.0; BLOCK], vec![0.0; BLOCK]);
    for _ in 0..20 {
        e.render(&mut l, &mut r);
    }
    let previous = song();
    e.set_song(Box::new(song().prepare(Some(&previous), SR)));
    // The limiter's lookahead holds it back a few blocks.
    let mut low = f32::MAX;
    for _ in 0..4 {
        e.render(&mut l, &mut r);
        low = l.iter().fold(low, |m, x| m.min(*x));
    }
    near(low, 0.25, "through the change");
}
