//! Takes recorded from the audio interface, written to disk as they come
//! in. The audio thread copies the recording track's input into a ring
//! (`Capture`); a thread of its own writes it to a WAV file (32-bit float,
//! mono), keeping the file's header up to date so a take survives the app
//! going down mid-take. Finished, the studio gets the take from where its
//! downbeat was heard (`read_take`), and the file goes.
//!
//! Measuring the round trip uses the same capture, with clicks played
//! straight to the output at known times (`PROBE_CLICKS`).

use std::fs::File;
use std::io::{self, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use dawn_engine::mix::input_sample;
use rtrb::{Consumer, Producer, RingBuffer};

/// Frames per bucket of the live waveform: waveform.ts's WAVE_BUCKET.
pub const BUCKET: usize = 64;
/// How long a take the ring holds unwritten (s): the writer only falls
/// that far behind if the disk stalls.
const RING_SECONDS: usize = 30;
const HEADER: u64 = 44;

/// Where the clicks measuring the round trip go, from the capture's start
/// (s): as the browser engine measures (audioEngine.ts).
pub const PROBE_CLICKS: [f64; 5] = [0.3, 0.9, 1.5, 2.1, 2.7];

/// The click measuring the round trip: 4 ms of 2.5 kHz, faded in and out.
pub fn probe_click(sample_rate: f64) -> Vec<f32> {
    let n = (0.004 * sample_rate).round() as usize;
    (0..n)
        .map(|i| {
            let t = i as f64;
            (0.5 * (2.0 * std::f64::consts::PI * 2500.0 * t / sample_rate).sin()
                * (std::f64::consts::PI * t / n as f64).sin()) as f32
        })
        .collect()
}

/// The audio thread's side of a take: the input it takes (a channel, or
/// all mixed to one), into the writer's ring, and the live waveform's
/// buckets (lowest, highest) into the studio's.
pub struct Capture {
    channel: Option<usize>,
    samples: Producer<f32>,
    buckets: Producer<[f32; 2]>,
    bucket: [f32; 2],
    in_bucket: usize,
    /// Frames taken so far.
    pub frames: u64,
    /// Samples the writer had no room for (it fell behind).
    pub dropped: u64,
    /// Set when the take ends: the writer finishes then.
    ended: Arc<AtomicBool>,
}

impl Capture {
    /// The take ends: the writer writes what's left and stops.
    pub fn end(&self) {
        self.ended.store(true, Ordering::Release);
    }

    /// Takes the frames of the interface's input in `input` (`channels`
    /// samples each, interleaved).
    pub fn push(&mut self, input: &[f32], channels: usize) {
        if channels == 0 {
            return;
        }
        for frame in input.chunks_exact(channels) {
            let v = input_sample(frame, self.channel);
            if self.samples.push(v).is_err() {
                self.dropped += 1;
            }
            self.bucket = [self.bucket[0].min(v), self.bucket[1].max(v)];
            self.in_bucket += 1;
            if self.in_bucket == BUCKET {
                let _ = self.buckets.push(self.bucket);
                self.bucket = [0.0; 2];
                self.in_bucket = 0;
            }
            self.frames += 1;
        }
    }
}

/// A take being written: its file, and the thread writing it.
pub struct Writer {
    pub path: PathBuf,
    /// The live waveform's buckets, as they come.
    pub buckets: Consumer<[f32; 2]>,
    thread: Option<thread::JoinHandle<io::Result<u64>>>,
}

impl Writer {
    /// Waits for the last of the take to be written (once the audio
    /// thread has said it's ended, or gone); the frames written.
    pub fn finish(mut self) -> io::Result<u64> {
        match self.thread.take().map(thread::JoinHandle::join) {
            Some(Ok(result)) => result,
            Some(Err(_)) => Err(io::Error::other("The take's writer stopped.")),
            None => Ok(0),
        }
    }
}

/// Starts a take written to `path` at `sample_rate`: the capture for the
/// audio thread, and the writer, which stops once the capture ends (or is
/// dropped) and it's written everything.
pub fn start(
    path: PathBuf,
    sample_rate: u32,
    channel: Option<usize>,
) -> io::Result<(Capture, Writer)> {
    let ended = Arc::new(AtomicBool::new(false));
    let ends = ended.clone();
    let (samples, from_thread) = RingBuffer::<f32>::new(sample_rate as usize * RING_SECONDS);
    let (buckets, bucket_rx) =
        RingBuffer::<[f32; 2]>::new(sample_rate as usize * RING_SECONDS / BUCKET);
    let file = File::create(&path)?;
    let thread = thread::Builder::new()
        .name("dawn-take-writer".into())
        .spawn(move || write(file, sample_rate, from_thread, &ends))?;
    Ok((
        Capture {
            channel,
            samples,
            buckets,
            bucket: [0.0; 2],
            in_bucket: 0,
            frames: 0,
            dropped: 0,
            ended,
        },
        Writer {
            path,
            buckets: bucket_rx,
            thread: Some(thread),
        },
    ))
}

fn header(out: &mut impl Write, sample_rate: u32, frames: u64) -> io::Result<()> {
    let data = u32::try_from(frames * 4).unwrap_or(u32::MAX - 36);
    out.write_all(b"RIFF")?;
    out.write_all(&(36 + data).to_le_bytes())?;
    out.write_all(b"WAVEfmt ")?;
    out.write_all(&16u32.to_le_bytes())?;
    // IEEE float, mono.
    out.write_all(&3u16.to_le_bytes())?;
    out.write_all(&1u16.to_le_bytes())?;
    out.write_all(&sample_rate.to_le_bytes())?;
    out.write_all(&(sample_rate * 4).to_le_bytes())?;
    out.write_all(&4u16.to_le_bytes())?;
    out.write_all(&32u16.to_le_bytes())?;
    out.write_all(b"data")?;
    out.write_all(&data.to_le_bytes())
}

fn write(
    file: File,
    sample_rate: u32,
    mut samples: Consumer<f32>,
    ended: &AtomicBool,
) -> io::Result<u64> {
    let mut out = BufWriter::new(file);
    header(&mut out, sample_rate, 0)?;
    let mut frames = 0u64;
    let mut headed = Instant::now();
    loop {
        let done = ended.load(Ordering::Acquire) || samples.is_abandoned();
        let n = samples.slots();
        if n > 0 {
            let chunk = samples
                .read_chunk(n)
                .map_err(|_| io::Error::other("The take's ring"))?;
            let (a, b) = chunk.as_slices();
            for v in a.iter().chain(b) {
                out.write_all(&v.to_le_bytes())?;
            }
            chunk.commit_all();
            frames += n as u64;
        } else if done {
            break;
        } else {
            thread::sleep(Duration::from_millis(5));
        }
        // The header follows along, so the file is whole if the app goes.
        if headed.elapsed() > Duration::from_secs(1) {
            headed = Instant::now();
            out.seek(SeekFrom::Start(0))?;
            header(&mut out, sample_rate, frames)?;
            out.seek(SeekFrom::End(0))?;
        }
    }
    out.seek(SeekFrom::Start(0))?;
    header(&mut out, sample_rate, frames)?;
    out.flush()?;
    Ok(frames)
}

/// A take's samples from frame `skip` on (f32, little-endian), and the
/// file removed.
pub fn read_take(path: &Path, skip: u64) -> io::Result<Vec<u8>> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    let from = (HEADER + skip * 4).min(len);
    file.seek(SeekFrom::Start(from))?;
    let mut bytes = Vec::with_capacity((len - from) as usize);
    file.read_to_end(&mut bytes)?;
    drop(file);
    let _ = std::fs::remove_file(path);
    bytes.truncate(bytes.len() / 4 * 4);
    Ok(bytes)
}

