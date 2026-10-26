//! Download progress: files your browser is still downloading show on the
//! island, then a note with Open when they finish. It only looks at the
//! Downloads folder's file names and sizes, every 1.5 seconds, while the
//! feature is on.
//!
//! Chrome, Edge, and Brave write `.crdownload`, Firefox `.part`, and Safari a
//! `.download` bundle. Only Safari records the total size, so the others show
//! what has arrived and how fast, not a guessed percentage.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

static ENABLED: AtomicBool = AtomicBool::new(false);

pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::Relaxed);
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Download {
    /// The file's name once it's done.
    pub name: String,
    pub bytes: u64,
    /// Known for Safari only.
    pub total: Option<u64>,
    /// Bytes per second over the last few seconds.
    pub speed: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Finished {
    pub path: String,
    pub name: String,
    pub bytes: u64,
}

/// The finished name of a file still downloading, or None for a finished file.
pub fn in_progress(name: &str) -> Option<String> {
    if name.starts_with('.') {
        return None;
    }
    for ext in [".crdownload", ".part", ".download"] {
        if let Some(base) = name.strip_suffix(ext) {
            // Firefox can add a random suffix: "file.zip.Xa1b2.part".
            let base = if ext == ".part" { base.rsplit_once('.').filter(|(b, r)| r.len() == 6 && b.contains('.')).map_or(base, |(b, _)| b) } else { base };
            return Some(base.to_string());
        }
    }
    None
}

fn downloads_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    Some(PathBuf::from(home).join("Downloads"))
}

/// Size so far, and the total when the browser records it (Safari).
fn sizes(path: &Path) -> (u64, Option<u64>) {
    if path.is_dir() {
        // Safari: a bundle with the partial file and an Info.plist.
        let mut bytes = 0;
        if let Ok(rd) = fs::read_dir(path) {
            for e in rd.flatten() {
                if e.file_name() != "Info.plist" {
                    bytes += e.metadata().map(|m| m.len()).unwrap_or(0);
                }
            }
        }
        return (bytes, safari_total(&path.join("Info.plist")));
    }
    (fs::metadata(path).map(|m| m.len()).unwrap_or(0), None)
}

#[cfg(target_os = "macos")]
fn safari_total(plist: &Path) -> Option<u64> {
    let out = std::process::Command::new("/usr/bin/plutil").args(["-extract", "DownloadEntryProgressTotalToLoad", "raw"]).arg(plist).output().ok()?;
    String::from_utf8_lossy(&out.stdout).trim().parse().ok().filter(|t| *t > 0)
}

#[cfg(not(target_os = "macos"))]
fn safari_total(_: &Path) -> Option<u64> {
    None
}

struct Track {
    name: String,
    bytes: u64,
    total: Option<u64>,
    /// (when, bytes) a few seconds back, for the speed.
    base: (Instant, u64),
    speed: u64,
}

pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        let mut active: HashMap<PathBuf, Track> = HashMap::new();
        let mut last: Vec<Download> = Vec::new();
        loop {
            thread::sleep(Duration::from_millis(1500));
            let Some(dir) = downloads_dir().filter(|_| ENABLED.load(Ordering::Relaxed)) else {
                active.clear();
                continue;
            };
            let Ok(rd) = fs::read_dir(&dir) else { continue };
            let mut now_active = Vec::new();
            for e in rd.flatten() {
                let p = e.path();
                let Some(name) = in_progress(&e.file_name().to_string_lossy()) else { continue };
                let (bytes, total) = sizes(&p);
                let t = active.entry(p.clone()).or_insert_with(|| Track { name: name.clone(), bytes, total, base: (Instant::now(), bytes), speed: 0 });
                let secs = t.base.0.elapsed().as_secs_f64();
                if secs >= 1.0 {
                    t.speed = ((bytes.saturating_sub(t.base.1)) as f64 / secs) as u64;
                    if secs >= 4.0 {
                        t.base = (Instant::now(), bytes);
                    }
                }
                t.name = name;
                t.bytes = bytes;
                t.total = total.or(t.total);
                now_active.push(p);
            }
            // Gone from the list: finished (renamed to its real name) or cancelled.
            let gone: Vec<PathBuf> = active.keys().filter(|k| !now_active.contains(k)).cloned().collect();
            for g in gone {
                let t = active.remove(&g).unwrap();
                if let Some(done) = finished_file(&dir, &t.name) {
                    let bytes = fs::metadata(&done).map(|m| m.len()).unwrap_or(t.bytes);
                    let name = done.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(t.name);
                    let _ = app.emit("download-done", Finished { path: done.to_string_lossy().into_owned(), name, bytes });
                }
            }
            let mut list: Vec<Download> = active.values().map(|t| Download { name: t.name.clone(), bytes: t.bytes, total: t.total, speed: t.speed }).collect();
            list.sort_by(|a, b| a.name.cmp(&b.name));
            if list != last {
                let _ = app.emit("downloads", &list);
                last = list;
            }
        }
    });
}

