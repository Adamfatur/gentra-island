//! How long since the last keyboard or mouse input, system-wide. Care
//! reminders use it to tell real work from a computer left on: five quiet
//! minutes count as a break.

/// Seconds since the last input, or None where the system won't say.
#[tauri::command]
pub fn idle_secs() -> Option<u64> {
    platform::idle_secs()
}

#[cfg(target_os = "macos")]
mod platform {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
    }

    pub fn idle_secs() -> Option<u64> {
        // Combined session state, any input event.
        // SAFETY: a plain C call with constant arguments.
        let s = unsafe { CGEventSourceSecondsSinceLastEventType(0, u32::MAX) };
        s.is_finite().then(|| s.max(0.0) as u64)
    }
}

#[cfg(windows)]
mod platform {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    pub fn idle_secs() -> Option<u64> {
        let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
        // SAFETY: info is a valid, sized LASTINPUTINFO we own.
        if unsafe { GetLastInputInfo(&mut info) } == 0 {
            return None;
        }
        // Both tick counts wrap together every 49.7 days.
        let now = unsafe { GetTickCount() };
        Some(u64::from(now.wrapping_sub(info.dwTime)) / 1000)
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
mod platform {
    use zbus::blocking::Connection;

    /// GNOME answers through Mutter; KDE and others through the screensaver
    /// interface (in milliseconds there too). X11 without either says nothing.
    pub fn idle_secs() -> Option<u64> {
        let bus = Connection::session().ok()?;
        let mutter = bus
            .call_method(Some("org.gnome.Mutter.IdleMonitor"), "/org/gnome/Mutter/IdleMonitor/Core", Some("org.gnome.Mutter.IdleMonitor"), "GetIdletime", &())
            .ok()
            .and_then(|m| m.body().deserialize::<u64>().ok());
        if let Some(ms) = mutter {
            return Some(ms / 1000);
        }
        bus.call_method(Some("org.freedesktop.ScreenSaver"), "/org/freedesktop/ScreenSaver", Some("org.freedesktop.ScreenSaver"), "GetSessionIdleTime", &())
            .ok()
            .and_then(|m| m.body().deserialize::<u32>().ok())
            .map(|ms| u64::from(ms) / 1000)
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    fn reads_idle_time_on_this_mac() {
        let s = super::idle_secs().expect("macOS always reports idle time");
        assert!(s < 365 * 86_400, "{s}");
    }
}
