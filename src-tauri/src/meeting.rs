//! Meeting guard: notices when an app starts using the microphone, shows how
//! long the call has run, and can mute the system microphone.
//!
//! It only asks the OS whether the mic is in use and by whom. It never opens
//! the microphone or listens to audio.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

static ENABLED: AtomicBool = AtomicBool::new(false);
static LAST: Mutex<Option<Mic>> = Mutex::new(None);

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Mic {
    pub in_use: bool,
    /// The app using the mic, when the OS says.
    pub app: Option<String>,
    /// None when this system can't read or change mute.
    pub muted: Option<bool>,
    /// Unix seconds when the mic went live.
    pub since: u64,
}

pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::Relaxed);
}

#[tauri::command]
pub fn mic_now() -> Option<Mic> {
    LAST.lock().unwrap().clone()
}

/// Mutes or unmutes the system microphone (macOS only for now).
#[tauri::command]
pub fn mic_set_muted(muted: bool) -> Result<(), String> {
    platform::set_muted(muted).ok_or_else(|| "mute_unavailable".to_string())?;
    if let Some(m) = LAST.lock().unwrap().as_mut() {
        m.muted = Some(muted);
    }
    Ok(())
}

/// Gives back an input volume we turned down to mute, so quitting the app
/// never leaves the microphone silently at zero.
pub fn restore() {
    if platform::muted_by_volume() {
        let _ = platform::set_muted(false);
    }
}

pub fn spawn(app: AppHandle) {
    thread::spawn(move || loop {
        if !ENABLED.load(Ordering::Relaxed) {
            if LAST.lock().unwrap().take().is_some() {
                let _ = app.emit("mic", Mic::default());
            }
            thread::sleep(Duration::from_secs(2));
            continue;
        }
        let (in_use, app_name) = platform::in_use();
        let muted = platform::muted();
        let mut last = LAST.lock().unwrap();
        let since = match last.as_ref() {
            Some(m) if m.in_use && in_use => m.since,
            _ if in_use => SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
            _ => 0,
        };
        let now = Mic { in_use, app: app_name, muted, since };
        if last.as_ref() != Some(&now) {
            let _ = app.emit("mic", &now);
            *last = Some(now);
        }
        drop(last);
        // One cheap OS query every 2 s, and only while the feature is on.
        thread::sleep(Duration::from_secs(2));
    });
}

/// Windows keeps one registry key per app that asked for the mic:
/// `Microsoft.WindowsCamera_8wekyb3d8bbwe` or `C:#Program Files#Zoom#bin#Zoom.exe`.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn windows_app_name(key: &str) -> String {
    if key.contains('#') {
        let file = key.rsplit('#').next().unwrap_or(key);
        return file.trim_end_matches(".exe").trim_end_matches(".EXE").to_string();
    }
    let family = key.split('_').next().unwrap_or(key);
    family.rsplit('.').next().unwrap_or(family).to_string()
}

/// Browsers record calls in helper processes: "Google Chrome Helper (Renderer)"
/// belongs to Google Chrome. Other non-app processes have no name worth showing.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn helper_owner(process: &str) -> Option<String> {
    process.split_once(" Helper").map(|(app, _)| app.trim().to_string()).filter(|a| !a.is_empty())
}

/// ALSA writes `state: RUNNING` in a capture stream's status file while it records.
#[cfg_attr(any(target_os = "macos", windows), allow(dead_code))]
pub fn alsa_capturing(status: &str) -> bool {
    status.lines().any(|l| l.trim() == "state: RUNNING")
}

#[cfg(target_os = "macos")]
mod platform {
    use std::ffi::c_void;
    use std::sync::Mutex;

    use objc2_app_kit::NSRunningApplication;

    #[repr(C)]
    struct Address {
        selector: u32,
        scope: u32,
        element: u32,
    }

    #[link(name = "CoreAudio", kind = "framework")]
    extern "C" {
        fn AudioObjectGetPropertyDataSize(id: u32, a: *const Address, qs: u32, q: *const c_void, size: *mut u32) -> i32;
        fn AudioObjectGetPropertyData(id: u32, a: *const Address, qs: u32, q: *const c_void, size: *mut u32, out: *mut c_void) -> i32;
        fn AudioObjectSetPropertyData(id: u32, a: *const Address, qs: u32, q: *const c_void, size: u32, data: *const c_void) -> i32;
        fn AudioObjectIsPropertySettable(id: u32, a: *const Address, out: *mut u8) -> i32;
    }

