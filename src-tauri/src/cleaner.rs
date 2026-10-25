//! Safe storage cleaner. It only looks inside a short allow-list of folders
//! that apps regenerate on their own, and every path is re-checked right
//! before it is moved to the Trash.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

pub struct Category {
    pub id: &'static str,
    pub hint: &'static str,
    pub default_on: bool,
    pub items: Vec<PathBuf>,
    pub size: u64,
}

const DAY: u64 = 86_400;

/// The cleaner's rules differ per system; tests exercise all three anywhere.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Os {
    Mac,
    Windows,
    Linux,
}

impl Os {
    pub const CURRENT: Os = if cfg!(target_os = "macos") {
        Os::Mac
    } else if cfg!(windows) {
        Os::Windows
    } else {
        Os::Linux
    };
}

struct Rules {
    /// Folders the cleaner may empty (relative to home), never the folder itself.
    roots: &'static [&'static str],
    /// Never touched, whatever else matches. Checked before anything else.
    protected: &'static [&'static str],
    installer_ext: &'static [&'static str],
    /// Where people usually keep code; only these are searched for node_modules.
    project_roots: &'static [&'static str],
    /// Application data trees where a folder named node_modules is not a project's.
    app_data: &'static str,
}

fn rules(os: Os) -> Rules {
    match os {
        Os::Mac => Rules {
            roots: &["Library/Caches", "Library/Logs", "Library/Developer/Xcode/DerivedData", "Downloads"],
            protected: &[
                "Documents",
                "Desktop",
                "Pictures",
                "Movies",
                "Music",
                "Library/Mobile Documents",
                "Library/Application Support",
                "Library/Keychains",
            ],
            installer_ext: &["dmg", "pkg", "mpkg", "iso"],
            project_roots: &["Projects", "Developer", "Code", "code", "dev", "src", "Sites"],
            app_data: "Library",
        },
        Os::Windows => Rules {
            roots: &["AppData/Local/Temp", "AppData/Local/CrashDumps", "Downloads"],
            protected: &[
                "Documents",
                "Desktop",
                "Pictures",
                "Videos",
                "Music",
                "OneDrive",
                "AppData/Roaming",
                "AppData/Local/Microsoft",
            ],
            installer_ext: &["exe", "msi", "msix", "iso"],
            project_roots: &["source/repos", "Projects", "Code", "code", "dev", "src"],
            app_data: "AppData",
        },
        Os::Linux => Rules {
            roots: &[".cache", "Downloads"],
            protected: &["Documents", "Desktop", "Pictures", "Videos", "Music", ".config", ".ssh", ".gnupg", ".local/share/keyrings", ".mozilla"],
            installer_ext: &["deb", "rpm", "appimage", "iso"],
            project_roots: &["Projects", "Code", "code", "dev", "src", "workspace"],
            app_data: ".local",
        },
    }
}

/// True when `path` is something the cleaner may move to the Trash on `os`.
pub fn is_allowed_on(os: Os, path: &Path, home: &Path) -> bool {
    use std::path::Component;
    let r = rules(os);
    if path.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) {
        return false;
    }
    let Ok(rel) = path.strip_prefix(home) else { return false };
    if r.protected.iter().any(|p| rel.starts_with(p)) {
        return false;
    }
    if path.symlink_metadata().map(|m| m.file_type().is_symlink()).unwrap_or(false) {
        return false;
    }
    if rel.file_name().is_some_and(|n| n == "node_modules") && !rel.starts_with(r.app_data) {
        return true;
    }
    r.roots.iter().any(|root| {
        if !rel.starts_with(root) || rel == Path::new(root) {
            return false;
        }
        // Downloads hold people's files; only installers qualify there.
        *root != "Downloads" || has_ext(path, r.installer_ext)
    })
}

/// True when `path` is something the cleaner may move to the Trash here.
pub fn is_allowed(path: &Path, home: &Path) -> bool {
    is_allowed_on(Os::CURRENT, path, home)
}

fn has_ext(path: &Path, exts: &[&str]) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| exts.iter().any(|x| x.eq_ignore_ascii_case(e)))
}

