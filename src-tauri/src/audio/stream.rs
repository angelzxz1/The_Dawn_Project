//! The audio interface playing the engine: the device's callback owns the
//! engine and renders it into the device's buffer. The app talks to it
//! only through lock-free queues: commands in, what the audio thread is
//! done with out (freed here, never on the audio thread), and through
//! atomics it reads - position, meters, dropouts, how busy the callback is.
//!
//! The interface's input, when it's open, is a second stream: its callback
//! puts what comes in on a ring, and the output's callback takes as much
//! as it renders - for the tracks monitoring it, the input meters and the
//! take being recorded (`take`). Only the newest is kept waiting, so the
//! input stays as close as it can be.
//!
//! cpal's streams can't move between threads on every system, so a thread
//! of its own opens them and keeps them until it's told to close.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, mpsc};
use std::thread;
use std::time::Instant;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{
    BufferSize, Device, FromSample, InputCallbackInfo, OutputCallbackInfo, SampleFormat,
    SizedSample, StreamConfig,
};
use dawn_engine::mix::{Engine, LiveInput, Prepared};
use rtrb::{Consumer, Producer, RingBuffer};

use super::take::{Capture, PROBE_CLICKS, probe_click};

/// Meters kept for this many tracks and buses (more are unmetered).
pub const MAX_METERED: usize = 256;
/// The input channels read (an interface with more has the rest unheard).
pub const MAX_INPUTS: usize = 64;
/// The longest buffer the callback renders in one go (frames); a device
/// asking for more is filled in parts.
const SCRATCH: usize = 8192;

/// A command for the audio thread.
pub enum Command {
    Song(Box<Prepared>),
    Play {
        from: f64,
        count_in_beats: f64,
    },
    Stop,
    Seek(f64),
    Loop(Option<(f64, f64)>),
    Metronome(bool),
    MetronomeLevel(f64),
    /// One of `metronome::CLICK_SOUNDS` (static, so nothing is freed on
    /// the audio thread).
    MetronomeSound(&'static str),
    /// A key pressed (with its velocity) or let go live, on the track
    /// `track_key` names.
    Key {
        track: u64,
        key: i32,
        velocity: Option<f64>,
    },
    /// A track's sustain pedal.
    Sustain {
        track: u64,
        down: bool,
    },
    /// A track's pitch bend (-1..1 of its range).
    Bend {
        track: u64,
        value: f64,
    },
    /// A track's mod wheel (0..1).
    ModWheel {
        track: u64,
        value: f64,
    },
    /// The tracks hearing the input live, in place of those before.
    Monitors(Vec<LiveInput>),
    /// A take starts: the input goes to its capture from now on. With
    /// `probe`, the round trip is being measured: clicks play straight to
    /// the output at `PROBE_CLICKS` from now.
    Record {
        capture: Box<Capture>,
        probe: bool,
    },
    /// The take ends (its writer finishes).
    EndTake,
}

/// What the audio thread is done with, to be freed by the app (only
/// held, to be dropped there).
#[allow(dead_code)]
pub enum Garbage {
    Song(Box<Prepared>),
    Monitors(Vec<LiveInput>),
    Capture(Box<Capture>),
}

/// What's known about the take being recorded (or the last one), on the
/// engine's clock.
#[derive(Clone, Copy, Debug, Default)]
pub struct TakeClock {
    /// When the capture started.
    pub started: u64,
    /// Where the transport starts moving (after the count-in).
    pub downbeat: u64,
    /// How late the mix comes out (frames).
    pub mix_latency: u64,
    /// Frames captured.
    pub frames: u64,
    /// Samples lost because the writer fell behind.
    pub dropped: u64,
}

/// What the audio thread shares: written there, read by the app.
pub struct Status {
    position: AtomicU64,
    playing: AtomicBool,
    /// Peaks since last read, as f32 bits (left, right per track, then
    /// bus, then the master's two).
    peaks: Vec<AtomicU32>,
    /// The share of each buffer's time the last callbacks took (0-1, as
    /// f32 bits, smoothed).
    load: AtomicU32,
    /// Dropouts and other stream errors since it opened.
    errors: AtomicU32,
    /// The limiter's gain reduction, from its last meter reading (f32 bits).
    limiter_gain: AtomicU32,
    /// The engine needed an instrument the song didn't bring: the song
    /// should be sent again, prepared from scratch.
    missing: AtomicBool,
    /// The input's peaks since last read, per channel (f32 bits).
    input_peaks: Vec<AtomicU32>,
    /// How late the input's and the output's sound is (s, f32 bits): the
    /// drivers' own, and the input's waiting on its ring.
    input_latency: AtomicU32,
    output_latency: AtomicU32,
    input_wait: AtomicU32,
    /// The input's callbacks' size (frames), the last one.
    input_chunk: AtomicU32,
    /// The take: when its capture and transport started, its mix latency
    /// and how much was taken (`TakeClock`).
    take: [AtomicU64; 5],
}

impl Status {
    fn new() -> Self {
        Self {
            position: AtomicU64::new(0),
            playing: AtomicBool::new(false),
            peaks: (0..(2 * MAX_METERED * 2 + 2))
                .map(|_| AtomicU32::new(0))
                .collect(),
            load: AtomicU32::new(0),
            errors: AtomicU32::new(0),
            limiter_gain: AtomicU32::new(1.0f32.to_bits()),
            missing: AtomicBool::new(false),
            input_peaks: (0..MAX_INPUTS).map(|_| AtomicU32::new(0)).collect(),
            input_latency: AtomicU32::new(0),
            output_latency: AtomicU32::new(0),
            input_wait: AtomicU32::new(0),
            input_chunk: AtomicU32::new(0),
            take: std::array::from_fn(|_| AtomicU64::new(0)),
        }
    }

