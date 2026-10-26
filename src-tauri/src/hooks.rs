//! Command alerts: a tiny shell hook tells the island when a long command ends.
//!
//! The app listens on a random port on 127.0.0.1. Each start writes
//! `<data>/hook/endpoint` ("port token") and the hook scripts; the scripts read
//! the endpoint when a command finishes and send it with curl. The listener
//! blocks in `accept`, so it costs nothing while no command finishes.

use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::fs;
use std::hash::{BuildHasher, Hasher};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::secret;

/// Commands that end when you leave them, not when work is done.
const INTERACTIVE: &[&str] = &[
    "vim", "nvim", "vi", "nano", "emacs", "micro", "hx", "ssh", "mosh", "less", "more", "man", "top", "htop", "btop",
    "tmux", "screen", "watch", "fzf", "lazygit", "claude", "irb", "psql", "mysql",
];

static ENABLED: AtomicBool = AtomicBool::new(false);
static STATE: Mutex<Option<Hook>> = Mutex::new(None);

struct Hook {
    dir: PathBuf,
    recent: Vec<Done>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Done {
    pub cmd: String,
    pub code: i32,
    pub secs: u64,
    /// Last folder of the working directory, enough to tell projects apart.
    pub place: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookInfo {
    /// One line per shell to paste into its config file.
    pub lines: Vec<(String, String)>,
    pub recent: Vec<Done>,
}

pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::Relaxed);
}

/// `POST /done` with the right token returns the form body.
pub fn parse_request(raw: &str, token: &str) -> Option<HashMap<String, String>> {
    let (head, body) = raw.split_once("\r\n\r\n")?;
    let mut lines = head.lines();
    let mut start = lines.next()?.split_whitespace();
    if start.next()? != "POST" || start.next()? != "/done" {
        return None;
    }
    let sent = lines
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.trim().eq_ignore_ascii_case("x-gate-token"))
        .map(|(_, v)| v.trim())?;
    if sent != token {
        return None;
    }
    Some(url::form_urlencoded::parse(body.as_bytes()).into_owned().collect())
}

/// Turns the hook's fields into an alert, or None for commands not worth one.
pub fn to_done(form: &HashMap<String, String>) -> Option<Done> {
    let cmd = form.get("cmd")?.trim();
    let first = cmd.split_whitespace().next()?;
    let first = Path::new(first).file_name()?.to_string_lossy();
    if INTERACTIVE.contains(&first.as_ref()) {
        return None;
    }
    let place = form
        .get("dir")
        .and_then(|d| Path::new(d.trim_end_matches(['/', '\\'])).file_name().map(|f| f.to_string_lossy().into_owned()))
        .unwrap_or_default();
    // Commands can carry tokens (`export KEY=…`); never show them in full.
    let cmd: String = secret::redact(cmd).chars().take(120).collect();
    Some(Done {
        cmd,
        code: form.get("code")?.trim().parse().ok()?,
        secs: form.get("secs")?.trim().parse().ok()?,
        place,
    })
}

