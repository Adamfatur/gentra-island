// Runs the real island UI in a plain browser with the Tauri backend mocked.
// Open http://localhost:1420/preview.html while `pnpm dev` is running.
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { ClipItem } from "./clipboard";
import type { ShelfItem } from "./shelf";
import type { Stats } from "./system";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

/** A made-up album cover: soft color fields and a sun, nothing copyrighted. */
function cover(a: string, b: string, c: string) {
  const s = 360;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const x = cv.getContext("2d")!;
  const g = x.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  x.fillStyle = c;
  x.beginPath();
  x.arc(s * 0.62, s * 0.42, s * 0.2, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = "rgba(10, 8, 30, 0.55)";
  x.beginPath();
  x.moveTo(0, s * 0.78);
  x.bezierCurveTo(s * 0.3, s * 0.6, s * 0.6, s * 0.95, s, s * 0.7);
  x.lineTo(s, s);
  x.lineTo(0, s);
  x.fill();
  return cv.toDataURL("image/jpeg", 0.9);
}

function shot(a: string, b: string) {
  const c = document.createElement("canvas");
  c.width = 360;
  c.height = 220;
  const x = c.getContext("2d")!;
  const g = x.createLinearGradient(0, 0, 360, 220);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  x.fillStyle = g;
  x.fillRect(0, 0, 360, 220);
  x.fillStyle = "rgba(10,10,14,.9)";
  x.fillRect(30, 26, 300, 170);
  for (let i = 0; i < 5; i++) {
    x.fillStyle = `rgba(255,255,255,${0.12 + (i % 2) * 0.08})`;
    x.fillRect(120, 60 + i * 20, 80 + ((i * 41) % 110), 8);
  }
  return c.toDataURL("image/jpeg");
}

const now = Date.now();
let clips: ClipItem[] = [
  { id: 7, kind: "image", thumb: shot("#ff7a45", "#ff3d7f"), size: [2880, 1800], app: "Tangkapan Layar", created: now - 120_000, pinned: false },
  { id: 6, kind: "text", text: "Rapat sprint dipindah ke Kamis jam 14.00, tolong konfirmasi ya.", app: "Slack", created: now - 300_000, pinned: false },
  { id: 5, kind: "link", text: "https://github.com/Adamfatur/gentra-island", app: "Arc", created: now - 720_000, pinned: false },
  { id: 4, kind: "color", text: "#FF6A3D", app: "Figma", created: now - 1_200_000, pinned: false },
  { id: 3, kind: "code", text: 'git commit -m "feat: spring-driven island"', app: "Terminal", created: now - 1_900_000, pinned: true },
  { id: 2, kind: "image", thumb: shot("#2bc5b4", "#2a6cff"), size: [1200, 800], app: "Finder", created: now - 3_700_000, pinned: false },
  { id: 1, kind: "text", text: "Jl. Braga No. 21, Sumur Bandung, Kota Bandung 40111", app: "Maps", created: now - 7_300_000, pinned: false },
];

let shelfItems: ShelfItem[] = [];

let ram = 11.2 * GB;
let cpu = 22;
let pressure: Stats["pressure"] = 0;
const stats = (): Stats => ({
  memUsed: ram,
  memTotal: 16 * GB,
  swapUsed: 512 * MB,
  pressure,
  cpu,
  netRx: (1 + Math.random() * 6) * MB,
  netTx: (120 + Math.random() * 500) * 1024,
  top: [
    { name: "Google Chrome", mem: 3.1 * GB },
    { name: "Figma", mem: 1.8 * GB },
    { name: "Xcode", mem: 1.6 * GB },
    { name: "Slack", mem: 820 * MB },
    { name: "Gentra Island", mem: 48 * MB },
  ],
});

let servers = [
  { port: 5173, pid: 812, name: "node vite", dir: "~/Desain/Dynamic Gate", age: 2520 },
  { port: 3000, pid: 90, name: "next-server", dir: "~/Projects/toko-online", age: 7300 },
  { port: 5432, pid: 77, name: "postgres", dir: "/opt/homebrew/var/postgresql@16", age: 90000 },
];
let track: { title: string; artist: string; album: string; app: string; playing: boolean; duration: number; elapsed: number; at: number; art: string | null } | null = null;
const doneList: { cmd: string; code: number; secs: number; place: string }[] = [];
let mic = { inUse: false, app: null as string | null, muted: false as boolean | null, since: 0 };

mockWindows("island");
mockIPC(
  (cmd, args) => {
    const a = args as Record<string, unknown>;
    switch (cmd) {
      case "screen_info":
        return { platform: "macos", notchWidth: 185, notchHeight: 32, menubarHeight: 32 };
      case "stats_now":
        return stats();
      case "clip_list":
        return clips;
      case "clip_pin": {
        const it = clips.find((c) => c.id === a.id);
        if (it) it.pinned = !it.pinned;
        return it?.pinned ?? false;
      }
      case "clip_delete":
        clips = clips.filter((c) => c.id !== a.id);
        return null;
      case "clip_clear":
        clips = clips.filter((c) => c.pinned);
        return null;
      case "clip_write":
        return null;
      case "clip_copy": {
        const i = clips.findIndex((c) => c.id === a.id);
        if (i >= 0) clips.unshift({ ...clips.splice(i, 1)[0], created: Date.now() });
        return null;
      }
      case "shelf_list":
        return shelfItems;
      case "shelf_add": {
        const paths = (a.paths as string[]).filter((p) => !shelfItems.some((s) => s.path === p));
        shelfItems = [...paths.map((p) => ({ path: p, name: p.split("/").pop()!, size: 1_200_000, isDir: false })), ...shelfItems];
        return shelfItems;
      }
      case "shelf_remove":
        shelfItems = shelfItems.filter((s) => s.path !== a.path);
        return shelfItems;
      case "shelf_clear":
        shelfItems = [];
        return null;
      case "cleaner_scan":
        return {
          supported: true,
          diskTotal: 494 * GB,
          diskAvailable: 63 * GB,
          categories: [
            { id: "xcode", hint: "~/Library/Developer/Xcode/DerivedData", defaultOn: true, size: 8.7 * GB, count: 14 },
            { id: "caches", hint: "~/Library/Caches", defaultOn: true, size: 3.4 * GB, count: 62 },
            { id: "logs", hint: "~/Library/Logs", defaultOn: true, size: 640 * MB, count: 211 },
            { id: "installers", hint: "~/Downloads", defaultOn: false, size: 1.3 * GB, count: 4 },
          ],
        };
      case "cleaner_run":
        return { freed: 12.7 * GB, moved: 287, skipped: 2 };
      case "ports_list":
        return servers;
      case "port_stop":
        servers = servers.filter((x) => x.port !== a.port);
        return null;
      case "hook_info":
        return {
          lines: [
            ["zsh", 'source "/Users/kamu/Library/Application Support/app.gentra.island/hook/hook.zsh"'],
            ["bash", 'source "/Users/kamu/Library/Application Support/app.gentra.island/hook/hook.bash"'],
            ["fish", 'source "/Users/kamu/Library/Application Support/app.gentra.island/hook/hook.fish"'],
            ["powershell", '. "C:\\Users\\kamu\\AppData\\Roaming\\app.gentra.island\\hook\\hook.ps1"'],
          ],
          recent: doneList,
        };
      case "shot_text":
        return "Rapat evaluasi Jumat jam 14.00\nRuang 3, bawa laporan Q3";
      case "download_open":
      case "download_reveal":
        return null;
      case "shot_copy":
        return null;
      case "agents_answer":
        setTimeout(() => void emit("agent-ask-done", a.id), 50);
        return null;
      case "agents_set_ask":
        return null;
      case "idle_secs":
        return 3;
      case "agents_status":
        return agentStatus();
      case "agents_connect":
      case "agents_disconnect":
        connected[a.agent as "claude" | "codex"] = cmd === "agents_connect";
        return null;
      case "media_now":
        return track;
      case "media_control":
        if (track && a.action === "toggle") track = { ...track, playing: !track.playing, elapsed: track.elapsed + (Date.now() - track.at) / 1000, at: Date.now() };
        if (track && a.action === "seek") track = { ...track, elapsed: a.position as number, at: Date.now() };
        if (track) void emit("media", track);
        return null;
      case "mic_now":
        return mic;
      case "mic_set_muted":
        mic = { ...mic, muted: a.muted as boolean };
        return null;
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);

// ?scene=home|media|… sets up a ready-made state for screenshots and the demo
// video (see scripts/capture.mjs). ?shot hides the harness; ?theme=light and
// ?lang=id switch theme and language.
const params = new URLSearchParams(location.search);
const scene = params.get("scene");
if (scene || params.has("shot")) {
  document.body.classList.add("shot");
  localStorage.setItem("gentra:guide", "1");
  localStorage.setItem("gentra:lang", params.get("lang") ?? "en");
  localStorage.setItem("gentra:settings", JSON.stringify({ theme: params.get("theme") ?? "dark", accent: null }));
  localStorage.removeItem("gentra:reminders");
  if (scene === "reminder-due") {
    localStorage.setItem(
      "gentra:reminders",
      JSON.stringify([{ id: "d1", text: "Send the Q3 report to Dita before the 3 pm review", at: Date.now() - 30_000, created: Date.now() - 3_600_000, app: "Slack", fired: false }]),
    );
  }
  localStorage.setItem(
    "gentra:mode",
    JSON.stringify({ mode: "kustom", base: "harian", on: ["sistem", "clip", "pintar", "rak", "fokus", "bersih", "port", "perintah", "meeting", "kamera", "musik", "ingat", "ai", "jaga", "tangkap", "unduh"] }),
  );
}

// The island lives inside a 760×520 box, the same size as the real window.
const html = await (await fetch("/index.html")).text();
const doc = new DOMParser().parseFromString(html, "text/html");
const shell = doc.getElementById("shell")!;
document.getElementById("stagebox")!.replaceChildren(shell);
await import("./main");

setInterval(() => {
  ram = Math.min(15.4 * GB, Math.max(9.5 * GB, ram + (Math.random() - 0.5) * 0.3 * GB));
  cpu = Math.max(4, Math.min(95, cpu + (Math.random() - 0.5) * 16));
  void emit("stats", stats());
}, 1000);

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sampleJwt = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ sub: "user_42", email: "raka@contoh.id", role: "admin", exp: Math.floor(Date.now() / 1000) + 5400 })}.c2lnbmF0dXJl`;
const copy = (item: Omit<ClipItem, "id" | "created" | "pinned">) => {
  clips.unshift({ id: n++, created: Date.now(), pinned: false, ...item });
  void emit("clips-changed", null);
};

const connected = { claude: false, codex: false };
const H = 3_600_000;
const windowStart = Math.floor(Date.now() / H) * H - H;
const agentStatus = () => [
  {
    agent: "claude",
    installed: true,
    connected: connected.claude,
    canAsk: connected.claude,
    usage: { windowTokens: 2_955_318, windowStart, windowEnd: windowStart + 5 * H, todayTokens: 3_129_806, weekTokens: 95_368_831, lastActive: Date.now(), primary: null, secondary: null },
  },
  {
    agent: "codex",
    installed: true,
    connected: connected.codex,
    canAsk: false,
    usage: {
      windowTokens: 412_000, windowStart, windowEnd: windowStart + 5 * H, todayTokens: 412_000, weekTokens: 1_840_000, lastActive: Date.now(),
      primary: { usedPercent: 42, windowMinutes: 300, resetsAt: windowStart + 5 * H },
      secondary: { usedPercent: 18, windowMinutes: 10080, resetsAt: Date.now() + 4 * 24 * H },
    },
  },
];
const agentEvent = (agent: string, event: string, message = "", place = "toko-online") =>
  void emit("agent-event", { agent, event, place, message, session: `${agent}-1` });

let n = 100;
const actions: Record<string, () => void> = {
  "Hover masuk": () => void emit("island-hover", true),
  "Hover keluar": () => void emit("island-hover", false),
  "Salin teks": () => {
    clips.unshift({ id: n++, kind: "text", text: "Tolong kirim invoice bulan Oktober sebelum Jumat ya 🙏", app: "WhatsApp", created: Date.now(), pinned: false });
    void emit("clips-changed", null);
  },
  "Salin screenshot": () => {
    clips.unshift({ id: n++, kind: "image", thumb: shot("#b18cff", "#5ac8fa"), size: [1440, 900], app: "Tangkapan Layar", created: Date.now(), pinned: false });
    void emit("clips-changed", null);
  },
  "Salin JWT": () => copy({ kind: "text", text: sampleJwt, app: "Postman" }),
  "Salin link pelacak": () =>
    copy({ kind: "link", text: "https://tokoku.id/produk/sepatu-lari?utm_source=instagram&utm_medium=story&fbclid=IwAR3xYz&warna=hitam", app: "Instagram" }),
  "Salin NIK": () => copy({ kind: "text", text: "Nama: Raka Pratama\nNIK: 3273012505900001", app: "Notes" }),
  "Salin kunci API": () =>
    copy({ kind: "text", text: "ANTHROPIC_API_KEY=sk-ant-••••••••7Qx2", secret: "anthropic", expires: Date.now() + 60_000, app: "Terminal" }),
  "Salin timestamp": () => copy({ kind: "text", text: String(Math.floor(Date.now() / 1000) - 7200), app: "Terminal" }),
  "Tema terang": () => {
    localStorage.setItem("gentra:settings", JSON.stringify({ theme: "light", accent: null }));
    location.reload();
  },
  "Tema gelap": () => {
    localStorage.setItem("gentra:settings", JSON.stringify({ theme: "dark", accent: null }));
    location.reload();
  },
  "Seret file masuk": () =>
    void emit("tauri://drag-drop", { paths: ["/Users/kamu/Desktop/Brief-Klien-Q4.pdf", "/Users/kamu/Desktop/hero-final@2x.png"], position: { x: 0, y: 0 } }),
  "Memori kritis": () => {
    pressure = 2;
    ram = 15.2 * GB;
    void emit("stats", stats());
    pressure = 0;
  },
  "Pintasan clipboard": () => void emit("open-tab", "clipboard"),
  "Salin jadwal": () => copy({ kind: "text", text: "Rapat evaluasi Jumat jam 14.00 di ruang 3, bawa laporan Q3 ya", app: "WhatsApp" }),
  "Build selesai": () => {
    const d = { cmd: "pnpm build", code: 0, secs: 42, place: "toko-online" };
    doneList.unshift(d);
    void emit("command-done", d);
  },
  "Tes gagal": () => {
    const d = { cmd: "cargo test --workspace", code: 101, secs: 185, place: "Dynamic Gate" };
    doneList.unshift(d);
    void emit("command-done", d);
  },
  "Musik diputar": () => {
    track = { title: "Kisah Klasik Untuk Masa Depan", artist: "Sheila on 7", album: "Kisah Klasik", app: "Spotify", playing: true, duration: 268, elapsed: 41, at: Date.now(), art: cover("#ff7a59", "#6a3df0", "#ffd166") };
    void emit("media", track);
  },
  "Lagu berikutnya": () => {
    track = { title: "Lathi", artist: "Weird Genius", album: "", app: "YouTube", playing: true, duration: 219, elapsed: 0, at: Date.now(), art: null };
    void emit("media", track);
  },
  "Musik berhenti": () => {
    track = null;
    void emit("media", null);
  },
  "Claude mulai": () => agentEvent("claude", "start"),
  "Claude butuh izin": () => agentEvent("claude", "notify", "Claude needs your permission to use Bash"),
  "Claude selesai": () => agentEvent("claude", "stop"),
  "Unduh berjalan": () => void emit("downloads", [{ name: "Gentra.Island_0.8.1_universal.dmg", bytes: 3_400_000, total: 6_850_000, speed: 1_200_000 }]),
  "Unduh selesai": () => {
    void emit("downloads", []);
    void emit("download-done", { path: "/Users/kamu/Downloads/Gentra.Island_0.8.1_universal.dmg", name: "Gentra.Island_0.8.1_universal.dmg", bytes: 6_850_000 });
  },
  "Screenshot baru": () =>
    void emit("screenshot", { path: "/Users/kamu/Desktop/Screenshot 2026-10-26 at 09.41.12.png", name: "Screenshot 2026-10-26 at 09.41.12.png", thumb: shot("#5ac8fa", "#b18cff"), size: [2940, 1912] }),
  "Claude minta izin": () =>
    void emit("agent-ask", { id: `ask-${n++}`, agent: "claude", place: "gentra-island", session: "claude-1", tool: "Bash", summary: "npm test -- --coverage && git push origin main" }),
  "Codex mulai": () => agentEvent("codex", "start", "", "gentra-island"),
  "Codex selesai": () => agentEvent("codex", "stop", "", "gentra-island"),
  "Codex 85%": () => {
    const st = agentStatus();
    st[1].usage.primary!.usedPercent = 85;
    void emit("agent-usage", st);
  },
  "Panggilan mulai": () => {
    mic = { inUse: true, app: "Zoom", muted: false, since: Math.floor(Date.now() / 1000) - 724 };
    void emit("mic", mic);
  },
  "Panggilan selesai": () => {
    // Like the OS, mute stays as it was when the call ends.
    mic = { inUse: false, app: null, muted: mic.muted, since: 0 };
    void emit("mic", mic);
  },
};
const bar = document.getElementById("harness")!;
for (const [label, fn] of Object.entries(actions)) {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = fn;
  bar.appendChild(b);
}

/* ---------- scenes for screenshots and the demo video ---------- */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const play = () => actions["Musik diputar"]();
const scenes: Record<string, () => Promise<void>> = {
  compact: async () => {
    play();
    await wait(3600);
  },
  home: async () => {
    play();
    agentEvent("claude", "start", "", "gentra-island");
    copy({ kind: "text", text: "Meeting moved to 3 pm, same link as last week.", app: "Slack" });
    actions["Seret file masuk"]();
    await wait(3400);
    void emit("open-tab", "home");
  },
  media: async () => {
    play();
    await wait(3400);
    void emit("open-tab", "media");
  },
  clipboard: async () => {
    actions["Salin screenshot"]();
    copy({ kind: "link", text: "https://shop.example.com/running-shoes?utm_source=newsletter&utm_medium=email&fbclid=IwAR3", app: "Mail" });
    copy({ kind: "text", text: sampleJwt, app: "Postman" });
    copy({ kind: "text", text: "Meeting moved to 3 pm, same link as last week.", app: "Slack" });
    await wait(3000);
    void emit("open-tab", "clipboard");
  },
  dev: async () => {
    actions["Build selesai"]();
    await wait(200);
    actions["Tes gagal"]();
    await wait(4200);
    void emit("open-tab", "dev");
  },
  calls: async () => {
    mic = { inUse: true, app: "Zoom", muted: false, since: Math.floor(Date.now() / 1000) - 1325 };
    void emit("mic", mic);
    await wait(3800);
    void emit("open-tab", "call");
  },
  system: async () => {
    await wait(2500);
    void emit("open-tab", "system");
  },
  settings: async () => {
    await wait(300);
    void emit("open-tab", "settings");
  },
  peek: async () => {
    await wait(300);
    actions["Build selesai"]();
  },
  "reminder-offer": async () => {
    await wait(300);
    actions["Salin jadwal"]();
    await wait(600);
  },
  "reminder-pick": async () => {
    actions["Salin jadwal"]();
    await wait(9000);
    void emit("open-tab", "clipboard");
    await wait(600);
    document.querySelector<HTMLElement>("#strip [data-remind]")?.click();
  },
  ai: async () => {
    connected.claude = true;
    agentEvent("claude", "start", "", "gentra-island");
    agentEvent("codex", "start", "", "toko-online");
    await wait(300);
    agentEvent("claude", "notify", "Claude needs your permission to use Bash", "gentra-island");
    await wait(10_600);
    void emit("open-tab", "ai");
  },
  "agent-peek": async () => {
    agentEvent("claude", "start", "", "gentra-island");
    await wait(300);
    agentEvent("claude", "notify", "Claude needs your permission to use Bash", "gentra-island");
  },
  "agent-ask": async () => {
    agentEvent("claude", "start", "", "gentra-island");
    await wait(300);
    actions["Claude minta izin"]();
  },
  screenshot: async () => {
    await wait(300);
    actions["Screenshot baru"]();
  },
  care: async () => {
    await wait(300);
    (window as unknown as { __care: (k: string, v?: number) => void }).__care("break", 0);
  },
  "care-water": async () => {
    await wait(300);
    (window as unknown as { __care: (k: string, v?: number) => void }).__care("water", 0);
  },
  "reminder-due": async () => {
    await wait(900);
  },
  // A short tour for the README video: small island, open, a few tabs, close, an alert.
  demo: async () => {
    copy({ kind: "text", text: "Meeting moved to 3 pm, same link as last week.", app: "Slack" });
    document.body.dataset.ready = "1";
    await wait(1200);
    play();
    await wait(3800);
    void emit("open-tab", "home");
    await wait(2600);
    void emit("open-tab", "media");
    await wait(2600);
    void emit("open-tab", "clipboard");
    await wait(2600);
    void emit("open-tab", "dev");
    await wait(2400);
    connected.claude = true;
    agentEvent("claude", "start", "", "gentra-island");
    void emit("open-tab", "ai");
    await wait(2800);
    void emit("open-tab", "toggle");
    await wait(2200);
    agentEvent("claude", "notify", "Claude needs your permission to use Bash", "gentra-island");
    await wait(3800);
    // A care reminder takes the peek's place.
    (window as unknown as { __care: (k: string, v?: number) => void }).__care("water", 0);
    await wait(4500);
    document.body.dataset.done = "1";
  },
};
if (scene === "demo") {
  await wait(400);
  await scenes.demo();
} else if (scene && scenes[scene]) {
  await wait(400);
  await scenes[scene]();
  // Lets the capture script know the scene is ready.
  await wait(1200);
  document.body.dataset.ready = "1";
}

