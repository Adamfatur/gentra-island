import { invoke } from "@tauri-apps/api/core";
import { esc, took } from "./format";
import { errorText, t } from "./i18n";
import { icon } from "./icons";

export interface Server {
  port: number;
  pid: number;
  name: string;
  dir: string;
  /** Seconds since the process started. */
  age: number;
}

export interface Done {
  cmd: string;
  code: number;
  secs: number;
  place: string;
}

interface HookInfo {
  lines: [Shell, string][];
  recent: Done[];
}

type Shell = "zsh" | "bash" | "fish" | "powershell";
const SHELLS: { id: Shell; name: string; file: string }[] = [
  { id: "zsh", name: "zsh", file: "~/.zshrc" },
  { id: "bash", name: "bash", file: "~/.bashrc" },
  { id: "fish", name: "fish", file: "~/.config/fish/config.fish" },
  { id: "powershell", name: "PowerShell", file: "$PROFILE" },
];

const SHELL_KEY = "gate.shell";

/** Ages read better without seconds once they pass a minute. */
const upFor = (secs: number) => took(secs >= 60 ? Math.floor(secs / 60) * 60 : secs);

export const doneTitle = (d: Done) => t(d.code === 0 ? "dev.alerts.ok" : "dev.alerts.fail", { cmd: d.cmd.split(/\s+/).slice(0, 3).join(" ") });
export const doneMeta = (d: Done) => (d.place ? t("dev.alerts.meta", { time: took(d.secs), place: d.place }) : t("dev.alerts.metaNoPlace", { time: took(d.secs) }));

/** Dev tab: local servers (port watcher) and command alerts. */
export class DevPanel {
  ports = true;
  alerts = true;
  private root = document.getElementById("devPanel")!;
  private servers: Server[] | null = null;
  private hook: HookInfo | null = null;
  private poll = 0;
  private open = false;
  private html = "";
  private armed: { port: number; at: number } | null = null;
  private showSetup = false;
  private shell: Shell;

