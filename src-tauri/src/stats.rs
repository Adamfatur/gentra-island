//! System stats sampled once per second and pushed to the island as `stats`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use sysinfo::{Networks, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub mem_used: u64,
    pub mem_total: u64,
    pub swap_used: u64,
    /// 0 = normal, 1 = warning, 2 = critical.
    pub pressure: u8,
    pub cpu: f32,
    pub net_rx: u64,
    pub net_tx: u64,
    pub top: Vec<Proc>,
}

#[derive(Serialize, Clone)]
pub struct Proc {
    pub name: String,
    pub mem: u64,
}

static LAST: Mutex<Option<Stats>> = Mutex::new(None);
/// True while the System panel is open; process scans only run then.
static DETAIL: AtomicBool = AtomicBool::new(false);
/// False when the user's mode switches the system monitor off: no sampling at all.
static ENABLED: AtomicBool = AtomicBool::new(true);

pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::Relaxed);
}

#[tauri::command]
pub fn set_stats_detail(on: bool) {
    DETAIL.store(on, Ordering::Relaxed);
}

#[tauri::command]
pub fn stats_now() -> Option<Stats> {
    LAST.lock().unwrap().clone()
}

pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        let mut sys = System::new();
        let mut nets = Networks::new_with_refreshed_list();
        let mut top: Vec<Proc> = Vec::new();
        let mut interval = Duration::from_secs(2);
        for tick in 0u64.. {
            if !ENABLED.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_secs(1));
                continue;
            }
            sys.refresh_memory();
            sys.refresh_cpu_usage();
            nets.refresh(true);
            let detail = DETAIL.load(Ordering::Relaxed);
            // Walking every process is the expensive part: only while the
            // System panel is open, and then every 2 s.
            if detail && tick % 2 == 0 {
                sys.refresh_processes(ProcessesToUpdate::All, true);
                top = top_apps(&sys);
            }
            // Bytes since the last refresh, turned into a per-second rate.
            let secs = interval.as_secs().max(1);
            let (rx, tx) = nets
                .iter()
                .fold((0, 0), |(r, t), (_, d)| (r + d.received() / secs, t + d.transmitted() / secs));
            let stats = Stats {
                mem_used: sys.used_memory(),
                mem_total: sys.total_memory(),
                swap_used: sys.used_swap(),
                pressure: pressure(sys.used_memory(), sys.total_memory()),
                cpu: sys.global_cpu_usage(),
                net_rx: rx,
                net_tx: tx,
                top: top.clone(),
            };
            let _ = app.emit("stats", &stats);
            *LAST.lock().unwrap() = Some(stats);
            // The compact island only needs a reading every 2 s; the open
            // System panel gets one every second.
            interval = Duration::from_secs(if detail { 1 } else { 2 });
            thread::sleep(interval);
        }
    });
}

/// Groups helper processes under their app ("Google Chrome Helper (Renderer)"
/// counts toward "Google Chrome") and returns the five heaviest.
fn top_apps(sys: &System) -> Vec<Proc> {
    let mut by_app: HashMap<String, u64> = HashMap::new();
    for p in sys.processes().values() {
        let name = p.name().to_string_lossy();
        let name = name.split(" Helper").next().unwrap_or(&name).trim_end_matches(".exe");
        *by_app.entry(name.to_string()).or_default() += p.memory();
    }
    let mut v: Vec<Proc> = by_app.into_iter().map(|(name, mem)| Proc { name, mem }).collect();
    v.sort_by(|a, b| b.mem.cmp(&a.mem));
    v.truncate(5);
    v
}

/// macOS reports real memory pressure; elsewhere fall back to the used ratio.
fn pressure(used: u64, total: u64) -> u8 {
    #[cfg(target_os = "macos")]
    {
        let mut level: libc::c_int = 0;
        let mut size = std::mem::size_of::<libc::c_int>();
        // SAFETY: valid name, out-pointer and size for an int sysctl.
        let rc = unsafe {
            libc::sysctlbyname(
                c"kern.memorystatus_vm_pressure_level".as_ptr(),
                &mut level as *mut _ as *mut libc::c_void,
                &mut size,
                std::ptr::null_mut(),
                0,
            )
        };
        if rc == 0 {
            return match level {
                4 => 2,
                2 => 1,
                _ => 0,
            };
        }
    }
    let ratio = used as f64 / total.max(1) as f64;
    if ratio > 0.92 {
        2
    } else if ratio > 0.8 {
        1
    } else {
        0
    }
}
