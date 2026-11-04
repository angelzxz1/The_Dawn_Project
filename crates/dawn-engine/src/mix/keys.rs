//! Sidechains: which track or bus keys which effect, the order the mix runs
//! in so every key is ready before the effect hearing it, and how long each
//! key waits to line up with that effect's input. As the studio decides
//! them (`src/effects/sidechain/sidechainRouting.ts`, `resolveSidechains`
//! and `keyDelay`), in frames, from the engine's own latencies and delay
//! compensation (`latency`).
//!
//! Loops: a key can't come from a track or bus that the effect's own host
//! feeds (through its route, its sends or other keys): the studio leaves
//! such a link out, and so does the engine, taking them in the same order
//! (the tracks' chains, the buses', the master's), so a song the studio
//! didn't check stays safe. The effect then listens to its own input.
//!
//! Timing: the key is tapped on its source (before its effects, after
//! them, or after its fader), and each point is late by the latent effects
//! and compensation ahead of it; the keyed effect's input is late too, by
//! the time its host's input is and the effects ahead of it in its chain.
//! The key waits the difference; one already later can't be pulled
//! earlier, so it stays as it is.

use super::fx::{self, KeySource, Tap};
use super::latency::{Delay, Plan};
use super::song::{Destination, Song, Stereo};

/// A track or a bus, in the order the mix runs them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Node {
    Track(usize),
    Bus(usize),
}

/// A connected key as the audio thread has it: its source's tap, copied in
/// each block and delayed, for one effect (`Prepared::key_of` says which).
pub(crate) struct KeyLink {
    /// The keyed effect's id, so its delay carries on into the song's next
    /// version.
    pub effect: String,
    pub source: KeySource,
    pub tap: Tap,
    pub delay: Delay,
    pub buf: Stereo,
}

/// For each host (the tracks, the buses, the master: indices as
/// `Song::host_effects`), the hosts it takes audio from: a track from the
/// tracks routed into it, a bus from the tracks sending to it, the master
/// from everything.
fn feeds(song: &Song) -> Vec<Vec<usize>> {
    let (t, b) = (song.tracks.len(), song.buses.len());
    let master = t + b;
    let mut graph = vec![vec![]; master + 1];
    for (i, track) in song.tracks.iter().enumerate() {
        for send in &track.sends {
            graph[t + send.bus].push(i);
        }
        match track.destination {
            Destination::Track(d) => graph[d].push(i),
            Destination::Master => graph[master].push(i),
        }
    }
    for j in 0..b {
        graph[master].push(t + j);
    }
    graph
}

/// Whether `from`'s audio (by way of anything) reaches `to`.
fn reaches(graph: &[Vec<usize>], from: usize, to: usize) -> bool {
    let mut seen = vec![false; graph.len()];
    let mut stack = vec![to];
    while let Some(node) = stack.pop() {
        if node == from {
            return true;
        }
        if std::mem::replace(&mut seen[node], true) {
            continue;
        }
        stack.extend(&graph[node]);
    }
    false
}

fn source_host(song: &Song, source: KeySource) -> Option<usize> {
    match source {
        KeySource::Track(i) if i < song.tracks.len() => Some(i),
        KeySource::Bus(j) if j < song.buses.len() => Some(song.tracks.len() + j),
        _ => None,
    }
}

/// Keeps the keys that can be connected without a loop (in order, as the
/// studio's `resolveSidechains`), drops the rest and those of effects that
/// take none, and points each keyed effect's detector at its key or its
/// own input to match. Returns the hosts each host takes audio from, keys
/// included, for `order`.
pub(crate) fn resolve(song: &mut Song) -> Vec<Vec<usize>> {
    let mut graph = feeds(song);
    let (t, b) = (song.tracks.len(), song.buses.len());
    for h in 0..=t + b {
        let len = song.host_effects(h).len();
        for e in 0..len {
            let spec = &song.host_effects(h)[e];
            let source = spec
                .key
                .filter(|_| spec.settings.takes_key())
                .and_then(|k| source_host(song, k.source))
                .filter(|&s| s != h && !reaches(&graph, h, s));
            if let Some(s) = source {
                graph[h].push(s);
            }
            let spec = host_effect_mut(song, h, e);
            if source.is_none() {
                spec.key = None;
            }
            spec.settings.set_external(source.is_some());
            if let Some(a) = &mut spec.automation {
                a.set_external(source.is_some());
            }
        }
    }
    graph
}

