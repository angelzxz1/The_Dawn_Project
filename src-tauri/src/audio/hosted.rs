//! The plugins the engine runs (CLAP through `dawn_plugins::host`, VST3
//! through `dawn_plugins::vst3_host`), kept on the app's main thread: both
//! formats ask for an instance's main-thread calls on one thread, and Tauri
//! runs the commands that aren't async on it (setting the song, the status,
//! the plugins' windows and states). So this lives in a thread-local, and
//! only those commands reach it.
//!
//! Each plugin effect (by the studio's effect id) has its instance. Making
//! the song asks for its processor (`make`), which goes into the effect's
//! slot when the instance has one to give: its first, or after the last
//! came home (the engine dropped it: the effect went, or the device opened
//! anew). An instance whose effect is gone is destroyed once its processor
//! is home. Its window is a window of the app's with the plugin's own GUI
//! in it. A plugin instrument is kept the same way, by its track's id
//! (tracks' ids and effects' never meet: "ch-3", "fx-12").

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use dawn_engine::mix::{PluginNote, PluginProcessor, PluginSettings, PluginSlot, TimedNote};
use dawn_plugins::NoteEvent;
use dawn_plugins::host::{ClapPlugin, ClapProcessor, ParentWindow, PluginEntry, load_entry};
use dawn_plugins::vst3::Module;
use dawn_plugins::vst3_host::{Vst3Plugin, Vst3Processor, load_module};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::{AppHandle, LogicalSize, PhysicalSize, WindowEvent};

use super::song::PluginSpec;

/// The most notes a block gives an instrument.
const MAX_NOTES: usize = 1024;

/// The engine's notes for a block, as the plugins take them (into a
/// buffer made beforehand: this runs on the audio thread).
fn notes_into(notes: &[TimedNote], into: &mut Vec<(u32, NoteEvent)>) {
    into.clear();
    for n in notes.iter().take(MAX_NOTES) {
        into.push((
            n.offset,
            match n.note {
                PluginNote::On { key, velocity } => NoteEvent::On { key, velocity },
                PluginNote::Off { key } => NoteEvent::Off { key },
                PluginNote::Bend(b) => NoteEvent::Bend(b),
                PluginNote::ModWheel(m) => NoteEvent::ModWheel(m),
            },
        ));
    }
}

/// A CLAP plugin's processor, as the engine runs it.
struct Clap(ClapProcessor, Vec<(u32, NoteEvent)>);

impl PluginProcessor for Clap {
    fn process(&mut self, l: &mut [f32], r: &mut [f32]) {
        self.0.process(l, r);
    }

    fn play(&mut self, notes: &[TimedNote], l: &mut [f32], r: &mut [f32]) {
        notes_into(notes, &mut self.1);
        self.0.play(&self.1, l, r);
    }
}

/// A VST3 plugin's.
struct Vst3(Vst3Processor, Vec<(u32, NoteEvent)>);

impl PluginProcessor for Vst3 {
    fn process(&mut self, l: &mut [f32], r: &mut [f32]) {
        self.0.process(l, r);
    }

    fn play(&mut self, notes: &[TimedNote], l: &mut [f32], r: &mut [f32]) {
        notes_into(notes, &mut self.1);
        self.0.play(&self.1, l, r);
    }
}

/// An instance of a plugin, whichever its format.
enum Instance {
    Clap(ClapPlugin),
    Vst3(Vst3Plugin),
}

impl Instance {
    fn reclaim(&mut self) {
        match self {
            Self::Clap(p) => p.reclaim(),
            Self::Vst3(p) => p.reclaim(),
        }
    }

    fn is_out(&self) -> bool {
        match self {
            Self::Clap(p) => p.is_out(),
            Self::Vst3(p) => p.is_out(),
        }
    }

    fn load_state(&mut self, bytes: &[u8]) -> Result<(), String> {
        match self {
            Self::Clap(p) => p.load_state(bytes),
            Self::Vst3(p) => p.load_state(bytes),
        }
    }

    fn save_state(&mut self) -> Result<Vec<u8>, String> {
        match self {
            Self::Clap(p) => p.save_state(),
            Self::Vst3(p) => p.save_state(),
        }
    }

