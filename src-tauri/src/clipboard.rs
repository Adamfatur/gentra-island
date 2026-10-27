//! Clipboard history: text, links, code, colours and images.
//!
//! A watcher thread checks the OS clipboard's change counter every 400 ms (a
//! cheap integer read) and only reads the content when it moved. History is
//! kept in `history.json`; full-size images live next to it as PNG files.

use std::borrow::Cow;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use arboard::{Clipboard, ImageData};
use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::secret;

const MAX_ITEMS: usize = 300;
/// Images are the heavy part of the history; past this many, the oldest go.
const MAX_IMAGES: usize = 60;
const DAY_MS: u64 = 24 * 60 * 60 * 1000;
/// How long unpinned items stay, in days; 0 keeps them until the history is full.
static KEEP_DAYS: AtomicU64 = AtomicU64::new(30);
const THUMB_W: u32 = 360;
/// Card surface colour; transparent pixels are blended onto it.
const THUMB_BG: [u8; 3] = [0x17, 0x17, 0x1b];
/// How long a copied credential stays in history and on the clipboard.
const SECRET_TTL: Duration = Duration::from_secs(60);

/// False when the user's mode switches clipboard history off.
static ENABLED: AtomicBool = AtomicBool::new(true);

pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::Relaxed);
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClipItem {
    pub id: u64,
    /// "text" | "link" | "code" | "color" | "image"
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// JPEG data URL for image items.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumb: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<(u32, u32)>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
    pub hash: u64,
    pub created: u64,
    pub pinned: bool,
    /// Kind of credential, when the text contains one. Never written to disk.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret: Option<String>,
    /// When a secret item disappears from history (ms since epoch).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires: Option<u64>,
}

/// Items that may be written to `history.json`: everything except secrets.
fn persisted(items: &[ClipItem]) -> Vec<&ClipItem> {
    items.iter().filter(|i| i.secret.is_none()).collect()
}

/// What the UI receives: secrets arrive already masked.
fn for_ui(item: &ClipItem) -> ClipItem {
    let mut shown = item.clone();
    if shown.secret.is_some() {
        shown.text = shown.text.as_deref().map(secret::redact);
    }
    shown
}

pub struct ClipStore {
    items: Mutex<Vec<ClipItem>>,
    dir: PathBuf,
    /// Change counter we have already handled; writes from `clip_copy` bump it
    /// so our own copies are not recorded as new items.
    seen: Mutex<u64>,
}

impl ClipStore {
    fn image_path(&self, id: u64) -> PathBuf {
        self.dir.join("images").join(format!("{id}.png"))
    }

    fn save(&self, items: &[ClipItem]) {
        if let Ok(json) = serde_json::to_vec(&persisted(items)) {
            let tmp = self.dir.join("history.json.tmp");
            if fs::write(&tmp, json).is_ok() {
                let _ = fs::rename(tmp, self.dir.join("history.json"));
            }
        }
    }

    /// Adds an item, or moves an identical existing one to the top.
    fn push(&self, mut item: ClipItem, image: Option<&ImageData>) -> bool {
        let mut items = self.items.lock().unwrap();
        if let Some(pos) = items.iter().position(|i| i.hash == item.hash) {
            let mut existing = items.remove(pos);
            existing.created = item.created;
            existing.app = item.app.or(existing.app);
            items.insert(0, existing);
        } else {
            if let Some(img) = image {
                if write_png(img, &self.image_path(item.id)).is_err() {
                    return false;
                }
                item.thumb = thumbnail(img);
            }
            items.insert(0, item);
            self.trim(&mut items);
        }
        self.save(&items);
        true
    }