pub fn scripts(dir: &Path) -> Vec<(&'static str, String)> {
    let d = dir.to_string_lossy();
    let skip = INTERACTIVE.join(" ");
    let skip_bar = INTERACTIVE.join("|");
    let skip_ps = INTERACTIVE.iter().map(|s| format!("'{s}'")).collect::<Vec<_>>().join(",");
    vec![
        (
            "hook.zsh",
            format!(
                r#"# Gentra Island: tells the island when a command that ran 10 seconds or more finishes.
zmodload zsh/datetime
typeset -g __gate_dir="{d}" __gate_start=0 __gate_cmd=""
__gate_preexec() {{ __gate_start=$EPOCHSECONDS; __gate_cmd=$1 }}
__gate_precmd() {{
  local code=$? secs port token
  (( __gate_start )) || return
  secs=$(( EPOCHSECONDS - __gate_start )); __gate_start=0
  (( secs >= 10 )) || return
  case ${{__gate_cmd%% *}} in {skip_bar}) return;; esac
  read -r port token < "$__gate_dir/endpoint" 2>/dev/null || return
  curl -s -m 2 -o /dev/null -H "X-Gate-Token: $token" --data-urlencode "cmd=$__gate_cmd" --data-urlencode "code=$code" --data-urlencode "secs=$secs" --data-urlencode "dir=$PWD" "http://127.0.0.1:$port/done" &!
}}
autoload -Uz add-zsh-hook
add-zsh-hook preexec __gate_preexec
add-zsh-hook precmd __gate_precmd
"#
            ),
        ),
        (
            "hook.bash",
            format!(
                r#"# Gentra Island: tells the island when a command that ran 10 seconds or more finishes.
__gate_dir="{d}"; __gate_start=0; __gate_cmd=""; __gate_skip=1
__gate_preexec() {{
  [[ $__gate_skip == 1 || -n $COMP_LINE ]] && return
  (( __gate_start )) && return
  __gate_start=$SECONDS; __gate_cmd=$BASH_COMMAND
}}
__gate_precmd() {{
  local code=$? secs port token
  __gate_skip=1
  (( __gate_start )) || return
  secs=$(( SECONDS - __gate_start )); __gate_start=0
  (( secs >= 10 )) || return
  case ${{__gate_cmd%% *}} in {skip_bar}) return;; esac
  read -r port token < "$__gate_dir/endpoint" 2>/dev/null || return
  (curl -s -m 2 -o /dev/null -H "X-Gate-Token: $token" --data-urlencode "cmd=$__gate_cmd" --data-urlencode "code=$code" --data-urlencode "secs=$secs" --data-urlencode "dir=$PWD" "http://127.0.0.1:$port/done" &)
}}
__gate_arm() {{ __gate_skip=0; }}
trap '__gate_preexec' DEBUG
PROMPT_COMMAND="__gate_precmd;${{PROMPT_COMMAND:+$PROMPT_COMMAND;}}__gate_arm"
"#
            ),
        ),
        (
            "hook.fish",
            format!(
                r#"# Gentra Island: tells the island when a command that ran 10 seconds or more finishes.
function __gate_done --on-event fish_postexec
    set -l code $status
    set -l secs (math --scale=0 $CMD_DURATION / 1000)
    test $secs -ge 10; or return
    set -l first (string split -f1 ' ' -- $argv[1])
    contains -- $first {skip}; and return
    read -l port token < "{d}/endpoint"; or return
    curl -s -m 2 -o /dev/null -H "X-Gate-Token: $token" --data-urlencode "cmd=$argv[1]" --data-urlencode "code=$code" --data-urlencode "secs=$secs" --data-urlencode "dir=$PWD" "http://127.0.0.1:$port/done" &
    disown 2>/dev/null
end
"#
            ),
        ),
        (
            "hook.ps1",
            format!(
                r#"# Gentra Island: tells the island when a command that ran 10 seconds or more finishes.
$global:__GateDir = "{d}"
$global:__GateLast = 0
$global:__GatePrompt = $function:prompt
function global:prompt {{
  $ok = $?; $code = $LASTEXITCODE
  $h = Get-History -Count 1
  if ($h -and $h.Id -ne $global:__GateLast) {{
    $global:__GateLast = $h.Id
    $secs = [int]($h.EndExecutionTime - $h.StartExecutionTime).TotalSeconds
    $first = ($h.CommandLine -split ' ')[0]
    if ($secs -ge 10 -and $first -notin @({skip_ps})) {{
      $e = (Get-Content (Join-Path $global:__GateDir 'endpoint') -ErrorAction SilentlyContinue) -split ' '
      if ($e.Count -eq 2) {{
        $exit = if ($ok) {{ 0 }} elseif ($code) {{ $code }} else {{ 1 }}
        $body = @{{ cmd = $h.CommandLine; code = $exit; secs = $secs; dir = (Get-Location).Path }}
        try {{ Invoke-RestMethod -Uri "http://127.0.0.1:$($e[0])/done" -Method Post -Headers @{{ 'X-Gate-Token' = $e[1] }} -Body $body -TimeoutSec 1 | Out-Null }} catch {{}}
      }}
    }}
  }}
  & $global:__GatePrompt
}}
"#
            ),
        ),
    ]
}

/// The line to paste into each shell's config.
fn source_lines(dir: &Path) -> Vec<(String, String)> {
    let p = |f: &str| dir.join(f).to_string_lossy().into_owned();
    vec![
        ("zsh".into(), format!("source \"{}\"", p("hook.zsh"))),
        ("bash".into(), format!("source \"{}\"", p("hook.bash"))),
        ("fish".into(), format!("source \"{}\"", p("hook.fish"))),
        ("powershell".into(), format!(". \"{}\"", p("hook.ps1"))),
    ]
}

