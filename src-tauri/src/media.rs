//! Now playing: what music or video is playing in any app, with play/pause,
//! next, previous, and seek.
//!
//! - macOS: since 15.4 only Apple's own programs may read now-playing info, so
//!   a small `osascript` helper reads it and prints a JSON line when it
//!   changes. Commands still work from any app and go straight to MediaRemote.
//! - Windows: the system media session API (SMTC).
//! - Linux: MPRIS over D-Bus.

use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

static ENABLED: AtomicBool = AtomicBool::new(false);
static LAST: Mutex<Option<NowPlaying>> = Mutex::new(None);

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub album: String,
    /// The app playing it: Spotify, Music, Safari, Chrome…
    #[serde(default)]
    pub app: String,
    #[serde(default)]
    pub playing: bool,
    /// Seconds; 0 for live streams.
    #[serde(default)]
    pub duration: f64,
    /// Seconds played at `at`.
    #[serde(default)]
    pub elapsed: f64,
    /// Unix milliseconds when `elapsed` was read; the UI counts on from there.
    #[serde(default)]
    pub at: u64,
    /// A small JPEG as a data URL.
    #[serde(default)]
    pub art: Option<String>,
    /// Set when artwork needs the user's help, e.g. "automation:Google Chrome"
    /// when macOS blocked asking the browser for its tab.
    #[serde(default)]
    pub art_help: Option<String>,
}

pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::Relaxed);
}

fn enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn media_now() -> Option<NowPlaying> {
    LAST.lock().unwrap().clone()
}

/// Switches YouTube thumbnails for browser playback on or off (macOS), and
/// tries again right away for what is playing now.
#[tauri::command]
pub fn media_youtube_art(app: AppHandle, on: bool) {
    platform::set_youtube_art(on);
    let now = LAST.lock().unwrap().clone();
    if let Some(n) = now {
        std::thread::spawn(move || {
            let n = platform::enrich(n);
            publish(&app, Some(n));
        });
    }
}

/// `toggle`, `next`, `previous`, or `seek` with `position` in seconds.
#[tauri::command]
pub fn media_control(action: String, position: Option<f64>) -> Result<(), String> {
    let action = match action.as_str() {
        "toggle" => Action::Toggle,
        "next" => Action::Next,
        "previous" => Action::Previous,
        "seek" => Action::Seek(position.ok_or("bad_action")?.max(0.0)),
        _ => return Err("bad_action".into()),
    };
    platform::control(action).ok_or_else(|| "media_unavailable".to_string())
}

#[derive(Clone, Copy, Debug)]
pub enum Action {
    Toggle,
    Next,
    Previous,
    Seek(f64),
}

/// Stores and announces a new state, if it differs from the last one.
/// Artwork arrives once per track; later updates without it keep the old one.
fn publish(app: &AppHandle, next: Option<NowPlaying>) {
    let mut last = LAST.lock().unwrap();
    let next = next.map(|mut n| {
        if n.art.is_none() {
            if let Some(prev) = last.as_ref().filter(|p| p.title == n.title && p.artist == n.artist) {
                n.art = prev.art.clone();
            }
        }
        n
    });
    if *last != next {
        let _ = app.emit("media", &next);
        *last = next;
    }
}

/// Shrinks artwork of any size to a 160 px JPEG data URL.
pub fn thumbnail(bytes: &[u8]) -> Option<String> {
    let img = image::load_from_memory(bytes).ok()?.thumbnail(160, 160).to_rgb8();
    let mut out = Cursor::new(Vec::new());
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 82).encode_image(&img).ok()?;
    Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(out.into_inner())))
}

