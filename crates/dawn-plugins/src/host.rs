//! Running CLAP plugins: an instance of one, on the thread that made it
//! (the app's main thread, as CLAP asks), and its audio processor, which
//! goes to the audio thread to process a track's sound.
//!
//! An instance (`ClapPlugin`) is activated at the device's rate and hands
//! out its processor (`ClapProcessor`), started. The processor goes back
//! home when it's dropped (off the audio thread: the engine frees what it's
//! done with elsewhere), and the instance takes it back (`reclaim`):
//! stopped and deactivated, ready to be activated again (at another rate)
//! or destroyed. The instance's state is saved and loaded as CLAP's state
//! extension says, and its window is the plugin's own GUI, put in a window
//! the app gives it (`open_gui`).

use std::cell::Cell;
use std::ffi::CString;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use clack_extensions::audio_ports::{
    AudioPortInfoBuffer, AudioPortRescanFlags, HostAudioPortsImpl, PluginAudioPorts,
};
use clack_extensions::gui::{
    GuiApiType, GuiConfiguration, GuiSize, HostGui, HostGuiImpl, PluginGui, Window,
};
use clack_extensions::latency::{HostLatency, HostLatencyImpl, PluginLatency};
use clack_extensions::state::{HostState, HostStateImpl, PluginState};
use clack_host::prelude::*;

/// What a plugin's window goes in (a window of the app's, by its handle).
pub use clack_extensions::gui::Window as ParentWindow;
/// A loaded CLAP file's entry.
pub use clack_host::prelude::PluginEntry;

/// The most frames processed in one go: the engine's block.
pub const MAX_FRAMES: u32 = 2048;

/// What the plugin can ask of the host from any thread, kept for the main
/// thread to act on (`ClapPlugin::tick`).
pub struct Shared {
    /// It asked to be called on the main thread.
    callback: AtomicBool,
    /// It asked to be restarted (deactivated and activated again).
    restart: AtomicBool,
    /// Its state changed: it should be saved again.
    dirty: AtomicBool,
    /// Its window was closed by the plugin, or wants another size.
    gui_closed: AtomicBool,
    gui_size: Mutex<Option<GuiSize>>,
    /// Called when it wants the main thread's attention.
    wake: Arc<dyn Fn() + Send + Sync>,
    state: OnceLock<Option<PluginState>>,
    latency: OnceLock<Option<PluginLatency>>,
    gui: OnceLock<Option<PluginGui>>,
    ports: OnceLock<Option<PluginAudioPorts>>,
}

impl<'a> SharedHandler<'a> for Shared {
    fn initializing(&self, instance: InitializingPluginHandle<'a>) {
        let _ = self.state.set(instance.get_extension());
        let _ = self.latency.set(instance.get_extension());
        let _ = self.gui.set(instance.get_extension());
        let _ = self.ports.set(instance.get_extension());
    }

    fn request_restart(&self) {
        self.restart.store(true, Ordering::Release);
        (self.wake)();
    }

    fn request_process(&self) {}

    fn request_callback(&self) {
        self.callback.store(true, Ordering::Release);
        (self.wake)();
    }
}

impl HostGuiImpl for Shared {
    fn resize_hints_changed(&self) {}

    fn request_resize(&self, new_size: GuiSize) -> Result<(), HostError> {
        *self.gui_size.lock().unwrap_or_else(|e| e.into_inner()) = Some(new_size);
        (self.wake)();
        Ok(())
    }

    fn request_show(&self) -> Result<(), HostError> {
        Ok(())
    }

    fn request_hide(&self) -> Result<(), HostError> {
        Ok(())
    }

    fn closed(&self, _was_destroyed: bool) {
        self.gui_closed.store(true, Ordering::Release);
        (self.wake)();
    }
}

pub struct MainThread<'a> {
    shared: &'a Shared,
    latency_changed: Cell<bool>,
}

impl<'a> MainThreadHandler<'a> for MainThread<'a> {}

impl HostStateImpl for MainThread<'_> {
    fn mark_dirty(&self) {
        self.shared.dirty.store(true, Ordering::Release);
    }
}

impl HostLatencyImpl for MainThread<'_> {
    fn changed(&self) {
        self.latency_changed.set(true);
    }
}

impl HostAudioPortsImpl for MainThread<'_> {
    fn is_rescan_flag_supported(&self, _flag: AudioPortRescanFlags) -> bool {
        false
    }

    fn rescan(&self, _flag: AudioPortRescanFlags) {}
}

pub struct DawnHost;

impl HostHandlers for DawnHost {
    type Shared<'a> = Shared;
    type MainThread<'a> = MainThread<'a>;
    type AudioProcessor<'a> = ();

