//! The shelf: files dragged onto the island and held there until they are
//! dragged out, shared, or removed. Only paths are kept; files never move.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShelfItem {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
}

/// Adds `paths` to the front of `existing`, skipping duplicates and paths
/// that no longer exist.
pub fn merge(existing: &[ShelfItem], paths: &[PathBuf]) -> Vec<ShelfItem> {
    let mut out: Vec<ShelfItem> = Vec::new();
    for p in paths {
        let Some(new) = item(p) else { continue };
        if !existing.iter().chain(out.iter()).any(|i| i.path == new.path) {
            out.push(new);
        }
    }
    out.extend(existing.iter().cloned());
    out
}

fn item(path: &Path) -> Option<ShelfItem> {
    let meta = fs::metadata(path).ok()?;
    Some(ShelfItem {
        path: path.to_string_lossy().into_owned(),
        name: path.file_name()?.to_string_lossy().into_owned(),
        size: if meta.is_dir() { crate::cleaner::size_of(path) } else { meta.len() },
        is_dir: meta.is_dir(),
    })
}

// ---------- state & commands ----------

pub struct Shelf {
    items: Mutex<Vec<ShelfItem>>,
    file: PathBuf,
}

impl Shelf {
    fn save(&self, items: &[ShelfItem]) {
        if let Ok(json) = serde_json::to_vec(items) {
            let _ = fs::write(&self.file, json);
        }
    }

    fn contains(&self, path: &str) -> bool {
        self.items.lock().unwrap().iter().any(|i| i.path == path)
    }
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let dir = app.path().app_data_dir()?;
    fs::create_dir_all(&dir)?;
    let file = dir.join("shelf.json");
    let saved: Vec<ShelfItem> = fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    // Drop files that were moved or deleted while the app was closed.
    let items = saved.into_iter().filter(|i| Path::new(&i.path).exists()).collect();
    app.manage(Shelf { items: Mutex::new(items), file });
    Ok(())
}

#[tauri::command]
pub fn shelf_list(shelf: tauri::State<Shelf>) -> Vec<ShelfItem> {
    shelf.items.lock().unwrap().clone()
}

#[tauri::command]
pub fn shelf_add(shelf: tauri::State<Shelf>, paths: Vec<PathBuf>) -> Vec<ShelfItem> {
    let mut items = shelf.items.lock().unwrap();
    *items = merge(&items, &paths);
    shelf.save(&items);
    items.clone()
}

#[tauri::command]
pub fn shelf_remove(shelf: tauri::State<Shelf>, path: String) -> Vec<ShelfItem> {
    let mut items = shelf.items.lock().unwrap();
    items.retain(|i| i.path != path);
    shelf.save(&items);
    items.clone()
}

#[tauri::command]
pub fn shelf_clear(shelf: tauri::State<Shelf>) {
    let mut items = shelf.items.lock().unwrap();
    items.clear();
    shelf.save(&items);
}

/// Opens the file manager with the file selected. Only shelf paths qualify.
#[tauri::command]
pub fn shelf_reveal(shelf: tauri::State<Shelf>, path: String) -> Result<(), String> {
    if !shelf.contains(&path) {
        return Err("not_on_shelf".into());
    }
    platform::reveal(Path::new(&path)).map_err(|e| e.to_string())
}

/// The picture shown under the cursor while dragging a file out.
#[tauri::command]
pub fn shelf_drag_icon(app: AppHandle) -> Result<String, String> {
    let path = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("drag.png");
    if !path.exists() {
        fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        fs::write(&path, include_bytes!("../icons/64x64.png")).map_err(|e| e.to_string())?;
    }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn shelf_airdrop(app: AppHandle, shelf: tauri::State<Shelf>, paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() || !paths.iter().all(|p| shelf.contains(p)) {
        return Err("nothing_selected".into());
    }
    platform::airdrop(&app, paths)
}

#[cfg(target_os = "macos")]
mod platform {
    use std::path::Path;
    use std::process::Command;

    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSSharingService, NSSharingServiceNameSendViaAirDrop};
    use objc2_foundation::{NSArray, NSString, NSURL};

    pub fn reveal(path: &Path) -> std::io::Result<()> {
        Command::new("open").arg("-R").arg(path).spawn().map(|_| ())
    }

    pub fn airdrop(app: &tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
        app.run_on_main_thread(move || {
            let urls: Vec<Retained<AnyObject>> = paths
                .iter()
                .map(|p| Retained::into_super(Retained::into_super(NSURL::fileURLWithPath(&NSString::from_str(p)))))
                .collect();
            let items = NSArray::from_retained_slice(&urls);
            // SAFETY: the extern constant is provided by AppKit.
            let name = unsafe { NSSharingServiceNameSendViaAirDrop };
            if let Some(service) = NSSharingService::sharingServiceNamed(name) {
                unsafe { service.performWithItems(&items) };
            }
        })
        .map_err(|e| e.to_string())
    }
}

#[cfg(windows)]
mod platform {
    use std::path::Path;
    use std::process::Command;

    pub fn reveal(path: &Path) -> std::io::Result<()> {
        let mut arg = std::ffi::OsString::from("/select,");
        arg.push(path);
        Command::new("explorer").arg(arg).spawn().map(|_| ())
    }

    pub fn airdrop(_app: &tauri::AppHandle, _paths: Vec<String>) -> Result<(), String> {
        Err("airdrop_unavailable".into())
    }
}

#[cfg(all(not(target_os = "macos"), not(windows)))]
mod platform {
    use std::path::Path;
    use std::process::Command;

    pub fn reveal(path: &Path) -> std::io::Result<()> {
        let dir = path.parent().unwrap_or(path);
        Command::new("xdg-open").arg(dir).spawn().map(|_| ())
    }

    pub fn airdrop(_app: &tauri::AppHandle, _paths: Vec<String>) -> Result<(), String> {
        Err("airdrop_unavailable".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn dir() -> PathBuf {
        use std::sync::atomic::{AtomicU32, Ordering};
        static N: AtomicU32 = AtomicU32::new(0);
        let d = std::env::temp_dir().join(format!("dg-shelf-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn adds_new_files_to_the_front_with_name_and_size() {
        let d = dir();
        fs::write(d.join("a.pdf"), [0u8; 10]).unwrap();
        fs::write(d.join("b.png"), [0u8; 20]).unwrap();
        let first = merge(&[], &[d.join("a.pdf")]);
        let both = merge(&first, &[d.join("b.png")]);
        assert_eq!(both.iter().map(|i| i.name.as_str()).collect::<Vec<_>>(), ["b.png", "a.pdf"]);
        assert_eq!(both[0].size, 20);
        assert!(!both[0].is_dir);
    }

    #[test]
    fn ignores_duplicates() {
        let d = dir();
        fs::write(d.join("a.pdf"), [0u8; 10]).unwrap();
        let once = merge(&[], &[d.join("a.pdf")]);
        assert_eq!(merge(&once, &[d.join("a.pdf")]).len(), 1);
    }

    #[test]
    fn ignores_paths_that_do_not_exist() {
        let d = dir();
        assert!(merge(&[], &[d.join("hilang.txt")]).is_empty());
    }

    #[test]
    fn folders_count_as_items() {
        let d = dir();
        fs::create_dir_all(d.join("proyek")).unwrap();
        let items = merge(&[], &[d.join("proyek")]);
        assert!(items[0].is_dir);
    }
}
