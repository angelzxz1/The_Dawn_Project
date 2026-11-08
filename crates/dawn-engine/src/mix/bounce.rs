//! Rendering a song offline, for an export: the engine playing it from a
//! point for a while, faster than real time, as it would play it to the
//! audio interface. What's exported is then what the engine plays.
//!
//! As the browser's export does (`src/export/bounce.ts`): the transport
//! plays from `from` for `length` seconds and stops there (what's still
//! playing is let go, as stopping does), and the render goes on `tail`
//! seconds more for effects ringing out. The mix comes out of the master
//! late by the song's latency (its delay compensation, the master's
//! effects, the limiter's lookahead), so that much more is rendered and
//! trimmed off the front: the file starts on its first beat.

use super::engine::Engine;
use super::song::Song;

/// What part of the song to render (s).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BounceRange {
    /// Where on the timeline it starts.
    pub from: f64,
    /// How long the song plays.
    pub length: f64,
    /// How long it's rendered after, for tails.
    pub tail: f64,
}

/// Frames rendered at a time.
const CHUNK: usize = 4096;

/// The song rendered at `sample_rate` over `range`: the left and right
/// sides. `progress` hears how far it's got (0..1) every so often, and
/// stops it by answering false (None then).
pub fn bounce(
    song: Song,
    sample_rate: f64,
    range: BounceRange,
    progress: &mut dyn FnMut(f64) -> bool,
) -> Option<[Vec<f32>; 2]> {
    let frames = |s: f64| (s.max(0.0) * sample_rate).round() as usize;
    let prepared = song.prepare(None, sample_rate);
    let late = prepared.latency();
    let mut engine = Engine::new(sample_rate);
    drop(engine.set_song(Box::new(prepared)));
    let playing = frames(range.length);
    let total = late + playing + frames(range.tail);
    let mut l = vec![0.0f32; total];
    let mut r = vec![0.0f32; total];
    engine.play(range.from.max(0.0), 0.0);
    let mut at = 0;
    while at < total {
        // The transport stops where the range ends.
        if at == playing {
            engine.stop();
        }
        let end = if at < playing {
            playing.min(at + CHUNK)
        } else {
            total.min(at + CHUNK)
        };
        engine.render(&mut l[at..end], &mut r[at..end]);
        at = end;
        if !progress(at as f64 / total.max(1) as f64) {
            return None;
        }
    }
    l.drain(..late.min(l.len()));
    r.drain(..late.min(r.len()));
    Some([l, r])
}