/// The 11-character video ID from a YouTube address; None for any other site
/// or anything that isn't a clean ID, so it is always safe to put in a URL.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn youtube_id(address: &str) -> Option<String> {
    let u = url::Url::parse(address).ok()?;
    let host = u.host_str()?;
    let host = host.strip_prefix("www.").or_else(|| host.strip_prefix("m.")).unwrap_or(host);
    let id = match host {
        "youtube.com" | "music.youtube.com" => match u.query_pairs().find(|(k, _)| k == "v") {
            Some((_, v)) => v.into_owned(),
            None => {
                let mut parts = u.path_segments()?;
                match parts.next()? {
                    "shorts" | "live" | "embed" => parts.next()?.to_string(),
                    _ => return None,
                }
            }
        },
        "youtu.be" => u.path_segments()?.next()?.to_string(),
        _ => return None,
    };
    (id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')).then_some(id)
}

/// From "title<TAB>address" lines, the address of the YouTube tab whose title
/// contains what is playing. Spacing and case are ignored; YouTube adds
/// "(2) " and " - YouTube" around the video title.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn tab_for(lines: &str, playing: &str) -> Option<String> {
    let norm = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    let want = norm(playing);
    if want.is_empty() {
        return None;
    }
    lines.lines().find_map(|line| {
        let (title, address) = line.split_once('\t')?;
        (norm(title).contains(&want) && youtube_id(address.trim()).is_some()).then(|| address.trim().to_string())
    })
}

/// One line from the macOS helper: `{}` when nothing plays, `art` as base64.
pub fn parse_line(line: &str) -> Option<Option<NowPlaying>> {
    let mut v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("error").is_some() {
        return None;
    }
    if v.get("title").and_then(|t| t.as_str()).is_none_or(str::is_empty) {
        return Some(None);
    }
    let art = v.get_mut("art").and_then(|a| a.take().as_str().map(str::to_owned));
    let mut n: NowPlaying = serde_json::from_value(v).ok()?;
    n.art = art.and_then(|b64| base64::engine::general_purpose::STANDARD.decode(b64).ok()).and_then(|b| thumbnail(&b));
    Some(Some(n))
}

pub fn spawn(app: AppHandle) {
    platform::spawn(app);
}

/// Stops helper processes when the app quits.
pub fn shutdown() {
    platform::shutdown();
}

#[cfg(target_os = "macos")]
mod platform {
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::io::{BufRead, BufReader};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::process::{Child, Command, Stdio};
    use std::sync::Mutex;
    use std::thread;
    use std::time::Duration;

    use tauri::AppHandle;

    use super::{enabled, parse_line, publish, Action, NowPlaying};

    static CHILD: Mutex<Option<Child>> = Mutex::new(None);
    static YOUTUBE: AtomicBool = AtomicBool::new(false);
    /// Artwork found per song title, and titles already tried, so a song is
    /// looked up once rather than on every update.
    static FOUND: Mutex<Option<HashMap<String, Option<String>>>> = Mutex::new(None);

    /// Browsers that answer AppleScript, and the property that holds a tab's title.
    const BROWSERS: &[(&str, &str)] = &[
        ("Google Chrome", "title"),
        ("Safari", "name"),
        ("Brave Browser", "title"),
        ("Microsoft Edge", "title"),
        ("Arc", "title"),
        ("Vivaldi", "title"),
        ("Opera", "title"),
        ("Chromium", "title"),
    ];

    pub fn set_youtube_art(on: bool) {
        YOUTUBE.store(on, Ordering::Relaxed);
        // Switching on, or "Try again", forgets earlier misses.
        *FOUND.lock().unwrap() = None;
    }

    /// Lists the browser's tabs as "title<TAB>address" lines. Err when macOS
    /// hasn't allowed Gentra Island to ask that browser.
    fn browser_tabs(browser: &str, title_prop: &str) -> Result<String, ()> {
        let script = format!(
            "if application \"{browser}\" is running then\n\
             tell application \"{browser}\"\n\
             set out to \"\"\n\
             repeat with w in windows\n\
             repeat with t in tabs of w\n\
             set out to out & ({title_prop} of t) & (character id 9) & (URL of t) & (character id 10)\n\
             end repeat\n\
             end repeat\n\
             return out\n\
             end tell\n\
             end if"
        );
        let out = Command::new("/usr/bin/osascript").args(["-e", &script]).output().map_err(|_| ())?;
        if out.status.success() {
            return Ok(String::from_utf8_lossy(&out.stdout).into_owned());
        }
        let err = String::from_utf8_lossy(&out.stderr);
        // -1743: the user (or macOS) said no to Automation for this browser.
        if err.contains("-1743") || err.contains("Not authorized") {
            Err(())
        } else {
            Ok(String::new())
        }
    }