fn older_than(path: &Path, days: u64, now: SystemTime) -> bool {
    path.symlink_metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| now.duration_since(t).ok())
        .is_some_and(|age| age.as_secs() > days * DAY)
}

/// Total size of a file or folder without following symlinks.
pub fn size_of(path: &Path) -> u64 {
    let mut total = 0;
    let mut stack = vec![path.to_path_buf()];
    while let Some(p) = stack.pop() {
        let Ok(meta) = p.symlink_metadata() else { continue };
        if meta.is_dir() {
            if let Ok(rd) = std::fs::read_dir(&p) {
                stack.extend(rd.flatten().map(|e| e.path()));
            }
        } else if meta.is_file() {
            total += meta.len();
        }
    }
    total
}

fn children(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir).map(|rd| rd.flatten().map(|e| e.path()).collect()).unwrap_or_default()
}

fn files_older_than(dir: &Path, days: u64, depth: usize, now: SystemTime, out: &mut Vec<PathBuf>) {
    for p in children(dir) {
        let Ok(meta) = p.symlink_metadata() else { continue };
        if meta.is_file() && older_than(&p, days, now) {
            out.push(p);
        } else if meta.is_dir() && depth > 0 {
            files_older_than(&p, days, depth - 1, now, out);
        }
    }
}

/// node_modules folders whose project has not changed in `days` days.
fn stale_node_modules(dir: &Path, depth: usize, days: u64, now: SystemTime, out: &mut Vec<PathBuf>) {
    for p in children(dir) {
        let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if name.starts_with('.') || !p.symlink_metadata().map(|m| m.is_dir()).unwrap_or(false) {
            continue;
        }
        if name == "node_modules" {
            let pkg = dir.join("package.json");
            if older_than(dir, days, now) && (!pkg.exists() || older_than(&pkg, days, now)) {
                out.push(p);
            }
        } else if depth > 0 {
            stale_node_modules(&p, depth - 1, days, now, out);
        }
    }
}

/// (id, path hint, on by default, items). The UI names categories in the user's language.
type Candidate = (&'static str, &'static str, bool, Vec<PathBuf>);

fn old_children(dir: &Path, days: u64, now: SystemTime) -> Vec<PathBuf> {
    children(dir).into_iter().filter(|p| older_than(p, days, now)).collect()
}

fn installers(home: &Path, os: Os, now: SystemTime) -> Vec<PathBuf> {
    let ext = rules(os).installer_ext;
    children(&home.join("Downloads"))
        .into_iter()
        .filter(|p| p.is_file() && has_ext(p, ext) && older_than(p, 7, now))
        .collect()
}

fn mac_candidates(home: &Path, running: &HashSet<String>, now: SystemTime) -> Vec<Candidate> {
    let mut cats = Vec::new();
    let caches = children(&home.join("Library/Caches"))
        .into_iter()
        .filter(|p| {
            let name = p.file_name().unwrap_or_default().to_string_lossy();
            !name.starts_with("com.apple.") && !running.contains(name.as_ref())
        })
        .collect();
    cats.push(("caches", "~/Library/Caches", true, caches));

    let mut logs = Vec::new();
    files_older_than(&home.join("Library/Logs"), 7, 3, now, &mut logs);
    cats.push(("logs", "~/Library/Logs", true, logs));

    if !running.contains("com.apple.dt.Xcode") {
        let derived = children(&home.join("Library/Developer/Xcode/DerivedData"));
        cats.push(("xcode", "~/Library/Developer/Xcode/DerivedData", true, derived));
    }
    cats.push(("installers", "~/Downloads", false, installers(home, Os::Mac, now)));
    cats
}

fn windows_candidates(home: &Path, now: SystemTime) -> Vec<Candidate> {
    vec![
        ("temp", "%LOCALAPPDATA%\\Temp", true, old_children(&home.join("AppData/Local/Temp"), 7, now)),
        ("crashdumps", "%LOCALAPPDATA%\\CrashDumps", true, children(&home.join("AppData/Local/CrashDumps"))),
        ("installers", "Downloads", false, installers(home, Os::Windows, now)),
    ]
}

