//! Automation: a track's volume, pan and effect parameters following the
//! lanes drawn in the studio, as its engine plays them
//! (`src/engine/automation.ts`, `audioEngine.ts` `ensureAutomationLoop`).
//!
//! A lane is points on the timeline (s), each segment from one point to the
//! next a line bent by the first point's `curve` (`curve_shape`), flat
//! before the first point and after the last.
//!
//! The volume and pan follow their lanes on the audio thread, gliding over
//! each block to where the lane is at its end. An effect's parameters
//! can't be worked out there (its settings are made from them, and some
//! make impulses or tables), so its settings are made beforehand, off the
//! audio thread (`stages`): one every `STEP` on the timeline where its
//! lanes move, as the studio applies them every 50 ms, and the engine
//! switches to the one for where the transport is. The parameters that
//! shape a reverb's impulse or a chorus's tables (`fx::stepped`) take each
//! point's value once it's passed instead of gliding: the studio's reverb,
//! too, rebuilds its impulse only once its decay stops moving.

use std::collections::BTreeMap;
use std::sync::Arc;

use super::fx::{EffectSettings, stepped};

/// How steep the most bent curve (`curve` ±1) is.
const CURVE_STEEPNESS: f64 = 6.0;

/// How far apart (s) an effect's settings are made along its lanes: the
/// studio's control rate.
pub const STEP: f64 = 0.05;

/// The most settings made for one effect: past that (lanes moving over
/// more than ten minutes), they're further apart.
const MOST_STAGES: usize = 12_000;

/// A point on a lane.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    /// On the timeline, in seconds.
    pub time: f64,
    /// In the target's own range: dB for the volume, -1..1 for the pan, an
    /// effect parameter's own values.
    pub value: f64,
    /// How the segment from it to the next bends, -1..1 (0 is straight).
    pub curve: f64,
}

impl Point {
    pub fn new(time: f64, value: f64) -> Self {
        Self {
            time,
            value,
            curve: 0.0,
        }
    }
}

/// Where a segment is `r` (0..1) of the way along, bent by `curve` (-1..1):
/// 0 is a straight line; above 0 it starts slow and ends fast, below 0 the
/// other way round (`curveShape`).
pub fn curve_shape(r: f64, curve: f64) -> f64 {
    if curve.abs() < 1e-6 {
        return r;
    }
    let k = CURVE_STEEPNESS * curve;
    (k * r).exp_m1() / k.exp_m1()
}

/// A lane's value at `t` (s), or None when it has no points
/// (`interpolateAutomation`). The points are sorted by time.
pub fn value_at(points: &[Point], t: f64) -> Option<f64> {
    let first = points.first()?;
    let last = points[points.len() - 1];
    if points.len() == 1 || t <= first.time {
        return Some(first.value);
    }
    if t >= last.time {
        return Some(last.value);
    }
    // The segment it's in: the last point at or before it.
    let i = points.partition_point(|p| p.time <= t) - 1;
    let (a, b) = (points[i], points[i + 1]);
    let span = b.time - a.time;
    let ratio = if span > 0.0 { (t - a.time) / span } else { 1.0 };
    Some(a.value + (b.value - a.value) * curve_shape(ratio, a.curve))
}

/// The value of the last point passed at `t` (the first point's before
/// it): a lane that steps rather than glides.
fn step_at(points: &[Point], t: f64) -> Option<f64> {
    let first = points.first()?;
    let i = points.partition_point(|p| p.time <= t);
    Some(if i == 0 {
        first.value
    } else {
        points[i - 1].value
    })
}

/// One parameter's lane.
#[derive(Clone, Debug, PartialEq)]
pub struct ParamLane {
    /// Its key, as in the effect's `index.ts`.
    pub param: String,
    pub points: Vec<Point>,
}

/// An effect's settings from where on the timeline (frames) they apply.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Stage {
    pub at: i64,
    pub settings: EffectSettings,
}

/// An effect's automation: its type and parameters, to make its settings
/// from, and its lanes.
#[derive(Clone, Debug, PartialEq)]
pub struct EffectAutomation {
    /// Its type, as the studio saves it (`EffectSettings::from_params`).
    pub kind: String,
    /// Its parameters as they're set (the lanes' take their place).
    pub params: BTreeMap<String, f64>,
    pub lanes: Vec<ParamLane>,
    /// Its settings along the timeline, made by `Song::prepare_effects`:
    /// the first from the start (and before the lanes), each of the rest
    /// from its `at`, sorted. Empty with no lanes that have points.
    pub(crate) stages: Option<Arc<Vec<Stage>>>,
}

impl EffectAutomation {
    pub fn new(
        kind: impl Into<String>,
        params: BTreeMap<String, f64>,
        lanes: Vec<ParamLane>,
    ) -> Self {
        Self {
            kind: kind.into(),
            params,
            lanes: lanes.into_iter().filter(|l| !l.points.is_empty()).collect(),
            stages: None,
        }
    }

