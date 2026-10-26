//! Gentra Island, created by Adam Faturahman.
//! SPDX-License-Identifier: GPL-3.0-or-later

mod cleaner;
mod agents;
mod idle;
mod screenshots;
mod downloads;
mod clipboard;
mod hooks;
mod media;
mod meeting;
mod ports;
mod secret;
mod shelf;
mod stats;
mod window;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// The user's mode decides which background work runs at all.
#[tauri::command]
fn set_features(sistem: bool, clip: bool, perintah: bool, meeting: bool, musik: bool, ai: bool, tangkap: bool, unduh: bool) {
    screenshots::set_enabled(tangkap);
    downloads::set_enabled(unduh);
    agents::set_enabled(ai);
    media::set_enabled(musik);
    stats::set_enabled(sistem);
    clipboard::set_enabled(clip);
    hooks::set_enabled(perintah);
    meeting::set_enabled(meeting);
}

/// The app was called Dynamic Gate before; bring its clipboard history,
/// shelf, and settings over the first time Gentra Island starts.
fn move_old_data(app: &tauri::AppHandle) {
    let Ok(new) = app.path().app_data_dir() else { return };
    let Some(old) = new.parent().map(|p| p.join("org.dynamicgate.app")) else { return };
    if old.is_dir() && !new.exists() {
        if let Err(e) = std::fs::rename(&old, &new) {
            eprintln!("gentra-island: could not move old data: {e}");
        }
    }
}

/// The author's tip jar. Fixed here, so the page can't be pointed elsewhere.
const SUPPORT_URL: &str = "https://paypal.me/adamfaturahman";

#[tauri::command]
fn open_support() -> Result<(), String> {
    ports::open_in_browser(SUPPORT_URL)
}

/// Opens the Privacy Policy or the Terms of Use on GitHub. Fixed addresses only.
#[tauri::command]
fn open_doc(kind: String) -> Result<(), String> {
    let url = match kind.as_str() {
        "privacy" => "https://github.com/Adamfatur/gentra-island/blob/main/PRIVACY.md",
        "terms" => "https://github.com/Adamfatur/gentra-island/blob/main/TERMS.md",
        _ => return Err("bad_action".into()),
    };
    ports::open_in_browser(url)
}

/// Opens the system page where a permission is granted, so the guide can
/// say "click this" instead of "find it yourself". Only known pages.
#[tauri::command]
fn open_privacy_settings(kind: String) -> Result<(), String> {
    if kind == "automation" {
        // Only macOS asks before one app may ask another (here: a browser for its tabs).
        return if cfg!(target_os = "macos") {
            ports::open_in_browser("x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")
        } else {
            Err("bad_action".into())
        };
    }
    if kind != "camera" {
        return Err("bad_action".into());
    }
    if cfg!(target_os = "macos") {
        ports::open_in_browser("x-apple.systempreferences:com.apple.preference.security?Privacy_Camera")
    } else if cfg!(windows) {
        ports::open_in_browser("ms-settings:privacy-webcam")
    } else {
        // GNOME 42+ has a Camera page; other desktops differ, so the guide words it generally.
        std::process::Command::new("gnome-control-center")
            .arg("camera")
            .spawn()
            .map(|_| ())
            .map_err(|_| "no_settings_app".to_string())
    }
}