    fn thumbnail_for(id: &str) -> Option<String> {
        // youtube_id() guarantees `id` is 11 safe characters.
        let url = format!("https://i.ytimg.com/vi/{id}/mqdefault.jpg");
        let out = Command::new("/usr/bin/curl").args(["-sf", "--max-time", "6", "--proto", "=https", &url]).output().ok()?;
        out.status.success().then_some(())?;
        super::thumbnail(&out.stdout)
    }

    /// Adds a YouTube thumbnail to browser playback that came without artwork.
    pub fn enrich(mut n: NowPlaying) -> NowPlaying {
        if n.art.is_some() || !YOUTUBE.load(Ordering::Relaxed) {
            return n;
        }
        let Some(&(browser, prop)) = BROWSERS.iter().find(|(b, _)| *b == n.app) else { return n };
        if let Some(found) = FOUND.lock().unwrap().get_or_insert_with(HashMap::new).get(&n.title) {
            n.art = found.clone();
            return n;
        }
        match browser_tabs(browser, prop) {
            Err(()) => n.art_help = Some(format!("automation:{browser}")),
            Ok(tabs) => {
                let art = super::tab_for(&tabs, &n.title).and_then(|a| super::youtube_id(&a)).and_then(|id| thumbnail_for(&id));
                FOUND.lock().unwrap().get_or_insert_with(HashMap::new).insert(n.title.clone(), art.clone());
                n.art = art;
            }
        }
        n
    }

