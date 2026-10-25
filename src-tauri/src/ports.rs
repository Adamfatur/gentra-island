//! Port watcher: local servers listening on TCP, with their process and folder.
//!
//! Each OS already ships a tool that maps ports to processes (`lsof`, `ss`,
//! `netstat`), so we ask it only while the Dev panel is open and parse the
//! output. Nothing runs in the background.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub port: u16,
    pub pid: u32,
    pub name: String,
    /// The folder the server was started from, with the home folder as `~`.
    pub dir: String,
    /// Seconds since the process started.
    pub age: u64,
}

/// `lsof -nP -iTCP -sTCP:LISTEN -Fpn`: `p<pid>` starts a process, `n<addr>:<port>` follows.
pub fn parse_lsof(out: &str) -> Vec<(u16, u32)> {
    let mut pid = None;
    let mut found = Vec::new();
    for line in out.lines() {
        if let Some(p) = line.strip_prefix('p') {
            pid = p.parse().ok();
        } else if let (Some(addr), Some(pid)) = (line.strip_prefix('n'), pid) {
            if let Some(port) = port_of(addr) {
                found.push((port, pid));
            }
        }
    }
    found
}

/// `ss -Hltnp`: `LISTEN 0 511 *:5173 *:* users:(("node",pid=812,fd=23))`.
pub fn parse_ss(out: &str) -> Vec<(u16, u32)> {
    out.lines()
        .filter_map(|line| {
            let cols: Vec<&str> = line.split_whitespace().collect();
            let port = port_of(cols.get(3)?)?;
            let pid = line.split("pid=").nth(1)?.split([',', ')']).next()?.parse().ok()?;
            Some((port, pid))
        })
        .collect()
}

/// `netstat -ano` (IPv4 and IPv6; `-p TCP` would hide `[::1]` servers):
/// `TCP 0.0.0.0:5173 0.0.0.0:0 LISTENING 812`.
pub fn parse_netstat(out: &str) -> Vec<(u16, u32)> {
    out.lines()
        .filter_map(|line| {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() < 5 || cols[0] != "TCP" || cols[3] != "LISTENING" {
                return None;
            }
            Some((port_of(cols[1])?, cols[4].parse().ok()?))
        })
        .collect()
}

/// The port after the last colon: `127.0.0.1:5173`, `[::1]:5173`, `*:5173`.
fn port_of(addr: &str) -> Option<u16> {
    addr.rsplit(':').next()?.parse().ok()
}

/// One entry per port (IPv4 and IPv6 sockets of the same server collapse),
/// skipping the system range below 1024.
pub fn dedupe(found: Vec<(u16, u32)>) -> Vec<(u16, u32)> {
    let mut by_port = BTreeMap::new();
    for (port, pid) in found {
        if port >= 1024 {
            by_port.entry(port).or_insert(pid);
        }
    }
    by_port.into_iter().collect()
}

/// Dev servers run from a project folder. System helpers (AirPlay, sharing,
/// Windows services) run from `/` or the Windows folder, so they are left out.
pub fn is_project_dir(dir: &Path) -> bool {
    let s = dir.to_string_lossy().to_lowercase().replace('\\', "/");
    !(s.is_empty() || s == "/" || s.starts_with("c:/windows"))
}

fn tilde(dir: &Path) -> String {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    match home.and_then(|h| dir.strip_prefix(h).ok().map(Path::to_path_buf)) {
        Some(rest) if rest.as_os_str().is_empty() => "~".into(),
        Some(rest) => format!("~/{}", rest.to_string_lossy().replace('\\', "/")),
        None => dir.to_string_lossy().into_owned(),
    }
}

fn listening() -> Vec<(u16, u32)> {
    let run = |cmd: &str, args: &[&str]| -> Option<String> {
        let mut c = Command::new(cmd);
        c.args(args);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW: no console flashing up every few seconds.
            c.creation_flags(0x0800_0000);
        }
        let out = c.output().ok()?;
        Some(String::from_utf8_lossy(&out.stdout).into_owned())
    };
    if cfg!(target_os = "macos") {
        run("lsof", &["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"]).map(|o| parse_lsof(&o))
    } else if cfg!(windows) {
        run("netstat", &["-ano"]).map(|o| parse_netstat(&o))
    } else {
        run("ss", &["-Hltnp"]).map(|o| parse_ss(&o))
    }
    .unwrap_or_default()
}

fn servers() -> Vec<Server> {
    let found = dedupe(listening());
    let pids: Vec<Pid> = found.iter().map(|&(_, pid)| Pid::from_u32(pid)).collect();
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&pids),
        true,
        ProcessRefreshKind::nothing().with_cwd(UpdateKind::Always).with_cmd(UpdateKind::Always),
    );
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    found
        .into_iter()
        .filter_map(|(port, pid)| {
            let p = sys.process(Pid::from_u32(pid))?;
            let dir = p.cwd().filter(|d| is_project_dir(d))?;
            Some(Server {
                port,
                pid,
                name: display_name(p),
                dir: tilde(dir),
                age: now.saturating_sub(p.start_time()),
            })
        })
        .collect()
}