    /// Reads and resets the input's peaks, for its first `channels`.
    pub fn take_input_peaks(&self, channels: usize) -> Vec<f32> {
        self.input_peaks
            .iter()
            .take(channels)
            .map(|a| f32::from_bits(a.swap(0, Ordering::Relaxed)))
            .collect()
    }

    /// The round trip as the drivers say (s): out, back in, and the wait
    /// on the input's ring.
    pub fn round_trip(&self) -> f32 {
        let get = |a: &AtomicU32| f32::from_bits(a.load(Ordering::Relaxed));
        get(&self.output_latency) + get(&self.input_latency) + get(&self.input_wait)
    }

    pub fn take_clock(&self) -> TakeClock {
        let [started, downbeat, mix_latency, frames, dropped] =
            self.take.each_ref().map(|a| a.load(Ordering::Acquire));
        TakeClock {
            started,
            downbeat,
            mix_latency,
            frames,
            dropped,
        }
    }

    fn set_take_clock(&self, t: TakeClock) {
        let values = [t.started, t.downbeat, t.mix_latency, t.frames, t.dropped];
        for (a, v) in self.take.iter().zip(values) {
            a.store(v, Ordering::Release);
        }
    }

    /// Whether the song needs sending again from scratch (`missing`), once.
    pub fn take_missing(&self) -> bool {
        self.missing.swap(false, Ordering::Relaxed)
    }

    fn keep_peak(&self, slot: usize, value: f32) {
        if let Some(a) = self.peaks.get(slot) {
            a.fetch_max(value.to_bits(), Ordering::Relaxed);
        }
    }

    fn take_peak(&self, slot: usize) -> f32 {
        self.peaks
            .get(slot)
            .map_or(0.0, |a| f32::from_bits(a.swap(0, Ordering::Relaxed)))
    }

    pub fn position(&self) -> f64 {
        f64::from_bits(self.position.load(Ordering::Relaxed))
    }