    /// Runs inside `osascript`, an Apple program that may still read now-playing
    /// info. Prints a JSON line on every change and quits with the app.
    pub(super) const READER: &str = r#"
ObjC.import('Foundation');
ObjC.bindFunction('getppid', ['int', []]);
function run() {
  $.NSBundle.bundleWithPath('/System/Library/PrivateFrameworks/MediaRemote.framework/').load;
  const R = $.NSClassFromString('MRNowPlayingRequest');
  const out = $.NSFileHandle.fileHandleWithStandardOutput;
  const val = (v) => (v && !v.isNil() ? ObjC.unwrap(v) : null);
  const ms = (d) => (d && !d.isNil() ? Math.round(d.timeIntervalSince1970 * 1000) : 0);
  let last = '';
  let artFor = '';
  while (true) {
    // Orphaned (the app quit or crashed): launchd became the parent.
    if ($.getppid() === 1) return;
    let o = {};
    try {
      const item = R.localNowPlayingItem;
      const info = item && !item.isNil() ? item.nowPlayingInfo : null;
      if (info && !info.isNil()) {
        const g = (k) => info.objectForKey('kMRMediaRemoteNowPlayingInfo' + k);
        const client = R.localNowPlayingPlayerPath.client;
        o = {
          title: val(g('Title')) || '',
          artist: val(g('Artist')) || '',
          album: val(g('Album')) || '',
          app: val(client.displayName) || '',
          playing: !!R.localIsPlaying,
          duration: val(g('Duration')) || 0,
          elapsed: val(g('ElapsedTime')) || 0,
          at: ms(g('Timestamp')),
        };
        const id = o.title + '\u0000' + o.artist;
        const art = g('ArtworkData');
        if (art && !art.isNil() && id !== artFor) {
          o.art = ObjC.unwrap(art.base64EncodedStringWithOptions(0));
          artFor = id;
        }
      }
    } catch (e) {
      o = { error: String(e) };
    }
    const key = JSON.stringify(Object.assign({}, o, { art: undefined }));
    if (key !== last || o.art) {
      last = key;
      out.writeData($(JSON.stringify(o) + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
    }
    delay(1);
  }
}
"#;

    pub fn spawn(app: AppHandle) {
        thread::spawn(move || loop {
            if !enabled() {
                stop_child();
                thread::sleep(Duration::from_secs(1));
                continue;
            }
            let child = Command::new("/usr/bin/osascript")
                .args(["-l", "JavaScript", "-e", READER])
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn();
            let Ok(mut child) = child else {
                thread::sleep(Duration::from_secs(30));
                continue;
            };
            let stdout = child.stdout.take();
            *CHILD.lock().unwrap() = Some(child);
            // A second thread notices when the feature is switched off.
            thread::spawn(|| {
                while enabled() && CHILD.lock().unwrap().is_some() {
                    thread::sleep(Duration::from_secs(1));
                }
                stop_child();
            });
            if let Some(stdout) = stdout {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    if let Some(state) = parse_line(&line) {
                        publish(&app, state.map(enrich));
                    }
                }
            }
            stop_child();
            publish(&app, None);
            // The helper ended (switched off, or it crashed): wait a little before trying again.
            thread::sleep(Duration::from_secs(if enabled() { 5 } else { 1 }));
        });
    }

    fn stop_child() {
        if let Some(mut c) = CHILD.lock().unwrap().take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }

    pub fn shutdown() {
        stop_child();
    }

    const MEDIA_REMOTE: &std::ffi::CStr = c"/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote";

    fn symbol(name: &std::ffi::CStr) -> Option<*mut c_void> {
        // SAFETY: dlopen/dlsym with valid C strings; the framework stays loaded.
        unsafe {
            let h = libc::dlopen(MEDIA_REMOTE.as_ptr(), libc::RTLD_NOW);
            if h.is_null() {
                return None;
            }
            let f = libc::dlsym(h, name.as_ptr());
            (!f.is_null()).then_some(f)
        }
    }

    pub fn control(action: Action) -> Option<()> {
        if let Action::Seek(secs) = action {
            let f = symbol(c"MRMediaRemoteSetElapsedTime")?;
            // SAFETY: MRMediaRemoteSetElapsedTime(double).
            let set: extern "C" fn(f64) = unsafe { std::mem::transmute(f) };
            set(secs);
            return Some(());
        }
        // MRMediaRemoteCommand: 2 toggle, 4 next, 5 previous.
        let cmd = match action {
            Action::Toggle => 2,
            Action::Next => 4,
            Action::Previous => 5,
            Action::Seek(_) => unreachable!(),
        };
        let f = symbol(c"MRMediaRemoteSendCommand")?;
        // SAFETY: MRMediaRemoteSendCommand(MRMediaRemoteCommand, CFDictionaryRef).
        let send: extern "C" fn(i32, *const c_void) -> bool = unsafe { std::mem::transmute(f) };
        send(cmd, std::ptr::null()).then_some(())
    }
}

#[cfg(windows)]
mod platform {
    use std::thread;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use tauri::AppHandle;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::{DataReader, InputStreamOptions};

    use super::{enabled, publish, thumbnail, Action, NowPlaying};

    /// TimeSpan ticks are 100 ns.
    const TICKS: f64 = 10_000_000.0;

    fn session() -> Option<Session> {
        Manager::RequestAsync().ok()?.join().ok()?.GetCurrentSession().ok()
    }

    fn app_name(id: &str) -> String {
        // "Spotify.exe", "Chrome", "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"
        let id = id.split('!').next().unwrap_or(id);
        crate::meeting::windows_app_name(id)
    }

    fn art(s: &Session, props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties) -> Option<String> {
        let _ = s;
        let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.join().ok()?;
        let size = stream.Size().ok()? as u32;
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        reader.SetInputStreamOptions(InputStreamOptions::ReadAhead).ok()?;
        reader.LoadAsync(size).ok()?.join().ok()?;
        let mut buf = vec![0u8; size as usize];
        reader.ReadBytes(&mut buf).ok()?;
        thumbnail(&buf)
    }