/// Tray menu items, kept so their labels follow the UI language.
struct TrayItems {
    about: MenuItem<tauri::Wry>,
    open: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

#[tauri::command]
fn set_tray_labels(items: tauri::State<TrayItems>, about: String, open: String, quit: String) {
    let _ = items.about.set_text(about);
    let _ = items.open.set_text(open);
    let _ = items.quit.set_text(quit);
}

/// ⌥⌘ on macOS, Ctrl+Alt elsewhere (Win+V is taken by Windows' own clipboard).
fn shortcut(code: Code) -> Shortcut {
    #[cfg(target_os = "macos")]
    let mods = Modifiers::ALT | Modifiers::SUPER;
    #[cfg(not(target_os = "macos"))]
    let mods = Modifiers::ALT | Modifiers::CONTROL;
    Shortcut::new(Some(mods), code)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_drag::init())
        // A LaunchAgent on macOS, the Run key on Windows, a .desktop file on Linux.
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, pressed, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    // ⌥⌘V opens the clipboard; ⌥⌘G opens or closes the island.
                    let tab = if pressed.id() == shortcut(Code::KeyV).id() { "clipboard" } else { "toggle" };
                    window::summon(app, tab);
                })
                .build(),
        )
        .manage(window::HitState::default())
        .invoke_handler(tauri::generate_handler![
            window::set_hit_rect,
            window::screen_info,
            stats::stats_now,
            stats::set_stats_detail,
            set_features,
            set_tray_labels,
            open_support,
            open_doc,
            open_privacy_settings,
            cleaner::cleaner_scan,
            cleaner::cleaner_run,
            hooks::hook_info,
            agents::agents_status,
            agents::agents_connect,
            agents::agents_disconnect,
            agents::agents_set_offset,
            agents::agents_answer,
            agents::agents_set_ask,
            idle::idle_secs,
            screenshots::shot_text,
            screenshots::shot_copy,
            downloads::download_open,
            downloads::download_reveal,
            media::media_now,
            media::media_control,
            media::media_youtube_art,
            meeting::mic_now,
            meeting::mic_set_muted,
            ports::ports_list,
            ports::port_stop,
            ports::port_open,
            shelf::shelf_list,
            shelf::shelf_add,
            shelf::shelf_remove,
            shelf::shelf_clear,
            shelf::shelf_reveal,
            shelf::shelf_drag_icon,
            shelf::shelf_airdrop,
            clipboard::clip_list,
            clipboard::clip_copy,
            clipboard::clip_write,
            clipboard::clip_pin,
            clipboard::clip_delete,
            clipboard::clip_clear,
        ])
        .setup(|app| {
            // No Dock icon: the island lives in the menu bar area only.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let win = app
                .get_webview_window(window::LABEL)
                .expect("island window is declared in tauri.conf.json");
            move_old_data(app.handle());
            window::setup(&win)?;
            window::spawn_hit_tester(app.handle().clone());
            stats::spawn(app.handle().clone());
            clipboard::init(app.handle())?;
            shelf::init(app.handle())?;
            // Command alerts are optional; the island still starts without them.
            if let Err(e) = hooks::init(app.handle()) {
                eprintln!("gentra-island: command alerts unavailable: {e}");
            }
            meeting::spawn(app.handle().clone());
            media::spawn(app.handle().clone());
            agents::spawn(app.handle().clone());
            screenshots::spawn(app.handle().clone());
            downloads::spawn(app.handle().clone());

            for code in [Code::KeyV, Code::KeyG] {
                if let Err(e) = app.global_shortcut().register(shortcut(code)) {
                    eprintln!("gentra-island: could not register shortcut {code:?}: {e}");
                }
            }

            // English until the UI sends labels in the user's language.
            let open = MenuItem::with_id(app, "open", "Open Gentra Island", true, Some("Alt+Super+G"))?;
            let quit = MenuItem::with_id(app, "quit", "Quit Gentra Island", true, None::<&str>)?;
            // Version and credit, shown but not clickable.
            let version = app.package_info().version.to_string();
            let about = MenuItem::with_id(app, "about", format!("Gentra Island {version}, made by Adam Faturahman"), false, None::<&str>)?;
            let line = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&about, &line, &open, &quit])?;
            app.manage(TrayItems { about: about.clone(), open: open.clone(), quit: quit.clone() });
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("Gentra Island")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "open" => window::summon(app, "home"),
                        "quit" => app.exit(0),
                        _ => {}
                    }
                });
            // macOS: a one-color G that the menu bar tints for light and dark.
            #[cfg(target_os = "macos")]
            {
                tray = tray.icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray@2x.png"))?).icon_as_template(true);
            }
            #[cfg(not(target_os = "macos"))]
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            win.show()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Gentra Island")
        .run(|_, event| {
            if let tauri::RunEvent::Exit = event {
                meeting::restore();
                media::shutdown();
            }
        });
}
