//! AI agents: what Claude Code and Codex are doing, and how much they've used.
//!
//! - **Activity** comes from the agents' own hooks. Connecting adds one small
//!   script to their hook settings (a backup of the file is kept); the script
//!   forwards each event to the island over the same local, token-protected
//!   port as command alerts.
//! - **Usage** is read from the agents' local session logs: token counts per
//!   message for Claude Code, and token counts plus the rate limits Codex
//!   reports about itself. Nothing is sent anywhere, and no login or token of
//!   the agents is ever read.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

static ENABLED: AtomicBool = AtomicBool::new(false);
/// The hook folder, set once the local server is up.
static HOOK_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);
static LAST: Mutex<Option<Vec<AgentStatus>>> = Mutex::new(None);

const FIVE_HOURS: i64 = 5 * 3600 * 1000;
const WEEK: i64 = 7 * 86_400_000;
/// Marks our hook entries, so disconnecting removes exactly those.
const MARKER: &str = "gentra-agent-hook";

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Agent {
    Claude,
    Codex,
}

impl Agent {
    const ALL: [Agent; 2] = [Agent::Claude, Agent::Codex];

    fn id(self) -> &'static str {
        match self {
            Agent::Claude => "claude",
            Agent::Codex => "codex",
        }
    }

    fn from_id(id: &str) -> Option<Agent> {
        Agent::ALL.into_iter().find(|a| a.id() == id)
    }

    /// Hook events we listen to, and what each one means for the island.
    fn events(self) -> &'static [(&'static str, &'static str)] {
        match self {
            Agent::Claude => &[("UserPromptSubmit", "start"), ("Notification", "notify"), ("Stop", "stop")],
            Agent::Codex => &[("UserPromptSubmit", "start"), ("Stop", "stop")],
        }
    }

    fn home(self) -> Option<PathBuf> {
        let env = match self {
            Agent::Claude => "CLAUDE_CONFIG_DIR",
            Agent::Codex => "CODEX_HOME",
        };
        if let Some(dir) = std::env::var_os(env) {
            return Some(PathBuf::from(dir));
        }
        let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
        Some(PathBuf::from(home).join(match self {
            Agent::Claude => ".claude",
            Agent::Codex => ".codex",
        }))
    }

    fn settings_file(self) -> Option<PathBuf> {
        Some(self.home()?.join(match self {
            Agent::Claude => "settings.json",
            Agent::Codex => "hooks.json",
        }))
    }
}

pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::Relaxed);
}

pub fn set_hook_dir(dir: &Path) {
    *HOOK_DIR.lock().unwrap() = Some(dir.to_path_buf());
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/* ---------- events from the hooks ---------- */

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub agent: Agent,
    /// "start", "notify", or "stop".
    pub event: String,
    /// Last folder of the working directory: the project name.
    pub place: String,
    /// What the agent says it needs, for "notify".
    pub message: String,
    pub session: String,
}

/// `POST /agent?agent=claude&event=stop` with the token and the hook's JSON.
pub fn parse_agent_request(raw: &str, token: &str) -> Option<AgentEvent> {
    let (head, body) = raw.split_once("\r\n\r\n")?;
    let mut lines = head.lines();
    let mut start = lines.next()?.split_whitespace();
    if start.next()? != "POST" {
        return None;
    }
    let target = start.next()?;
    let (path, query) = target.split_once('?')?;
    if path != "/agent" {
        return None;
    }
    let sent = lines
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.trim().eq_ignore_ascii_case("x-gate-token"))
        .map(|(_, v)| v.trim())?;
    if sent != token {
        return None;
    }
    let q: HashMap<String, String> = url::form_urlencoded::parse(query.as_bytes()).into_owned().collect();
    let agent = Agent::from_id(q.get("agent")?)?;
    let event = q.get("event")?.clone();
    if !["start", "notify", "stop"].contains(&event.as_str()) {
        return None;
    }
    // A long prompt can arrive cut short; the fields we need come first or not at all.
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let text = |k: &str| match v.get(k).and_then(Value::as_str) {
        Some(s) => s.to_string(),
        None if v.is_null() => raw_field(body, k),
        None => String::new(),
    };
    // Either separator: the agent may run on Windows or in WSL.
    let place = text("cwd").trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().unwrap_or("").to_string();
    let message: String = crate::secret::redact(&text("message")).chars().take(160).collect();
    Some(AgentEvent { agent, event, place, message, session: text("session_id").chars().take(64).collect() })
}