    fn read(with_art: bool) -> Option<NowPlaying> {
        let s = session()?;
        let props = s.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
        let title = props.Title().ok()?.to_string();
        if title.is_empty() {
            return None;
        }
        let playing = s.GetPlaybackInfo().ok()?.PlaybackStatus().ok()? == Status::Playing;
        let tl = s.GetTimelineProperties().ok()?;
        let duration = (tl.EndTime().ok()?.Duration - tl.StartTime().ok()?.Duration) as f64 / TICKS;
        let elapsed = tl.Position().ok()?.Duration as f64 / TICKS;
        Some(NowPlaying {
            title,
            artist: props.Artist().map(|a| a.to_string()).unwrap_or_default(),
            album: props.AlbumTitle().map(|a| a.to_string()).unwrap_or_default(),
            app: s.SourceAppUserModelId().map(|a| app_name(&a.to_string())).unwrap_or_default(),
            playing,
            duration: duration.max(0.0),
            elapsed,
            at: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
            art: if with_art { art(&s, &props) } else { None },
        })
    }

    pub fn spawn(app: AppHandle) {
        thread::spawn(move || {
            let mut track = String::new();
            loop {
                if !enabled() {
                    track.clear();
                    publish(&app, None);
                    thread::sleep(Duration::from_secs(1));
                    continue;
                }
                // Artwork is read once per track; the rest every 1.5 s.
                let peek = read(false);
                let id = peek.as_ref().map(|n| format!("{}\u{0}{}", n.title, n.artist)).unwrap_or_default();
                let now = if id != track && peek.is_some() { read(true) } else { peek };
                track = id;
                publish(&app, now);
                thread::sleep(Duration::from_millis(1500));
            }
        });
    }

    /// Windows and Linux players hand over artwork themselves.
    pub fn set_youtube_art(_on: bool) {}

    pub fn enrich(n: NowPlaying) -> NowPlaying {
        n
    }

    pub fn shutdown() {}

    pub fn control(action: Action) -> Option<()> {
        let s = session()?;
        let ok = match action {
            Action::Toggle => s.TryTogglePlayPauseAsync().ok()?.join().ok()?,
            Action::Next => s.TrySkipNextAsync().ok()?.join().ok()?,
            Action::Previous => s.TrySkipPreviousAsync().ok()?.join().ok()?,
            Action::Seek(secs) => s.TryChangePlaybackPositionAsync((secs * TICKS) as i64).ok()?.join().ok()?,
        };
        ok.then_some(())
    }
}

#[cfg(all(not(target_os = "macos"), not(windows)))]
mod platform {
    use std::collections::HashMap;
    use std::thread;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use tauri::AppHandle;
    use zbus::blocking::{Connection, Proxy};
    use zbus::zvariant::{OwnedObjectPath, OwnedValue};

    use super::{enabled, publish, thumbnail, Action, NowPlaying};

    const PREFIX: &str = "org.mpris.MediaPlayer2.";
    const PATH: &str = "/org/mpris/MediaPlayer2";
    const PLAYER: &str = "org.mpris.MediaPlayer2.Player";

    fn players(conn: &Connection) -> Vec<String> {
        let Ok(dbus) = zbus::blocking::fdo::DBusProxy::new(conn) else { return Vec::new() };
        dbus.list_names()
            .map(|names| names.into_iter().map(|n| n.to_string()).filter(|n| n.starts_with(PREFIX)).collect())
            .unwrap_or_default()
    }