    /// Drops what the history should no longer keep, with its image files.
    fn trim(&self, items: &mut Vec<ClipItem>) -> bool {
        let drop = to_drop(items, now_ms(), KEEP_DAYS.load(Ordering::Relaxed));
        if drop.is_empty() {
            return false;
        }
        for gone in items.iter().filter(|i| drop.contains(&i.id) && i.kind == "image") {
            let _ = fs::remove_file(self.image_path(gone.id));
        }
        items.retain(|i| !drop.contains(&i.id));
        true
    }
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let dir = app.path().app_data_dir()?;
    fs::create_dir_all(dir.join("images"))?;
    let items: Vec<ClipItem> = fs::read(dir.join("history.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    app.manage(ClipStore { items: Mutex::new(items), dir, seen: Mutex::new(platform::change_count()) });

    let app = app.clone();
    thread::spawn(move || {
        let mut cb = match Clipboard::new() {
            Ok(cb) => cb,
            Err(e) => return eprintln!("gentra-island: clipboard unavailable: {e}"),
        };
        let mut last_text_hash = 0u64;
        let mut last_prune = std::time::Instant::now();
        loop {
            thread::sleep(Duration::from_millis(400));
            let store = app.state::<ClipStore>();
            // Items age out even when nothing new is copied.
            if last_prune.elapsed() >= Duration::from_secs(3600) {
                last_prune = std::time::Instant::now();
                let mut items = store.items.lock().unwrap();
                if store.trim(&mut items) {
                    store.save(&items);
                    let _ = app.emit("clips-changed", ());
                }
            }
            let count = platform::change_count();
            // History switched off by the user's mode: keep the counter in
            // step so nothing copied meanwhile is recorded when it comes back.
            if !ENABLED.load(Ordering::Relaxed) {
                *store.seen.lock().unwrap() = count;
                continue;
            }
            // Platforms without a change counter report 0; fall back to hashing.
            if count != 0 {
                let mut seen = store.seen.lock().unwrap();
                if count == *seen {
                    continue;
                }
                *seen = count;
            }
            if platform::is_concealed() {
                continue; // password managers mark secrets as concealed
            }
            let Some((item, image)) = read_clipboard(&mut cb) else { continue };
            if count == 0 {
                if item.hash == last_text_hash {
                    continue;
                }
                last_text_hash = item.hash;
            }
            let expiring = item.secret.is_some().then_some(item.hash);
            if store.push(item, image.as_ref()) {
                let _ = app.emit("clips-changed", ());
                if let Some(hash) = expiring {
                    forget_secret_later(app.clone(), hash, count);
                }
            }
        }
    });
    Ok(())
}

fn read_clipboard(cb: &mut Clipboard) -> Option<(ClipItem, Option<ImageData<'static>>)> {
    let app = platform::frontmost_app();
    if let Ok(text) = cb.get_text() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            let created = now_ms();
            let found = secret::detect(&text);
            return Some((
                ClipItem {
                    id: new_id(),
                    kind: classify(trimmed).into(),
                    hash: hash_of(text.as_bytes()),
                    text: Some(text),
                    thumb: None,
                    size: None,
                    app,
                    created,
                    pinned: false,
                    secret: found.map(Into::into),
                    expires: found.map(|_| created + SECRET_TTL.as_millis() as u64),
                },
                None,
            ));
        }
    }
    let img = cb.get_image().ok()?;
    let item = ClipItem {
        id: new_id(),
        kind: "image".into(),
        hash: hash_of(&img.bytes),
        text: None,
        thumb: None,
        size: Some((img.width as u32, img.height as u32)),
        app,
        created: now_ms(),
        pinned: false,
        secret: None,
        expires: None,
    };
    Some((item, Some(img.to_owned_img())))
}

/// Cheap heuristics; good enough to pick an icon and a preview style.
fn classify(t: &str) -> &'static str {
    let one_line = !t.contains('\n');
    let lower = t.to_ascii_lowercase();
    if one_line && is_color(&lower) {
        "color"
    } else if one_line && !t.contains(' ') && (lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("www.")) {
        "link"
    } else if looks_like_code(t) {
        "code"
    } else {
        "text"
    }
}

fn is_color(t: &str) -> bool {
    if let Some(hex) = t.strip_prefix('#') {
        return matches!(hex.len(), 3 | 4 | 6 | 8) && hex.chars().all(|c| c.is_ascii_hexdigit());
    }
    (t.starts_with("rgb(") || t.starts_with("rgba(") || t.starts_with("hsl(") || t.starts_with("oklch(")) && t.ends_with(')')
}

fn looks_like_code(t: &str) -> bool {
    const SHELL: [&str; 10] = ["git ", "npm ", "pnpm ", "yarn ", "cargo ", "cd ", "sudo ", "docker ", "brew ", "$ "];
    const MARKERS: [&str; 9] = ["=>", "fn ", "const ", "let ", "function ", "import ", "def ", "</", "();"];
    let first = t.lines().next().unwrap_or("");
    SHELL.iter().any(|p| first.starts_with(p))
        || MARKERS.iter().any(|m| t.contains(m))
        || (t.contains('\n') && (t.contains('{') || t.contains(';')))
}