    fn declare_extensions(builder: &mut HostExtensions<Self>, _shared: &Self::Shared<'_>) {
        builder
            .register::<HostState>()
            .register::<HostLatency>()
            .register::<HostGui>()
            .register::<clack_extensions::audio_ports::HostAudioPorts>();
    }
}

type Processor = StartedPluginAudioProcessor<DawnHost>;

/// Where a processor goes back to when it's dropped.
type Home = Arc<Mutex<Option<Processor>>>;

/// The channels of each of a plugin's audio ports, inputs and outputs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ports {
    pub inputs: Vec<u32>,
    pub outputs: Vec<u32>,
}

/// A plugin's audio processor on the audio thread, with its buffers.
pub struct ClapProcessor {
    processor: Option<Processor>,
    home: Home,
    ports: Ports,
    /// Each input port's channels, then each output port's.
    inputs: Vec<Vec<f32>>,
    outputs: Vec<Vec<f32>>,
    input_ports: AudioPorts,
    output_ports: AudioPorts,
    events_in: EventBuffer,
    events_out: EventBuffer,
    steady: u64,
}

impl ClapProcessor {
    /// Processes a stereo block in place (its main ports: a mono one takes
    /// both sides mixed and gives its one to both). A plugin that fails
    /// leaves the sound as it was.
    pub fn process(&mut self, l: &mut [f32], r: &mut [f32]) {
        let n = l.len().min(r.len()).min(MAX_FRAMES as usize);
        let Some(processor) = self.processor.as_mut() else {
            return;
        };
        // The main input: the track's sound; the others (sidechains): silence.
        let main_in = self.ports.inputs.first().copied().unwrap_or(0) as usize;
        for (c, buf) in self.inputs.iter_mut().enumerate() {
            let b = &mut buf[..n];
            match (c, main_in) {
                (0, 1) => b
                    .iter_mut()
                    .zip(l.iter().zip(r.iter()))
                    .for_each(|(x, (a, b))| *x = (a + b) * 0.5),
                (0, m) if m >= 1 => b.copy_from_slice(&l[..n]),
                (1, m) if m >= 2 => b.copy_from_slice(&r[..n]),
                _ => b.fill(0.0),
            }
        }
        let mut inputs = self.inputs.iter_mut();
        let ins = self.ports.inputs.iter().map(|&count| AudioPortBuffer {
            latency: 0,
            channels: AudioPortBufferType::f32_input_only(
                inputs
                    .by_ref()
                    .take(count as usize)
                    .map(|b| InputChannel::variable(&mut b[..n]))
                    .collect::<Vec<_>>(),
            ),
        });
        let input_audio = self.input_ports.with_input_buffers(ins);
        let mut outputs = self.outputs.iter_mut();
        let outs = self.ports.outputs.iter().map(|&count| AudioPortBuffer {
            latency: 0,
            channels: AudioPortBufferType::f32_output_only(
                outputs
                    .by_ref()
                    .take(count as usize)
                    .map(|b| &mut b[..n])
                    .collect::<Vec<_>>(),
            ),
        });
        let mut output_audio = self.output_ports.with_output_buffers(outs);
        self.events_in.clear();
        self.events_out.clear();
        let result = processor.process(
            &input_audio,
            &mut output_audio,
            &InputEvents::from_buffer(&self.events_in),
            &mut OutputEvents::from_buffer(&mut self.events_out),
            Some(self.steady),
            None,
        );
        self.steady += n as u64;
        if result.is_err() {
            return;
        }
        let main_out = self.ports.outputs.first().copied().unwrap_or(0);
        match main_out {
            0 => {}
            1 => {
                l[..n].copy_from_slice(&self.outputs[0][..n]);
                r[..n].copy_from_slice(&self.outputs[0][..n]);
            }
            _ => {
                l[..n].copy_from_slice(&self.outputs[0][..n]);
                r[..n].copy_from_slice(&self.outputs[1][..n]);
            }
        }
    }
}

impl Drop for ClapProcessor {
    fn drop(&mut self) {
        if let Some(p) = self.processor.take() {
            *self.home.lock().unwrap_or_else(|e| e.into_inner()) = Some(p);
        }
    }
}

/// An instance of a CLAP plugin, on the thread that made it.
pub struct ClapPlugin {
    instance: PluginInstance<DawnHost>,
    home: Home,
    /// Its processor is out (with the engine, or waiting to go there).
    out: bool,
    /// The rate it's active at.
    active_at: Option<f64>,
    gui_open: bool,
}

fn host_info() -> HostInfo {
    HostInfo::new(
        "The Dawn Project",
        "The Dawn Project",
        "https://thedawnproject.app",
        env!("CARGO_PKG_VERSION"),
    )
    .expect("the host's info has no nul bytes")
}