fn host_effect_mut(song: &mut Song, h: usize, e: usize) -> &mut fx::EffectSpec {
    let (t, b) = (song.tracks.len(), song.buses.len());
    if h < t {
        &mut song.tracks[h].effects[e]
    } else if h < t + b {
        &mut song.buses[h - t].effects[e]
    } else {
        &mut song.master_effects[e]
    }
}

/// The order to mix the tracks and buses in: each after everything it
/// takes audio from (`graph`, from `resolve`), keeping to `tracks` (the
/// tracks deepest in the routing first) and then the buses as far as that
/// allows. The master comes after all of them.
pub(crate) fn order(graph: &[Vec<usize>], tracks: &[usize], buses: usize) -> Vec<Node> {
    let t = tracks.len();
    let preferred: Vec<(usize, Node)> = tracks
        .iter()
        .map(|&i| (i, Node::Track(i)))
        .chain((0..buses).map(|j| (t + j, Node::Bus(j))))
        .collect();
    let mut done = vec![false; t + buses];
    let mut out = Vec::with_capacity(t + buses);
    while out.len() < preferred.len() {
        let next = preferred
            .iter()
            .find(|&&(h, _)| !done[h] && graph[h].iter().all(|&d| d >= done.len() || done[d]))
            // `resolve` leaves no loop; this keeps a bad graph from hanging.
            .or_else(|| preferred.iter().find(|&&(h, _)| !done[h]))
            .copied();
        let Some((h, node)) = next else { break };
        done[h] = true;
        out.push(node);
    }
    out
}

/// How late (frames) audio is at each point of the mix, from the chains'
/// latencies and the compensation plan.
pub(crate) struct Timing<'a> {
    song: &'a Song,
    plan: &'a Plan,
    tracks: Vec<usize>,
    buses: Vec<usize>,
}

impl<'a> Timing<'a> {
    pub fn new(song: &'a Song, plan: &'a Plan, sample_rate: f64) -> Self {
        Self {
            song,
            plan,
            tracks: song
                .tracks
                .iter()
                .map(|t| fx::latency(&t.effects, sample_rate))
                .collect(),
            buses: song
                .buses
                .iter()
                .map(|b| fx::latency(&b.effects, sample_rate))
                .collect(),
        }
    }

    /// How late a track's audio leaves its compensation delay.
    fn track_out(&self, i: usize) -> usize {
        self.plan.own[i] + self.tracks[i] + self.plan.channel[i]
    }

    /// How late audio reaches a bus's input: its latest sender's.
    fn bus_input(&self, j: usize) -> usize {
        (0..self.song.tracks.len())
            .filter(|&i| self.song.tracks[i].sends.iter().any(|s| s.bus == j))
            .map(|i| self.track_out(i) + self.plan.send[i])
            .max()
            .unwrap_or(0)
    }

    /// How late audio reaches the start of host `h`'s chain.
    fn host_input(&self, h: usize) -> usize {
        let (t, b) = (self.song.tracks.len(), self.song.buses.len());
        if h < t {
            return self.plan.own[h];
        }
        if h < t + b {
            return self.bus_input(h - t);
        }
        let tracks = (0..t)
            .filter(|&i| self.song.tracks[i].destination == Destination::Master)
            .map(|i| {
                self.track_out(i)
                    + if self.plan.live[i] {
                        0
                    } else {
                        self.plan.direct
                    }
            });
        let buses = (0..b).map(|j| self.bus_input(j) + self.buses[j] + self.plan.bus[j]);
        tracks.chain(buses).max().unwrap_or(0)
    }

    /// How late a source's audio is at a tap.
    fn tap(&self, source: KeySource, tap: Tap) -> usize {
        let (start, chain, pdc) = match source {
            KeySource::Track(i) => (self.plan.own[i], self.tracks[i], self.plan.channel[i]),
            KeySource::Bus(j) => (self.bus_input(j), self.buses[j], self.plan.bus[j]),
        };
        match tap {
            Tap::PreFx => start,
            Tap::PostFx => start + chain,
            Tap::PostFader => start + chain + pdc,
        }
    }