fn linux_candidates(home: &Path, now: SystemTime) -> Vec<Candidate> {
    vec![
        // Apps that are running touch their cache; a day untouched means idle.
        ("caches", "~/.cache", true, old_children(&home.join(".cache"), 1, now)),
        ("installers", "~/Downloads", false, installers(home, Os::Linux, now)),
    ]
}

/// Scans `home` with `os`'s rules and returns the categories worth cleaning.
/// On macOS `running` holds bundle ids of running apps; their caches stay.
pub fn plan_on(os: Os, home: &Path, running: &HashSet<String>, now: SystemTime) -> Vec<Category> {
    let mut cats = match os {
        Os::Mac => mac_candidates(home, running, now),
        Os::Windows => windows_candidates(home, now),
        Os::Linux => linux_candidates(home, now),
    };
    let mut modules = Vec::new();
    for root in rules(os).project_roots {
        stale_node_modules(&home.join(root), 4, 90, now, &mut modules);
    }
    cats.push(("node_modules", "", false, modules));

    cats.into_iter()
        .filter_map(|(id, hint, default_on, items)| {
            let items: Vec<PathBuf> = items.into_iter().filter(|p| is_allowed_on(os, p, home)).collect();
            let size = items.iter().map(|p| size_of(p)).sum();
            (size > 0).then_some(Category { id, hint, default_on, items, size })
        })
        .collect()
}

pub fn plan(home: &Path, running: &HashSet<String>, now: SystemTime) -> Vec<Category> {
    plan_on(Os::CURRENT, home, running, now)
}

// ---------- commands ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryView {
    id: &'static str,
    hint: &'static str,
    default_on: bool,
    size: u64,
    count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    supported: bool,
    categories: Vec<CategoryView>,
    disk_total: u64,
    disk_available: u64,
}

#[derive(Serialize)]
pub struct RunResult {
    freed: u64,
    moved: usize,
    skipped: usize,
}

/// The last scan; `cleaner_run` only ever acts on paths from it.
static LAST: Mutex<Vec<Category>> = Mutex::new(Vec::new());

fn disk_for(path: &Path) -> (u64, u64) {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    disks
        .iter()
        .filter(|d| path.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .map(|d| (d.total_space(), d.available_space()))
        .unwrap_or((0, 0))
}

#[tauri::command]
pub async fn cleaner_scan(app: AppHandle) -> Result<ScanResult, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let (disk_total, disk_available) = disk_for(&home);
        if !platform::SUPPORTED {
            return ScanResult { supported: false, categories: vec![], disk_total, disk_available };
        }
        let cats = plan(&home, &platform::running_apps(), SystemTime::now());
        let categories = cats
            .iter()
            .map(|c| CategoryView { id: c.id, hint: c.hint, default_on: c.default_on, size: c.size, count: c.items.len() })
            .collect();
        *LAST.lock().unwrap() = cats;
        ScanResult { supported: true, categories, disk_total, disk_available }
    })
    .await
    .map_err(|e| e.to_string())
}

