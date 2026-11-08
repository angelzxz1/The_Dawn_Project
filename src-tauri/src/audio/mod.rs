//! The native engine in the desktop app: the audio devices, and the
//! commands the studio drives the engine with (`src/engine/native/`).
//!
//! The studio sends the song (`engine_set_song`) whenever it changes, each
//! audio file once (`engine_load_audio`, decoded at the engine's rate), and
//! the transport's commands; it reads back the position and meters
//! (`engine_status`) to draw them. With the interface's input open, it says
//! which tracks hear it live (`engine_monitor`), and records takes onto
//! disk (`engine_record`, then `engine_finish_take` hands it the take).
//! An export renders a song offline (`engine_bounce`), as the engine plays
//! it.

pub mod devices;
pub mod hosted;
pub mod song;
pub mod stream;
pub mod take;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use dawn_engine::mix::metronome::CLICK_SOUNDS;
use dawn_engine::mix::{AudioData, BounceRange, LiveInput, Song, bounce, track_key};
use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State};

use song::{LoadedAudio, SongSpec};
use stream::{Command, Running};

#[derive(Default)]
struct Inner {
    running: Option<Running>,
    /// The take being recorded (or the round trip being measured).
    take: Option<take::Writer>,
    /// The audio files the studio has sent, by its ids.
    audio: HashMap<String, LoadedAudio>,
    /// The song sent last (what's playing), to glide from and to meter.
    song: Option<Song>,
}

impl Inner {
    fn send(&mut self, command: Command) -> Result<(), String> {
        let running = self.running.as_mut().ok_or("No audio device is open.")?;
        if running.send(command) {
            Ok(())
        } else {
            Err("The audio thread isn't keeping up.".into())
        }
    }
}

/// The engine's state in the app (Tauri's managed state).
#[derive(Default)]
pub struct AudioState(Mutex<Inner>);

impl AudioState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        // A panic while holding it leaves nothing half-done worth refusing.
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[tauri::command]
pub async fn audio_devices() -> Vec<devices::DriverInfo> {
    devices::list()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    sample_rate: f64,
    buffer_size: Option<u32>,
    /// The input that opened (its name and channel count), or why it
    /// couldn't.
    input_name: Option<String>,
    input_channels: Option<usize>,
    input_error: Option<String>,
}

/// Opens a device (none: the system's default), closing the one open; with
/// `input`, the interface's input too (`input_device`; none: the output
/// device itself if it records, else its driver's default input).
#[tauri::command]
pub async fn audio_open(
    state: State<'_, AudioState>,
    device: Option<String>,
    sample_rate: Option<u32>,
    buffer_size: Option<u32>,
    input: Option<bool>,
    input_device: Option<String>,
) -> Result<Opened, String> {
    // Closed first, so a device can be reopened with other settings.
    let (previous, take) = {
        let mut inner = state.lock();
        (inner.running.take(), inner.take.take())
    };
    drop(previous);
    // A take going on is left on disk.
    drop(take);
    let running = stream::open(stream::Request {
        device,
        sample_rate,
        buffer_size,
        input: input.unwrap_or(false),
        input_device,
    })?;
    let opened = Opened {
        sample_rate: running.sample_rate,
        buffer_size: running.buffer_size,
        input_name: running.input.as_ref().map(|i| i.name.clone()),
        input_channels: running.input.as_ref().map(|i| i.channels),
        input_error: running.input_error.clone(),
    };
    let mut inner = state.lock();
    inner.running = Some(running);
    // The song is sent again by the studio (its clips at the new rate).
    inner.song = None;
    Ok(opened)
}

#[tauri::command]
pub fn audio_close(state: State<'_, AudioState>) {
    let running = {
        let mut inner = state.lock();
        inner.song = None;
        inner.running.take()
    };
    drop(running);
    // The engine's gone, and with it the plugins' processors: they go too.
    hosted::forget_all();
}

/// Opens a plugin effect's own window (or brings it forward).
#[tauri::command]
pub fn plugin_window_open(app: AppHandle, effect: String, title: String) -> Result<(), String> {
    hosted::open_window(&app, &effect, &title)
}

