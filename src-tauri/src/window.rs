//! The island window: a fixed-size, transparent, always-on-top window.
//!
//! The OS window never resizes. The frontend animates the island inside it and
//! reports the island's rectangle; everything outside that rectangle is made
//! click-through by polling the cursor and toggling `ignore_cursor_events`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewWindow};

pub const LABEL: &str = "island";
const WIN_W: f64 = 760.0;
const WIN_H: f64 = 520.0;

#[derive(Default, Clone, Copy, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x <= self.x + self.w && y >= self.y && y <= self.y + self.h
    }

    fn grown(&self, by: f64) -> Rect {
        Rect { x: self.x - by, y: self.y - by, w: self.w + 2.0 * by, h: self.h + 2.0 * by }
    }
}

/// macOS applies a change to click-through only at the next mouse movement.
/// Switching while the pointer is still on its way, this far out, means a
/// click right after it stops lands on the island, not the app behind it.
const CATCH_MARGIN: f64 = 16.0;

#[derive(Default)]
pub struct HitState(pub Mutex<Rect>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreenInfo {
    pub platform: &'static str,
    /// Width of the camera housing in points, 0 when the screen has no notch.
    pub notch_width: f64,
    pub notch_height: f64,
    pub menubar_height: f64,
}

/// Called by the frontend whenever the island's hit area changes (logical px).
/// The eyes in the notch follow the pointer; only then is its position sent.
static EYES: AtomicBool = AtomicBool::new(false);
/// Ten times a second: smooth enough with the CSS transition, and quick
/// enough to tuck the eyes away before the pointer reaches them.
const EYES_EVERY: Duration = Duration::from_millis(100);

#[tauri::command]
pub fn set_eyes(on: bool) {
    EYES.store(on, Ordering::Relaxed);
}

#[tauri::command]
pub fn set_hit_rect(state: tauri::State<HitState>, rect: Rect) {
    *state.0.lock().unwrap() = rect;
}

/// Opens the island from a shortcut or the menu bar and lets it take keys.
pub fn summon(app: &AppHandle, tab: &str) {
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.set_ignore_cursor_events(false);
        platform::focus(&win);
    }
    let _ = app.emit("open-tab", tab);
}

#[tauri::command]
pub fn screen_info() -> ScreenInfo {
    platform::screen_info()
}

pub fn setup(win: &WebviewWindow) -> tauri::Result<()> {
    win.set_size(LogicalSize::new(WIN_W, WIN_H))?;
    if let Some(monitor) = win.primary_monitor()?.or(win.current_monitor()?) {
        let scale = monitor.scale_factor();
        let size = monitor.size().to_logical::<f64>(scale);
        let origin = monitor.position().to_logical::<f64>(scale);
        win.set_position(LogicalPosition::new(origin.x + (size.width - WIN_W) / 2.0, origin.y))?;
    }
    win.set_ignore_cursor_events(true)?;
    platform::elevate(win);
    Ok(())
}

/// Polls the global cursor (60 Hz near the island, 10 Hz elsewhere) and flips click-through when it crosses
/// the island's edge. Also tells the frontend about hover, because the webview
/// gets no mouse events while the window ignores the cursor.
pub fn spawn_hit_tester(app: AppHandle) {
    thread::spawn(move || {
        let mut inside = false;
        let mut accepting = false;
        let mut sent = Instant::now();
        let mut wait = Duration::from_millis(100);
        let mut last = (f64::NAN, f64::NAN);
        let mut still = Duration::ZERO;
        // Window origin and scale only change when displays change, so they are
        // re-read every ~2 s instead of on every tick.
        let mut geometry = None;
        let mut geometry_age = Duration::MAX;
        loop {
            thread::sleep(wait);
            geometry_age = geometry_age.saturating_add(wait);
            let Some(win) = app.get_webview_window(LABEL) else { continue };
            if geometry.is_none() || geometry_age > Duration::from_secs(2) {
                geometry = win.outer_position().ok().zip(win.scale_factor().ok());
                geometry_age = Duration::ZERO;
            }
            let (Ok(cursor), Some((origin, scale))) = (win.cursor_position(), geometry) else {
                continue;
            };
            let x = (cursor.x - origin.x as f64) / scale;
            let y = (cursor.y - origin.y as f64) / scale;
            let moved = (x - last.0).abs() > 0.5 || (y - last.1).abs() > 0.5;
            last = (x, y);
            still = if moved { Duration::ZERO } else { still.saturating_add(wait) };
            if moved && EYES.load(Ordering::Relaxed) && sent.elapsed() >= EYES_EVERY {
                sent = Instant::now();
                let _ = app.emit("pointer", (x.round(), y.round()));
            }
            let rect = *app.state::<HitState>().0.lock().unwrap();
            let near = y < rect.y + rect.h + 80.0 && x > rect.x - 80.0 && x < rect.x + rect.w + 80.0;
            // Every check wakes the CPU, so poll fast only when hover can change soon:
            // 30 Hz over or near the island while the cursor moves, slower when it
            // rests, and 5 Hz once it has sat still far away. Slower than that and a
            // quick flick to the notch is noticed late.
            let ms = match (inside || near, still > Duration::from_secs(1)) {
                (true, false) => 33,
                (true, true) => 150,
                (false, false) => 100,
                (false, true) => 200,
            };
            wait = Duration::from_millis(ms);
            let catching = rect.grown(CATCH_MARGIN).contains(x, y);
            if catching != accepting {
                accepting = catching;
                let _ = win.set_ignore_cursor_events(!catching);
            }
            let now = rect.contains(x, y);
            if now != inside {
                inside = now;
                let _ = app.emit("island-hover", now);
            }
        }
    });
}