fn write_png(img: &ImageData, path: &PathBuf) -> image::ImageResult<()> {
    let buf = image::RgbaImage::from_raw(img.width as u32, img.height as u32, img.bytes.to_vec())
        .ok_or_else(|| image::ImageError::Parameter(image::error::ParameterError::from_kind(
            image::error::ParameterErrorKind::DimensionMismatch,
        )))?;
    buf.save_with_format(path, image::ImageFormat::Png)
}

fn thumbnail(img: &ImageData) -> Option<String> {
    let rgba = image::RgbaImage::from_raw(img.width as u32, img.height as u32, img.bytes.to_vec())?;
    let dynimg = image::DynamicImage::ImageRgba8(rgba);
    let small = if dynimg.width() > THUMB_W { dynimg.thumbnail(THUMB_W, THUMB_W * 4) } else { dynimg };
    // JPEG has no alpha: blend onto the card colour so window shadows and
    // transparent PNGs don't turn into black bars.
    let mut flat = image::RgbImage::new(small.width(), small.height());
    for (x, y, p) in small.to_rgba8().enumerate_pixels() {
        let a = p.0[3] as u32;
        let mix = |c: u8, bg: u8| ((c as u32 * a + bg as u32 * (255 - a)) / 255) as u8;
        flat.put_pixel(x, y, image::Rgb([mix(p.0[0], THUMB_BG[0]), mix(p.0[1], THUMB_BG[1]), mix(p.0[2], THUMB_BG[2])]));
    }
    let mut out = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(flat)
        .write_to(&mut out, image::ImageFormat::Jpeg)
        .ok()?;
    Some(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(out.into_inner())
    ))
}

