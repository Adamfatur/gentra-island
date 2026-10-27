//! Smart screenshots: a new screenshot shows on the island with its text one
//! click away. The text is read on this computer (Vision on macOS, the
//! built-in OCR on Windows, tesseract on Linux when installed); nothing is sent.
//!
//! Watching is a cheap check of one folder's modified time every 1.5 seconds,
//! and only while the feature is on.

use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, SystemTime};

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

static ENABLED: AtomicBool = AtomicBool::new(false);

pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::Relaxed);
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Shot {
    pub path: String,
    pub name: String,
    /// A small JPEG as a data URL.
    pub thumb: Option<String>,
    pub size: Option<(u32, u32)>,
}

pub fn is_image(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| ["png", "jpg", "jpeg"].contains(&e.to_ascii_lowercase().as_str()))
}

/// Names screenshot tools give their files, for folders that hold other images too.
pub fn looks_like_screenshot(name: &str) -> bool {
    let n = name.to_lowercase();
    !n.starts_with('.') && ["screenshot", "screen shot", "tangkapan layar", "cuplikan layar", "bildschirmfoto", "capture d", "captura de pantalla"].iter().any(|p| n.starts_with(p))
}

/// macOS marks the files it saves from ⇧⌘3 and ⇧⌘4, whatever their name or language.
#[cfg(target_os = "macos")]
fn marked_screenshot(path: &Path) -> bool {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let (Ok(p), Ok(name)) = (CString::new(path.as_os_str().as_bytes()), CString::new("com.apple.metadata:kMDItemIsScreenCapture")) else { return false };
    // SAFETY: valid C strings; a null buffer asks only for the attribute's size.
    unsafe { libc::getxattr(p.as_ptr(), name.as_ptr(), std::ptr::null_mut(), 0, 0, 0) > 0 }
}

#[cfg(not(target_os = "macos"))]
fn marked_screenshot(_: &Path) -> bool {
    false
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from)
}

/// Where screenshots land, and whether that folder holds only screenshots.
fn folders() -> Vec<(PathBuf, bool)> {
    let Some(home) = home() else { return Vec::new() };
    if cfg!(target_os = "macos") {
        let custom = std::process::Command::new("defaults")
            .args(["read", "com.apple.screencapture", "location"])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty())
            .map(|s| if let Some(rest) = s.strip_prefix("~/") { home.join(rest) } else { PathBuf::from(s) });
        vec![(custom.unwrap_or_else(|| home.join("Desktop")), false)]
    } else if cfg!(windows) {
        vec![(home.join("Pictures").join("Screenshots"), true), (home.join("OneDrive").join("Pictures").join("Screenshots"), true)]
    } else {
        vec![(home.join("Pictures").join("Screenshots"), true), (home.join("Pictures"), false)]
    }
}

fn thumb(path: &Path) -> (Option<String>, Option<(u32, u32)>) {
    let Ok(img) = image::open(path) else { return (None, None) };
    let size = Some((img.width(), img.height()));
    let small = img.thumbnail(360, 240).to_rgb8();
    let mut out = Cursor::new(Vec::new());
    if image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 82).encode_image(&small).is_err() {
        return (None, size);
    }
    (Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(out.into_inner()))), size)
}

pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        let mut since = SystemTime::now();
        let mut stamps: Vec<Option<SystemTime>> = Vec::new();
        let mut seen: Vec<PathBuf> = Vec::new();
        loop {
            thread::sleep(Duration::from_millis(1500));
            if !ENABLED.load(Ordering::Relaxed) {
                since = SystemTime::now();
                continue;
            }
            let dirs = folders();
            stamps.resize(dirs.len(), None);
            for (i, (dir, only_shots)) in dirs.iter().enumerate() {
                // Nothing added or renamed in the folder: nothing to look at.
                let stamp = fs::metadata(dir).and_then(|m| m.modified()).ok();
                if stamp == stamps[i] {
                    continue;
                }
                stamps[i] = stamp;
                let Ok(rd) = fs::read_dir(dir) else { continue };
                for e in rd.flatten() {
                    let p = e.path();
                    let name = e.file_name().to_string_lossy().into_owned();
                    if name.starts_with('.') || !is_image(&p) || seen.contains(&p) {
                        continue;
                    }
                    let new = e.metadata().and_then(|m| m.created().or_else(|_| m.modified())).is_ok_and(|t| t > since);
                    if !new || !(*only_shots || marked_screenshot(&p) || looks_like_screenshot(&name)) {
                        continue;
                    }
                    seen.push(p.clone());
                    // The file may still be finishing; give it a moment.
                    thread::sleep(Duration::from_millis(300));
                    let (thumb, size) = thumb(&p);
                    let _ = app.emit("screenshot", Shot { path: p.to_string_lossy().into_owned(), name, thumb, size });
                }
            }
            seen.retain(|p| p.exists());
        }
    });
}