    fn take_dirty(&self) -> bool {
        match self {
            Self::Clap(p) => p.take_dirty(),
            Self::Vst3(p) => p.take_dirty(),
        }
    }

    fn latency(&mut self) -> u32 {
        match self {
            Self::Clap(p) => p.latency(),
            Self::Vst3(p) => p.latency(),
        }
    }

    fn processor(&mut self, sample_rate: f64) -> Result<Option<Box<dyn PluginProcessor>>, String> {
        Ok(match self {
            Self::Clap(p) => p.processor(sample_rate)?.map(|p| {
                Box::new(Clap(p, Vec::with_capacity(MAX_NOTES))) as Box<dyn PluginProcessor>
            }),
            Self::Vst3(p) => p.processor(sample_rate)?.map(|p| {
                Box::new(Vst3(p, Vec::with_capacity(MAX_NOTES))) as Box<dyn PluginProcessor>
            }),
        })
    }

    fn tick(&mut self) {
        match self {
            Self::Clap(p) => p.tick(),
            Self::Vst3(p) => p.tick(),
        }
    }

    fn close_gui(&mut self) {
        match self {
            Self::Clap(p) => p.close_gui(),
            Self::Vst3(p) => p.close_gui(),
        }
    }

    /// A size its window asked for: (width, height, in logical pixels).
    fn take_gui_resize(&mut self) -> Option<(u32, u32, bool)> {
        match self {
            Self::Clap(p) => p.take_gui_resize().map(|s| (s.width, s.height, false)),
            Self::Vst3(p) => p
                .take_gui_resize()
                .map(|(w, h)| (w.max(1) as u32, h.max(1) as u32, cfg!(target_os = "macos"))),
        }
    }

    fn take_gui_closed(&mut self) -> bool {
        match self {
            Self::Clap(p) => p.take_gui_closed(),
            Self::Vst3(_) => false,
        }
    }

    /// Puts its window in ours: how big it is, and whether in logical pixels.
    ///
    /// # Safety
    /// `window` must stay until `close_gui`.
    unsafe fn open_gui(&mut self, window: &tauri::Window) -> Result<(u32, u32, bool), String> {
        match self {
            Self::Clap(p) => {
                let parent = ParentWindow::from_window(window).ok_or("No window to put it in.")?;
                // SAFETY: as this function's.
                let (size, logical) = unsafe { p.open_gui(parent) }?;
                Ok((size.width, size.height, logical))
            }
            Self::Vst3(p) => {
                let handle = window.window_handle().map_err(|e| format!("{e}"))?;
                let parent = match handle.as_raw() {
                    RawWindowHandle::Win32(h) => h.hwnd.get() as *mut std::ffi::c_void,
                    RawWindowHandle::AppKit(h) => h.ns_view.as_ptr(),
                    _ => return Err("The plugin's window doesn't work on this system.".into()),
                };
                // SAFETY: as this function's.
                let (w, h) = unsafe { p.open_gui(parent) }?;
                Ok((w.max(1) as u32, h.max(1) as u32, cfg!(target_os = "macos")))
            }
        }
    }
}

struct Hosted {
    /// Its file and plugin id: another means another instance.
    file: String,
    id: String,
    plugin: Instance,
    window: Option<tauri::Window>,
}

#[derive(Default)]
struct Host {
    entries: HashMap<PathBuf, PluginEntry>,
    modules: HashMap<PathBuf, Arc<Module>>,
    plugins: HashMap<String, Hosted>,
    /// The effects the song has now.
    wanted: HashSet<String>,
    /// Why an effect's plugin couldn't run, by its id.
    errors: HashMap<String, String>,
    windows: usize,
}

thread_local! {
    static HOST: RefCell<Host> = RefCell::default();
}

fn with<R>(f: impl FnOnce(&mut Host) -> R) -> R {
    HOST.with(|h| f(&mut h.borrow_mut()))
}