/// Where a take starts in its capture (frames): what was heard on the
/// downbeat comes back in after the wait for the transport (`downbeat`
/// on the engine's clock, the capture starting at `started`), the mix's
/// own latency, and the round trip (`round_trip` frames, from the
/// studio: measured or estimated, with its offset).
pub fn take_start(started: u64, downbeat: u64, mix_latency: u64, round_trip: i64) -> u64 {
    let at = downbeat.saturating_sub(started) + mix_latency;
    at.saturating_add_signed(round_trip)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("dawn-take-test-{name}-{}.wav", std::process::id()))
    }

    #[test]
    fn a_take_is_written_as_a_wav_and_read_from_its_downbeat() {
        let path = temp("write");
        let (mut capture, writer) = start(path.clone(), 48000, Some(1)).unwrap();
        // Two channels; the take is the second.
        let input: Vec<f32> = (0..200).flat_map(|i| [0.0, i as f32 / 1000.0]).collect();
        capture.push(&input, 2);
        assert_eq!(capture.frames, 200);
        // Three buckets of 64 so far, the last one's highest its last.
        let mut buckets = writer.buckets;
        let writer = Writer {
            path: writer.path,
            buckets: RingBuffer::new(1).1,
            thread: writer.thread,
        };
        let got: Vec<[f32; 2]> = std::iter::from_fn(|| buckets.pop().ok()).collect();
        assert_eq!(got.len(), 3);
        assert!((got[2][1] - 0.191).abs() < 1e-6);
        capture.end();
        assert_eq!(writer.finish().unwrap(), 200);
        let file = std::fs::read(&path).unwrap();
        assert_eq!(&file[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(file[40..44].try_into().unwrap()), 800);
        let bytes = read_take(&path, 150).unwrap();
        let samples: Vec<f32> = bytes
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| f32::from_le_bytes(*b))
            .collect();
        assert_eq!(samples.len(), 50);
        assert!((samples[0] - 0.150).abs() < 1e-6);
        assert!(!path.exists(), "the file goes once read");
    }

    #[test]
    fn a_take_starts_where_its_downbeat_comes_back_in() {
        // Recording a second before the downbeat (a count-in), 240 frames
        // of limiter lookahead, a 10 ms round trip at 48 kHz.
        assert_eq!(take_start(1000, 49000, 240, 480), 48000 + 240 + 480);
        // Less than nothing (a big negative offset) is the capture's start.
        assert_eq!(take_start(1000, 1000, 0, -480), 0);
    }

    #[test]
    fn the_probe_click_is_short_and_faded() {
        let click = probe_click(48000.0);
        assert_eq!(click.len(), 192);
        assert!(click[0].abs() < 1e-6);
        assert!(click.iter().any(|v| v.abs() > 0.3));
    }
}