/// A plain string field from JSON that was cut off before its end.
fn raw_field(body: &str, key: &str) -> String {
    let Some(i) = body.find(&format!("\"{key}\":\"")) else { return String::new() };
    let rest = &body[i + key.len() + 4..];
    let mut out = String::new();
    let mut chars = rest.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => return out,
            '\\' => match chars.next() {
                Some('n') => out.push('\n'),
                Some(c) => out.push(c),
                None => break,
            },
            c => out.push(c),
        }
    }
    String::new()
}

/// Called by the hook server for every agent request.
pub fn deliver(app: &AppHandle, e: AgentEvent) {
    if ENABLED.load(Ordering::Relaxed) {
        let _ = app.emit("agent-event", e);
    }
}

/* ---------- connecting the hooks ---------- */

/// Adds our hook to each event, once. Everything else in the file stays as it was.
pub fn merge_hooks(mut settings: Value, events: &[(&str, &str)], command: impl Fn(&str) -> (String, Option<String>)) -> Value {
    if !settings.is_object() {
        settings = json!({});
    }
    let hooks = settings.as_object_mut().unwrap().entry("hooks").or_insert_with(|| json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    let hooks = hooks.as_object_mut().unwrap();
    for (event, meaning) in events {
        let list = hooks.entry(event.to_string()).or_insert_with(|| json!([]));
        if !list.is_array() {
            *list = json!([]);
        }
        let list = list.as_array_mut().unwrap();
        let ours = list.iter().any(|g| g.to_string().contains(MARKER));
        if ours {
            continue;
        }
        let (cmd, windows) = command(meaning);
        let mut entry = json!({ "type": "command", "command": cmd, "timeout": 5 });
        if let Some(w) = windows {
            entry["commandWindows"] = json!(w);
        }
        list.push(json!({ "hooks": [entry] }));
    }
    settings
}

/// Removes only our hook entries, and any event list they leave empty.
pub fn unmerge_hooks(mut settings: Value) -> Value {
    let Some(hooks) = settings.get_mut("hooks").and_then(Value::as_object_mut) else { return settings };
    for list in hooks.values_mut() {
        if let Some(groups) = list.as_array_mut() {
            for g in groups.iter_mut() {
                if let Some(inner) = g.get_mut("hooks").and_then(Value::as_array_mut) {
                    inner.retain(|h| !h.to_string().contains(MARKER));
                }
            }
            groups.retain(|g| g.get("hooks").and_then(Value::as_array).is_none_or(|h| !h.is_empty()));
        }
    }
    hooks.retain(|_, list| list.as_array().is_none_or(|g| !g.is_empty()));
    let empty = hooks.is_empty();
    if empty {
        settings.as_object_mut().unwrap().remove("hooks");
    }
    settings
}

pub fn is_connected(settings: &Value) -> bool {
    settings.get("hooks").is_some_and(|h| h.to_string().contains(MARKER))
}

/// The scripts each hook runs: they forward the event and never block the agent.
pub fn hook_scripts() -> Vec<(&'static str, String)> {
    vec![
        (
            "agent-hook.sh",
            format!(
                "#!/bin/sh\n# {MARKER}: tells Gentra Island what Claude Code or Codex is doing. Never blocks the agent.\n\
                 dir=\"$(cd \"$(dirname \"$0\")\" && pwd)\"\n\
                 read -r port token < \"$dir/endpoint\" 2>/dev/null || exit 0\n\
                 curl -s -m 1 -o /dev/null -X POST -H \"X-Gate-Token: $token\" -H \"Content-Type: application/json\" --data-binary @- \"http://127.0.0.1:$port/agent?agent=$1&event=$2\" >/dev/null 2>&1\n\
                 exit 0\n"
            ),
        ),
        (
            "agent-hook.ps1",
            format!(
                "# {MARKER}: tells Gentra Island what Claude Code or Codex is doing. Never blocks the agent.\n\
                 param($agent, $event)\n\
                 $e = (Get-Content (Join-Path $PSScriptRoot 'endpoint') -ErrorAction SilentlyContinue) -split ' '\n\
                 if ($e.Count -eq 2) {{\n  $body = [Console]::In.ReadToEnd()\n  try {{ Invoke-RestMethod -Uri \"http://127.0.0.1:$($e[0])/agent?agent=$agent&event=$event\" -Method Post -Headers @{{ 'X-Gate-Token' = $e[1] }} -ContentType 'application/json' -Body $body -TimeoutSec 1 | Out-Null }} catch {{}}\n}}\n\
                 exit 0\n"
            ),
        ),
    ]
}

/// Codex reads `commandWindows`; Claude Code has no such key, so it gets the
/// command for the system it runs on.
fn hook_command(dir: &Path, agent: Agent, meaning: &str) -> (String, Option<String>) {
    let sh = dir.join("agent-hook.sh");
    let ps = dir.join("agent-hook.ps1");
    let unix = format!("/bin/sh '{}' {} {meaning} # {MARKER}", sh.display(), agent.id());
    let win = format!("powershell -NoProfile -ExecutionPolicy Bypass -File \"{}\" {} {meaning} # {MARKER}", ps.display(), agent.id());
    match (agent, cfg!(windows)) {
        (Agent::Codex, true) => (win.clone(), Some(win)),
        (Agent::Codex, false) => (unix, Some(win)),
        (Agent::Claude, true) => (win, None),
        (Agent::Claude, false) => (unix, None),
    }
}

fn read_settings(path: &Path) -> Result<Value, String> {
    match fs::read_to_string(path) {
        Ok(s) if s.trim().is_empty() => Ok(json!({})),
        Ok(s) => serde_json::from_str(&s).map_err(|_| "settings_unreadable".to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(_) => Err("settings_unreadable".to_string()),
    }
}

fn write_settings(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())? + "\n";
    // Write next to it first, then swap, so a crash never leaves a half file.
    let tmp = path.with_extension("json.gentra-tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agents_connect(agent: String) -> Result<(), String> {
    let agent = Agent::from_id(&agent).ok_or("bad_action")?;
    let dir = HOOK_DIR.lock().unwrap().clone().ok_or("hooks_unavailable")?;
    let path = agent.settings_file().ok_or("agent_missing")?;
    let current = read_settings(&path)?;
    if path.exists() {
        // One backup per connect, next to the original.
        let stamp = now_ms() / 1000;
        let backup = path.with_file_name(format!("{}.gentra-backup-{stamp}", path.file_name().unwrap().to_string_lossy()));
        fs::copy(&path, backup).map_err(|e| e.to_string())?;
    }
    let merged = merge_hooks(current, agent.events(), |m| hook_command(&dir, agent, m));
    write_settings(&path, &merged)
}

#[tauri::command]
pub fn agents_disconnect(agent: String) -> Result<(), String> {
    let agent = Agent::from_id(&agent).ok_or("bad_action")?;
    let path = agent.settings_file().ok_or("agent_missing")?;
    if !path.exists() {
        return Ok(());
    }
    let current = read_settings(&path)?;
    write_settings(&path, &unmerge_hooks(current))
}

/* ---------- usage from the logs ---------- */

/// One Claude Code reply: when, which message (for de-duplicating streamed
/// copies), and its tokens (input, output, and cache writes; cache reads are
/// left out because they are cheap and would dwarf the rest).
pub fn claude_line(line: &str) -> Option<(i64, String, u64)> {
    // Most lines are prompts and tool output; skip them without parsing.
    if !line.contains("\"output_tokens\"") {
        return None;
    }
    let v: Value = serde_json::from_str(line).ok()?;
    if v.get("type")?.as_str()? != "assistant" {
        return None;
    }
    let msg = v.get("message")?;
    let usage = msg.get("usage")?;
    let n = |k: &str| usage.get(k).and_then(Value::as_u64).unwrap_or(0);
    let tokens = n("input_tokens") + n("output_tokens") + n("cache_creation_input_tokens");
    let id = format!("{}:{}", msg.get("id").and_then(Value::as_str).unwrap_or(""), v.get("requestId").and_then(Value::as_str).unwrap_or(""));
    let ts = chrono_ms(v.get("timestamp")?.as_str()?)?;
    Some((ts, id, tokens))
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Limit {
    pub used_percent: f64,
    pub window_minutes: u64,
    /// Unix ms when it resets, when known.
    pub resets_at: Option<i64>,
}

#[derive(Debug, PartialEq)]
pub enum CodexLine {
    Tokens(i64, u64),
    Limits(i64, Option<Limit>, Option<Limit>),
}

/// Codex writes `token_count` events with the turn's tokens and, in recent
/// versions, its own rate-limit percentages for the 5-hour and weekly windows.
pub fn codex_line(line: &str) -> Vec<CodexLine> {
    if !line.contains("token_count") {
        return Vec::new();
    }
    let Ok(v) = serde_json::from_str::<Value>(line) else { return Vec::new() };
    let Some(p) = v.get("payload") else { return Vec::new() };
    if p.get("type").and_then(Value::as_str) != Some("token_count") {
        return Vec::new();
    }
    let ts = v.get("timestamp").and_then(Value::as_str).and_then(chrono_ms).unwrap_or(0);
    let mut out = Vec::new();
    if let Some(last) = p.pointer("/info/last_token_usage") {
        let t = last.get("total_tokens").and_then(Value::as_u64).unwrap_or_else(|| {
            let n = |k: &str| last.get(k).and_then(Value::as_u64).unwrap_or(0);
            n("input_tokens") + n("output_tokens")
        });
        out.push(CodexLine::Tokens(ts, t));
    }
    if let Some(rl) = p.get("rate_limits") {
        let limit = |k: &str| -> Option<Limit> {
            let l = rl.get(k)?;
            let used = l.get("used_percent")?.as_f64()?;
            let resets_at = l
                .get("resets_at")
                .and_then(Value::as_i64)
                .map(|s| s * 1000)
                .or_else(|| l.get("resets_in_seconds").and_then(Value::as_i64).map(|s| ts + s * 1000));
            Some(Limit { used_percent: used, window_minutes: l.get("window_minutes").and_then(Value::as_u64).unwrap_or(0), resets_at })
        };
        out.push(CodexLine::Limits(ts, limit("primary"), limit("secondary")));
    }
    out
}

/// "2026-10-26T09:14:03.120Z" to Unix ms.
fn chrono_ms(s: &str) -> Option<i64> {
    let s = s.trim_end_matches('Z');
    let (date, time) = s.split_once('T')?;
    let mut d = date.split('-').map(|x| x.parse::<i64>());
    let (y, mo, da) = (d.next()?.ok()?, d.next()?.ok()?, d.next()?.ok()?);
    let time = time.split(['+']).next()?;
    let mut t = time.split(':');
    let (h, mi) = (t.next()?.parse::<i64>().ok()?, t.next()?.parse::<i64>().ok()?);
    let sec: f64 = t.next().unwrap_or("0").parse().ok()?;
    // Days from civil, Howard Hinnant's algorithm.
    let (y2, m2) = if mo <= 2 { (y - 1, mo + 9) } else { (y, mo - 3) };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * m2 + 2) / 5 + da - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 86_400 + h * 3600 + mi * 60) as f64 * 1000.0 + sec * 1000.0) as i64)
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    /// Tokens in the current 5-hour window, if one is running.
    pub window_tokens: u64,
    pub window_start: Option<i64>,
    pub window_end: Option<i64>,
    pub today_tokens: u64,
    pub week_tokens: u64,
    pub last_active: Option<i64>,
    /// Rate limits the agent reports itself (Codex): 5-hour and weekly.
    pub primary: Option<Limit>,
    pub secondary: Option<Limit>,
}