impl Host {
    fn instance(&mut self, effect: &str, spec: &PluginSpec) -> Result<&mut Hosted, String> {
        if spec.format != "clap" && spec.format != "vst3" {
            return Err("That plugin format doesn't run in the engine.".into());
        }
        let stale = self
            .plugins
            .get(effect)
            .is_some_and(|h| h.file != spec.path || h.id != spec.id);
        if stale && let Some(mut old) = self.plugins.remove(effect) {
            old.plugin.reclaim();
            if old.plugin.is_out() {
                // The engine still has it: it goes when it comes home.
                self.plugins.insert(effect.to_owned(), old);
                return Err("The plugin is changing.".into());
            }
            close_window(&mut old);
        }
        if !self.plugins.contains_key(effect) {
            let path = PathBuf::from(&spec.path);
            let mut plugin = if spec.format == "vst3" {
                if !self.modules.contains_key(&path) {
                    // SAFETY: a plugin the user put in their project; it
                    // runs its own code, as every host lets it.
                    let module = unsafe { load_module(&path) }?;
                    self.modules.insert(path.clone(), module);
                }
                Instance::Vst3(Vst3Plugin::new(self.modules[&path].clone(), &spec.id)?)
            } else {
                if !self.entries.contains_key(&path) {
                    // SAFETY: as above.
                    let entry = unsafe { load_entry(&path) }?;
                    self.entries.insert(path.clone(), entry);
                }
                Instance::Clap(ClapPlugin::new(
                    &self.entries[&path],
                    &spec.id,
                    Arc::new(|| {}),
                )?)
            };
            if let Some(state) = spec.state.as_deref().filter(|s| !s.is_empty()) {
                let bytes = STANDARD
                    .decode(state)
                    .map_err(|_| "Its saved state isn't readable.".to_owned())?;
                plugin.load_state(&bytes)?;
            }
            self.plugins.insert(
                effect.to_owned(),
                Hosted {
                    file: spec.path.clone(),
                    id: spec.id.clone(),
                    plugin,
                    window: None,
                },
            );
        }
        Ok(self.plugins.get_mut(effect).expect("just made"))
    }

    /// Destroys the instances whose effects are gone, once they're home.
    fn retain(&mut self) {
        let gone: Vec<String> = self
            .plugins
            .iter_mut()
            .filter(|(id, _)| !self.wanted.contains(*id))
            .filter_map(|(id, h)| {
                h.plugin.reclaim();
                (!h.plugin.is_out()).then(|| id.clone())
            })
            .collect();
        for id in gone {
            if let Some(mut h) = self.plugins.remove(&id) {
                close_window(&mut h);
            }
        }
        self.errors.retain(|id, _| self.wanted.contains(id));
    }
}

fn close_window(h: &mut Hosted) {
    h.plugin.close_gui();
    if let Some(w) = h.window.take() {
        let _ = w.destroy();
    }
}

/// A plugin effect's (or instrument's, by its track's id) settings for the
/// song at `sample_rate`: its slot (with a processor if its instance has
/// one to give) and its latency. None if it can't run; why is in the
/// status.
pub fn make(effect: &str, spec: &PluginSpec, sample_rate: f64) -> Option<PluginSettings> {
    with(|host| {
        host.wanted.insert(effect.to_owned());
        let made = host.instance(effect, spec).and_then(|h| {
            let processor = h.plugin.processor(sample_rate)?;
            let latency = h.plugin.latency() as usize;
            Ok(PluginSettings {
                slot: Arc::new(PluginSlot::new(processor)),
                latency,
            })
        });
        match made {
            Ok(settings) => {
                host.errors.remove(effect);
                Some(settings)
            }
            Err(e) => {
                host.errors.insert(effect.to_owned(), e);
                None
            }
        }
    })
}

/// A new song is being made: the effects it has are those `make` is
/// asked for from now.
pub fn begin_song() {
    with(|host| host.wanted.clear());
}

/// The song's been made: instances of effects it doesn't have go.
pub fn end_song() {
    with(Host::retain);
}

