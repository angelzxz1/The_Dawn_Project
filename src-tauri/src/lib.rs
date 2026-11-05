//! The Dawn Project's desktop app: the studio (the web app's static export
//! in `out/`, opened at `/app`) in a native window, the bridge to the
//! native engine (crates/dawn-engine) as it takes over from Web Audio, and
//! the VST3 and CLAP plugins on the computer (crates/dawn-plugins). See
//! docs/desktop.md.

mod audio;
mod plugins;

use std::ffi::OsString;
use std::process::ExitCode;
use std::sync::atomic::{AtomicUsize, Ordering};

use tauri::webview::{NewWindowFeatures, NewWindowResponse, PermissionKind, PermissionResponse};
use tauri::{AppHandle, Manager, Url, Webview, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry};

/// What the studio can learn about the native engine
/// (`invoke("engine_info")`).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineInfo {
    version: &'static str,
    /// The effects whose kernels have been ported to Rust.
    ported_effects: &'static [&'static str],
}

#[tauri::command]
fn engine_info() -> EngineInfo {
    EngineInfo {
        version: dawn_engine::VERSION,
        ported_effects: dawn_engine::effects::PORTED,
    }
}

/// Whether a webview is showing the studio itself (the bundled app, or the
/// dev server in a debug build) rather than a site it was sent to.
fn is_app_page(webview: &Webview) -> bool {
    let Ok(url) = webview.url() else {
        return false;
    };
    let place = (url.scheme(), url.host_str());
    let bundled = matches!(
        place,
        ("tauri", _) | ("http" | "https", Some("tauri.localhost"))
    );
    let dev_server =
        cfg!(debug_assertions) && matches!(place, ("http", Some("localhost" | "127.0.0.1")));
    bundled || dev_server
}

/// How many of the studio's own windows have been opened, to name each.
static STUDIO_WINDOWS: AtomicUsize = AtomicUsize::new(0);

/// The name the studio gave one of its windows (`dawn-mixer`, from
/// `about:blank#dawn-mixer`), if it's one it could have given: the window's
/// label starts with it.
fn studio_window_name(url: &Url) -> Option<&str> {
    url.fragment().filter(|name| {
        name.len() <= 64
            && name.starts_with("dawn-")
            && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    })
}

/// A window the studio asked for with window.open: the mixer or the piano
/// roll on a screen of its own (src/ui/Popout.tsx). It opens blank and the
/// studio draws into it from the main window (window.opener), so it's a
/// window of the main page's own, with its title taken from the page.
/// Anything else asked for this way is left to the webview, as before.
fn studio_window(app: &AppHandle, url: Url, features: NewWindowFeatures) -> NewWindowResponse<Wry> {
    if url.scheme() != "about" || url.path() != "blank" {
        return NewWindowResponse::Allow;
    }
    let name = studio_window_name(&url).unwrap_or("dawn-window");
    let label = format!("{name}-{}", STUDIO_WINDOWS.fetch_add(1, Ordering::Relaxed));
    let built = WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
        .window_features(features)
        .title("The Dawn Project")
        // Effects dragged onto the mixer's strips, as in the main window.
        .disable_drag_drop_handler()
        .on_document_title_changed(|window, title| {
            let _ = window.set_title(&title);
        })
        .build();
    match built {
        Ok(window) => NewWindowResponse::Create { window },
        Err(_) => NewWindowResponse::Deny,
    }
}

/// Whether `label` is one of the windows studio_window opened as `name`.
fn is_studio_window(label: &str, name: &str) -> bool {
    name.starts_with("dawn-")
        && label
            .strip_prefix(name)
            .and_then(|rest| rest.strip_prefix('-'))
            .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

/// Closes the studio's window named `name` (`dawn-mixer`). window.close()
/// in it would take away only its page (wry destroys the webview, not the
/// window around it), leaving an empty window.
#[tauri::command]
fn close_studio_window(app: AppHandle, name: String) {
    for (label, window) in app.webview_windows() {
        if is_studio_window(&label, &name) {
            let _ = window.destroy();
        }
    }
}

/// If the app was run to read a plugin file for the plugin scan
/// (`--scan-plugin <format> <path>`, from plugins.rs), reads it and says
/// how to exit; otherwise None, and the app starts as usual.
pub fn scan_plugin(args: impl IntoIterator<Item = OsString>) -> Option<ExitCode> {
    dawn_plugins::scan::child_main(args)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // The studio records from the audio interface and plays from MIDI
        // controllers: the app's own pages get those without the webview
        // asking on every launch (the system may still ask once, like
        // macOS's microphone prompt).
        .on_permission_request(|webview, kind| match kind {
            PermissionKind::Microphone | PermissionKind::Midi if is_app_page(&webview) => {
                PermissionResponse::Allow
            }
            _ => PermissionResponse::Default,
        })
        // The main window, from tauri.conf.json (which doesn't create it):
        // built here to take the studio's own windows (studio_window).
        .setup(|app| {
            let config = app
                .config()
                .app
                .windows
                .first()
                .cloned()
                .ok_or("tauri.conf.json has no window")?;
            let handle = app.handle().clone();
            WebviewWindowBuilder::from_config(app.handle(), &config)?
                .on_new_window(move |url, features| studio_window(&handle, url, features))
                .build()?;
            Ok(())
        })
        .manage(audio::AudioState::default())
        .manage(plugins::PluginsState::default())
        // The studio's own windows go with the main one: otherwise the app
        // keeps running for them.
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, WindowEvent::Destroyed) {
                for (label, other) in window.app_handle().webview_windows() {
                    if label != "main" {
                        let _ = other.destroy();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            engine_info,
            close_studio_window,
            audio::audio_devices,
            audio::audio_open,
            audio::audio_close,
            audio::engine_load_audio,
            audio::engine_forget_audio,
            audio::engine_set_song,
            audio::engine_key,
            audio::engine_sustain,
            audio::engine_bend,
            audio::engine_mod_wheel,
            audio::engine_play,
            audio::engine_stop,
            audio::engine_seek,
            audio::engine_loop,
            audio::engine_metronome,
            audio::engine_status,
            audio::engine_tuner,
            audio::engine_monitor,
            audio::engine_record,
            audio::engine_finish_take,
            audio::engine_cancel_take,
            audio::plugin_window_open,
            audio::plugin_window_close,
            audio::plugin_state,
            plugins::plugins_list,
            plugins::plugins_scan,
            plugins::plugins_add_folder,
            plugins::plugins_remove_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Dawn desktop app");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_studio_window_is_named_by_the_address_it_was_opened_at() {
        let name = |s: &str| studio_window_name(&Url::parse(s).unwrap()).map(str::to_owned);
        assert_eq!(
            name("about:blank#dawn-mixer").as_deref(),
            Some("dawn-mixer")
        );
        assert_eq!(
            name("about:blank#dawn-piano-roll").as_deref(),
            Some("dawn-piano-roll")
        );
        assert_eq!(name("about:blank"), None);
        assert_eq!(name("about:blank#mixer"), None);
        assert_eq!(name("about:blank#dawn-a/b"), None);
    }

    #[test]
    fn closing_a_studio_window_closes_only_the_ones_of_that_name() {
        assert!(is_studio_window("dawn-mixer-0", "dawn-mixer"));
        assert!(is_studio_window("dawn-mixer-12", "dawn-mixer"));
        assert!(!is_studio_window("dawn-piano-roll-1", "dawn-piano"));
        assert!(!is_studio_window("dawn-mixer-", "dawn-mixer"));
        assert!(!is_studio_window("main", "main"));
        assert!(!is_studio_window("main-0", "main"));
    }
}