fn token() -> String {
    // RandomState is seeded from the OS's random source on every call.
    let a = RandomState::new().build_hasher().finish();
    let b = RandomState::new().build_hasher().finish();
    format!("{a:016x}{b:016x}")
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let dir = app.path().app_data_dir()?.join("hook");
    fs::create_dir_all(&dir)?;
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    let token = token();
    for (name, body) in scripts(&dir).into_iter().chain(crate::agents::hook_scripts()) {
        fs::write(dir.join(name), body)?;
    }
    fs::write(dir.join("endpoint"), format!("{port} {token}\n"))?;
    crate::agents::set_hook_dir(&dir);
    *STATE.lock().unwrap() = Some(Hook { dir, recent: Vec::new() });

    let app = app.clone();
    thread::spawn(move || {
        // One thread per connection: a permission request waits for an
        // answer, and nothing else should wait behind it.
        for stream in listener.incoming().flatten() {
            let (app, token) = (app.clone(), token.clone());
            thread::spawn(move || serve(stream, &token, &app));
        }
    });
    Ok(())
}

fn serve(mut stream: TcpStream, token: &str, app: &AppHandle) {
    let Some(raw) = read_request(&mut stream) else { return };
    if let Some(ask) = crate::agents::parse_ask_request(&raw, token) {
        let body = crate::agents::ask(app, ask);
        let _ = stream.write_all(
            format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes(),
        );
        return;
    }
    let req = match crate::agents::parse_agent_request(&raw, token) {
        Some(e) => Some(Request::Agent(e)),
        None => parse_request(&raw, token).and_then(|f| to_done(&f)).map(Request::Done),
    };
    let status = if req.is_some() { "204 No Content" } else { "403 Forbidden" };
    let _ = stream.write_all(format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes());
    match req {
        Some(Request::Agent(e)) => crate::agents::deliver(app, e),
        Some(Request::Done(done)) if ENABLED.load(Ordering::Relaxed) => {
            if let Some(h) = STATE.lock().unwrap().as_mut() {
                h.recent.insert(0, done.clone());
                h.recent.truncate(8);
            }
            let _ = app.emit("command-done", done);
        }
        _ => {}
    }
}

enum Request {
    Done(Done),
    Agent(crate::agents::AgentEvent),
}

#[cfg(test)]
fn handle(mut stream: TcpStream, token: &str) -> Option<Request> {
    let raw = read_request(&mut stream)?;
    let req = crate::agents::parse_agent_request(&raw, token).map(Request::Agent);
    let _ = stream.write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    req
}

fn read_request(stream: &mut TcpStream) -> Option<String> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    // Agent hooks send the whole prompt; anything past this is cut off, and
    // the fields we use come before it.
    let mut buf = vec![0u8; 256 * 1024];
    let mut len = 0;
    // Read until the body is complete.
    while len < buf.len() {
        let n = stream.read(&mut buf[len..]).ok()?;
        if n == 0 {
            break;
        }
        len += n;
        let text = String::from_utf8_lossy(&buf[..len]);
        if let Some((head, body)) = text.split_once("\r\n\r\n") {
            let want = head
                .lines()
                .filter_map(|l| l.split_once(':'))
                .find(|(k, _)| k.trim().eq_ignore_ascii_case("content-length"))
                .and_then(|(_, v)| v.trim().parse::<usize>().ok())
                .unwrap_or(0);
            if body.len() >= want {
                break;
            }
        }
    }
    Some(String::from_utf8_lossy(&buf[..len]).into_owned())
}

