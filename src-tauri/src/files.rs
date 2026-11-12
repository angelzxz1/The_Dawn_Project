//! Files through the system's own dialogs (step 35): Save As for exports,
//! the folder dialog for projects and plugin folders, and the reading and
//! writing a project folder needs (src/project/nativeFolder.ts).
//!
//! The studio may only touch what the user picked in one of these dialogs:
//! a folder and everything in it, or the one file a Save As named. Picked
//! project folders are remembered across launches (`granted-folders.json`
//! in the app's data folder), so a recent project opens without asking
//! again; a Save As file is good until the app quits.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State, WebviewWindow};

const GRANTS_FILE: &str = "granted-folders.json";
/// Folders remembered across launches; the oldest go first.
const MAX_REMEMBERED: usize = 64;

#[derive(Default)]
struct Inner {
    loaded: bool,
    /// Picked folders (as the system resolves them), newest last.
    folders: Vec<PathBuf>,
    /// Files named in a Save As this session.
    files: Vec<PathBuf>,
}

/// What the studio has been given (Tauri's managed state).
#[derive(Default, Clone)]
pub struct FilesState(Arc<Mutex<Inner>>);

impl FilesState {
    fn lock(&self, app: &AppHandle) -> MutexGuard<'_, Inner> {
        let mut inner = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if !inner.loaded {
            inner.loaded = true;
            if let Some(file) = grants_file(app) {
                inner.folders = fs::read(file)
                    .ok()
                    .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                    .unwrap_or_default();
            }
        }
        inner
    }
}

fn grants_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(GRANTS_FILE))
}

fn save_grants(app: &AppHandle, folders: &[PathBuf]) {
    if let Some(file) = grants_file(app) {
        if let Some(dir) = file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_vec_pretty(folders) {
            let _ = fs::write(file, json);
        }
    }
}

/// `path` as the system resolves it (links followed), for comparing: the
/// nearest part of it that exists, resolved, with the rest put back on.
/// None for a relative path or one that climbs with "..".
fn resolve(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return None;
    }
    let mut existing = path;
    let mut rest = Vec::new();
    loop {
        if let Ok(real) = existing.canonicalize() {
            return Some(rest.iter().rev().fold(real, |p, part| p.join(part)));
        }
        rest.push(existing.file_name()?.to_owned());
        existing = existing.parent()?;
    }
}

/// Whether `path` is in a picked folder or is a file a Save As named.
fn is_granted(inner: &Inner, path: &Path) -> bool {
    let Some(real) = resolve(path) else {
        return false;
    };
    inner.folders.iter().any(|f| real.starts_with(f)) || inner.files.contains(&real)
}

fn check(state: &FilesState, app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if is_granted(&state.lock(app), &path) {
        Ok(path)
    } else {
        Err(format!(
            "Dawn can only use folders you've picked. Open \"{}\" again from File, Open.",
            path.file_name()
                .map(|n| n.to_string_lossy())
                .unwrap_or_default()
        ))
    }
}

fn remember_folder(state: &FilesState, app: &AppHandle, folder: &Path) {
    let Some(real) = resolve(folder) else { return };
    let mut inner = state.lock(app);
    inner.folders.retain(|f| f != &real);
    inner.folders.push(real);
    let over = inner.folders.len().saturating_sub(MAX_REMEMBERED);
    inner.folders.drain(..over);
    save_grants(app, &inner.folders);
}

fn text(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

/// The folder dialog. `grant`: the studio may then read and write in the
/// folder (a project's, or where a new one goes); a plugin folder only
/// needs its path.
#[tauri::command]
pub async fn files_pick_folder(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, FilesState>,
    title: String,
    grant: bool,
) -> Result<Option<String>, String> {
    let picked = rfd::AsyncFileDialog::new()
        .set_title(&title)
        .set_parent(&window)
        .pick_folder()
        .await;
    let Some(folder) = picked.map(|f| f.path().to_owned()) else {
        return Ok(None);
    };
    if grant {
        remember_folder(&state, &app, &folder);
    }
    Ok(Some(text(folder)))
}

/// The Save As dialog, suggesting `file_name`; the file chosen may then be
/// written (files_write).
#[tauri::command]
pub async fn files_save_dialog(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, FilesState>,
    title: String,
    file_name: String,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new()
        .set_title(&title)
        .set_file_name(&file_name)
        .set_parent(&window);
    if !extensions.is_empty() {
        dialog = dialog.add_filter(&filter_name, &extensions);
    }
    let Some(file) = dialog.save_file().await.map(|f| f.path().to_owned()) else {
        return Ok(None);
    };
    if let Some(real) = resolve(&file) {
        let mut inner = state.lock(&app);
        if !inner.files.contains(&real) {
            inner.files.push(real);
        }
    }
    Ok(Some(text(file)))
}

/// An entry in a folder.
#[derive(serde::Serialize)]
pub struct Entry {
    name: String,
    folder: bool,
}

#[tauri::command]
pub fn files_list(
    app: AppHandle,
    state: State<'_, FilesState>,
    path: String,
) -> Result<Vec<Entry>, String> {
    let dir = check(&state, &app, &path)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        entries.push(Entry {
            name: entry.file_name().to_string_lossy().into_owned(),
            folder: entry.file_type().is_ok_and(|t| t.is_dir()),
        });
    }
    Ok(entries)
}