/// The finished file: its expected name, or (Chrome's "Unconfirmed 123") the
/// newest file that appeared in the last few seconds.
fn finished_file(dir: &Path, name: &str) -> Option<PathBuf> {
    let direct = dir.join(name);
    if direct.is_file() {
        return Some(direct);
    }
    let recent = SystemTime::now() - Duration::from_secs(6);
    fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|e| {
            let n = e.file_name().to_string_lossy().into_owned();
            !n.starts_with('.') && in_progress(&n).is_none()
        })
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .filter(|(t, p)| *t > recent && p.is_file())
        .max_by_key(|(t, _)| *t)
        .map(|(_, p)| p)
}

/// Only files in the Downloads folder may be opened from here.
fn inside_downloads(path: &str) -> Result<PathBuf, String> {
    let p = fs::canonicalize(path).map_err(|_| "file_missing".to_string())?;
    let dir = downloads_dir().and_then(|d| fs::canonicalize(d).ok()).ok_or("file_missing")?;
    if p.starts_with(&dir) {
        Ok(p)
    } else {
        Err("file_missing".into())
    }
}

/// Opens a finished download in its usual app.
#[tauri::command]
pub fn download_open(path: String) -> Result<(), String> {
    let p = inside_downloads(&path)?;
    let mut cmd = if cfg!(target_os = "macos") {
        std::process::Command::new("open")
    } else if cfg!(windows) {
        std::process::Command::new("explorer")
    } else {
        std::process::Command::new("xdg-open")
    };
    cmd.arg(p).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Shows a finished download in Finder, Explorer, or the file manager.
#[tauri::command]
pub fn download_reveal(path: String) -> Result<(), String> {
    let p = inside_downloads(&path)?;
    let result = if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg("-R").arg(&p).spawn()
    } else if cfg!(windows) {
        std::process::Command::new("explorer").arg(format!("/select,{}", p.display())).spawn()
    } else {
        std::process::Command::new("xdg-open").arg(p.parent().unwrap_or(&p)).spawn()
    };
    result.map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_files_still_downloading() {
        assert_eq!(in_progress("report.pdf.crdownload").as_deref(), Some("report.pdf"));
        assert_eq!(in_progress("Unconfirmed 123456.crdownload").as_deref(), Some("Unconfirmed 123456"));
        assert_eq!(in_progress("setup.dmg.download").as_deref(), Some("setup.dmg"));
        assert_eq!(in_progress("movie.mp4.part").as_deref(), Some("movie.mp4"));
        assert_eq!(in_progress("movie.mp4.Xa1b2c.part").as_deref(), Some("movie.mp4"));
        assert_eq!(in_progress("report.pdf"), None);
        assert_eq!(in_progress(".hidden.crdownload"), None);
    }

    #[test]
    fn finds_the_finished_file() {
        let dir = std::env::temp_dir().join(format!("gentra-dl-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("report.pdf"), b"x").unwrap();
        assert_eq!(finished_file(&dir, "report.pdf"), Some(dir.join("report.pdf")));
        // Chrome named it "Unconfirmed" while downloading; the newest file is it.
        fs::write(dir.join("photo.jpg"), b"y").unwrap();
        assert!(finished_file(&dir, "Unconfirmed 9").is_some());
        let _ = fs::remove_dir_all(dir);
    }
}

#[cfg(all(test, target_os = "macos"))]
mod real_machine {
    /// Uses the real Downloads folder and Finder. Run with
    /// `cargo test downloads::real_machine -- --ignored`.
    #[test]
    #[ignore]
    fn reveals_a_real_download_and_refuses_other_folders() {
        let dir = super::downloads_dir().unwrap();
        let f = dir.join("gentra-reveal-test.txt");
        std::fs::write(&f, "test").unwrap();
        assert!(super::inside_downloads(f.to_str().unwrap()).is_ok());
        assert_eq!(super::inside_downloads("/etc/hosts").unwrap_err(), "file_missing");
        assert_eq!(super::inside_downloads(dir.join("missing.zip").to_str().unwrap()).unwrap_err(), "file_missing");
        super::download_reveal(f.to_string_lossy().into_owned()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1500));
        let sel = std::process::Command::new("osascript").args(["-e", "tell application \"Finder\" to get name of item 1 of (get selection)"]).output().unwrap();
        let _ = std::fs::remove_file(&f);
        assert_eq!(String::from_utf8_lossy(&sel.stdout).trim(), "gentra-reveal-test.txt");
    }
}