#[tauri::command]
pub fn plugin_window_close(effect: String) {
    hosted::close(&effect);
}

/// A plugin effect's state now (base64), for the project to keep.
#[tauri::command]
pub fn plugin_state(effect: String) -> Result<String, String> {
    hosted::state(&effect)
}

/// A track hearing the interface's input live: its id, and the input's
/// channel (0 = the first; none: all of them mixed to one).
#[derive(Deserialize)]
pub struct MonitorSpec {
    track: String,
    channel: Option<usize>,
}

/// The tracks hearing the input live, in place of those before.
#[tauri::command]
pub fn engine_monitor(
    state: State<'_, AudioState>,
    tracks: Vec<MonitorSpec>,
) -> Result<(), String> {
    let list = tracks
        .iter()
        .map(|t| LiveInput {
            track: track_key(&t.track),
            channel: t.channel,
        })
        .collect();
    state.lock().send(Command::Monitors(list))
}

/// Starts recording the input (`channel`; none: all of it mixed to one)
/// to a file, from now: the studio starts the transport with it. With
/// `probe`, it's measuring the round trip instead: clicks play straight to
/// the output (`take::PROBE_CLICKS`).
#[tauri::command]
pub fn engine_record(
    app: AppHandle,
    state: State<'_, AudioState>,
    channel: Option<usize>,
    probe: bool,
) -> Result<(), String> {
    let mut inner = state.lock();
    let running = inner.running.as_ref().ok_or("No audio device is open.")?;
    if running.input.is_none() {
        return Err(running
            .input_error
            .clone()
            .unwrap_or_else(|| "The audio input isn't open.".into()));
    }
    let rate = running.sample_rate as u32;
    let folder = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("{e}"))?
        .join("takes");
    std::fs::create_dir_all(&folder).map_err(|e| format!("{e}"))?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis());
    let path = folder.join(format!("take-{stamp}.wav"));
    // The one before, if it wasn't finished, stays on disk.
    drop(inner.take.take());
    let (capture, writer) = take::start(path, rate, channel).map_err(|e| format!("{e}"))?;
    inner.send(Command::Record {
        capture: Box::new(capture),
        probe,
    })?;
    inner.take = Some(writer);
    Ok(())
}

/// Ends the take and hands it over: its samples (mono f32s, little-endian)
/// from where its downbeat came back in, `round_trip` seconds (the round
/// trip and offset the studio uses) after the mix played it; a probe's,
/// from its start. The file goes once read.
#[tauri::command]
pub async fn engine_finish_take(
    state: State<'_, AudioState>,
    round_trip: Option<f64>,
) -> Result<Response, String> {
    let (writer, status, rate) = {
        let mut inner = state.lock();
        let _ = inner.send(Command::EndTake);
        let writer = inner.take.take().ok_or("Nothing is being recorded.")?;
        let running = inner.running.as_ref().ok_or("No audio device is open.")?;
        (writer, running.status.clone(), running.sample_rate)
    };
    tauri::async_runtime::spawn_blocking(move || {
        let path = writer.path.clone();
        writer.finish().map_err(|e| format!("{e}"))?;
        let clock = status.take_clock();
        let skip = match round_trip {
            Some(rt) => take::take_start(
                clock.started,
                clock.downbeat,
                clock.mix_latency,
                (rt * rate).round() as i64,
            ),
            None => 0,
        };
        take::read_take(&path, skip)
            .map(Response::new)
            .map_err(|e| format!("{e}"))
    })
    .await
    .map_err(|e| format!("{e}"))?
}

/// Abandons the take (its file is removed).
#[tauri::command]
pub fn engine_cancel_take(state: State<'_, AudioState>) {
    let mut inner = state.lock();
    let _ = inner.send(Command::EndTake);
    if let Some(writer) = inner.take.take() {
        let path = writer.path.clone();
        let _ = writer.finish();
        let _ = std::fs::remove_file(path);
    }
}