fn hash_of(bytes: &[u8]) -> u64 {
    let mut h = DefaultHasher::new();
    bytes.hash(&mut h);
    h.finish()
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn new_id() -> u64 {
    use std::sync::atomic::AtomicU64;
    static NEXT: AtomicU64 = AtomicU64::new(0);
    now_ms() * 1000 + NEXT.fetch_add(1, Ordering::Relaxed) % 1000
}

/// After `SECRET_TTL`, drop the secret from history and, if nothing else was
/// copied since, from the system clipboard too.
fn forget_secret_later(app: AppHandle, hash: u64, count_at_copy: u64) {
    thread::spawn(move || {
        thread::sleep(SECRET_TTL);
        let store = app.state::<ClipStore>();
        store.items.lock().unwrap().retain(|i| !(i.hash == hash && i.secret.is_some()));
        if count_at_copy != 0 && platform::change_count() == count_at_copy {
            if let Ok(mut cb) = Clipboard::new() {
                let _ = cb.clear();
            }
            *store.seen.lock().unwrap() = platform::change_count();
        }
        let _ = app.emit("clips-changed", ());
    });
}

// ---------- commands ----------

#[tauri::command]
pub fn clip_list(store: tauri::State<ClipStore>) -> Vec<ClipItem> {
    store.items.lock().unwrap().iter().map(for_ui).collect()
}

/// Puts arbitrary text (a decoded value, a cleaned link) on the clipboard
/// without adding it to history as a new item.
#[tauri::command]
pub fn clip_write(store: tauri::State<ClipStore>, text: String) -> Result<(), String> {
    Clipboard::new().and_then(|mut cb| cb.set_text(text)).map_err(|e| e.to_string())?;
    *store.seen.lock().unwrap() = platform::change_count();
    Ok(())
}

/// The text in a copied image, such as a screenshot copied straight to the
/// clipboard, read on this computer.
#[tauri::command]
pub async fn clip_text(store: tauri::State<'_, ClipStore>, id: u64) -> Result<String, String> {
    let path = store.image_path(id);
    if !path.is_file() {
        return Err("item_missing".into());
    }
    tauri::async_runtime::spawn_blocking(move || crate::screenshots::read_text(&path)).await.map_err(|e| e.to_string())?
}

/// Puts an item back on the system clipboard and moves it to the top.
#[tauri::command]
pub fn clip_copy(app: AppHandle, store: tauri::State<ClipStore>, id: u64) -> Result<(), String> {
    let item = {
        let items = store.items.lock().unwrap();
        items.iter().find(|i| i.id == id).cloned().ok_or("item_missing")?
    };
    let mut cb = Clipboard::new().map_err(|e| e.to_string())?;
    if item.kind == "image" {
        let img = image::open(store.image_path(id)).map_err(|e| e.to_string())?.to_rgba8();
        let (w, h) = img.dimensions();
        cb.set_image(ImageData { width: w as usize, height: h as usize, bytes: Cow::Owned(img.into_raw()) })
            .map_err(|e| e.to_string())?;
    } else if let Some(text) = &item.text {
        cb.set_text(text.clone()).map_err(|e| e.to_string())?;
    }
    *store.seen.lock().unwrap() = platform::change_count();
    {
        let mut items = store.items.lock().unwrap();
        if let Some(pos) = items.iter().position(|i| i.id == id) {
            let mut moved = items.remove(pos);
            moved.created = now_ms();
            items.insert(0, moved);
        }
        store.save(&items);
    }
    let _ = app.emit("clips-changed", ());
    Ok(())
}

#[tauri::command]
pub fn clip_pin(store: tauri::State<ClipStore>, id: u64) -> bool {
    let mut items = store.items.lock().unwrap();
    // Secrets are temporary by design, so they cannot be pinned.
    let pinned = items.iter_mut().find(|i| i.id == id && i.secret.is_none()).map(|i| {
        i.pinned = !i.pinned;
        i.pinned
    });
    store.save(&items);
    pinned.unwrap_or(false)
}

#[tauri::command]
pub fn clip_delete(store: tauri::State<ClipStore>, id: u64) {
    let mut items = store.items.lock().unwrap();
    if let Some(pos) = items.iter().position(|i| i.id == id) {
        let gone = items.remove(pos);
        if gone.kind == "image" {
            let _ = fs::remove_file(store.image_path(gone.id));
        }
    }
    store.save(&items);
}

/// Which items to drop, newest first in `items`: unpinned ones older than
/// `keep_days` (0 keeps them), then beyond MAX_IMAGES images and MAX_ITEMS in all.
/// Pinned items always stay.
pub fn to_drop(items: &[ClipItem], now: u64, keep_days: u64) -> Vec<u64> {
    let mut drop = Vec::new();
    let mut images = 0;
    let mut kept = 0;
    for i in items {
        if i.pinned {
            kept += 1;
            continue;
        }
        let too_old = keep_days > 0 && now.saturating_sub(i.created) > keep_days * DAY_MS;
        let too_many_images = i.kind == "image" && images >= MAX_IMAGES;
        if too_old || too_many_images || kept >= MAX_ITEMS {
            drop.push(i.id);
            continue;
        }
        if i.kind == "image" {
            images += 1;
        }
        kept += 1;
    }
    drop
}

/// Sets how many days the history keeps unpinned items (0: until it's full), and applies it now.
#[tauri::command]
pub fn clip_set_keep(app: AppHandle, store: tauri::State<ClipStore>, days: u64) {
    KEEP_DAYS.store(days, Ordering::Relaxed);
    let mut items = store.items.lock().unwrap();
    if store.trim(&mut items) {
        store.save(&items);
        let _ = app.emit("clips-changed", ());
    }
}

/// How many bytes the history takes on disk: its list and its images.
#[tauri::command]
pub fn clip_usage(store: tauri::State<ClipStore>) -> u64 {
    let size = |p: PathBuf| fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    let images = fs::read_dir(store.dir.join("images")).map(|rd| rd.flatten().filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum::<u64>()).unwrap_or(0);
    images + size(store.dir.join("history.json"))
}

/// Removes everything except pinned items.
#[tauri::command]
pub fn clip_clear(store: tauri::State<ClipStore>) {
    let mut items = store.items.lock().unwrap();
    for gone in items.iter().filter(|i| !i.pinned && i.kind == "image") {
        let _ = fs::remove_file(store.image_path(gone.id));
    }
    items.retain(|i| i.pinned);
    store.save(&items);
}

// ---------- platform ----------

#[cfg(target_os = "macos")]
mod platform {
    use objc2_app_kit::{NSPasteboard, NSWorkspace};

    pub fn change_count() -> u64 {
        NSPasteboard::generalPasteboard().changeCount() as u64
    }

    /// nspasteboard.org convention used by 1Password, Bitwarden, Keychain, etc.
    pub fn is_concealed() -> bool {
        let Some(types) = NSPasteboard::generalPasteboard().types() else { return false };
        types.iter().any(|t| {
            let s = t.to_string();
            s == "org.nspasteboard.ConcealedType" || s == "org.nspasteboard.TransientType"
        })
    }

    /// The app the user copied from. When the island itself is frontmost
    /// (it was just clicked) the source is unknown rather than "Gentra Island".
    pub fn frontmost_app() -> Option<String> {
        let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
        if app.processIdentifier() as u32 == std::process::id() {
            return None;
        }
        app.localizedName().map(|n| n.to_string())
    }
}

#[cfg(windows)]
mod platform {
    pub fn change_count() -> u64 {
        // SAFETY: no arguments, returns a counter.
        unsafe { windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber() as u64 }
    }
    pub fn is_concealed() -> bool {
        false
    }
    pub fn frontmost_app() -> Option<String> {
        None
    }
}

#[cfg(all(not(target_os = "macos"), not(windows)))]
mod platform {
    /// No portable change counter on Linux; the watcher hashes content instead.
    pub fn change_count() -> u64 {
        0
    }
    pub fn is_concealed() -> bool {
        false
    }
    pub fn frontmost_app() -> Option<String> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: u64, text: &str, secret: Option<&str>) -> ClipItem {
        ClipItem {
            id,
            kind: "text".into(),
            text: Some(text.into()),
            thumb: None,
            size: None,
            app: None,
            hash: id,
            created: 0,
            pinned: false,
            secret: secret.map(Into::into),
            expires: None,
        }
    }

    #[test]
    fn secrets_are_never_persisted() {
        let items = vec![item(1, "halo", None), item(2, "AKIAIOSFODNN7EXAMPLE", Some("Kunci akses AWS"))];
        let ids: Vec<u64> = persisted(&items).iter().map(|i| i.id).collect();
        assert_eq!(ids, vec![1]);
    }

    #[test]
    fn the_ui_only_sees_masked_secrets() {
        let shown = for_ui(&item(2, "key=AKIAIOSFODNN7EXAMPLE", Some("Kunci akses AWS")));
        assert_eq!(shown.text.as_deref(), Some("key=AKIA••••••••MPLE"));
    }

    #[test]
    fn transparent_pixels_become_the_card_colour_not_black() {
        // A fully transparent 4×4 image, like the shadow around a window screenshot.
        let img = ImageData { width: 4, height: 4, bytes: Cow::Owned(vec![0; 64]) };
        let url = thumbnail(&img).unwrap();
        let b64 = url.trim_start_matches("data:image/jpeg;base64,");
        let jpeg = base64::engine::general_purpose::STANDARD.decode(b64).unwrap();
        let px = image::load_from_memory(&jpeg).unwrap().to_rgb8().get_pixel(1, 1).0;
        let [r, g, b] = THUMB_BG;
        assert!(px.iter().zip([r, g, b]).all(|(a, e)| (*a as i32 - e as i32).abs() <= 3), "got {px:?}");
    }

    #[test]
    fn ordinary_items_reach_the_ui_unchanged() {
        assert_eq!(for_ui(&item(1, "halo", None)).text.as_deref(), Some("halo"));
    }
}