    fn proxy<'a>(conn: &'a Connection, name: &'a str, iface: &'a str) -> Option<Proxy<'a>> {
        Proxy::new(conn, name.to_string(), PATH, iface).ok()
    }

    /// The player that is playing, or the first one that has a track.
    fn current(conn: &Connection) -> Option<String> {
        let names = players(conn);
        let status = |n: &String| proxy(conn, n, PLAYER).and_then(|p| p.get_property::<String>("PlaybackStatus").ok());
        names
            .iter()
            .find(|n| status(n).as_deref() == Some("Playing"))
            .or_else(|| names.iter().find(|n| status(n).as_deref() == Some("Paused")))
            .cloned()
    }

    fn text(meta: &HashMap<String, OwnedValue>, key: &str) -> String {
        let Some(v) = meta.get(key) else { return String::new() };
        if let Ok(s) = String::try_from(v.clone()) {
            return s;
        }
        // xesam:artist is a list of names.
        Vec::<String>::try_from(v.clone()).map(|v| v.join(", ")).unwrap_or_default()
    }

    fn art(url: &str) -> Option<String> {
        // Only local files: fetching remote artwork would mean network calls.
        let path = url.strip_prefix("file://")?;
        let path = percent(path);
        thumbnail(&std::fs::read(path).ok()?)
    }

    fn percent(s: &str) -> String {
        url::form_urlencoded::parse(s.replace('+', "%2B").as_bytes()).map(|(k, v)| format!("{k}{v}")).collect()
    }

    fn read(conn: &Connection, with_art: bool) -> Option<NowPlaying> {
        let name = current(conn)?;
        let p = proxy(conn, &name, PLAYER)?;
        let meta: HashMap<String, OwnedValue> = p.get_property("Metadata").ok()?;
        let title = text(&meta, "xesam:title");
        if title.is_empty() {
            return None;
        }
        let playing = p.get_property::<String>("PlaybackStatus").ok().as_deref() == Some("Playing");
        let micros = |v: Option<&OwnedValue>| v.and_then(|v| i64::try_from(v.clone()).ok().or_else(|| u64::try_from(v.clone()).ok().map(|u| u as i64)));
        let duration = micros(meta.get("mpris:length")).unwrap_or(0) as f64 / 1e6;
        let elapsed = p.get_property::<i64>("Position").unwrap_or(0) as f64 / 1e6;
        let app = proxy(conn, &name, "org.mpris.MediaPlayer2")
            .and_then(|r| r.get_property::<String>("Identity").ok())
            .unwrap_or_else(|| name.trim_start_matches(PREFIX).split('.').next().unwrap_or("").to_string());
        Some(NowPlaying {
            title,
            artist: text(&meta, "xesam:artist"),
            album: text(&meta, "xesam:album"),
            app,
            playing,
            duration,
            elapsed,
            at: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
            art: if with_art { art(&text(&meta, "mpris:artUrl")) } else { None },
        })
    }

    pub fn spawn(app: AppHandle) {
        thread::spawn(move || {
            let mut conn: Option<Connection> = None;
            let mut track = String::new();
            loop {
                if !enabled() {
                    track.clear();
                    publish(&app, None);
                    thread::sleep(Duration::from_secs(1));
                    continue;
                }
                if conn.is_none() {
                    conn = Connection::session().ok();
                }
                let Some(c) = conn.as_ref() else {
                    thread::sleep(Duration::from_secs(30));
                    continue;
                };
                let peek = read(c, false);
                let id = peek.as_ref().map(|n| format!("{}\u{0}{}", n.title, n.artist)).unwrap_or_default();
                let now = if id != track && peek.is_some() { read(c, true) } else { peek };
                track = id;
                publish(&app, now);
                thread::sleep(Duration::from_millis(1500));
            }
        });
    }

    /// Windows and Linux players hand over artwork themselves.
    pub fn set_youtube_art(_on: bool) {}

    pub fn enrich(n: NowPlaying) -> NowPlaying {
        n
    }

    pub fn shutdown() {}

    pub fn control(action: Action) -> Option<()> {
        let conn = Connection::session().ok()?;
        let name = current(&conn)?;
        let p = proxy(&conn, &name, PLAYER)?;
        match action {
            Action::Toggle => p.call_method("PlayPause", &()).ok()?,
            Action::Next => p.call_method("Next", &()).ok()?,
            Action::Previous => p.call_method("Previous", &()).ok()?,
            Action::Seek(secs) => {
                let meta: HashMap<String, OwnedValue> = p.get_property("Metadata").ok()?;
                let track = OwnedObjectPath::try_from(meta.get("mpris:trackid")?.clone()).ok()?;
                p.call_method("SetPosition", &(track, (secs * 1e6) as i64)).ok()?
            }
        };
        Some(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finds_the_youtube_video_id_in_a_tab_address() {
        let id = |u: &str| youtube_id(u);
        assert_eq!(id("https://www.youtube.com/watch?v=dQw4w9WgXcQ").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(id("https://www.youtube.com/watch?list=PL1&v=dQw4w9WgXcQ&t=42s").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(id("https://youtu.be/dQw4w9WgXcQ?si=abc").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(id("https://www.youtube.com/shorts/dQw4w9WgXcQ").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(id("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RD").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(id("https://www.youtube.com/live/dQw4w9WgXcQ").as_deref(), Some("dQw4w9WgXcQ"));
    }

    #[test]
    fn ignores_other_sites_and_malformed_ids() {
        assert_eq!(youtube_id("https://evil.example/watch?v=dQw4w9WgXcQ"), None);
        assert_eq!(youtube_id("https://www.youtube.com/watch?v=short"), None);
        assert_eq!(youtube_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ%22;rm"), None);
        assert_eq!(youtube_id("https://www.youtube.com/"), None);
    }

    #[test]
    fn picks_the_tab_whose_title_matches_what_plays() {
        let tabs = "Inbox - Gmail\thttps://mail.google.com/\n\
                    (2) JANJI SETIA  | TIARA ANDINI - YouTube\thttps://www.youtube.com/watch?v=abcdefghijk\n";
        assert_eq!(tab_for(tabs, "JANJI SETIA | TIARA ANDINI").as_deref(), Some("https://www.youtube.com/watch?v=abcdefghijk"));
        assert_eq!(tab_for(tabs, "Something else"), None);
    }


    #[test]
    fn nothing_playing_is_none() {
        assert_eq!(parse_line("{}"), Some(None));
        assert_eq!(parse_line(r#"{"title":""}"#), Some(None));
    }

    #[test]
    fn reads_a_track_line() {
        let n = parse_line(r#"{"title":"Kita","artist":"Sheila on 7","album":"Kisah Klasik","app":"Spotify","playing":true,"duration":245.5,"elapsed":12.25,"at":1792945222147}"#)
            .unwrap()
            .unwrap();
        assert_eq!(n.title, "Kita");
        assert_eq!(n.app, "Spotify");
        assert!(n.playing);
        assert_eq!(n.duration, 245.5);
        assert_eq!(n.art, None);
    }

    #[test]
    fn helper_errors_and_garbage_are_ignored() {
        assert_eq!(parse_line(r#"{"error":"boom"}"#), None);
        assert_eq!(parse_line("not json"), None);
    }

    #[test]
    fn artwork_becomes_a_small_jpeg() {
        let img = image::RgbImage::from_pixel(600, 600, image::Rgb([200, 40, 90]));
        let mut png = Cursor::new(Vec::new());
        img.write_to(&mut png, image::ImageFormat::Png).unwrap();
        let b64 = base64::engine::general_purpose::STANDARD.encode(png.into_inner());
        let n = parse_line(&format!(r#"{{"title":"x","art":"{b64}"}}"#)).unwrap().unwrap();
        let url = n.art.unwrap();
        assert!(url.starts_with("data:image/jpeg;base64,"));
        let bytes = base64::engine::general_purpose::STANDARD.decode(&url[23..]).unwrap();
        let back = image::load_from_memory(&bytes).unwrap();
        assert!(back.width() <= 160 && back.height() <= 160);
    }
}

#[cfg(all(test, target_os = "macos"))]
mod real_machine {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};

    /// Reads one line from the real helper. Play something first, then run
    /// `cargo test -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn the_helper_reads_what_is_playing() {
        let mut child = Command::new("/usr/bin/osascript")
            .args(["-l", "JavaScript", "-e", super::platform::READER])
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
        let _ = child.kill();
        let state = super::parse_line(line.trim()).expect("helper line parses");
        println!("{:?}", state.map(|n| (n.title, n.artist, n.app, n.playing, n.duration, n.art.is_some())));
    }
}