/// Moves everything in the chosen categories to the Trash. Each path is
/// checked against the allow-list again right before it moves.
#[tauri::command]
pub async fn cleaner_run(app: AppHandle, ids: Vec<String>) -> Result<RunResult, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let items: Vec<PathBuf> = LAST
            .lock()
            .unwrap()
            .iter()
            .filter(|c| ids.iter().any(|id| id == c.id))
            .flat_map(|c| c.items.clone())
            .collect();
        let total = items.len();
        let mut result = RunResult { freed: 0, moved: 0, skipped: 0 };
        for (n, path) in items.iter().enumerate() {
            if is_allowed(path, &home) && path.symlink_metadata().is_ok() {
                let size = size_of(path);
                if platform::trash(path) {
                    result.freed += size;
                    result.moved += 1;
                } else {
                    result.skipped += 1;
                }
            } else {
                result.skipped += 1;
            }
            let _ = app.emit("cleaner-progress", (n + 1, total));
        }
        LAST.lock().unwrap().clear();
        result
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
mod platform {
    use std::collections::HashSet;
    use std::path::Path;

    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSFileManager, NSString, NSURL};

    pub const SUPPORTED: bool = true;

    pub fn running_apps() -> HashSet<String> {
        NSWorkspace::sharedWorkspace()
            .runningApplications()
            .iter()
            .filter_map(|a| a.bundleIdentifier().map(|b| b.to_string()))
            .collect()
    }

    /// Finder's own "Move to Trash", so everything can be put back.
    pub fn trash(path: &Path) -> bool {
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        NSFileManager::defaultManager().trashItemAtURL_resultingItemURL_error(&url, None).is_ok()
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use std::collections::HashSet;
    use std::path::Path;

    pub const SUPPORTED: bool = true;

    /// Windows and Linux rules rely on file age rather than running apps.
    pub fn running_apps() -> HashSet<String> {
        HashSet::new()
    }

    /// The Recycle Bin on Windows, the freedesktop Trash on Linux.
    pub fn trash(path: &Path) -> bool {
        trash::delete(path).is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::time::Duration;

    const DAY: Duration = Duration::from_secs(super::DAY);

    struct Home(PathBuf);
    impl Drop for Home {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn home() -> Home {
        use std::sync::atomic::{AtomicU32, Ordering};
        static N: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!("dg-cleaner-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&dir).unwrap();
        Home(dir)
    }

    fn file(path: &Path, bytes: usize, age: Duration) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, vec![0u8; bytes]).unwrap();
        File::options().write(true).open(path).unwrap().set_modified(SystemTime::now() - age).unwrap();
    }

    fn age_dir(path: &Path, age: Duration) {
        File::open(path).unwrap().set_modified(SystemTime::now() - age).unwrap();
    }

    fn category<'a>(plan: &'a [Category], id: &str) -> Option<&'a Category> {
        plan.iter().find(|c| c.id == id)
    }

    fn names(c: &Category) -> Vec<String> {
        let mut v: Vec<String> = c.items.iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    }

    // ---------- is_allowed ----------

    #[test]
    fn allows_an_app_cache_folder() {
        let h = home();
        assert!(is_allowed_on(Os::Mac, &h.0.join("Library/Caches/com.example.app"), &h.0));
    }

    #[test]
    fn never_allows_personal_folders() {
        let h = home();
        for p in ["Documents/skripsi.docx", "Pictures/foto.jpg", "Desktop/x", "Library/Mobile Documents/iCloud"] {
            assert!(!is_allowed_on(Os::Mac, &h.0.join(p), &h.0), "{p}");
        }
    }

    #[test]
    fn never_allows_the_cache_root_itself() {
        let h = home();
        assert!(!is_allowed_on(Os::Mac, &h.0.join("Library/Caches"), &h.0));
    }

    #[test]
    fn rejects_paths_that_climb_out_with_dot_dot() {
        let h = home();
        assert!(!is_allowed_on(Os::Mac, &h.0.join("Library/Caches/../../Documents"), &h.0));
    }

    #[test]
    #[cfg(unix)]
    fn rejects_symlinks_even_inside_an_allowed_folder() {
        let h = home();
        fs::create_dir_all(h.0.join("Documents")).unwrap();
        fs::create_dir_all(h.0.join("Library/Caches")).unwrap();
        let link = h.0.join("Library/Caches/sneaky");
        std::os::unix::fs::symlink(h.0.join("Documents"), &link).unwrap();
        assert!(!is_allowed_on(Os::Mac, &link, &h.0));
    }

    #[test]
    fn allows_node_modules_only_by_name() {
        let h = home();
        assert!(is_allowed_on(Os::Mac, &h.0.join("Projects/web/node_modules"), &h.0));
        assert!(!is_allowed_on(Os::Mac, &h.0.join("Projects/web/src"), &h.0));
    }

    // ---------- plan ----------

    #[test]
    fn caches_skip_running_apps_and_apple_system_caches() {
        let h = home();
        file(&h.0.join("Library/Caches/com.example.app/data"), 1000, DAY);
        file(&h.0.join("Library/Caches/com.running.app/data"), 500, DAY);
        file(&h.0.join("Library/Caches/com.apple.Safari/data"), 500, DAY);
        let running = HashSet::from(["com.running.app".to_string()]);
        let p = plan_on(Os::Mac, &h.0, &running, SystemTime::now());
        let caches = category(&p, "caches").unwrap();
        assert_eq!(names(caches), ["com.example.app"]);
        assert_eq!(caches.size, 1000);
        assert!(caches.default_on);
    }

    #[test]
    fn logs_keep_the_last_seven_days() {
        let h = home();
        file(&h.0.join("Library/Logs/old.log"), 10, 10 * DAY);
        file(&h.0.join("Library/Logs/new.log"), 10, DAY);
        let p = plan_on(Os::Mac, &h.0, &HashSet::new(), SystemTime::now());
        assert_eq!(names(category(&p, "logs").unwrap()), ["old.log"]);
    }

    #[test]
    fn installers_are_old_dmg_and_pkg_files_and_off_by_default() {
        let h = home();
        file(&h.0.join("Downloads/old.dmg"), 10, 30 * DAY);
        file(&h.0.join("Downloads/new.pkg"), 10, DAY);
        file(&h.0.join("Downloads/laporan.pdf"), 10, 30 * DAY);
        let p = plan_on(Os::Mac, &h.0, &HashSet::new(), SystemTime::now());
        let inst = category(&p, "installers").unwrap();
        assert_eq!(names(inst), ["old.dmg"]);
        assert!(!inst.default_on);
    }

    #[test]
    fn node_modules_only_in_projects_untouched_for_ninety_days() {
        let h = home();
        file(&h.0.join("Projects/lama/node_modules/react/index.js"), 50, 200 * DAY);
        file(&h.0.join("Projects/lama/package.json"), 5, 200 * DAY);
        age_dir(&h.0.join("Projects/lama"), 200 * DAY);
        file(&h.0.join("Projects/baru/node_modules/react/index.js"), 50, DAY);
        file(&h.0.join("Projects/baru/package.json"), 5, DAY);
        let p = plan_on(Os::Mac, &h.0, &HashSet::new(), SystemTime::now());
        let nm = category(&p, "node_modules").unwrap();
        assert_eq!(nm.items, vec![h.0.join("Projects/lama/node_modules")]);
        assert_eq!(nm.size, 50);
    }

    #[test]
    fn derived_data_is_skipped_while_xcode_runs() {
        let h = home();
        file(&h.0.join("Library/Developer/Xcode/DerivedData/App-abc/x"), 10, DAY);
        let idle = plan_on(Os::Mac, &h.0, &HashSet::new(), SystemTime::now());
        assert!(category(&idle, "xcode").is_some());
        let busy = plan_on(Os::Mac, &h.0, &HashSet::from(["com.apple.dt.Xcode".to_string()]), SystemTime::now());
        assert!(category(&busy, "xcode").is_none());
    }

    #[test]
    fn empty_categories_are_left_out() {
        let h = home();
        assert!(plan_on(Os::Mac, &h.0, &HashSet::new(), SystemTime::now()).is_empty());
    }

    // ---------- Windows ----------

    #[test]
    fn windows_cleans_old_temp_files_and_crash_dumps() {
        let h = home();
        file(&h.0.join("AppData/Local/Temp/old.tmp"), 30, 10 * DAY);
        file(&h.0.join("AppData/Local/Temp/new.tmp"), 30, DAY);
        file(&h.0.join("AppData/Local/CrashDumps/app.dmp"), 40, DAY);
        let p = plan_on(Os::Windows, &h.0, &HashSet::new(), SystemTime::now());
        assert_eq!(names(category(&p, "temp").unwrap()), ["old.tmp"]);
        assert_eq!(names(category(&p, "crashdumps").unwrap()), ["app.dmp"]);
    }

    #[test]
    fn windows_installers_are_old_exe_and_msi_files() {
        let h = home();
        file(&h.0.join("Downloads/setup.exe"), 10, 30 * DAY);
        file(&h.0.join("Downloads/tool.msi"), 10, DAY);
        file(&h.0.join("Downloads/laporan.pdf"), 10, 30 * DAY);
        let p = plan_on(Os::Windows, &h.0, &HashSet::new(), SystemTime::now());
        assert_eq!(names(category(&p, "installers").unwrap()), ["setup.exe"]);
    }

    #[test]
    fn windows_never_touches_personal_or_roaming_folders() {
        let h = home();
        for p in ["Documents/x", "Desktop/x", "OneDrive/x", "AppData/Roaming/app", "Pictures/x"] {
            assert!(!is_allowed_on(Os::Windows, &h.0.join(p), &h.0), "{p}");
        }
        assert!(is_allowed_on(Os::Windows, &h.0.join("AppData/Local/Temp/x.tmp"), &h.0));
    }

    // ---------- Linux ----------

    #[test]
    fn linux_cleans_cache_folders_not_used_today() {
        let h = home();
        file(&h.0.join(".cache/pip/wheel"), 70, 3 * DAY);
        age_dir(&h.0.join(".cache/pip"), 3 * DAY);
        file(&h.0.join(".cache/active/data"), 70, 0 * DAY);
        let p = plan_on(Os::Linux, &h.0, &HashSet::new(), SystemTime::now());
        assert_eq!(names(category(&p, "caches").unwrap()), ["pip"]);
    }

    #[test]
    fn linux_installers_are_old_packages() {
        let h = home();
        file(&h.0.join("Downloads/app.deb"), 10, 30 * DAY);
        file(&h.0.join("Downloads/app.AppImage"), 10, 30 * DAY);
        file(&h.0.join("Downloads/foto.png"), 10, 30 * DAY);
        let p = plan_on(Os::Linux, &h.0, &HashSet::new(), SystemTime::now());
        assert_eq!(names(category(&p, "installers").unwrap()), ["app.AppImage", "app.deb"]);
    }

    #[test]
    fn linux_never_touches_config_or_keys() {
        let h = home();
        for p in [".config/app", ".ssh/id_ed25519", ".gnupg/x", ".local/share/keyrings/x", "Documents/x"] {
            assert!(!is_allowed_on(Os::Linux, &h.0.join(p), &h.0), "{p}");
        }
        assert!(is_allowed_on(Os::Linux, &h.0.join(".cache/pip"), &h.0));
    }

    // ---------- real machine (run with `cargo test -- --ignored`) ----------

    /// Scans the real home folder without touching anything and checks that
    /// every candidate sits inside the allow-list and outside protected folders.
    #[test]
    #[ignore]
    #[cfg(target_os = "macos")]
    fn real_home_scan_stays_inside_the_allow_list() {
        let home = PathBuf::from(std::env::var("HOME").unwrap());
        let started = std::time::Instant::now();
        let cats = plan(&home, &platform::running_apps(), SystemTime::now());
        let took = started.elapsed();
        for c in &cats {
            eprintln!("{:<14} {:>10} bytes  {:>5} items", c.id, c.size, c.items.len());
            for p in &c.items {
                assert!(is_allowed(p, &home), "not allowed: {}", p.display());
                let rel = p.strip_prefix(&home).unwrap();
                assert!(!rules(Os::Mac).protected.iter().any(|x| rel.starts_with(x)), "protected: {}", p.display());
            }
        }
        eprintln!("scan took {took:?}");
        assert!(took.as_secs() < 60, "scan too slow: {took:?}");
    }

    /// Moves one file this test creates to the Trash and checks it left.
    #[test]
    #[ignore]
    #[cfg(target_os = "macos")]
    fn trash_moves_a_file_out_of_its_folder() {
        let home = PathBuf::from(std::env::var("HOME").unwrap());
        let file = home.join(format!("Library/Caches/gentra-island-trash-test-{}.txt", std::process::id()));
        fs::write(&file, b"Gentra Island test file, safe to delete").unwrap();
        assert!(is_allowed(&file, &home));
        assert!(platform::trash(&file), "trash failed");
        assert!(!file.exists(), "file is still in place");
    }
}