    /// The frames a key waits to line up with its effect's input: on host
    /// `h`, behind `before` frames of active effects in its chain.
    pub fn key_delay(&self, h: usize, before: usize, source: KeySource, tap: Tap) -> usize {
        (self.host_input(h) + before).saturating_sub(self.tap(source, tap))
    }
}

/// Copies a source's audio at a tap into the keys taken there, each
/// delayed by its own wait.
pub(crate) fn feed(keys: &mut [KeyLink], source: KeySource, tap: Tap, l: &[f32], r: &[f32]) {
    let n = l.len().min(r.len());
    for k in keys
        .iter_mut()
        .filter(|k| k.source == source && k.tap == tap)
    {
        k.buf.l[..n].copy_from_slice(&l[..n]);
        k.buf.r[..n].copy_from_slice(&r[..n]);
        k.delay.run(&mut k.buf.l[..n], &mut k.buf.r[..n]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mix::fx::{EffectSettings, EffectSpec, KeySpec};
    use crate::mix::song::{Bus, Send, Track};

    fn send(bus: usize) -> Send {
        Send {
            bus,
            gain: 1.0,
            pre: false,
        }
    }

    /// A Noise Gate keyed by `source` (post-FX), or by nothing.
    fn gate(id: &str, source: Option<KeySource>) -> EffectSpec {
        EffectSpec {
            key: source.map(|source| KeySpec {
                source,
                tap: Tap::PostFx,
            }),
            ..EffectSpec::new(id, EffectSettings::from_params("gate", &[]).unwrap())
        }
    }

    // As sidechainRouting.test.ts: kick, bass (sending to verb), pad.
    fn routing() -> Song {
        Song {
            tracks: vec![
                Track::new("kick"),
                Track {
                    sends: vec![send(0)],
                    ..Track::new("bass")
                },
                Track::new("pad"),
            ],
            buses: vec![Bus::new("verb")],
            ..Song::default()
        }
    }

    const KICK: KeySource = KeySource::Track(0);
    const BASS: KeySource = KeySource::Track(1);
    const PAD: KeySource = KeySource::Track(2);
    const VERB: KeySource = KeySource::Bus(0);

    /// The keys left connected, by effect id.
    fn connected(song: &Song) -> Vec<String> {
        (0..song.host_count())
            .flat_map(|h| song.host_effects(h).iter())
            .filter(|e| e.key.is_some())
            .map(|e| e.id.clone())
            .collect()
    }

    fn external(song: &Song, id: &str) -> bool {
        match &song.effect(id).unwrap().settings {
            EffectSettings::Gate(s) => s.key.external,
            _ => unreachable!(),
        }
    }

    #[test]
    fn connects_ordinary_keys_and_points_the_detectors_at_them() {
        let mut song = routing();
        song.tracks[1].effects.push(gate("c1", Some(KICK)));
        song.master_effects.push(gate("c2", Some(KICK)));
        song.buses[0].effects.push(gate("c3", Some(PAD)));
        song.tracks[2].effects.push(gate("own", None));
        resolve(&mut song);
        assert_eq!(connected(&song), ["c1", "c3", "c2"]);
        assert!(external(&song, "c1") && external(&song, "c2") && external(&song, "c3"));
        assert!(!external(&song, "own"));
    }

    #[test]
    fn leaves_out_self_and_missing_keys_and_effects_that_take_none() {
        let mut song = routing();
        song.tracks[1].effects.push(gate("self", Some(BASS)));
        song.tracks[1]
            .effects
            .push(gate("gone", Some(KeySource::Track(9))));
        let mut eq = EffectSpec::new("eq", EffectSettings::from_params("eq3", &[]).unwrap());
        eq.key = Some(KeySpec {
            source: KICK,
            tap: Tap::PostFx,
        });
        song.tracks[1].effects.push(eq);
        resolve(&mut song);
        assert!(connected(&song).is_empty());
        assert!(!external(&song, "self"));
    }

    #[test]
    fn refuses_a_key_from_a_bus_the_track_feeds() {
        // bass -> verb, so verb keying bass's gate would be a loop.
        let mut song = routing();
        song.tracks[1].effects.push(gate("c1", Some(VERB)));
        song.tracks[2].effects.push(gate("c2", Some(VERB)));
        resolve(&mut song);
        assert_eq!(connected(&song), ["c2"]);
        assert!(!external(&song, "c1"));
    }

    #[test]
    fn refuses_the_second_of_two_tracks_keying_each_other() {
        let mut song = routing();
        song.tracks[0].effects.push(gate("c1", Some(PAD)));
        song.tracks[2].effects.push(gate("c2", Some(KICK)));
        resolve(&mut song);
        assert_eq!(connected(&song), ["c1"]);
        // Through a bus: pad keyed by verb, bass sends to verb, so bass
        // keyed by pad would close the loop.
        let mut song = routing();
        song.tracks[1].effects.push(gate("c1", Some(PAD)));
        song.tracks[2].effects.push(gate("c2", Some(VERB)));
        resolve(&mut song);
        assert_eq!(connected(&song), ["c1"]);
    }

    #[test]
    fn mixes_every_source_before_what_it_keys() {
        // bass keyed by pad (after it in the song), and kick by verb, which
        // waits for bass's send: pad, bass, verb, then kick.
        let mut song = routing();
        song.tracks[1].effects.push(gate("c1", Some(PAD)));
        song.tracks[0].effects.push(gate("c2", Some(VERB)));
        let graph = resolve(&mut song);
        let order = order(&graph, &[0, 1, 2], 1);
        let at = |n: Node| order.iter().position(|&x| x == n).unwrap();
        assert_eq!(order.len(), 4);
        assert!(at(Node::Track(2)) < at(Node::Track(1)));
        assert!(at(Node::Track(1)) < at(Node::Bus(0)));
        assert!(at(Node::Bus(0)) < at(Node::Track(0)));
        // With no keys, the order is the tracks' and then the buses'.
        let mut plain = routing();
        let graph = resolve(&mut plain);
        assert_eq!(
            super::order(&graph, &[2, 0, 1], 1),
            [Node::Track(2), Node::Track(0), Node::Track(1), Node::Bus(0)]
        );
    }

    // As sidechainRouting.test.ts's timing, at 48 frames a millisecond:
    // kick has 5 ms of effects, delayed 3 ms to match bass's 8 ms chain,
    // and sends to verb, which has 10 ms of effects; both tracks go to the
    // master through the 10 ms direct delay.
    fn timing<'a>(song: &'a Song, plan: &'a Plan) -> Timing<'a> {
        Timing {
            song,
            plan,
            tracks: vec![240, 384],
            buses: vec![480],
        }
    }

    fn timed() -> (Song, Plan) {
        let song = Song {
            tracks: vec![
                Track {
                    sends: vec![send(0)],
                    ..Track::new("kick")
                },
                Track::new("bass"),
            ],
            buses: vec![Bus::new("verb")],
            ..Song::default()
        };
        let plan = Plan {
            channel: vec![144, 0],
            own: vec![0, 0],
            send: vec![0, 0],
            bus: vec![0],
            direct: 480,
            total: 0,
            live: vec![false, false],
        };
        (song, plan)
    }

    #[test]
    fn knows_how_late_each_tap_point_is() {
        let (song, plan) = timed();
        let t = timing(&song, &plan);
        let kick = KeySource::Track(0);
        assert_eq!(t.tap(kick, Tap::PreFx), 0);
        assert_eq!(t.tap(kick, Tap::PostFx), 240);
        assert_eq!(t.tap(kick, Tap::PostFader), 384);
        // The bus hears kick after its strip (8 ms), then adds 10 ms.
        assert_eq!(t.tap(KeySource::Bus(0), Tap::PostFx), 864);
    }

    #[test]
    fn delays_the_key_to_meet_the_effects_input() {
        let (song, plan) = timed();
        let t = timing(&song, &plan);
        let kick = KeySource::Track(0);
        // After 8 ms of bass's effects, keyed from kick pre-FX: 8 ms.
        assert_eq!(t.key_delay(1, 384, kick, Tap::PreFx), 384);
        // Post-FX: kick is already 5 ms late.
        assert_eq!(t.key_delay(1, 384, kick, Tap::PostFx), 144);
        // First in the chain, the key would have to come early: no delay.
        assert_eq!(t.key_delay(1, 0, kick, Tap::PostFx), 0);
        // On the master everything's in by 18 ms.
        assert_eq!(t.key_delay(3, 0, kick, Tap::PreFx), 864);
    }
}
