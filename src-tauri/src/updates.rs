//! One-click updates. Once a day the island downloads one small file from
//! the GitHub release page to see whether a newer version is out. Every
//! update is signed, and the app installs only what that signature checks
//! out for. Settings can turn the daily check off.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

static AUTO: AtomicBool = AtomicBool::new(true);

pub fn set_auto(on: bool) {
    AUTO.store(on, Ordering::Relaxed);
}

/// The update found by the last check, ready to install.
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub version: String,
}

#[derive(Serialize, Clone)]
pub struct Progress {
    pub done: u64,
    pub total: Option<u64>,
}

async fn check(app: &AppHandle) -> Result<Option<Found>, String> {
    // A call or music player the island changed is put back before the app quits to update.
    let updater = app
        .updater_builder()
        .on_before_exit(|| {
            crate::meeting::restore();
            crate::media::shutdown();
        })
        .build()
        .map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| {
        eprintln!("gentra-island: update check failed: {e}");
        "update_offline".to_string()
    })?;
    let found = update.as_ref().map(|u| Found { version: u.version.clone() });
    *app.state::<Pending>().0.lock().unwrap() = update;
    Ok(found)
}

pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        // Not during startup; the island has enough to do then.
        thread::sleep(Duration::from_secs(60));
        let mut last: Option<Instant> = None;
        loop {
            let due = last.is_none_or(|t| t.elapsed() >= Duration::from_secs(24 * 3600));
            if AUTO.load(Ordering::Relaxed) && due {
                last = Some(Instant::now());
                if let Ok(Some(found)) = tauri::async_runtime::block_on(check(&app)) {
                    let _ = app.emit("update-ready", found);
                }
            }
            thread::sleep(Duration::from_secs(3600));
        }
    });
}

#[tauri::command]
pub fn update_set_auto(on: bool) {
    set_auto(on);
}

/// Checks now, whatever the daily setting.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<Found>, String> {
    check(&app).await
}

/// Downloads and installs the update the last check found, then restarts.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    let update = app.state::<Pending>().0.lock().unwrap().clone().ok_or("update_none")?;
    let mut done = 0u64;
    update
        .download_and_install(
            |chunk, total| {
                done += chunk as u64;
                let _ = app.emit("update-progress", Progress { done, total });
            },
            || {},
        )
        .await
        .map_err(|e| {
            eprintln!("gentra-island: update failed: {e}");
            "update_failed".to_string()
        })?;
    crate::meeting::restore();
    crate::media::shutdown();
    app.restart();
}