#[cfg(test)]
mod keep_tests {
    use super::*;

    fn item(id: u64, kind: &str, age_days: u64, pinned: bool) -> ClipItem {
        ClipItem { id, kind: kind.into(), text: None, thumb: None, size: None, app: None, hash: id, created: 100 * DAY_MS - age_days * DAY_MS, pinned, secret: None, expires: None }
    }

    #[test]
    fn old_items_go_unless_pinned_or_kept_forever() {
        let items = vec![item(1, "text", 1, false), item(2, "text", 10, false), item(3, "text", 40, true)];
        assert_eq!(to_drop(&items, 100 * DAY_MS, 7), vec![2]);
        assert!(to_drop(&items, 100 * DAY_MS, 0).is_empty());
    }

    #[test]
    fn only_the_newest_images_stay() {
        let items: Vec<ClipItem> = (0..MAX_IMAGES as u64 + 3).map(|i| item(i, "image", 0, false)).collect();
        assert_eq!(to_drop(&items, 100 * DAY_MS, 7), vec![60, 61, 62]);
    }

    #[test]
    fn the_history_never_grows_past_its_size() {
        let items: Vec<ClipItem> = (0..MAX_ITEMS as u64 + 2).map(|i| item(i, "text", 0, false)).collect();
        assert_eq!(to_drop(&items, 100 * DAY_MS, 0), vec![300, 301]);
    }
}