    const fn cc(s: &[u8; 4]) -> u32 {
        u32::from_be_bytes(*s)
    }
    const SYSTEM: u32 = 1;
    const GLOBAL: u32 = cc(b"glob");
    const INPUT: u32 = cc(b"inpt");

    /// System helpers that hold the mic without a call (dictation, Siri).
    const IGNORED: &[&str] = &["corespeechd", "Siri", "SiriNCService", "assistantd", "localspeechrecognition", "heard"];

    /// Input volume before we muted by volume, for devices without a mute switch.
    static SAVED_VOLUME: Mutex<Option<f32>> = Mutex::new(None);

    fn get<T: Default + Copy>(id: u32, selector: u32, scope: u32) -> Option<T> {
        let a = Address { selector, scope, element: 0 };
        let mut v = T::default();
        let mut size = std::mem::size_of::<T>() as u32;
        // SAFETY: `v` is a plain value of the size we pass.
        let rc = unsafe { AudioObjectGetPropertyData(id, &a, 0, std::ptr::null(), &mut size, &mut v as *mut T as *mut c_void) };
        (rc == 0).then_some(v)
    }

    fn set<T: Copy>(id: u32, selector: u32, scope: u32, v: T) -> bool {
        let a = Address { selector, scope, element: 0 };
        let mut ok = 0u8;
        // SAFETY: valid address and out-pointer; `v` matches the property's size.
        unsafe {
            AudioObjectIsPropertySettable(id, &a, &mut ok) == 0
                && ok != 0
                && AudioObjectSetPropertyData(id, &a, 0, std::ptr::null(), std::mem::size_of::<T>() as u32, &v as *const T as *const c_void) == 0
        }
    }

    fn default_input() -> Option<u32> {
        get::<u32>(SYSTEM, cc(b"dIn "), GLOBAL).filter(|&d| d != 0)
    }

    fn app_name(pid: i32) -> Option<String> {
        let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)?;
        app.localizedName().map(|n| n.to_string())
    }

    /// The executable name, for daemons and helpers that are not apps.
    fn process_name(pid: i32) -> Option<String> {
        let mut buf = [0u8; 256];
        // SAFETY: the buffer and its length are valid for the call.
        let n = unsafe { libc::proc_name(pid, buf.as_mut_ptr() as *mut c_void, buf.len() as u32) };
        (n > 0).then(|| String::from_utf8_lossy(&buf[..n as usize]).into_owned())
    }

    /// A name worth showing: the app, or the app a helper belongs to
    /// ("Google Chrome Helper" is Chrome). None for system processes.
    fn who(pid: i32) -> Result<Option<String>, ()> {
        if let Some(name) = app_name(pid) {
            return Ok(Some(name));
        }
        let Some(proc_name) = process_name(pid) else { return Ok(None) };
        if IGNORED.contains(&proc_name.as_str()) {
            return Err(());
        }
        Ok(super::helper_owner(&proc_name))
    }

    /// macOS 14 lists every process using audio; older systems only say
    /// whether the default mic is running.
    pub fn in_use() -> (bool, Option<String>) {
        let a = Address { selector: cc(b"prs#"), scope: GLOBAL, element: 0 };
        let mut size = 0u32;
        // SAFETY: size query on the system object.
        if unsafe { AudioObjectGetPropertyDataSize(SYSTEM, &a, 0, std::ptr::null(), &mut size) } == 0 && size > 0 {
            let mut ids = vec![0u32; size as usize / 4];
            // SAFETY: `ids` has room for `size` bytes.
            let rc = unsafe { AudioObjectGetPropertyData(SYSTEM, &a, 0, std::ptr::null(), &mut size, ids.as_mut_ptr() as *mut c_void) };
            if rc == 0 {
                let me = std::process::id() as i32;
                // Ok(name) is a real user of the mic; Err is a system helper to skip.
                let users: Vec<Option<String>> = ids
                    .iter()
                    .filter(|&&p| get::<u32>(p, cc(b"piri"), GLOBAL) == Some(1))
                    .filter_map(|&p| get::<i32>(p, cc(b"ppid"), GLOBAL))
                    .filter(|&pid| pid != me)
                    .filter_map(|pid| who(pid).ok())
                    .filter(|n| !n.as_deref().is_some_and(|n| IGNORED.contains(&n)))
                    .collect();
                let app = users.iter().flatten().next().cloned();
                return (!users.is_empty(), app);
            }
        }
        let running = default_input().and_then(|d| get::<u32>(d, cc(b"gone"), GLOBAL)) == Some(1);
        (running, None)
    }

    pub fn muted() -> Option<bool> {
        let d = default_input()?;
        if let Some(m) = get::<u32>(d, cc(b"mute"), INPUT) {
            return Some(m == 1);
        }
        get::<f32>(d, cc(b"volm"), INPUT).map(|v| v == 0.0)
    }

    pub fn muted_by_volume() -> bool {
        SAVED_VOLUME.lock().unwrap().is_some()
    }

    pub fn set_muted(on: bool) -> Option<()> {
        let d = default_input()?;
        if set(d, cc(b"mute"), INPUT, on as u32) {
            return Some(());
        }
        // Built-in mics often have no mute switch: turn the input volume down instead.
        let mut saved = SAVED_VOLUME.lock().unwrap();
        let volume = if on {
            *saved = get::<f32>(d, cc(b"volm"), INPUT).filter(|&v| v > 0.0).or(*saved);
            0.0
        } else {
            saved.take().unwrap_or(0.75)
        };
        set(d, cc(b"volm"), INPUT, volume).then_some(())
    }
}