/// "file", "folder", or None when nothing is there.
#[tauri::command]
pub fn files_kind(
    app: AppHandle,
    state: State<'_, FilesState>,
    path: String,
) -> Result<Option<&'static str>, String> {
    let path = check(&state, &app, &path)?;
    Ok(fs::metadata(path)
        .ok()
        .map(|m| if m.is_dir() { "folder" } else { "file" }))
}

#[tauri::command]
pub fn files_make_folder(
    app: AppHandle,
    state: State<'_, FilesState>,
    path: String,
) -> Result<(), String> {
    fs::create_dir_all(check(&state, &app, &path)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn files_read(
    app: AppHandle,
    state: State<'_, FilesState>,
    path: String,
) -> Result<Response, String> {
    fs::read(check(&state, &app, &path)?)
        .map(Response::new)
        .map_err(|e| e.to_string())
}

/// Removes a file (never a folder).
#[tauri::command]
pub fn files_remove(
    app: AppHandle,
    state: State<'_, FilesState>,
    path: String,
) -> Result<(), String> {
    fs::remove_file(check(&state, &app, &path)?).map_err(|e| e.to_string())
}

/// Writes the request's bytes to the file its `dawn-path` header names
/// (percent-encoded), whole: into a file beside it first, then put in its
/// place, so a write that fails halfway leaves the old file as it was.
#[tauri::command]
pub fn files_write(
    app: AppHandle,
    state: State<'_, FilesState>,
    request: Request<'_>,
) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the file's bytes.".into());
    };
    let path = request
        .headers()
        .get("dawn-path")
        .and_then(|v| v.to_str().ok())
        .and_then(percent_decode)
        .ok_or("No path.")?;
    let path = check(&state, &app, &path)?;
    let name = path
        .file_name()
        .ok_or("No file name.")?
        .to_string_lossy()
        .into_owned();
    let partial = path.with_file_name(format!(".{name}.partial"));
    fs::write(&partial, bytes).map_err(|e| e.to_string())?;
    fs::rename(&partial, &path).map_err(|e| {
        let _ = fs::remove_file(&partial);
        e.to_string()
    })
}

/// encodeURIComponent undone.
fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dawn-files-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn percent_decoding_undoes_encode_uri_component() {
        assert_eq!(
            percent_decode("C%3A%5CUsers%5CZu%C3%B1iga%5CMy%20Song").as_deref(),
            Some("C:\\Users\\Zuñiga\\My Song")
        );
        assert_eq!(percent_decode("plain").as_deref(), Some("plain"));
        assert_eq!(percent_decode("bad%2"), None);
        assert_eq!(percent_decode("bad%zz"), None);
    }

    #[test]
    fn only_picked_folders_and_saved_files_are_granted() {
        let root = temp_dir("grants");
        let picked = root.join("Projects");
        let other = root.join("Elsewhere");
        fs::create_dir_all(&picked).unwrap();
        fs::create_dir_all(&other).unwrap();
        let saved = other.join("Mix.wav");
        let inner = Inner {
            loaded: true,
            folders: vec![resolve(&picked).unwrap()],
            files: vec![resolve(&saved).unwrap()],
        };
        // In the folder, even what isn't there yet.
        assert!(is_granted(&inner, &picked));
        assert!(is_granted(
            &inner,
            &picked.join("My Song").join("Samples").join("a.wav")
        ));
        // The Save As file, and nothing else beside it.
        assert!(is_granted(&inner, &saved));
        assert!(!is_granted(&inner, &other.join("Other.wav")));
        assert!(!is_granted(&inner, &other));
        // No climbing out, no relative paths, no look-alike names.
        assert!(!is_granted(
            &inner,
            &picked.join("..").join("Elsewhere").join("Mix2.wav")
        ));
        assert!(!is_granted(&inner, Path::new("Projects/My Song")));
        assert!(!is_granted(&inner, &root.join("Projects 2")));
        fs::remove_dir_all(root).unwrap();
    }
}
