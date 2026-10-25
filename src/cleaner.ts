import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { bytes, esc } from "./format";
import { errorText, t, type Key } from "./i18n";
import { icon } from "./icons";

interface CategoryView {
  id: string;
  hint: string;
  defaultOn: boolean;
  size: number;
  count: number;
}

interface ScanResult {
  supported: boolean;
  categories: CategoryView[];
  diskTotal: number;
  diskAvailable: number;
}

interface RunResult {
  freed: number;
  moved: number;
  skipped: number;
}

type State =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "ready"; scan: ScanResult }
  | { kind: "running"; scan: ScanResult; done: number; total: number }
  | { kind: "done"; scan: ScanResult; result: RunResult }
  | { kind: "error"; message: string };

const CHECK = icon.check;

/** How old something must be before it counts, per category id. */
const AGE: Record<string, Key> = {
  logs: "cleaner.age.week",
  installers: "cleaner.age.week",
  temp: "cleaner.age.week",
  node_modules: "cleaner.age.projects",
};

const categoryName = (c: CategoryView) => t(`cleaner.cat.${c.id}` as Key);

/** "~/Library/Logs, older than a week, 211 items": the backend sends only the path. */
function categoryDetail(c: CategoryView): string {
  // Linux caches count as idle after a day; other systems use their own rules.
  const age = c.hint === "~/.cache" ? t("cleaner.age.day") : AGE[c.id] ? t(AGE[c.id]) : "";
  return [c.hint, age, t("cleaner.items", { count: c.count })].filter(Boolean).join(", ");
}
const SHIELD = icon.shield;

export class CleanerPanel {
  private state: State = { kind: "idle" };
  private chosen = new Set<string>();
  private scannedAt = 0;
  private root = document.getElementById("cleanerPanel")!;

  constructor() {
    void listen<[number, number]>("cleaner-progress", ({ payload: [done, total] }) => {
      if (this.state.kind === "running") {
        this.state = { ...this.state, done, total };
        this.updateProgress();
      }
    });
    this.root.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const row = t.closest<HTMLElement>("[data-cat]");
      if (row && this.state.kind === "ready") {
        const id = row.dataset.cat!;
        this.chosen.has(id) ? this.chosen.delete(id) : this.chosen.add(id);
        return this.render();
      }
      if (t.closest("#cleanRun")) return void this.run();
      if (t.closest("#cleanRescan")) return void this.scan();
    });
  }

  /** Scans on first open, and again when the last scan is over a minute old. */
  ensureScanned() {
    if (this.state.kind === "running" || this.state.kind === "scanning") return;
    if (this.state.kind === "idle" || Date.now() - this.scannedAt > 60_000) void this.scan();
  }

  private async scan() {
    this.state = { kind: "scanning" };
    this.render();
    try {
      const scan = await invoke<ScanResult>("cleaner_scan");
      this.scannedAt = Date.now();
      this.chosen = new Set(scan.categories.filter((c) => c.defaultOn).map((c) => c.id));
      this.state = { kind: "ready", scan };
    } catch (err) {
      this.state = { kind: "error", message: t("cleaner.scanFailed", { error: errorText(err) }) };
    }
    this.render();
  }

  private async run() {
    if (this.state.kind !== "ready" || !this.chosen.size) return;
    const scan = this.state.scan;
    this.state = { kind: "running", scan, done: 0, total: 0 };
    this.render();
    try {
      const result = await invoke<RunResult>("cleaner_run", { ids: [...this.chosen] });
      const after = await invoke<ScanResult>("cleaner_scan");
      this.scannedAt = Date.now();
      this.chosen = new Set(after.categories.filter((c) => c.defaultOn).map((c) => c.id));
      this.state = { kind: "done", scan: after, result };
    } catch (err) {
      this.state = { kind: "error", message: t("cleaner.runFailed", { error: errorText(err) }) };
    }
    this.render();
  }

  private selectedSize(scan: ScanResult) {
    return scan.categories.filter((c) => this.chosen.has(c.id)).reduce((a, c) => a + c.size, 0);
  }

  private updateProgress() {
    if (this.state.kind !== "running") return;
    const { done, total } = this.state;
    const bar = this.root.querySelector<HTMLElement>(".clean-btn .prog");
    const label = this.root.querySelector<HTMLElement>(".clean-btn span:last-child");
    if (bar) bar.style.width = total ? `${(done / total) * 100}%` : "0";
    if (label) label.textContent = total ? t("cleaner.movingCount", { done, total }) : t("cleaner.moving");
  }

  render() {
    const s = this.state;
    if (s.kind === "idle" || s.kind === "scanning") {
      this.root.innerHTML = `<div class="state"><b>${t("cleaner.scanning.title")}</b><span>${t("cleaner.scanning.body")}</span></div>`;
      return;
    }
    if (s.kind === "error") {
      this.root.innerHTML = `<div class="state"><b>${esc(s.message)}</b><span><button class="clean-btn" id="cleanRescan"><span>${t("cleaner.rescan")}</span></button></span></div>`;
      return;
    }
    const scan = s.scan;
    if (!scan.supported) {
      this.root.innerHTML = `<div class="state"><b>${t("cleaner.unsupported.title")}</b><span>${t("cleaner.unsupported.body")}</span></div>`;
      return;
    }
    const busy = s.kind === "running";
    const list = scan.categories.length
      ? scan.categories
          .map(
            (c) => `<button class="cat" role="checkbox" data-cat="${c.id}" aria-checked="${this.chosen.has(c.id)}" ${busy ? "disabled" : ""}>
              <span class="box">${CHECK}</span>
              <span class="cat-text"><span class="n">${esc(categoryName(c))}</span><span class="h">${esc(categoryDetail(c))}</span></span>
              <span class="sz num">${bytes(c.size)}</span></button>`,
          )
          .join("")
      : `<div class="state"><b>${t("cleaner.clean.title")}</b><span>${t("cleaner.clean.body")}</span></div>`;

    const used = scan.diskTotal - scan.diskAvailable;
    const sel = this.selectedSize(scan);
    const pctUsed = scan.diskTotal ? ((used - sel) / scan.diskTotal) * 100 : 0;
    const pctSel = scan.diskTotal ? (sel / scan.diskTotal) * 100 : 0;
    const headline =
      s.kind === "done"
        ? `<p class="big num">${bytes(s.result.freed)}</p><p class="muted">${t("cleaner.freed")}${s.result.skipped ? ` ${t("cleaner.skipped", { count: s.result.skipped })}` : ""}</p>`
        : `<p class="big num">${bytes(sel)}</p><p class="muted">${sel ? t("cleaner.ready") : t("cleaner.pickOne")}</p>`;
    const action =
      s.kind === "done"
        ? `<button class="clean-btn" id="cleanRescan"><span>${t("cleaner.rescan")}</span></button>`
        : `<button class="clean-btn" id="cleanRun" ${busy || !sel ? "disabled" : ""}><span class="prog"></span><span>${busy ? t("cleaner.moving") : t("cleaner.run")}</span></button>`;

    this.root.innerHTML = `<div class="clean">
      <div class="cats">${list}</div>
      <div class="clean-side">
        <p class="muted num">${t("cleaner.disk", { free: bytes(scan.diskAvailable), total: bytes(scan.diskTotal) })}</p>
        <div class="diskbar"><i style="width:${pctUsed}%"></i><i class="sel" style="width:${pctSel}%"></i></div>
        ${headline}
        ${action}
        <p class="safe">${SHIELD}<span>${t("cleaner.safe")}</span></p>
      </div>
    </div>`;
    this.updateProgress();
  }
}