/// "node" says little; "node vite" or "python3 -m http.server" says what it is.
fn display_name(p: &sysinfo::Process) -> String {
    let name = p.name().to_string_lossy().trim_end_matches(".exe").to_string();
    let script = p
        .cmd()
        .iter()
        .skip(1)
        .map(|a| a.to_string_lossy())
        .find(|a| !a.starts_with('-'))
        .and_then(|a| Path::new(a.as_ref()).file_name().map(|f| f.to_string_lossy().into_owned()));
    match script {
        Some(s) if ["node", "bun", "deno", "python", "python3", "ruby", "php"].contains(&name.to_lowercase().as_str()) => {
            format!("{} {s}", name.to_lowercase())
        }
        _ => name,
    }
}

#[tauri::command]
pub async fn ports_list() -> Vec<Server> {
    tauri::async_runtime::spawn_blocking(servers).await.unwrap_or_default()
}

/// Stops the server on `port`. The pid must still be the one listening there,
/// so a stale list can never stop an unrelated process that reused the pid.
#[tauri::command]
pub async fn port_stop(port: u16, pid: u32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !dedupe(listening()).contains(&(port, pid)) {
            return Err("port_gone".to_string());
        }
        let mut sys = System::new();
        sys.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
        let p = sys.process(Pid::from_u32(pid)).ok_or("port_gone")?;
        // A polite stop first, so dev servers can clean up; Windows has no SIGTERM.
        let stopped = p.kill_with(sysinfo::Signal::Term).unwrap_or_else(|| p.kill());
        if stopped {
            Ok(())
        } else {
            Err("stop_failed".to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Opens `http://localhost:<port>` in the default browser.
#[tauri::command]
pub fn port_open(port: u16) -> Result<(), String> {
    open_in_browser(&format!("http://localhost:{port}"))
}

/// Opens a web address in the default browser.
pub fn open_in_browser(url: &str) -> Result<(), String> {
    let mut c = if cfg!(target_os = "macos") {
        let mut c = Command::new("open");
        c.arg(url);
        c
    } else if cfg!(windows) {
        let mut c = Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", url]);
        c
    } else {
        let mut c = Command::new("xdg-open");
        c.arg(url);
        c
    };
    c.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_lsof_field_output() {
        let out = "p812\nf23\nn*:5173\nf24\nn[::1]:5173\np90\nf5\nn127.0.0.1:5432\n";
        assert_eq!(parse_lsof(out), vec![(5173, 812), (5173, 812), (5432, 90)]);
    }

    #[test]
    fn reads_ss_output() {
        let out = "LISTEN 0 511 *:5173 *:* users:((\"node\",pid=812,fd=23))\n\
                   LISTEN 0 128 127.0.0.1:631 0.0.0.0:*\n\
                   LISTEN 0 4096 [::1]:8080 [::]:* users:((\"python3\",pid=77,fd=3))\n";
        assert_eq!(parse_ss(out), vec![(5173, 812), (8080, 77)]);
    }

    #[test]
    fn reads_netstat_output() {
        let out = "\r\nActive Connections\r\n\r\n  Proto  Local Address  Foreign Address  State  PID\r\n\
                   TCP    0.0.0.0:5173   0.0.0.0:0   LISTENING   812\r\n\
                   TCP    10.0.0.2:5050  1.2.3.4:443 ESTABLISHED 77\r\n\
                   TCP    [::]:3000      [::]:0      LISTENING   90\r\n";
        assert_eq!(parse_netstat(out), vec![(5173, 812), (3000, 90)]);
    }

    #[test]
    fn reads_ipv6_rows_and_skips_udp() {
        let out = "  TCP    [::1]:5173     [::]:0      LISTENING   812\r\n\
                   UDP    0.0.0.0:5353   *:*                     44\r\n\
                   UDP    [::]:5353      *:*                     44\r\n";
        assert_eq!(parse_netstat(out), vec![(5173, 812)]);
    }

    #[test]
    fn one_entry_per_port_and_no_system_ports() {
        assert_eq!(dedupe(vec![(5173, 812), (5173, 812), (80, 1), (3000, 90)]), vec![(3000, 90), (5173, 812)]);
    }

    #[test]
    fn system_helpers_are_not_dev_servers() {
        assert!(!is_project_dir(Path::new("/")));
        assert!(!is_project_dir(Path::new("C:\\Windows\\System32")));
        assert!(is_project_dir(Path::new("/Users/adam/Projects/toko")));
        assert!(is_project_dir(Path::new("D:\\code\\app")));
    }
}

#[cfg(test)]
mod real_machine {
    /// Prints the servers on this machine. Run with `cargo test -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn lists_servers_here() {
        for s in super::servers() {
            println!("{s:?}");
        }
    }
}