    /// The same lanes on the same effect, with the same parameters.
    fn same(&self, other: &Self) -> bool {
        self.kind == other.kind && self.params == other.params && self.lanes == other.lanes
    }

    /// Makes its settings along the timeline (off the audio thread), at
    /// `sample_rate`. `base` is the effect's own settings, prepared (its
    /// file, its sidechain's switch); `previous` is the same effect's
    /// automation in the song playing, whose settings it takes if nothing's
    /// changed, or whose impulses and tables it keeps where they're the same.
    pub(crate) fn prepare(
        &mut self,
        base: &EffectSettings,
        external: bool,
        previous: Option<&EffectAutomation>,
        sample_rate: f64,
    ) {
        if self.stages.is_some() {
            return;
        }
        let made = previous.and_then(|p| p.stages.as_ref());
        if let (Some(p), Some(made)) = (previous, made)
            && self.same(p)
            && made
                .first()
                .is_none_or(|s| s.settings.external() == external)
        {
            self.stages = Some(made.clone());
            return;
        }
        self.stages = Some(Arc::new(self.make(
            base,
            external,
            made.map(|m| &m[..]),
            sample_rate,
        )));
    }

    fn make(
        &self,
        base: &EffectSettings,
        external: bool,
        previous: Option<&[Stage]>,
        sample_rate: f64,
    ) -> Vec<Stage> {
        let Some(start) = self.lanes.iter().map(|l| l.points[0].time).reduce(f64::min) else {
            return vec![];
        };
        let end = self
            .lanes
            .iter()
            .map(|l| l.points[l.points.len() - 1].time)
            .fold(start, f64::max);
        let step = STEP.max((end - start) / MOST_STAGES as f64);
        let first = (start / step).floor() as i64;
        let last = (end / step).ceil() as i64;
        let mut params = self.params.clone();
        let mut stages: Vec<Stage> = vec![];
        for k in first..=last {
            let t = k as f64 * step;
            for lane in &self.lanes {
                let value = if stepped(&self.kind, &lane.param) {
                    step_at(&lane.points, t)
                } else {
                    value_at(&lane.points, t)
                };
                if let (Some(v), Some(slot)) = (value, params.get_mut(&lane.param)) {
                    *slot = v;
                } else if let Some(v) = value {
                    params.insert(lane.param.clone(), v);
                }
            }
            let Some(mut settings) = EffectSettings::from_params(&self.kind, &params) else {
                return vec![];
            };
            if stages.last().is_some_and(|s| s.settings == settings) {
                continue;
            }
            settings.set_file(base.file().cloned());
            settings.set_external(external);
            // What it needs made: as the stage before's, or one in the
            // version playing, or the effect's own, if any is the same.
            let like = stages
                .last()
                .map(|s| &s.settings)
                .filter(|s| s.prepared_alike(&settings))
                .or_else(|| {
                    previous?
                        .iter()
                        .map(|s| &s.settings)
                        .find(|s| s.prepared_alike(&settings))
                })
                .or(Some(base).filter(|b| b.prepared_alike(&settings)));
            settings.prepare(sample_rate, like);
            stages.push(Stage {
                at: if stages.is_empty() {
                    i64::MIN
                } else {
                    (t * sample_rate).round() as i64
                },
                settings,
            });
        }
        stages
    }

    /// Points its settings' detector at its key or at its own input (when
    /// the song leaves its key out).
    pub(crate) fn set_external(&mut self, external: bool) {
        if let Some(stages) = &mut self.stages
            && stages
                .first()
                .is_some_and(|s| s.settings.external() != external)
        {
            Arc::make_mut(stages)
                .iter_mut()
                .for_each(|s| s.settings.set_external(external));
        }
    }