/// An audio file, decoded: the body is its samples (f32, little-endian),
/// one channel after another; the headers say its id, channel count and
/// sample rate.
#[tauri::command]
pub fn engine_load_audio(state: State<'_, AudioState>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the samples as bytes.".into());
    };
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
    };
    let id = header("dawn-audio-id").ok_or("No audio id.")?;
    let channels: usize = header("dawn-channels")
        .and_then(|v| v.parse().ok())
        .filter(|c| *c > 0)
        .ok_or("No channel count.")?;
    let sample_rate: f64 = header("dawn-sample-rate")
        .and_then(|v| v.parse().ok())
        .ok_or("No sample rate.")?;
    let samples: Vec<f32> = bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| f32::from_le_bytes(*b))
        .collect();
    let frames = samples.len() / channels;
    let data = AudioData {
        channels: samples
            .chunks(frames.max(1))
            .take(channels)
            .map(<[f32]>::to_vec)
            .collect(),
    };
    state.lock().audio.insert(
        id,
        LoadedAudio {
            sample_rate,
            data: Arc::new(data),
        },
    );
    Ok(())
}

/// Forgets audio files no longer used (what's playing keeps its own).
#[tauri::command]
pub fn engine_forget_audio(state: State<'_, AudioState>, ids: Vec<String>) {
    let mut inner = state.lock();
    ids.iter().for_each(|id| {
        inner.audio.remove(id);
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongSent {
    /// Files its clips need that haven't been sent at the engine's rate.
    missing: Vec<String>,
}

#[tauri::command]
pub fn engine_set_song(state: State<'_, AudioState>, song: SongSpec) -> Result<SongSent, String> {
    let mut inner = state.lock();
    let sample_rate = inner
        .running
        .as_ref()
        .ok_or("No audio device is open.")?
        .sample_rate;
    hosted::begin_song();
    let (mut built, missing) = song::build_with(
        &song,
        inner.song.as_ref(),
        &inner.audio,
        sample_rate,
        &|id, spec| hosted::make(id, spec, sample_rate),
    );
    // The effects' impulses are made on the song kept to follow, so the
    // next version keeps them when they're the same.
    built.prepare_effects(inner.song.as_ref(), sample_rate);
    let prepared = Box::new(built.clone().prepare(inner.song.as_ref(), sample_rate));
    inner.send(Command::Song(prepared))?;
    inner.song = Some(built);
    hosted::end_song();
    Ok(SongSent { missing })
}

/// What `engine_bounce` says when files the song needs haven't been sent:
/// this, then their ids, a line each. The studio sends them and asks again.
const MISSING: &str = "missing files:";

/// Renders `song` offline over `from` + `length` (s), with `tail` more for
/// effects ringing out, at the device's rate, as the engine plays it (its
/// files are those sent for the song playing). The body is the left side's
/// samples then the right's (f32, little-endian). Its plugins are
/// instances of their own, made for it (from their saved state) and gone
/// after.
#[tauri::command]
pub async fn engine_bounce(
    app: AppHandle,
    song: SongSpec,
    from: f64,
    length: f64,
    tail: f64,
) -> Result<Response, String> {
    // Made on the main thread, where the plugins live.
    let (tx, rx) = std::sync::mpsc::channel();
    let main = app.clone();
    app.run_on_main_thread(move || {
        let state = main.state::<AudioState>();
        let inner = state.lock();
        let made = inner
            .running
            .as_ref()
            .map(|r| r.sample_rate)
            .ok_or_else(|| "No audio device is open.".to_owned())
            .map(|rate| {
                let ids = std::cell::RefCell::new(Vec::new());
                let (built, missing) =
                    song::build_with(&song, None, &inner.audio, rate, &|id, spec| {
                        let id = format!("export:{id}");
                        ids.borrow_mut().push(id.clone());
                        hosted::make(&id, spec, rate)
                    });
                (built, missing, rate, ids.into_inner())
            });
        let _ = tx.send(made);
    })
    .map_err(|e| format!("{e}"))?;
    let (built, missing, rate, plugins) = tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| format!("{e}"))?
        .map_err(|e| format!("{e}"))??;
    let forget = move |app: &AppHandle| {
        let _ = app.run_on_main_thread(move || hosted::forget(&plugins));
    };
    if !missing.is_empty() {
        forget(&app);
        return Err(format!("{MISSING}\n{}", missing.join("\n")));
    }
    let range = BounceRange { from, length, tail };
    let rendered =
        tauri::async_runtime::spawn_blocking(move || bounce(built, rate, range, &mut |_| true))
            .await
            .map_err(|e| format!("{e}"));
    forget(&app);
    let [l, r] = rendered?.ok_or("The export was stopped.")?;
    let mut bytes = Vec::with_capacity((l.len() + r.len()) * 4);
    for s in l.iter().chain(r.iter()) {
        bytes.extend_from_slice(&s.to_le_bytes());
    }
    Ok(Response::new(bytes))
}

/// A key pressed live (`velocity` 0-1) or let go (none) on a track.
#[tauri::command]
pub fn engine_key(
    state: State<'_, AudioState>,
    track: String,
    key: i32,
    velocity: Option<f64>,
) -> Result<(), String> {
    state.lock().send(Command::Key {
        track: track_key(&track),
        key,
        velocity,
    })
}

/// A track's sustain pedal (CC64), down or up.
#[tauri::command]
pub fn engine_sustain(
    state: State<'_, AudioState>,
    track: String,
    down: bool,
) -> Result<(), String> {
    state.lock().send(Command::Sustain {
        track: track_key(&track),
        down,
    })
}

/// A track's pitch bend: -1..1 of its instrument's bend range.
#[tauri::command]
pub fn engine_bend(state: State<'_, AudioState>, track: String, value: f64) -> Result<(), String> {
    state.lock().send(Command::Bend {
        track: track_key(&track),
        value,
    })
}

/// A track's mod wheel, 0..1.
#[tauri::command]
pub fn engine_mod_wheel(
    state: State<'_, AudioState>,
    track: String,
    value: f64,
) -> Result<(), String> {
    state.lock().send(Command::ModWheel {
        track: track_key(&track),
        value,
    })
}

#[tauri::command]
pub fn engine_play(
    state: State<'_, AudioState>,
    from: f64,
    count_in_beats: f64,
) -> Result<(), String> {
    state.lock().send(Command::Play {
        from,
        count_in_beats,
    })
}

#[tauri::command]
pub fn engine_stop(state: State<'_, AudioState>) -> Result<(), String> {
    state.lock().send(Command::Stop)
}

#[tauri::command]
pub fn engine_seek(state: State<'_, AudioState>, seconds: f64) -> Result<(), String> {
    state.lock().send(Command::Seek(seconds))
}

#[tauri::command]
pub fn engine_loop(
    state: State<'_, AudioState>,
    start: Option<f64>,
    end: Option<f64>,
) -> Result<(), String> {
    state.lock().send(Command::Loop(start.zip(end)))
}

#[tauri::command]
pub fn engine_metronome(
    state: State<'_, AudioState>,
    enabled: bool,
    level_db: f64,
    sound: Option<String>,
) -> Result<(), String> {
    let mut inner = state.lock();
    inner.send(Command::Metronome(enabled))?;
    inner.send(Command::MetronomeLevel(level_db))?;
    match sound.and_then(|s| CLICK_SOUNDS.iter().find(|c| **c == s)) {
        Some(sound) => inner.send(Command::MetronomeSound(sound)),
        None => Ok(()),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    open: bool,
    sample_rate: f64,
    position: f64,
    playing: bool,
    /// Peaks since the last status (0-1), in the song's track order.
    tracks: Vec<[f32; 2]>,
    buses: Vec<[f32; 2]>,
    master: [f32; 2],
    /// The master limiter's gain (1: not limiting).
    limiter_gain: f32,
    /// How much of each buffer's time the engine takes (0-1).
    load: f32,
    /// Dropouts and stream errors since the device opened.
    errors: u32,
    /// The input's peaks since the last status, per channel (0-1).
    inputs: Vec<f32>,
    /// The round trip as the drivers say (s): out, and back in.
    round_trip: f32,
    /// The take being recorded, if one is.
    take: Option<TakeStatus>,
    /// The plugin effects whose state changed (to be saved), and why any
    /// that couldn't run didn't.
    plugins: PluginsStatus,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginsStatus {
    dirty: Vec<String>,
    errors: Vec<(String, String)>,
    /// The effects whose plugin window is open.
    windows: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TakeStatus {
    /// Frames taken so far.
    frames: u64,
    /// Where its downbeat is in it, before the round trip: the wait for
    /// the count-in and the mix's latency (frames).
    downbeat: u64,
    /// Its live waveform since the last status: each bucket's (64 frames)
    /// lowest and highest.
    min: Vec<f32>,
    max: Vec<f32>,
    /// Samples lost because the disk fell behind.
    dropped: u64,
}

/// What's gone into a Tuner (by its effect id) lately, for the studio to
/// find its pitch in: the last 4096 samples, oldest first, as little-endian
/// f32s. Nothing when the song has no such Tuner, or it's bypassed (the
/// engine skips it, so it hears nothing, as the browser's unplugged one).
#[tauri::command]
pub fn engine_tuner(state: State<'_, AudioState>, effect: String) -> Response {
    let inner = state.lock();
    let samples = inner
        .song
        .as_ref()
        .and_then(|s| s.effect(&effect))
        .filter(|e| !e.bypass)
        .and_then(|e| e.settings.tuner_tap())
        .map(|tap| tap.waveform())
        .unwrap_or_default();
    Response::new(
        samples
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect::<Vec<u8>>(),
    )
}

#[tauri::command]
pub fn engine_status(state: State<'_, AudioState>) -> EngineStatus {
    let mut inner = state.lock();
    // The engine found a track without the instrument it was counting on
    // (a version of the song it never got): it gets the song again, with
    // every instrument made anew.
    let resend = inner
        .running
        .as_ref()
        .is_some_and(|r| r.status.take_missing());
    if resend
        && let Some(song) = inner.song.clone()
        && let Some(rate) = inner.running.as_ref().map(|r| r.sample_rate)
    {
        let _ = inner.send(Command::Song(Box::new(song.prepare(None, rate))));
    }
    let take = inner.take.as_mut().map(|w| {
        let (min, max) = std::iter::from_fn(|| w.buckets.pop().ok())
            .map(|[lo, hi]| (lo, hi))
            .unzip();
        (min, max)
    });
    let inner = inner;
    let Some(r) = &inner.running else {
        return EngineStatus {
            open: false,
            sample_rate: 0.0,
            position: 0.0,
            playing: false,
            tracks: vec![],
            buses: vec![],
            master: [0.0; 2],
            limiter_gain: 1.0,
            load: 0.0,
            errors: 0,
            inputs: vec![],
            round_trip: 0.0,
            take: None,
            plugins: PluginsStatus::default(),
        };
    };
    let (tracks, buses) = inner
        .song
        .as_ref()
        .map_or((0, 0), |s| (s.tracks.len(), s.buses.len()));
    let s = &r.status;
    let (tracks, buses, master) = s.take_peaks(tracks, buses);
    EngineStatus {
        open: true,
        sample_rate: r.sample_rate,
        position: s.position(),
        playing: s.playing(),
        tracks,
        buses,
        master,
        limiter_gain: s.limiter_gain(),
        load: s.load(),
        errors: s.errors(),
        inputs: s.take_input_peaks(r.input.as_ref().map_or(0, |i| i.channels)),
        round_trip: s.round_trip(),
        plugins: PluginsStatus {
            dirty: hosted::tick(),
            errors: hosted::errors(),
            windows: hosted::open_windows(),
        },
        take: take.map(|(min, max)| {
            let clock = s.take_clock();
            TakeStatus {
                frames: clock.frames,
                downbeat: clock.downbeat.saturating_sub(clock.started) + clock.mix_latency,
                min,
                max,
                dropped: clock.dropped,
            }
        }),
    }
}