    pub fn playing(&self) -> bool {
        self.playing.load(Ordering::Relaxed)
    }

    pub fn load(&self) -> f32 {
        f32::from_bits(self.load.load(Ordering::Relaxed))
    }

    pub fn errors(&self) -> u32 {
        self.errors.load(Ordering::Relaxed)
    }

    pub fn limiter_gain(&self) -> f32 {
        f32::from_bits(self.limiter_gain.load(Ordering::Relaxed))
    }

    /// Reads and resets the peaks of `tracks` tracks and `buses` buses, and
    /// the master's.
    pub fn take_peaks(
        &self,
        tracks: usize,
        buses: usize,
    ) -> (Vec<[f32; 2]>, Vec<[f32; 2]>, [f32; 2]) {
        let t = (0..tracks.min(MAX_METERED))
            .map(|i| [self.take_peak(2 * i), self.take_peak(2 * i + 1)])
            .collect();
        let base = 2 * MAX_METERED;
        let b = (0..buses.min(MAX_METERED))
            .map(|i| {
                [
                    self.take_peak(base + 2 * i),
                    self.take_peak(base + 2 * i + 1),
                ]
            })
            .collect();
        let m = 4 * MAX_METERED;
        (t, b, [self.take_peak(m), self.take_peak(m + 1)])
    }
}

/// The input that opened, if one was asked for.
pub struct InputOpened {
    pub name: String,
    pub channels: usize,
}

/// What's playing through the device.
pub struct Running {
    pub sample_rate: f64,
    pub buffer_size: Option<u32>,
    pub status: Arc<Status>,
    /// The interface's input, and why it couldn't open if it didn't.
    pub input: Option<InputOpened>,
    pub input_error: Option<String>,
    commands: Producer<Command>,
    finished: Consumer<Garbage>,
    close: mpsc::Sender<()>,
    thread: Option<thread::JoinHandle<()>>,
}

impl Running {
    /// Sends a command to the audio thread; first frees the songs it's
    /// done with. False when the queue is full (the audio thread stalled).
    pub fn send(&mut self, command: Command) -> bool {
        while let Ok(done) = self.finished.pop() {
            drop(done);
        }
        self.commands.push(command).is_ok()
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.close.send(());
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// The input's side on the audio thread: its ring, and the frames taken
/// off it for the block being rendered.
struct InputSide {
    samples: Consumer<f32>,
    channels: usize,
    block: Vec<f32>,
}

/// The audio thread's side.
struct Callback {
    engine: Engine,
    commands: Consumer<Command>,
    finished: Producer<Garbage>,
    status: Arc<Status>,
    left: Vec<f32>,
    right: Vec<f32>,
    channels: usize,
    sample_rate: f64,
    input: Option<InputSide>,
    /// The take being recorded, and if it's measuring the round trip, the
    /// engine frame it started at.
    capture: Option<Box<Capture>>,
    probe: Option<u64>,
    click: Vec<f32>,
}

impl Callback {
    fn apply(&mut self) {
        while let Ok(command) = self.commands.pop() {
            match command {
                Command::Song(song) => {
                    let old = self.engine.set_song(song);
                    // If the app's side is full, the song is freed here: rare,
                    // and better than holding it.
                    let _ = self.finished.push(Garbage::Song(old));
                }
                Command::Monitors(mut list) => {
                    self.engine.set_monitors(&mut list);
                    let _ = self.finished.push(Garbage::Monitors(list));
                }
                Command::Record { capture, probe } => {
                    self.end_take();
                    let started = self.engine.clock();
                    self.status.set_take_clock(TakeClock {
                        started,
                        downbeat: self.engine.starts_at(),
                        ..Default::default()
                    });
                    self.capture = Some(capture);
                    self.probe = probe.then_some(started);
                }
                Command::EndTake => self.end_take(),
                Command::Play {
                    from,
                    count_in_beats,
                } => self.engine.play(from, count_in_beats),
                Command::Stop => self.engine.stop(),
                Command::Seek(s) => self.engine.seek(s),
                Command::Loop(l) => self.engine.set_loop(l),
                Command::Metronome(on) => self.engine.set_metronome(on),
                Command::MetronomeLevel(db) => self.engine.set_metronome_level(db),
                Command::MetronomeSound(sound) => self.engine.set_metronome_sound(sound),
                Command::Key {
                    track,
                    key,
                    velocity: Some(v),
                } => self.engine.key_down(track, key, v),
                Command::Key {
                    track,
                    key,
                    velocity: None,
                } => self.engine.key_up(track, key),
                Command::Sustain { track, down } => self.engine.sustain(track, down),
                Command::Bend { track, value } => self.engine.pitch_bend(track, value),
                Command::ModWheel { track, value } => self.engine.mod_wheel(track, value),
            }
        }
        if self.engine.take_missing() {
            self.status.missing.store(true, Ordering::Relaxed);
        }
    }

    /// What's known of the take so far, for the app.
    fn note_take(&self) {
        if let Some(c) = &self.capture {
            let t = self.status.take_clock();
            self.status.set_take_clock(TakeClock {
                downbeat: self.engine.starts_at(),
                mix_latency: self.engine.song().latency() as u64,
                frames: c.frames,
                dropped: c.dropped,
                ..t
            });
        }
    }

    fn end_take(&mut self) {
        self.note_take();
        if let Some(c) = self.capture.take() {
            c.end();
            let _ = self.finished.push(Garbage::Capture(c));
        }
        self.probe = None;
    }

    /// Takes `n` frames of the input off its ring into its block (silence
    /// where they haven't come), keeping only the newest waiting; meters
    /// them and gives them to the take. The input's channels (0: none).
    fn read_input(&mut self, n: usize) -> usize {
        let Some(input) = &mut self.input else {
            return 0;
        };
        let ch = input.channels;
        let want = n * ch;
        // More than a callback's worth beyond this block waiting (the
        // input started first, or runs ahead): the oldest go.
        let chunk = (self.status.input_chunk.load(Ordering::Relaxed) as usize).max(n);
        let keep = want + 2 * chunk * ch;
        let waiting = input.samples.slots();
        if waiting > keep {
            let extra = (waiting - keep) / ch * ch;
            if let Ok(c) = input.samples.read_chunk(extra) {
                c.commit_all();
            }
        }
        let have = input.samples.slots().min(want) / ch * ch;
        if let Ok(c) = input.samples.read_chunk(have) {
            let (a, b) = c.as_slices();
            input.block[..a.len()].copy_from_slice(a);
            input.block[a.len()..a.len() + b.len()].copy_from_slice(b);
            c.commit_all();
        }
        input.block[have..want].fill(0.0);
        let wait = (input.samples.slots() / ch) as f64 / self.sample_rate;
        let before = f32::from_bits(self.status.input_wait.load(Ordering::Relaxed));
        self.status.input_wait.store(
            (before * 0.95 + wait as f32 * 0.05).to_bits(),
            Ordering::Relaxed,
        );
        for (c, peak) in self.status.input_peaks.iter().take(ch).enumerate() {
            let p = input.block[..want]
                .iter()
                .skip(c)
                .step_by(ch)
                .fold(0.0f32, |m, v| m.max(v.abs()));
            peak.fetch_max(p.to_bits(), Ordering::Relaxed);
        }
        if let Some(capture) = &mut self.capture {
            capture.push(&input.block[..want], ch);
        }
        ch
    }

    /// The clicks measuring the round trip, over the frames rendered from
    /// engine frame `from`.
    fn add_probe_clicks(&mut self, from: u64, n: usize) {
        let Some(start) = self.probe else {
            return;
        };
        for at in PROBE_CLICKS {
            let click_at = start + (at * self.sample_rate).round() as u64;
            for i in 0..n {
                let k = (from + i as u64).wrapping_sub(click_at) as usize;
                if let Some(v) = self.click.get(k) {
                    self.left[i] += v;
                    self.right[i] += v;
                }
            }
        }
    }

    fn render<T: SizedSample + FromSample<f32>>(
        &mut self,
        data: &mut [T],
        info: &OutputCallbackInfo,
    ) {
        let started = Instant::now();
        self.apply();
        let frames = data.len() / self.channels;
        let ts = info.timestamp();
        let driver = ts.playback.duration_since(ts.callback).as_secs_f64();
        let latency = driver.max(frames as f64 / self.sample_rate) as f32;
        self.status
            .output_latency
            .store(latency.to_bits(), Ordering::Relaxed);
        let mut done = 0;
        while done < frames {
            let n = (frames - done).min(SCRATCH);
            let ch = self.read_input(n);
            let clock = self.engine.clock();
            match &self.input {
                Some(input) if ch > 0 => self.engine.render_with_input(
                    &mut self.left[..n],
                    &mut self.right[..n],
                    &input.block[..n * ch],
                    ch,
                ),
                _ => self
                    .engine
                    .render(&mut self.left[..n], &mut self.right[..n]),
            }
            self.add_probe_clicks(clock, n);
            for i in 0..n {
                let frame = &mut data[(done + i) * self.channels..(done + i + 1) * self.channels];
                frame[0] = T::from_sample(self.left[i]);
                if self.channels > 1 {
                    frame[1] = T::from_sample(self.right[i]);
                    for x in &mut frame[2..] {
                        *x = T::EQUILIBRIUM;
                    }
                }
            }
            done += n;
        }
        let status = &self.status;
        status
            .position
            .store(self.engine.position_seconds().to_bits(), Ordering::Relaxed);
        status
            .playing
            .store(self.engine.playing(), Ordering::Relaxed);
        self.note_take();
        let master = self.engine.take_peaks(
            |i, p| {
                status.keep_peak(2 * i, p[0]);
                status.keep_peak(2 * i + 1, p[1]);
            },
            |i, p| {
                status.keep_peak(2 * MAX_METERED + 2 * i, p[0]);
                status.keep_peak(2 * MAX_METERED + 2 * i + 1, p[1]);
            },
        );
        status.keep_peak(4 * MAX_METERED, master[0]);
        status.keep_peak(4 * MAX_METERED + 1, master[1]);
        if let Some(m) = self.engine.take_limiter_meters() {
            status
                .limiter_gain
                .store((m.reduction as f32).to_bits(), Ordering::Relaxed);
        }
        if frames > 0 {
            let budget = frames as f64 / self.sample_rate;
            let used = (started.elapsed().as_secs_f64() / budget) as f32;
            let before = f32::from_bits(status.load.load(Ordering::Relaxed));
            status
                .load
                .store((before * 0.9 + used * 0.1).to_bits(), Ordering::Relaxed);
        }
    }
}

/// How to open a device.
pub struct Request {
    /// A device id from `devices::list`, or none for the system's default.
    pub device: Option<String>,
    pub sample_rate: Option<u32>,
    pub buffer_size: Option<u32>,
    /// Whether to open the input too, and which (an input's id from
    /// `devices::list`; none: the output device itself if it records, as
    /// an interface on ASIO or Core Audio does, else its driver's default).
    pub input: bool,
    pub input_device: Option<String>,
}

fn device_name(device: &Device) -> String {
    device
        .description()
        .ok()
        .map_or_else(|| device.to_string(), |d| d.name().to_owned())
}

fn find_input(output: &Device, id: Option<&str>) -> Result<Device, String> {
    if let Some(id) = id {
        let device_id: cpal::DeviceId = id.parse().map_err(|e| format!("{e}"))?;
        let host = cpal::host_from_id(device_id.host()).map_err(|e| format!("{e}"))?;
        return host
            .device_by_id(&device_id)
            .ok_or_else(|| "That audio input isn't connected.".to_owned());
    }
    if output
        .supported_input_configs()
        .is_ok_and(|mut c| c.next().is_some())
    {
        return Ok(output.clone());
    }
    let host_id = output.id().map_err(|e| format!("{e}"))?.host();
    cpal::host_from_id(host_id)
        .map_err(|e| format!("{e}"))?
        .default_input_device()
        .ok_or_else(|| "There's no audio input on this driver.".to_owned())
}

/// Opens the input at the output's rate: its stream, what it is, and the
/// ring its samples come on.
fn open_input(
    output: &Device,
    id: Option<&str>,
    sample_rate: u32,
    status: &Arc<Status>,
) -> Result<(cpal::Stream, InputOpened, Consumer<f32>), String> {
    let device = find_input(output, id)?;
    let default = device.default_input_config().map_err(|e| format!("{e}"))?;
    let takes_rate = device.supported_input_configs().is_ok_and(|mut c| {
        c.any(|c| c.min_sample_rate() <= sample_rate && sample_rate <= c.max_sample_rate())
    });
    if !takes_rate {
        return Err(format!(
            "The input runs at {} Hz and the output at {sample_rate} Hz: set both to the same rate.",
            default.sample_rate()
        ));
    }
    let channels = default.channels().max(1);
    let config = StreamConfig {
        channels,
        sample_rate,
        buffer_size: BufferSize::Default,
    };
    let ch = usize::from(channels);
    let (tx, rx) = RingBuffer::<f32>::new(SCRATCH * ch * 4);
    let stream = build_input(
        &device,
        &config,
        default.sample_format(),
        tx,
        status.clone(),
    )?;
    stream.play().map_err(|e| format!("{e}"))?;
    Ok((
        stream,
        InputOpened {
            name: device_name(&device),
            channels: ch,
        },
        rx,
    ))
}

fn build_input(
    device: &Device,
    config: &StreamConfig,
    format: SampleFormat,
    ring: Producer<f32>,
    status: Arc<Status>,
) -> Result<cpal::Stream, String> {
    fn typed<T: SizedSample + 'static>(
        device: &Device,
        config: &StreamConfig,
        mut ring: Producer<f32>,
        status: Arc<Status>,
    ) -> Result<cpal::Stream, String>
    where
        f32: FromSample<T>,
    {
        let channels = usize::from(config.channels);
        let rate = f64::from(config.sample_rate);
        let errors = status.clone();
        device
            .build_input_stream::<T, _, _>(
                *config,
                move |data: &[T], info: &InputCallbackInfo| {
                    for x in data {
                        // Full: the output isn't taking it (it stalled).
                        let _ = ring.push(x.to_sample::<f32>());
                    }
                    let frames = data.len() / channels;
                    let ts = info.timestamp();
                    let driver = ts.callback.duration_since(ts.capture).as_secs_f64();
                    let latency = driver.max(frames as f64 / rate) as f32;
                    status
                        .input_latency
                        .store(latency.to_bits(), Ordering::Relaxed);
                    status.input_chunk.store(frames as u32, Ordering::Relaxed);
                },
                move |_| {
                    errors.errors.fetch_add(1, Ordering::Relaxed);
                },
                None,
            )
            .map_err(|e| format!("{e}"))
    }
    match format {
        SampleFormat::F32 => typed::<f32>(device, config, ring, status),
        SampleFormat::F64 => typed::<f64>(device, config, ring, status),
        SampleFormat::I16 => typed::<i16>(device, config, ring, status),
        SampleFormat::I32 => typed::<i32>(device, config, ring, status),
        SampleFormat::U16 => typed::<u16>(device, config, ring, status),
        other => Err(format!(
            "The input's sample format ({other:?}) isn't supported yet."
        )),
    }
}

fn find_device(id: Option<&str>) -> Result<Device, String> {
    let Some(id) = id else {
        return cpal::default_host()
            .default_output_device()
            .ok_or("There's no audio output device.".into());
    };
    let device_id: cpal::DeviceId = id.parse().map_err(|e| format!("{e}"))?;
    let host = cpal::host_from_id(device_id.host()).map_err(|e| format!("{e}"))?;
    host.device_by_id(&device_id)
        .ok_or_else(|| "That audio device isn't connected.".to_owned())
}

/// What the stream's thread hands back once the device is playing.
struct Opened {
    sample_rate: f64,
    status: Arc<Status>,
    commands: Producer<Command>,
    finished: Consumer<Garbage>,
    input: Option<InputOpened>,
    input_error: Option<String>,
}

/// Opens the device and starts the engine playing through it.
pub fn open(request: Request) -> Result<Running, String> {
    let (ready_tx, ready_rx) = mpsc::channel::<Result<Opened, String>>();
    let (close_tx, close_rx) = mpsc::channel::<()>();
    let buffer_size = request.buffer_size;
    let thread = thread::Builder::new()
        .name("dawn-audio-device".into())
        .spawn(move || {
            let opened = (|| {
                let device = find_device(request.device.as_deref())?;
                let default = device.default_output_config().map_err(|e| format!("{e}"))?;
                let sample_rate = request
                    .sample_rate
                    .filter(|r| {
                        device.supported_output_configs().is_ok_and(|mut c| {
                            c.any(|c| c.min_sample_rate() <= *r && *r <= c.max_sample_rate())
                        })
                    })
                    .unwrap_or(default.sample_rate());
                let config = StreamConfig {
                    channels: default.channels().max(1),
                    sample_rate,
                    buffer_size: request
                        .buffer_size
                        .map_or(BufferSize::Default, BufferSize::Fixed),
                };
                let status = Arc::new(Status::new());
                let (commands_tx, commands_rx) = RingBuffer::<Command>::new(256);
                let (finished_tx, finished_rx) = RingBuffer::<Garbage>::new(64);
                // The input first, so it's coming in when the output starts.
                let (input_stream, input, input_error) = if request.input {
                    match open_input(
                        &device,
                        request.input_device.as_deref(),
                        sample_rate,
                        &status,
                    ) {
                        Ok((stream, opened, ring)) => (Some(stream), Some((opened, ring)), None),
                        Err(e) => (None, None, Some(e)),
                    }
                } else {
                    (None, None, None)
                };
                let (input, input_side) = match input {
                    Some((opened, samples)) => {
                        let channels = opened.channels;
                        (
                            Some(opened),
                            Some(InputSide {
                                samples,
                                channels,
                                block: vec![0.0; SCRATCH * channels],
                            }),
                        )
                    }
                    None => (None, None),
                };
                let callback = Callback {
                    engine: Engine::new(f64::from(sample_rate)),
                    commands: commands_rx,
                    finished: finished_tx,
                    status: status.clone(),
                    left: vec![0.0; SCRATCH],
                    right: vec![0.0; SCRATCH],
                    channels: usize::from(config.channels),
                    sample_rate: f64::from(sample_rate),
                    input: input_side,
                    capture: None,
                    probe: None,
                    click: probe_click(f64::from(sample_rate)),
                };
                let stream = build(
                    &device,
                    &config,
                    default.sample_format(),
                    callback,
                    status.clone(),
                )?;
                stream.play().map_err(|e| format!("{e}"))?;
                Ok((
                    (stream, input_stream),
                    Opened {
                        sample_rate: f64::from(sample_rate),
                        status,
                        commands: commands_tx,
                        finished: finished_rx,
                        input,
                        input_error,
                    },
                ))
            })();
            match opened {
                Ok((streams, parts)) => {
                    let _ = ready_tx.send(Ok(parts));
                    // Keeps the streams until told to close (or the app goes).
                    let _ = close_rx.recv();
                    drop(streams);
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                }
            }
        })
        .map_err(|e| format!("{e}"))?;
    let opened = ready_rx.recv().map_err(|e| format!("{e}"))??;
    Ok(Running {
        sample_rate: opened.sample_rate,
        buffer_size,
        status: opened.status,
        input: opened.input,
        input_error: opened.input_error,
        commands: opened.commands,
        finished: opened.finished,
        close: close_tx,
        thread: Some(thread),
    })
}

fn build(
    device: &Device,
    config: &StreamConfig,
    format: SampleFormat,
    callback: Callback,
    status: Arc<Status>,
) -> Result<cpal::Stream, String> {
    fn typed<T: SizedSample + FromSample<f32> + 'static>(
        device: &Device,
        config: &StreamConfig,
        mut callback: Callback,
        status: Arc<Status>,
    ) -> Result<cpal::Stream, String> {
        device
            .build_output_stream::<T, _, _>(
                *config,
                move |data: &mut [T], info: &OutputCallbackInfo| callback.render(data, info),
                move |_| {
                    status.errors.fetch_add(1, Ordering::Relaxed);
                },
                None,
            )
            .map_err(|e| format!("{e}"))
    }
    match format {
        SampleFormat::F32 => typed::<f32>(device, config, callback, status),
        SampleFormat::F64 => typed::<f64>(device, config, callback, status),
        SampleFormat::I16 => typed::<i16>(device, config, callback, status),
        SampleFormat::I32 => typed::<i32>(device, config, callback, status),
        SampleFormat::U16 => typed::<u16>(device, config, callback, status),
        other => Err(format!(
            "The device's sample format ({other:?}) isn't supported yet."
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peaks_are_kept_until_read() {
        let s = Status::new();
        s.keep_peak(0, 0.5);
        s.keep_peak(0, 0.25);
        s.keep_peak(4 * MAX_METERED + 1, 0.75);
        let (tracks, _, master) = s.take_peaks(1, 0);
        assert_eq!(tracks, [[0.5, 0.0]]);
        assert_eq!(master, [0.0, 0.75]);
        assert_eq!(s.take_peaks(1, 0).0, [[0.0, 0.0]]);
    }
}

#[cfg(test)]
mod device_tests {
    use super::*;

    /// Run by hand: lists the devices and plays a second through the
    /// default one (`cargo test -p dawn-desktop -- --ignored --nocapture`).
    #[test]
    #[ignore]
    fn plays_through_the_default_device() {
        for d in crate::audio::devices::list() {
            eprintln!("{} ({}): {} devices", d.name, d.id, d.devices.len());
            for dev in &d.devices {
                eprintln!(
                    "  {} [{}] rates {:?} buffers {:?}-{:?}",
                    dev.name, dev.id, dev.sample_rates, dev.min_buffer, dev.max_buffer
                );
            }
        }
        let mut running = open(Request {
            device: std::env::var("DAWN_TEST_DEVICE").ok(),
            sample_rate: None,
            buffer_size: Some(256),
            input: true,
            input_device: None,
        })
        .expect("opens");
        eprintln!(
            "open at {} Hz, input {:?} {:?}",
            running.sample_rate,
            running.input.as_ref().map(|i| (&i.name, i.channels)),
            running.input_error
        );
        assert!(running.send(Command::Metronome(true)));
        assert!(running.send(Command::Play {
            from: 0.0,
            count_in_beats: 0.0
        }));
        std::thread::sleep(std::time::Duration::from_millis(1000));
        let pos = running.status.position();
        eprintln!(
            "position after a second: {pos:.3} s, load {:.3}, errors {}",
            running.status.load(),
            running.status.errors()
        );
        assert!(pos > 0.5, "the transport moved {pos}");
    }
}
