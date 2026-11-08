//! Rendering a song offline, for an export: from its start or a range, its
//! first frame on the timeline's first, the transport stopping where the
//! range ends while effects ring on through the tail, and a stop asked for
//! along the way. Clips here are constant levels, easy to read.

use std::sync::Arc;

use dawn_engine::effects::limiter::LimiterSettings;
use dawn_engine::mix::{AudioData, BounceRange, Clip, ClipTiming, Master, Song, Track, bounce};

const SR: f64 = 48000.0;

fn dc(level: f32, seconds: f64) -> Arc<AudioData> {
    Arc::new(AudioData {
        channels: vec![vec![level; (seconds * SR) as usize]],
    })
}

/// A track with a clip of 0.25 from `offset` for `length`.
fn song(offset: f64, length: f64) -> Song {
    let clip = Clip::new(
        dc(0.25, 10.0),
        SR,
        ClipTiming {
            offset,
            length,
            ..Default::default()
        },
    );
    Song {
        tracks: vec![Track {
            clips: vec![clip],
            ..Track::new("a")
        }],
        ..Song::default()
    }
}

fn at(out: &[f32], seconds: f64) -> f32 {
    out[(seconds * SR) as usize]
}

#[test]
fn the_whole_song_starts_on_its_first_frame_with_its_tail() {
    let range = BounceRange {
        from: 0.0,
        length: 1.0,
        tail: 0.5,
    };
    let [l, r] = bounce(song(0.5, 0.25), SR, range, &mut |_| true).unwrap();
    assert_eq!(l.len(), (1.5 * SR) as usize);
    assert_eq!(l, r);
    // The limiter's lookahead is trimmed off: the clip is where it sits.
    let start = (0.5 * SR) as usize;
    assert_eq!(l[start - 1], 0.0);
    assert!((l[start + 10] - 0.25).abs() < 1e-6, "{}", l[start + 10]);
    assert_eq!(at(&l, 0.9), 0.0);
}

#[test]
fn a_range_starts_where_it_does_and_cuts_what_still_plays() {
    let range = BounceRange {
        from: 1.0,
        length: 1.0,
        tail: 1.0,
    };
    // A clip from 1.5 s to 4 s: heard from 0.5 s into the file, until the
    // range ends at 1 s; the tail is silent.
    let [l, _] = bounce(song(1.5, 2.5), SR, range, &mut |_| true).unwrap();
    assert_eq!(at(&l, 0.25), 0.0);
    assert!((at(&l, 0.75) - 0.25).abs() < 1e-6);
    assert_eq!(at(&l, 1.5), 0.0);
}

#[test]
fn stems_can_leave_the_limiter_alone_and_still_line_up() {
    // A level the limiter would hold down (it's over its -1 dB ceiling),
    // with its ceiling raised out of the way, as a stem without the master
    // chain asks.
    let mut loud = song(0.5, 0.25);
    loud.tracks[0].volume = 4.0;
    loud.master = Master {
        limiter: LimiterSettings::from_db(120.0, 0.0, 0.1, false),
        ..Master::default()
    };
    let range = BounceRange {
        from: 0.0,
        length: 1.0,
        tail: 0.0,
    };
    let [l, _] = bounce(loud, SR, range, &mut |_| true).unwrap();
    let start = (0.5 * SR) as usize;
    assert_eq!(l[start - 1], 0.0);
    assert!((l[start + 10] - 1.0).abs() < 1e-6, "{}", l[start + 10]);
}

#[test]
fn it_says_how_far_it_got_and_stops_when_told() {
    let range = BounceRange {
        from: 0.0,
        length: 2.0,
        tail: 0.0,
    };
    let mut seen = vec![];
    let done = bounce(song(0.0, 1.0), SR, range, &mut |f| {
        seen.push(f);
        true
    });
    assert!(done.is_some());
    assert!(seen.windows(2).all(|w| w[0] < w[1]));
    assert_eq!(*seen.last().unwrap(), 1.0);
    let stopped = bounce(song(0.0, 1.0), SR, range, &mut |f| f < 0.5);
    assert!(stopped.is_none());
}