    /// Which of its settings apply at `position` (frames on the timeline),
    /// if it has any.
    pub(crate) fn stage_at(&self, position: i64) -> Option<(usize, &EffectSettings)> {
        let stages = self.stages.as_deref()?;
        if stages.is_empty() {
            return None;
        }
        let i = stages.partition_point(|s| s.at <= position).max(1) - 1;
        Some((i, &stages[i].settings))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lane(points: &[(f64, f64)]) -> Vec<Point> {
        points.iter().map(|&(t, v)| Point::new(t, v)).collect()
    }

    #[test]
    fn a_lane_is_flat_outside_its_points_and_straight_between() {
        let p = lane(&[(1.0, 0.0), (3.0, 10.0)]);
        assert_eq!(value_at(&[], 1.0), None);
        assert_eq!(value_at(&p, 0.0), Some(0.0));
        assert_eq!(value_at(&p, 2.0), Some(5.0));
        assert_eq!(value_at(&p, 2.5), Some(7.5));
        assert_eq!(value_at(&p, 9.0), Some(10.0));
        assert_eq!(value_at(&p[..1], 9.0), Some(0.0));
    }

    #[test]
    fn a_curve_bends_the_segment_from_its_point() {
        let mut p = lane(&[(0.0, 0.0), (1.0, 1.0)]);
        p[0].curve = 1.0;
        let slow = value_at(&p, 0.5).unwrap();
        // As the studio's curveShape(0.5, 1).
        let expected = (3.0f64).exp_m1() / (6.0f64).exp_m1();
        assert!((slow - expected).abs() < 1e-12);
        p[0].curve = -1.0;
        assert!(value_at(&p, 0.5).unwrap() > 0.5);
        assert_eq!(curve_shape(0.0, 0.7), 0.0);
        assert!((curve_shape(1.0, -0.4) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn a_stepping_lane_takes_the_last_point_passed() {
        let p = lane(&[(1.0, 2.0), (3.0, 8.0)]);
        assert_eq!(step_at(&p, 0.0), Some(2.0));
        assert_eq!(step_at(&p, 2.9), Some(2.0));
        assert_eq!(step_at(&p, 3.0), Some(8.0));
    }

    fn filter(lanes: Vec<ParamLane>) -> EffectAutomation {
        let params = BTreeMap::from([("frequency".to_string(), 1000.0)]);
        let base = EffectSettings::from_params("filter", &params).unwrap();
        let mut a = EffectAutomation::new("filter", params, lanes);
        a.prepare(&base, false, None, 48_000.0);
        a
    }

    #[test]
    fn an_effects_settings_are_made_every_step_where_its_lanes_move() {
        let a = filter(vec![ParamLane {
            param: "frequency".into(),
            points: lane(&[(1.0, 200.0), (2.0, 2200.0)]),
        }]);
        let stages = a.stages.as_deref().unwrap();
        // Flat before 1 s, then a step every 50 ms up to 2 s.
        assert_eq!(stages.len(), 21);
        assert_eq!(stages[0].at, i64::MIN);
        assert_eq!(stages[1].at, (1.05 * 48_000.0f64).round() as i64);
        let at = |s: f64| match a.stage_at((s * 48_000.0) as i64).unwrap().1 {
            EffectSettings::Filter(f) => f.frequency,
            _ => unreachable!(),
        };
        let near = |a: f64, b: f64| assert!((a - b).abs() < 1e-6, "{a} vs {b}");
        near(at(0.0), 200.0);
        near(at(1.5), 1200.0);
        near(at(1.52), 1200.0);
        near(at(5.0), 2200.0);
    }

    #[test]
    fn no_lanes_no_settings_and_a_flat_lane_one() {
        assert!(filter(vec![]).stage_at(0).is_none());
        let a = filter(vec![ParamLane {
            param: "frequency".into(),
            points: lane(&[(1.0, 300.0), (4.0, 300.0)]),
        }]);
        assert_eq!(a.stages.as_deref().unwrap().len(), 1);
    }

    #[test]
    fn a_reverbs_decay_steps_at_its_points_while_its_mix_glides() {
        let params = BTreeMap::new();
        let base = EffectSettings::from_params("reverb", &params).unwrap();
        let mut a = EffectAutomation::new(
            "reverb",
            params,
            vec![
                ParamLane {
                    param: "decay".into(),
                    points: lane(&[(0.0, 1.0), (1.0, 3.0)]),
                },
                ParamLane {
                    param: "wet".into(),
                    points: lane(&[(0.0, 0.0), (1.0, 1.0)]),
                },
            ],
        );
        a.prepare(&base, false, None, 8_000.0);
        let stages = a.stages.as_deref().unwrap();
        assert_eq!(stages.len(), 21);
        let reverb = |s: &Stage| match &s.settings {
            EffectSettings::Reverb(r) => (r.shape.decay, r.wet),
            _ => unreachable!(),
        };
        assert_eq!(reverb(&stages[10]).0, 1.0);
        assert!((reverb(&stages[10]).1 - 0.5).abs() < 1e-9);
        assert_eq!(reverb(&stages[20]), (3.0, 1.0));
        // Two impulses: before the last point, and from it.
        let mut decays: Vec<f64> = stages.iter().map(|s| reverb(s).0).collect();
        decays.dedup();
        assert_eq!(decays, [1.0, 3.0]);
    }

    #[test]
    fn the_same_lanes_keep_the_settings_made() {
        let lanes = vec![ParamLane {
            param: "frequency".into(),
            points: lane(&[(0.0, 200.0), (1.0, 800.0)]),
        }];
        let a = filter(lanes.clone());
        let params = a.params.clone();
        let base = EffectSettings::from_params("filter", &params).unwrap();
        let mut b = EffectAutomation::new("filter", params, lanes);
        b.prepare(&base, false, Some(&a), 48_000.0);
        assert!(Arc::ptr_eq(
            a.stages.as_ref().unwrap(),
            b.stages.as_ref().unwrap()
        ));
    }
}