impl ClapPlugin {
    /// Makes an instance of the plugin `id` in `entry`. `wake` is called
    /// (from any thread) when it wants the main thread's attention: the
    /// app should call `tick` then.
    pub fn new(
        entry: &PluginEntry,
        id: &str,
        wake: Arc<dyn Fn() + Send + Sync>,
    ) -> Result<Self, String> {
        let id = CString::new(id).map_err(|_| "A plugin id has no nul bytes.".to_owned())?;
        let instance = PluginInstance::<DawnHost>::new(
            move |_| Shared {
                callback: AtomicBool::new(false),
                restart: AtomicBool::new(false),
                dirty: AtomicBool::new(false),
                gui_closed: AtomicBool::new(false),
                gui_size: Mutex::new(None),
                wake,
                state: OnceLock::new(),
                latency: OnceLock::new(),
                gui: OnceLock::new(),
                ports: OnceLock::new(),
            },
            |shared| MainThread {
                shared,
                latency_changed: Cell::new(false),
            },
            entry,
            &id,
            &host_info(),
        )
        .map_err(|e| format!("The plugin couldn't be made ({e})."))?;
        Ok(Self {
            instance,
            home: Arc::new(Mutex::new(None)),
            out: false,
            active_at: None,
            gui_open: false,
        })
    }

    fn shared<R>(&self, f: impl FnOnce(&Shared) -> R) -> R {
        self.instance.access_shared_handler(f)
    }

    /// Its state, as it saves it; empty if it has none to save.
    pub fn save_state(&mut self) -> Result<Vec<u8>, String> {
        let Some(state) = self.shared(|s| s.state.get().copied().flatten()) else {
            return Ok(Vec::new());
        };
        let mut bytes = Vec::new();
        state
            .save(&self.instance.plugin_handle(), &mut bytes)
            .map_err(|_| "The plugin couldn't save its state.".to_owned())?;
        self.shared(|s| s.dirty.store(false, Ordering::Release));
        Ok(bytes)
    }

    /// Gives it back a state it saved.
    pub fn load_state(&mut self, bytes: &[u8]) -> Result<(), String> {
        let Some(state) = self.shared(|s| s.state.get().copied().flatten()) else {
            return Ok(());
        };
        state
            .load(&self.instance.plugin_handle(), &mut &bytes[..])
            .map_err(|_| "The plugin couldn't load its state.".to_owned())
    }

    /// Whether its state changed since it was last saved; once.
    pub fn take_dirty(&self) -> bool {
        self.shared(|s| s.dirty.swap(false, Ordering::AcqRel))
    }

    /// How late its sound comes out (frames), as it says while active.
    pub fn latency(&mut self) -> u32 {
        match self.shared(|s| s.latency.get().copied().flatten()) {
            Some(l) if self.instance.is_active() => l.get(&self.instance.plugin_handle()),
            _ => 0,
        }
    }

    /// Its audio ports' channels (a stereo pair each, if it doesn't say).
    pub fn ports(&mut self) -> Ports {
        let Some(ext) = self.shared(|s| s.ports.get().copied().flatten()) else {
            return Ports {
                inputs: vec![2],
                outputs: vec![2],
            };
        };
        let handle = self.instance.plugin_handle();
        let mut buffer = AudioPortInfoBuffer::new();
        let mut list = |input: bool| -> Vec<u32> {
            (0..ext.count(&handle, input))
                .map(|i| {
                    ext.get(&handle, i, input, &mut buffer)
                        .map_or(2, |p| p.channel_count)
                })
                .collect()
        };
        let inputs = list(true);
        let outputs = list(false);
        Ports { inputs, outputs }
    }

    /// Takes its processor back if it's come home: stopped and deactivated.
    pub fn reclaim(&mut self) {
        let back = self.home.lock().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(p) = back {
            self.instance.deactivate(p.stop_processing());
            self.active_at = None;
            self.out = false;
        }
    }

    /// Whether its processor is with the engine (or on its way there).
    pub fn is_out(&self) -> bool {
        self.out
    }

    /// Activates it at `sample_rate` and hands out its processor, started;
    /// None while one is out already.
    pub fn processor(&mut self, sample_rate: f64) -> Result<Option<ClapProcessor>, String> {
        self.reclaim();
        if self.out {
            return Ok(None);
        }
        let ports = self.ports();
        let config = PluginAudioConfiguration {
            sample_rate,
            min_frames_count: 1,
            max_frames_count: MAX_FRAMES,
        };
        let stopped = self
            .instance
            .activate(|_, _| (), config)
            .map_err(|e| format!("The plugin couldn't start ({e})."))?;
        self.active_at = Some(sample_rate);
        let started = stopped
            .start_processing()
            .map_err(|e| format!("The plugin couldn't start processing ({e})."))?;
        self.out = true;
        let channels = |counts: &[u32]| -> Vec<Vec<f32>> {
            let total: u32 = counts.iter().sum();
            (0..total).map(|_| vec![0.0; MAX_FRAMES as usize]).collect()
        };
        let total = |counts: &[u32]| counts.iter().sum::<u32>() as usize;
        Ok(Some(ClapProcessor {
            processor: Some(started),
            home: self.home.clone(),
            inputs: channels(&ports.inputs),
            outputs: channels(&ports.outputs),
            input_ports: AudioPorts::with_capacity(total(&ports.inputs), ports.inputs.len()),
            output_ports: AudioPorts::with_capacity(total(&ports.outputs), ports.outputs.len()),
            ports,
            events_in: EventBuffer::new(),
            events_out: EventBuffer::new(),
            steady: 0,
        }))
    }