#[tauri::command]
pub fn hook_info() -> Option<HookInfo> {
    let state = STATE.lock().unwrap();
    let h = state.as_ref()?;
    Some(HookInfo { lines: source_lines(&h.dir), recent: h.recent.clone() })
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "abc123";

    fn req(token: &str, body: &str) -> String {
        format!("POST /done HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Gate-Token: {token}\r\nContent-Length: {}\r\n\r\n{body}", body.len())
    }

    #[test]
    fn accepts_a_request_with_the_token() {
        let form = parse_request(&req(TOKEN, "cmd=pnpm+build&code=0&secs=42&dir=%2FUsers%2Fa%2Fshop"), TOKEN).unwrap();
        assert_eq!(form["cmd"], "pnpm build");
        assert_eq!(form["dir"], "/Users/a/shop");
    }

    #[test]
    fn rejects_a_wrong_or_missing_token() {
        assert!(parse_request(&req("nope", "cmd=x&code=0&secs=1"), TOKEN).is_none());
        assert!(parse_request("POST /done HTTP/1.1\r\n\r\ncmd=x", TOKEN).is_none());
        assert!(parse_request(&req(TOKEN, "").replace("POST", "GET"), TOKEN).is_none());
    }

    fn form(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn builds_an_alert_with_the_project_folder() {
        let d = to_done(&form(&[("cmd", "cargo test"), ("code", "101"), ("secs", "73"), ("dir", "/Users/a/shop/")])).unwrap();
        assert_eq!(d, Done { cmd: "cargo test".into(), code: 101, secs: 73, place: "shop".into() });
    }

    #[test]
    fn skips_editors_and_remote_sessions() {
        for cmd in ["vim notes.md", "ssh server", "/usr/bin/less log.txt"] {
            assert!(to_done(&form(&[("cmd", cmd), ("code", "0"), ("secs", "300")])).is_none(), "{cmd}");
        }
    }

    #[test]
    fn hides_secrets_typed_in_a_command() {
        let key = format!("sk-ant-api03-{}", "a".repeat(40));
        let d = to_done(&form(&[("cmd", &format!("export KEY={key} && deploy")), ("code", "0"), ("secs", "20")])).unwrap();
        assert!(!d.cmd.contains(&key), "{}", d.cmd);
    }

    #[test]
    fn scripts_point_at_the_hook_folder() {
        let dir = Path::new("/Users/a/Library/Application Support/gate/hook");
        for (name, body) in scripts(dir) {
            assert!(body.contains("/Users/a/Library/Application Support/gate/hook"), "{name}");
            assert!(body.contains("X-Gate-Token"), "{name}");
        }
    }
}

#[cfg(all(test, unix))]
mod agent_hook {
    use std::io::Write;
    use std::net::TcpListener;
    use std::process::{Command, Stdio};

    /// The real agent script, run by sh with curl, reaches the real request handler.
    #[test]
    fn agent_script_reaches_the_server() {
        let dir = std::env::temp_dir().join(format!("gentra-agent-hook-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::fs::write(dir.join("endpoint"), format!("{port} tok123\n")).unwrap();
        for (name, body) in crate::agents::hook_scripts() {
            std::fs::write(dir.join(name), body).unwrap();
        }
        let mut child = Command::new("/bin/sh")
            .arg(dir.join("agent-hook.sh"))
            .args(["claude", "notify"])
            .stdin(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(br#"{"session_id":"s9","cwd":"/Users/a/My Shop","message":"Claude needs your permission to use Bash"}"#)
            .unwrap();
        let (stream, _) = listener.accept().unwrap();
        let got = super::handle(stream, "tok123");
        assert!(child.wait().unwrap().success());
        let Some(super::Request::Agent(e)) = got else { panic!("no agent event") };
        assert_eq!(e.place, "My Shop");
        assert_eq!(e.session, "s9");
        assert_eq!(e.event, "notify");
        let _ = std::fs::remove_dir_all(dir);
    }
}

#[cfg(all(test, unix))]
mod agent_ask {
    use std::io::Write;
    use std::net::TcpListener;
    use std::process::{Command, Stdio};

    /// The real ask script sends the request and prints whatever the island answers.
    #[test]
    fn ask_script_prints_the_answer() {
        let dir = std::env::temp_dir().join(format!("gentra-agent-ask-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::fs::write(dir.join("endpoint"), format!("{port} tok9\n")).unwrap();
        for (name, body) in crate::agents::hook_scripts() {
            std::fs::write(dir.join(name), body).unwrap();
        }
        let mut child = Command::new("/bin/sh").arg(dir.join("agent-ask.sh")).arg("claude").stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        child.stdin.take().unwrap().write_all(br#"{"tool_name":"Bash","tool_input":{"command":"ls"},"cwd":"/x/y"}"#).unwrap();
        let (mut stream, _) = listener.accept().unwrap();
        let raw = super::read_request(&mut stream).unwrap();
        let req = crate::agents::parse_ask_request(&raw, "tok9").expect("a readable request");
        assert_eq!(req.summary, "ls");
        let body = crate::agents::answer_json(crate::agents::Answer::Allow);
        stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).unwrap();
        drop(stream);
        let out = child.wait_with_output().unwrap();
        assert_eq!(String::from_utf8_lossy(&out.stdout), body);
        let _ = std::fs::remove_dir_all(dir);
    }
}

#[cfg(test)]
mod real_machine {
    /// Writes the scripts to a temp folder and syntax-checks them with the shells
    /// installed here. Run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn scripts_parse_in_real_shells() {
        let dir = std::env::temp_dir().join("gate-hook-check");
        std::fs::create_dir_all(&dir).unwrap();
        for (name, body) in super::scripts(&dir) {
            std::fs::write(dir.join(name), body).unwrap();
        }
        for (shell, file) in [("zsh", "hook.zsh"), ("bash", "hook.bash"), ("fish", "hook.fish")] {
            let Ok(out) = std::process::Command::new(shell).arg("-n").arg(dir.join(file)).output() else { continue };
            assert!(out.status.success(), "{shell}: {}", String::from_utf8_lossy(&out.stderr));
            println!("{shell}: ok");
        }
    }
}