#[cfg(target_os = "macos")]
mod platform {
    use super::ScreenInfo;
    use objc2::MainThreadMarker;
    use objc2::runtime::{AnyClass, AnyObject, NSObject};
    use objc2::{define_class, ClassType, MainThreadOnly};
    use objc2_app_kit::{NSPanel, NSResponder, NSScreen, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask};

    define_class!(
        // A non-activating panel: it can take keyboard focus for search without
        // activating Gentra Island, so the app you are in (even full-screen)
        // keeps focus and its Space.
        #[unsafe(super(NSPanel, NSWindow, NSResponder, NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "GentraIslandPanel"]
        struct GatePanel;

        impl GatePanel {
            #[unsafe(method(canBecomeKeyWindow))]
            fn can_become_key_window(&self) -> bool {
                true
            }

            #[unsafe(method(canBecomeMainWindow))]
            fn can_become_main_window(&self) -> bool {
                false
            }
        }
    );

    fn ns_window(win: &tauri::WebviewWindow) -> Option<&NSWindow> {
        let ptr = win.ns_window().ok()?;
        // SAFETY: Tauri hands us the live NSWindow pointer for this window.
        Some(unsafe { &*(ptr as *const NSWindow) })
    }

    /// Turns the window into a non-activating panel above the menu bar
    /// (NSMainMenuWindowLevel = 24) that lives on every Space, including other
    /// apps' full-screen Spaces. Regular windows are not allowed there.
    pub fn elevate(win: &tauri::WebviewWindow) {
        let Some(ns) = ns_window(win) else { return };
        // SAFETY: swapping NSWindow for an NSPanel subclass that adds no ivars
        // is the established way to get a panel out of a framework-made window
        // (tauri-nspanel does the same). Runs on the main thread during setup.
        unsafe {
            objc2::ffi::object_setClass(
                ns as *const NSWindow as *mut AnyObject,
                GatePanel::class() as *const AnyClass,
            );
        }
        // SAFETY: the object is now a GatePanel, a subclass of NSPanel.
        let panel: &NSPanel = unsafe { &*(ns as *const NSWindow as *const NSPanel) };
        panel.setStyleMask(panel.styleMask() | NSWindowStyleMask::NonactivatingPanel);
        panel.setFloatingPanel(true);
        panel.setHidesOnDeactivate(false);
        panel.setBecomesKeyOnlyIfNeeded(false);
        ns.setLevel(27);
        ns.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        ns.setHasShadow(false);
    }

    /// Gives the island keyboard focus without activating the app.
    pub fn focus(win: &tauri::WebviewWindow) {
        if let Some(ns) = ns_window(win) {
            ns.makeKeyAndOrderFront(None);
        }
    }

    pub fn screen_info() -> ScreenInfo {
        let mut info = ScreenInfo {
            platform: "macos",
            notch_width: 0.0,
            notch_height: 0.0,
            menubar_height: 24.0,
        };
        let Some(mtm) = MainThreadMarker::new() else { return info };
        let screens = NSScreen::screens(mtm);
        let Some(screen) = screens.firstObject() else { return info };
        let frame = screen.frame();
        let visible = screen.visibleFrame();
        let top_inset = (frame.origin.y + frame.size.height) - (visible.origin.y + visible.size.height);
        if top_inset > 0.0 {
            info.menubar_height = top_inset;
        }
        let insets = screen.safeAreaInsets();
        if insets.top > 0.0 {
            let left = screen.auxiliaryTopLeftArea();
            let right = screen.auxiliaryTopRightArea();
            info.notch_height = insets.top;
            info.notch_width = frame.size.width - left.size.width - right.size.width;
        }
        info
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::ScreenInfo;

    pub fn elevate(_win: &tauri::WebviewWindow) {}

    pub fn focus(win: &tauri::WebviewWindow) {
        let _ = win.set_focus();
    }

    pub fn screen_info() -> ScreenInfo {
        ScreenInfo {
            platform: if cfg!(windows) { "windows" } else { "linux" },
            notch_width: 0.0,
            notch_height: 0.0,
            menubar_height: 0.0,
        }
    }
}

#[cfg(test)]
mod catch_tests {
    use super::*;

    #[test]
    fn clicks_are_caught_a_little_before_the_edge() {
        let r = Rect { x: 100.0, y: 0.0, w: 200.0, h: 40.0 };
        assert!(!r.contains(90.0, 20.0));
        assert!(r.grown(CATCH_MARGIN).contains(90.0, 20.0));
        assert!(!r.grown(CATCH_MARGIN).contains(80.0, 20.0));
    }
}