/// Splits activity into 5-hour windows the way subscription limits count them:
/// a window starts at the hour of the first message after the last one ended.
pub fn summarize(entries: &[(i64, u64)], now: i64, today_start: i64) -> Usage {
    let mut sorted: Vec<(i64, u64)> = entries.iter().copied().filter(|(t, _)| now - t <= WEEK).collect();
    sorted.sort_by_key(|e| e.0);
    let mut u = Usage::default();
    let mut block: Option<(i64, u64)> = None;
    for &(t, n) in &sorted {
        u.week_tokens += n;
        if t >= today_start {
            u.today_tokens += n;
        }
        block = match block {
            Some((start, sum)) if t < start + FIVE_HOURS => Some((start, sum + n)),
            _ => Some((t - t.rem_euclid(3_600_000), n)),
        };
        u.last_active = Some(t);
    }
    if let Some((start, sum)) = block {
        if now < start + FIVE_HOURS {
            u.window_tokens = sum;
            u.window_start = Some(start);
            u.window_end = Some(start + FIVE_HOURS);
        }
    }
    u
}

/// Reads only what was appended to each log since last time, a line at a
/// time: a week of Claude Code logs can run to gigabytes.
#[derive(Default)]
struct Tail {
    offsets: HashMap<PathBuf, u64>,
}