    /// What it asked for from other threads, done on this one: its
    /// callback, and a restart (the engine's processor is swapped next time
    /// the song is sent, so only a pending one is taken back here).
    pub fn tick(&mut self) {
        if self.shared(|s| s.callback.swap(false, Ordering::AcqRel)) {
            self.instance.call_on_main_thread_callback();
        }
        self.shared(|s| s.restart.store(false, Ordering::Release));
        self.reclaim();
    }

    // --- Its window ---

    fn gui(&self) -> Option<PluginGui> {
        self.shared(|s| s.gui.get().copied().flatten())
    }

    /// Whether it has a window of its own that can go in one of ours.
    pub fn has_gui(&mut self) -> bool {
        let Some(gui) = self.gui() else {
            return false;
        };
        let handle = self.instance.plugin_handle();
        GuiApiType::default_for_current_platform().is_some_and(|api| {
            gui.is_api_supported(
                &handle,
                GuiConfiguration {
                    api_type: api,
                    is_floating: false,
                },
            )
        })
    }

    /// Puts its window in `parent` (a window of ours, empty), and says
    /// how big it wants to be, and whether that's in logical pixels.
    ///
    /// # Safety
    /// `parent` must stay alive until `close_gui`.
    pub unsafe fn open_gui(&mut self, parent: Window) -> Result<(GuiSize, bool), String> {
        let gui = self.gui().ok_or("The plugin has no window of its own.")?;
        let api = GuiApiType::default_for_current_platform().ok_or("No window system.")?;
        if self.gui_open {
            self.close_gui();
        }
        let handle = self.instance.plugin_handle();
        let config = GuiConfiguration {
            api_type: api,
            is_floating: false,
        };
        gui.create(&handle, config)
            .map_err(|_| "The plugin couldn't make its window.".to_owned())?;
        self.gui_open = true;
        // SAFETY: the caller keeps the parent alive while it's open.
        unsafe { gui.set_parent(&handle, parent) }
            .map_err(|_| "The plugin couldn't go in its window.".to_owned())?;
        let size = gui.get_size(&handle).unwrap_or(GuiSize {
            width: 600,
            height: 400,
        });
        let _ = gui.show(&handle);
        self.shared(|s| s.gui_closed.store(false, Ordering::Release));
        Ok((size, api.uses_logical_size()))
    }

    /// Closes its window, if it's open.
    pub fn close_gui(&mut self) {
        if !std::mem::take(&mut self.gui_open) {
            return;
        }
        if let Some(gui) = self.gui() {
            let handle = self.instance.plugin_handle();
            let _ = gui.hide(&handle);
            gui.destroy(&handle);
        }
    }

    /// Our window was resized to `size`: the plugin's follows, if it can.
    pub fn resize_gui(&mut self, size: GuiSize) {
        if let Some(gui) = self.gui().filter(|_| self.gui_open) {
            let handle = self.instance.plugin_handle();
            if gui.can_resize(&handle) {
                let size = gui.adjust_size(&handle, size).unwrap_or(size);
                let _ = gui.set_size(&handle, size);
            }
        }
    }

    /// A size the plugin asked its window to be, once.
    pub fn take_gui_resize(&self) -> Option<GuiSize> {
        self.shared(|s| s.gui_size.lock().unwrap_or_else(|e| e.into_inner()).take())
    }

    /// Whether the plugin closed its window itself; once.
    pub fn take_gui_closed(&mut self) -> bool {
        let closed = self.shared(|s| s.gui_closed.swap(false, Ordering::AcqRel));
        if closed {
            self.gui_open = false;
        }
        closed
    }
}

impl Drop for ClapPlugin {
    fn drop(&mut self) {
        self.close_gui();
        self.reclaim();
        // A processor still out can't be stopped here: the instance goes
        // with it (`PluginInstance`'s own drop deactivates what it can).
    }
}

/// Loads the entry of the CLAP file at `path`.
///
/// # Safety
/// This runs the plugin's own code, which can do anything.
pub unsafe fn load_entry(path: &Path) -> Result<PluginEntry, String> {
    unsafe { PluginEntry::load(path) }.map_err(|e| format!("It couldn't be loaded ({e})."))
}