  constructor(
    platform: string,
    private toast: (msg: string) => void,
  ) {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(SHELL_KEY);
    } catch {
      /* private mode: fall back to the platform default */
    }
    this.shell = SHELLS.some((s) => s.id === saved) ? (saved as Shell) : platform === "windows" ? "powershell" : platform === "macos" ? "zsh" : "bash";
    this.root.addEventListener("click", (e) => void this.click(e));
  }

  /** Starts watching while the tab is open; nothing runs while it is closed. */
  show() {
    if (this.open) return void this.refresh();
    this.open = true;
    void this.loop();
  }

  hide() {
    this.open = false;
    window.clearTimeout(this.poll);
  }

  /** The next scan waits for this one, so a slow lsof never piles up. */
  private async loop() {
    await this.refresh();
    if (this.open) this.poll = window.setTimeout(() => void this.loop(), 3000);
  }

  /** The backend already keeps the list; reread it when the tab is open. */
  commandDone() {
    if (this.open) void this.refresh();
  }

  private async refresh() {
    const [servers, hook] = await Promise.all([
      this.ports ? invoke<Server[]>("ports_list").catch(() => []) : Promise.resolve(null),
      this.alerts ? invoke<HookInfo | null>("hook_info").catch(() => null) : Promise.resolve(null),
    ]);
    this.servers = servers;
    this.hook = hook;
    this.render();
  }

  private async click(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!b) return;
    const port = Number(b.closest<HTMLElement>("[data-port]")?.dataset.port);
    const server = this.servers?.find((s) => s.port === port);
    try {
      switch (b.dataset.act) {
        case "open":
          await invoke("port_open", { port });
          break;
        case "stop":
          if (!server) return;
          // Two clicks within 3 s: the first asks, the second stops.
          if (!this.armed || this.armed.port !== port || Date.now() - this.armed.at > 3000) {
            this.armed = { port, at: Date.now() };
            this.render();
            window.setTimeout(() => this.render(), 3100);
            return;
          }
          this.armed = null;
          await invoke("port_stop", { port, pid: server.pid });
          this.toast(t("dev.server.stopped", { port }));
          window.setTimeout(() => void this.refresh(), 600);
          break;
        case "shell":
          this.shell = b.dataset.shell as Shell;
          try {
            localStorage.setItem(SHELL_KEY, this.shell);
          } catch {
            /* remembered for this session only */
          }
          break;
        case "copy": {
          const line = this.hook?.lines.find(([s]) => s === this.shell)?.[1];
          if (!line) return;
          await invoke("clip_write", { text: line });
          this.toast(t("dev.alerts.copied", { file: this.file }));
          break;
        }
        case "setup":
          this.showSetup = !this.showSetup;
          break;
      }
    } catch (err) {
      this.toast(errorText(err));
    }
    this.render();
  }

  private get file() {
    return SHELLS.find((s) => s.id === this.shell)!.file;
  }

  render() {
    const parts: string[] = [];
    if (this.ports) parts.push(this.serversHtml());
    if (this.alerts) parts.push(this.alertsHtml());
    const html = `<div class="dev">${parts.join("")}</div>`;
    // Unchanged scans leave the DOM alone, so focus and text selection survive.
    if (html === this.html && this.root.firstChild) return;
    this.html = html;
    this.root.innerHTML = html;
  }

  private serversHtml() {
    const list = this.servers;
    const head = `<div class="dev-head"><h3>${icon.plug}${t("dev.servers")}</h3>${list?.length ? `<span class="muted num">${t("dev.servers.count", { count: list.length })}</span>` : ""}</div>`;
    if (!list) return `<section>${head}<p class="muted">${t("dev.servers.looking")}</p></section>`;
    if (!list.length) {
      return `<section>${head}<div class="dev-empty"><b>${t("dev.servers.empty.title")}</b><span>${t("dev.servers.empty.body")}</span></div></section>`;
    }
    const armedPort = this.armed && Date.now() - this.armed.at <= 3000 ? this.armed.port : null;
    const rows = list
      .map((s) => {
        const armed = armedPort === s.port;
        return `<li class="server" data-port="${s.port}">
          <span class="addr num">localhost:${s.port}</span>
          <span class="server-text"><span class="n">${esc(s.name)}</span><span class="h">${esc(t("dev.server.since", { dir: s.dir, time: upFor(s.age) }))}</span></span>
          <button data-act="open" aria-label="${esc(t("dev.server.openLabel", { port: s.port }))}">${icon.globe}<span>${t("dev.server.open")}</span></button>
          <button data-act="stop" class="${armed ? "danger" : ""}" aria-label="${esc(t("dev.server.stopLabel", { name: s.name, port: s.port }))}">${icon.stop}<span>${t(armed ? "dev.server.stopConfirm" : "dev.server.stop")}</span></button>
        </li>`;
      })
      .join("");
    return `<section>${head}<ul class="servers">${rows}</ul></section>`;
  }

  private alertsHtml() {
    const recent = this.hook?.recent ?? [];
    const head = `<div class="dev-head"><h3>${icon.terminal}${t("dev.alerts")}</h3>${
      recent.length ? `<button class="link-btn" data-act="setup" aria-expanded="${this.showSetup}">${t("dev.alerts.setup.another")}</button>` : ""
    }</div>`;
    const rows = recent
      .map(
        (d) => `<li class="done ${d.code === 0 ? "ok" : "bad"}">
          <span class="done-ic">${d.code === 0 ? icon.ok : icon.fail}</span>
          <span class="server-text"><span class="n">${esc(doneTitle(d))}</span><span class="h">${esc(doneMeta(d))}${d.code === 0 ? "" : `, ${t("dev.alerts.exit", { code: d.code })}`}</span></span>
        </li>`,
      )
      .join("");
    const list = recent.length ? `<ul class="dones">${rows}</ul>` : "";
    const setup = !recent.length || this.showSetup ? this.setupHtml(recent.length > 0) : "";
    return `<section>${head}${list}${setup}</section>`;
  }

  private setupHtml(hasRecent: boolean) {
    if (!this.hook) return `<p class="note">${t("dev.alerts.unavailable")}</p>`;
    const line = this.hook.lines.find(([s]) => s === this.shell)?.[1] ?? "";
    const shells = SHELLS.map(
      (s) => `<button class="seg" data-act="shell" data-shell="${s.id}" aria-pressed="${s.id === this.shell}"><span>${s.name}</span></button>`,
    ).join("");
    return `<div class="hook-setup">
      ${hasRecent ? "" : `<b>${t("dev.alerts.setup.title")}</b>`}
      <div class="segs shell-segs" role="group" aria-label="${t("dev.shell")}">${shells}</div>
      <p class="muted">${esc(t("dev.alerts.setup.body", { file: this.file }))}</p>
      <div class="hook-line"><code>${esc(line)}</code><button class="primary" data-act="copy">${icon.copy}<span>${t("dev.alerts.copy")}</span></button></div>
      ${hasRecent ? "" : `<p class="note">${t("dev.alerts.empty")}</p>`}
    </div>`;
  }
}