impl Tail {
    fn each_new_line(&mut self, path: &Path, mut f: impl FnMut(&str)) {
        let Ok(mut file) = fs::File::open(path) else { return };
        let len = file.metadata().map(|m| m.len()).unwrap_or(0);
        let mut from = *self.offsets.get(path).unwrap_or(&0);
        if len < from {
            from = 0; // rewritten
        }
        if len == from || file.seek(SeekFrom::Start(from)).is_err() {
            return;
        }
        let mut reader = BufReader::with_capacity(256 * 1024, file);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                // A half-written last line waits for next time.
                Ok(n) if n > 0 && line.ends_with('\n') => {
                    from += n as u64;
                    f(&line);
                }
                _ => break,
            }
        }
        self.offsets.insert(path.to_path_buf(), from);
    }
}

/// Log files changed in the last week, newest first, under `dir` (two levels for
/// Claude's projects, four for Codex's dated sessions).
fn recent_logs(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    let cutoff = SystemTime::now() - Duration::from_millis(WEEK as u64);
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() && depth > 0 {
            recent_logs(&p, depth - 1, out);
        } else if p.extension().is_some_and(|x| x == "jsonl") && e.metadata().and_then(|m| m.modified()).is_ok_and(|m| m >= cutoff) {
            out.push(p);
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub agent: Agent,
    /// The agent's folder exists on this computer.
    pub installed: bool,
    pub connected: bool,
    pub usage: Usage,
}

#[tauri::command]
pub fn agents_status() -> Vec<AgentStatus> {
    let last = LAST.lock().unwrap().clone().unwrap_or_default();
    // Usage comes from the last scan; connected is read fresh, so the button
    // changes the moment Connect or Disconnect is done.
    Agent::ALL
        .into_iter()
        .map(|a| status_of(a, last.iter().find(|s| s.agent == a).map(|s| s.usage.clone()).unwrap_or_default()))
        .collect()
}

fn status_of(agent: Agent, usage: Usage) -> AgentStatus {
    let installed = agent.home().is_some_and(|h| h.is_dir());
    let connected = agent.settings_file().and_then(|p| read_settings(&p).ok()).is_some_and(|v| is_connected(&v));
    AgentStatus { agent, installed, connected, usage }
}

/// The UI's local time zone, in minutes east of UTC; "today" starts at local midnight.
static UTC_OFFSET_MIN: AtomicI64 = AtomicI64::new(0);

#[tauri::command]
pub fn agents_set_offset(minutes: i64) {
    UTC_OFFSET_MIN.store(minutes.clamp(-14 * 60, 14 * 60), Ordering::Relaxed);
}

fn local_midnight(now: i64) -> i64 {
    let offset = UTC_OFFSET_MIN.load(Ordering::Relaxed) * 60_000;
    let local = now + offset;
    local - local.rem_euclid(86_400_000) - offset
}

/// Everything read from the logs so far; each scan adds only what's new.
#[derive(Default)]
struct Reader {
    tail: Tail,
    claude: Vec<(i64, u64)>,
    seen: HashSet<String>,
    codex: Vec<(i64, u64)>,
    limits: (i64, Option<Limit>, Option<Limit>),
}

impl Reader {
    fn scan(&mut self, now: i64) -> Vec<AgentStatus> {
        let Reader { tail, claude, seen, codex, limits } = self;
        if let Some(home) = Agent::Claude.home() {
            let mut files = Vec::new();
            recent_logs(&home.join("projects"), 1, &mut files);
            for f in files {
                tail.each_new_line(&f, |line| {
                    if let Some((t, id, n)) = claude_line(line) {
                        // Streaming writes the same reply more than once.
                        if now - t <= WEEK && seen.insert(id) {
                            claude.push((t, n));
                        }
                    }
                });
            }
        }
        if let Some(home) = Agent::Codex.home() {
            let mut files = Vec::new();
            recent_logs(&home.join("sessions"), 3, &mut files);
            for f in files {
                tail.each_new_line(&f, |line| {
                    for c in codex_line(line) {
                        match c {
                            CodexLine::Tokens(t, n) if now - t <= WEEK => codex.push((t, n)),
                            CodexLine::Limits(t, p, s) if t >= limits.0 => *limits = (t, p, s),
                            _ => {}
                        }
                    }
                });
            }
        }
        claude.retain(|(t, _)| now - t <= WEEK);
        codex.retain(|(t, _)| now - t <= WEEK);
        let midnight = local_midnight(now);
        let mut cx = summarize(codex, now, midnight);
        // Reported limits that have already reset are stale.
        let fresh = |l: &Option<Limit>| l.clone().filter(|l| l.resets_at.is_none_or(|r| r > now));
        cx.primary = fresh(&limits.1);
        cx.secondary = fresh(&limits.2);
        vec![status_of(Agent::Claude, summarize(claude, now, midnight)), status_of(Agent::Codex, cx)]
    }
}

pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        let mut reader = Reader::default();
        loop {
            if !ENABLED.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_secs(2));
                continue;
            }
            let statuses = reader.scan(now_ms());
            let mut last = LAST.lock().unwrap();
            if last.as_ref() != Some(&statuses) {
                let _ = app.emit("agent-usage", &statuses);
                *last = Some(statuses);
            }
            drop(last);
            // Activity arrives instantly through the hooks; usage can trail by a few seconds.
            thread::sleep(Duration::from_secs(15));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "abc123";

    fn req(target: &str, token: &str, body: &str) -> String {
        format!("POST {target} HTTP/1.1\r\nX-Gate-Token: {token}\r\nContent-Length: {}\r\n\r\n{body}", body.len())
    }

    #[test]
    fn reads_an_agent_event() {
        let e = parse_agent_request(
            &req("/agent?agent=claude&event=notify", TOKEN, r#"{"session_id":"s1","cwd":"/Users/a/gentra-island","message":"Claude needs your permission to use Bash"}"#),
            TOKEN,
        )
        .unwrap();
        assert_eq!(e.agent, Agent::Claude);
        assert_eq!(e.event, "notify");
        assert_eq!(e.place, "gentra-island");
        assert_eq!(e.message, "Claude needs your permission to use Bash");
    }

    #[test]
    fn rejects_wrong_token_unknown_agent_or_event() {
        assert!(parse_agent_request(&req("/agent?agent=claude&event=stop", "nope", "{}"), TOKEN).is_none());
        assert!(parse_agent_request(&req("/agent?agent=cursor&event=stop", TOKEN, "{}"), TOKEN).is_none());
        assert!(parse_agent_request(&req("/agent?agent=codex&event=rm", TOKEN, "{}"), TOKEN).is_none());
    }

    #[test]
    fn a_cut_off_body_still_counts_as_an_event() {
        let e = parse_agent_request(&req("/agent?agent=codex&event=start", TOKEN, r#"{"session_id":"s1","cwd":"C:\\code\\shop","prompt":"very lo"#), TOKEN).unwrap();
        assert_eq!(e.event, "start");
        assert_eq!(e.session, "s1");
        assert_eq!(e.place, "shop");
    }

    fn cmd(m: &str) -> (String, Option<String>) {
        (format!("/bin/sh hook.sh claude {m} # {MARKER}"), None)
    }

    #[test]
    fn connecting_keeps_everything_else_in_the_file() {
        let before = json!({
            "theme": "dark",
            "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "say done" } ] } ] }
        });
        let after = merge_hooks(before, Agent::Claude.events(), cmd);
        assert_eq!(after["theme"], "dark");
        assert_eq!(after["hooks"]["Stop"].as_array().unwrap().len(), 2);
        assert!(after["hooks"]["Stop"][0].to_string().contains("say done"));
        assert!(after["hooks"]["UserPromptSubmit"].to_string().contains(MARKER));
        assert!(after["hooks"]["Notification"].to_string().contains(MARKER));
    }

    #[test]
    fn only_codex_gets_a_windows_command() {
        let dir = Path::new("/hook");
        assert!(hook_command(dir, Agent::Claude, "stop").1.is_none());
        assert!(hook_command(dir, Agent::Codex, "stop").1.is_some());
        let claude = merge_hooks(json!({}), Agent::Claude.events(), |m| hook_command(dir, Agent::Claude, m));
        assert!(!claude.to_string().contains("commandWindows"));
    }

    #[test]
    fn connecting_twice_adds_nothing_more() {
        let once = merge_hooks(json!({}), Agent::Codex.events(), cmd);
        let twice = merge_hooks(once.clone(), Agent::Codex.events(), cmd);
        assert_eq!(once, twice);
    }

    #[test]
    fn disconnecting_removes_only_ours() {
        let before = json!({
            "theme": "dark",
            "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "say done" } ] } ] }
        });
        let after = unmerge_hooks(merge_hooks(before.clone(), Agent::Claude.events(), cmd));
        assert_eq!(after, before);
        assert!(!is_connected(&after));
        // With nothing of the user's own, the hooks key goes away entirely.
        assert_eq!(unmerge_hooks(merge_hooks(json!({ "theme": "x" }), Agent::Claude.events(), cmd)), json!({ "theme": "x" }));
    }

    #[test]
    fn reads_claude_usage_lines() {
        let line = r#"{"type":"assistant","requestId":"r1","timestamp":"2026-10-26T09:00:00.000Z","message":{"id":"m1","model":"claude-opus-5-5","usage":{"input_tokens":10,"output_tokens":200,"cache_creation_input_tokens":1000,"cache_read_input_tokens":50000}}}"#;
        let (t, id, n) = claude_line(line).unwrap();
        assert_eq!(n, 1210);
        assert_eq!(id, "m1:r1");
        assert_eq!(t, chrono_ms("2026-10-26T09:00:00Z").unwrap());
        assert!(claude_line(r#"{"type":"user","message":{}}"#).is_none());
    }

    #[test]
    fn tail_reads_only_new_complete_lines() {
        use std::io::Write;
        let path = std::env::temp_dir().join(format!("gentra-tail-{}.jsonl", std::process::id()));
        fs::write(&path, "a\nb\nhalf").unwrap();
        let mut tail = Tail::default();
        let mut got = Vec::new();
        tail.each_new_line(&path, |l| got.push(l.trim().to_string()));
        assert_eq!(got, ["a", "b"]);
        fs::OpenOptions::new().append(true).open(&path).unwrap().write_all(b"-done\nc\n").unwrap();
        got.clear();
        tail.each_new_line(&path, |l| got.push(l.trim().to_string()));
        assert_eq!(got, ["half-done", "c"]);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn parses_iso_timestamps() {
        assert_eq!(chrono_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(chrono_ms("2026-10-26T09:14:03.5Z"), Some(1_793_006_043_500));
    }

    #[test]
    fn reads_codex_tokens_and_limits() {
        let line = r#"{"timestamp":"2026-10-26T09:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":100,"output_tokens":20,"total_tokens":120}},"rate_limits":{"primary":{"used_percent":42.5,"window_minutes":300,"resets_in_seconds":3600},"secondary":{"used_percent":12.0,"window_minutes":10080,"resets_at":1793000000}}}}"#;
        let out = codex_line(line);
        let t = chrono_ms("2026-10-26T09:00:00Z").unwrap();
        assert_eq!(out[0], CodexLine::Tokens(t, 120));
        let CodexLine::Limits(_, Some(p), Some(s)) = &out[1] else { panic!("{out:?}") };
        assert_eq!(p.used_percent, 42.5);
        assert_eq!(p.resets_at, Some(t + 3_600_000));
        assert_eq!(s.resets_at, Some(1_793_000_000_000));
        assert!(codex_line(r#"{"type":"response_item","payload":{"type":"message"}}"#).is_empty());
    }

    #[test]
    fn five_hour_windows_start_on_the_hour_of_the_first_message() {
        let h = 3_600_000;
        let base = 1_000 * h; // on an hour boundary
        // 09:20 and 11:00 share a window (09:00 to 14:00); 15:30 starts a new one.
        let entries = [(base + h / 3, 100), (base + 2 * h, 50), (base + 6 * h + h / 2, 7)];
        let u = summarize(&entries, base + 7 * h, base);
        assert_eq!(u.window_tokens, 7);
        assert_eq!(u.window_start, Some(base + 6 * h));
        assert_eq!(u.window_end, Some(base + 11 * h));
        assert_eq!(u.week_tokens, 157);
        // After the window ends, nothing is running.
        let later = summarize(&entries, base + 12 * h, base);
        assert_eq!(later.window_tokens, 0);
        assert_eq!(later.window_end, None);
    }
}

#[cfg(test)]
mod real_machine {
    /// Scans this computer's real logs twice and prints what it found and how
    /// long it took. Run with `cargo test real_logs -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_logs() {
        let mut r = super::Reader::default();
        let t = std::time::Instant::now();
        let first = r.scan(super::now_ms());
        println!("first scan {:?}: {first:#?}", t.elapsed());
        let t = std::time::Instant::now();
        r.scan(super::now_ms());
        println!("next scan {:?}", t.elapsed());
    }
}