/// What the plugins asked for since last time, done (on the main thread):
/// their callbacks, their windows' sizes; and the effects whose plugin's
/// state changed (or whose window closed), to be saved.
pub fn tick() -> Vec<String> {
    with(|host| {
        let mut dirty = Vec::new();
        for (id, h) in &mut host.plugins {
            h.plugin.tick();
            if let (Some((width, height, logical)), Some(w)) =
                (h.plugin.take_gui_resize(), &h.window)
            {
                let _ = if logical {
                    w.set_size(LogicalSize::new(width, height))
                } else {
                    w.set_size(PhysicalSize::new(width, height))
                };
            }
            if h.plugin.take_gui_closed() {
                if let Some(w) = h.window.take() {
                    let _ = w.destroy();
                }
                dirty.push(id.clone());
            }
            if h.plugin.take_dirty() {
                dirty.push(id.clone());
            }
        }
        host.retain();
        dirty.sort();
        dirty.dedup();
        dirty
    })
}

/// Why each effect's plugin that couldn't run didn't, by its id.
pub fn errors() -> Vec<(String, String)> {
    with(|host| {
        let mut list: Vec<_> = host
            .errors
            .iter()
            .map(|(a, b)| (a.clone(), b.clone()))
            .collect();
        list.sort();
        list
    })
}

/// An effect's plugin's state now (base64), for the project.
pub fn state(effect: &str) -> Result<String, String> {
    with(|host| {
        let h = host
            .plugins
            .get_mut(effect)
            .ok_or("That plugin isn't running.")?;
        Ok(STANDARD.encode(h.plugin.save_state()?))
    })
}

/// Opens an effect's plugin's window (or brings it forward), titled.
pub fn open_window(app: &AppHandle, effect: &str, title: &str) -> Result<(), String> {
    let existing = with(|host| {
        host.plugins
            .get(effect)
            .map(|h| h.window.clone())
            .ok_or("That plugin isn't running.".to_owned())
    })?;
    if let Some(w) = existing {
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(());
    }
    let label = with(|host| {
        host.windows += 1;
        format!("dawn-plugin-{}", host.windows)
    });
    let window = tauri::window::WindowBuilder::new(app, label)
        .title(title)
        .inner_size(600.0, 400.0)
        .resizable(false)
        .visible(false)
        .build()
        .map_err(|e| format!("{e}"))?;
    let opened = with(|host| {
        let h = host
            .plugins
            .get_mut(effect)
            .ok_or("That plugin isn't running.".to_owned())?;
        // SAFETY: the window stays until the plugin's GUI is closed
        // (close_window, and the close request below).
        let size = unsafe { h.plugin.open_gui(&window) }?;
        h.window = Some(window.clone());
        Ok::<_, String>(size)
    });
    let (width, height, logical) = match opened {
        Ok(v) => v,
        Err(e) => {
            let _ = window.destroy();
            return Err(e);
        }
    };
    let _ = if logical {
        window.set_size(LogicalSize::new(width, height))
    } else {
        window.set_size(PhysicalSize::new(width, height))
    };
    let _ = window.show();
    // Closing it closes the plugin's GUI first, then the window (on the main
    // thread, after this event).
    let effect = effect.to_owned();
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let effect = effect.clone();
            let _ = handle.run_on_main_thread(move || close(&effect));
        }
    });
    Ok(())
}

/// Closes an effect's plugin's window.
pub fn close(effect: &str) {
    with(|host| {
        if let Some(h) = host.plugins.get_mut(effect) {
            close_window(h);
        }
    });
}

/// The effects whose plugin's window is open.
pub fn open_windows() -> Vec<String> {
    with(|host| {
        let mut list: Vec<String> = host
            .plugins
            .iter()
            .filter(|(_, h)| h.window.is_some())
            .map(|(id, _)| id.clone())
            .collect();
        list.sort();
        list
    })
}

/// An export's own instances (its plugins, made by `make` under ids of its
/// own), once it's done with them: they go, their processors home.
pub fn forget(ids: &[String]) {
    with(|host| {
        for id in ids {
            host.wanted.remove(id);
        }
        host.retain();
    });
}

/// The device closed: every instance goes (their processors are home).
pub fn forget_all() {
    with(|host| {
        host.wanted.clear();
        host.retain();
    });
}
