//! The engine that plays the song: the transport, the clips, the
//! instruments, the mix with its effects, sidechains, automation and the
//! master, and the metronome. The studio describes the song (`song::Song`),
//! and the engine renders it to whatever asks for samples: an audio
//! interface (the desktop app, `src-tauri`) or a file.

pub mod automation;
pub mod clip;
pub mod engine;
pub mod fx;
mod keys;
pub mod latency;
pub mod metronome;
pub mod player;
pub mod song;
pub mod tempo;

pub use automation::{EffectAutomation, ParamLane, Point};
pub use clip::{AudioData, Clip, ClipTiming};
pub use engine::{Engine, LiveInput, input_sample};
pub use fx::{
    EffectKind, EffectSettings, EffectSpec, KeySource, KeySpec, PluginProcessor, PluginSettings,
    PluginSlot, Tap,
};
pub use player::{InstrumentKind, InstrumentSpec, Note, track_key};
pub use song::{Bus, Destination, MAX_BLOCK, Master, Prepared, Send, Song, Track, db_to_gain};