/// The text in a screenshot, read on this computer.
#[tauri::command]
pub async fn shot_text(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    if !is_image(&path) || !path.is_file() {
        return Err("file_missing".into());
    }
    tauri::async_runtime::spawn_blocking(move || ocr(&path)).await.map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
fn ocr(path: &Path) -> Result<String, String> {
    const SCRIPT: &str = r#"
ObjC.import('Foundation');
ObjC.import('Vision');
function run(argv) {
  const req = $.VNRecognizeTextRequest.alloc.init;
  req.recognitionLevel = 0;
  req.usesLanguageCorrection = true;
  const h = $.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(argv[0]), $({}));
  h.performRequestsError($([req]), null);
  const res = req.results;
  const lines = [];
  for (let i = 0; i < res.count; i++) {
    const c = res.objectAtIndex(i).topCandidates(1);
    if (c.count) lines.push(ObjC.unwrap(c.objectAtIndex(0).string));
  }
  return lines.join('\n');
}
"#;
    let out = std::process::Command::new("/usr/bin/osascript").args(["-l", "JavaScript", "-e", SCRIPT]).arg(path).output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("ocr_failed".into());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string())
}

#[cfg(windows)]
fn ocr(path: &Path) -> Result<String, String> {
    use windows::core::HSTRING;
    use windows::Graphics::Imaging::BitmapDecoder;
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::{FileAccessMode, StorageFile};
    let run = || -> windows::core::Result<String> {
        let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.as_os_str()))?.join()?;
        let stream = file.OpenAsync(FileAccessMode::Read)?.join()?;
        let bitmap = BitmapDecoder::CreateAsync(&stream)?.join()?.GetSoftwareBitmapAsync()?.join()?;
        let result = OcrEngine::TryCreateFromUserProfileLanguages()?.RecognizeAsync(&bitmap)?.join()?;
        let mut lines = Vec::new();
        for line in result.Lines()? {
            lines.push(line.Text()?.to_string());
        }
        Ok(lines.join("\n"))
    };
    run().map_err(|_| "ocr_failed".to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn ocr(path: &Path) -> Result<String, String> {
    let out = std::process::Command::new("tesseract").arg(path).args(["-", "-l", "eng+ind"]).output();
    let out = match out {
        Ok(o) if o.status.success() => o,
        // Indonesian data may be missing; English alone still helps.
        _ => std::process::Command::new("tesseract").arg(path).arg("-").output().map_err(|_| "ocr_unavailable".to_string())?,
    };
    if !out.status.success() {
        return Err("ocr_unavailable".into());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string())
}

/// The text in any image file, read on this computer.
pub fn read_text(path: &Path) -> Result<String, String> {
    ocr(path)
}

/// Puts the screenshot itself on the clipboard.
#[tauri::command]
pub fn shot_copy(path: String) -> Result<(), String> {
    let img = image::open(&path).map_err(|_| "file_missing".to_string())?.to_rgba8();
    let (w, h) = img.dimensions();
    let data = arboard::ImageData { width: w as usize, height: h as usize, bytes: img.into_raw().into() };
    arboard::Clipboard::new().and_then(|mut c| c.set_image(data)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_screenshot_names() {
        for n in ["Screenshot 2026-10-26 at 09.14.02.png", "Screen Shot 2020-01-01.png", "Tangkapan Layar 2026-10-26 pukul 09.14.png", "Cuplikan layar 2026-10-26.png"] {
            assert!(looks_like_screenshot(n), "{n}");
        }
        for n in ["holiday.png", ".Screenshot 2026 (temp).png", "logo-screenshot.png"] {
            assert!(!looks_like_screenshot(n), "{n}");
        }
        assert!(is_image(Path::new("a/B.PNG")) && !is_image(Path::new("a/b.pdf")));
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn reads_text_on_this_mac() {
        let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../docs/screenshots/agent-peek.png");
        let text = ocr(&p).unwrap();
        assert!(text.contains("Claude Code needs you"), "{text}");
    }
}

#[cfg(test)]
mod image_copy {
    /// What Copy image puts on the clipboard, without touching the real one.
    #[test]
    fn a_screenshot_becomes_clipboard_image_data() {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../docs/screenshots/care.png");
        let img = image::open(&p).unwrap().to_rgba8();
        let (w, h) = img.dimensions();
        // The screenshot is retaken now and then, so its size isn't fixed; four bytes a pixel is.
        assert!(w > 0 && h > 0);
        assert_eq!(img.into_raw().len(), (w * h * 4) as usize);
    }
}