#[cfg(windows)]
mod platform {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    const STORE: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";

    fn live(key: &RegKey) -> bool {
        let start: u64 = key.get_value("LastUsedTimeStart").unwrap_or(0);
        let stop: u64 = key.get_value("LastUsedTimeStop").unwrap_or(1);
        start > 0 && stop == 0
    }

    pub fn in_use() -> (bool, Option<String>) {
        let Ok(store) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(STORE) else { return (false, None) };
        let mut apps = Vec::new();
        for name in store.enum_keys().flatten() {
            let Ok(key) = store.open_subkey(&name) else { continue };
            if name == "NonPackaged" {
                for inner in key.enum_keys().flatten() {
                    if key.open_subkey(&inner).map(|k| live(&k)).unwrap_or(false) {
                        apps.push(super::windows_app_name(&inner));
                    }
                }
            } else if live(&key) {
                apps.push(super::windows_app_name(&name));
            }
        }
        let app = apps.first().cloned();
        (!apps.is_empty(), app)
    }

    pub fn muted() -> Option<bool> {
        None
    }

    pub fn muted_by_volume() -> bool {
        false
    }

    pub fn set_muted(_on: bool) -> Option<()> {
        None
    }
}

#[cfg(all(not(target_os = "macos"), not(windows)))]
mod platform {
    pub fn in_use() -> (bool, Option<String>) {
        let Ok(cards) = std::fs::read_dir("/proc/asound") else { return (false, None) };
        let running = cards.flatten().filter(|c| c.file_name().to_string_lossy().starts_with("card")).any(|card| {
            std::fs::read_dir(card.path()).into_iter().flatten().flatten().any(|pcm| {
                let n = pcm.file_name().to_string_lossy().into_owned();
                n.starts_with("pcm")
                    && n.ends_with('c')
                    && std::fs::read_to_string(pcm.path().join("sub0/status")).map(|s| super::alsa_capturing(&s)).unwrap_or(false)
            })
        });
        (running, None)
    }

    pub fn muted() -> Option<bool> {
        None
    }

    pub fn muted_by_volume() -> bool {
        false
    }

    pub fn set_muted(_on: bool) -> Option<()> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_windows_apps_from_their_registry_keys() {
        assert_eq!(windows_app_name("C:#Program Files#Zoom#bin#Zoom.exe"), "Zoom");
        assert_eq!(windows_app_name("Microsoft.WindowsCamera_8wekyb3d8bbwe"), "WindowsCamera");
        assert_eq!(windows_app_name("MSTeams_8wekyb3d8bbwe"), "MSTeams");
    }

    #[test]
    fn names_the_browser_behind_a_helper() {
        assert_eq!(helper_owner("Google Chrome Helper (Renderer)").as_deref(), Some("Google Chrome"));
        assert_eq!(helper_owner("Microsoft Edge Helper").as_deref(), Some("Microsoft Edge"));
        assert_eq!(helper_owner("com.apple.WebKit.GPU"), None);
        assert_eq!(helper_owner("ffmpeg"), None);
    }

    #[test]
    fn reads_alsa_capture_state() {
        assert!(alsa_capturing("state: RUNNING\nowner_pid   : 812\n"));
        assert!(!alsa_capturing("closed\n"));
        assert!(!alsa_capturing("state: PREPARED\n"));
    }
}

#[cfg(all(test, target_os = "macos"))]
mod real_machine {
    /// Prints what this Mac reports. Run with `cargo test -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn reads_the_mic_state_here() {
        println!("in use: {:?}, muted: {:?}", super::platform::in_use(), super::platform::muted());
    }
}

