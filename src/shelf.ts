import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { invoke } from "@tauri-apps/api/core";
import { bytes, esc } from "./format";
import { errorText, t } from "./i18n";
import { icon } from "./icons";

export interface ShelfItem {
  path: string;
  name: string;
  size: number;
  isDir: boolean;
}

export class ShelfPanel {
  items: ShelfItem[] = [];
  private root = document.getElementById("shelfPanel")!;
  private dragIcon: Promise<string> = invoke<string>("shelf_drag_icon").catch(() => "");
  private armedClear = 0;

  /** The file manager's own name, which stays untranslated. */
  private get manager() {
    return this.platform === "macos" ? "Finder" : this.platform === "windows" ? "File Explorer" : "Files";
  }

  constructor(
    private platform: string,
    private toast: (msg: string) => void,
  ) {
    this.root.addEventListener("click", (e) => this.click(e));
    // Dragging a row starts a real OS drag, so files land in Finder, Mail, chat…
    this.root.addEventListener("mousedown", async (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(".file[data-path]");
      if (!row || (e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      const icon = await this.dragIcon;
      try {
        await startDrag({ item: [row.dataset.path!], icon });
      } catch (err) {
        this.toast(t("shelf.dragFailed", { error: errorText(err) }));
      }
    });
  }

  async load() {
    this.items = await invoke<ShelfItem[]>("shelf_list");
    this.render();
  }

  async add(paths: string[]) {
    const before = this.items.length;
    this.items = await invoke<ShelfItem[]>("shelf_add", { paths });
    const added = this.items.length - before;
    this.toast(added ? t("shelf.added", { count: added }) : t("shelf.already"));
    this.render();
  }

  setDropping(on: boolean) {
    this.root.querySelector(".drop")?.classList.toggle("over", on);
  }

  private async click(e: Event) {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!act) return;
    const path = act.closest<HTMLElement>("[data-path]")?.dataset.path;
    try {
      switch (act.dataset.act) {
        case "reveal":
          await invoke("shelf_reveal", { path });
          break;
        case "remove":
          this.items = await invoke<ShelfItem[]>("shelf_remove", { path });
          break;
        case "airdrop":
          await invoke("shelf_airdrop", { paths: this.items.map((i) => i.path) });
          break;
        case "clear":
          // Two clicks within 3 s: the first one asks, the second one clears.
          if (Date.now() - this.armedClear > 3000) {
            this.armedClear = Date.now();
            this.render();
            window.setTimeout(() => this.render(), 3100);
            return;
          }
          await invoke("shelf_clear");
          this.items = [];
          this.armedClear = 0;
          this.toast(t("shelf.cleared"));
          break;
      }
    } catch (err) {
      this.toast(errorText(err));
    }
    this.render();
  }

  render() {
    const total = this.items.reduce((a, i) => a + i.size, 0);
    const list = this.items.length
      ? `<ul class="files">${this.items
          .map(
            (i) => `<li class="file" data-path="${esc(i.path)}" title="${t("shelf.dragHint")}">
              <span class="ext">${i.isDir ? icon.folder : icon.file}</span>
              <span class="file-text"><span class="n">${esc(i.name)}</span><span class="h num">${bytes(i.size)}</span></span>
              <button data-act="reveal" aria-label="${esc(t("shelf.reveal", { name: i.name, manager: this.manager }))}">${icon.folder}</button>
              <button data-act="remove" aria-label="${esc(t("shelf.remove", { name: i.name }))}">${icon.x}</button>
            </li>`,
          )
          .join("")}</ul>`
      : `<div class="drop-empty"><b>${t("shelf.empty.title")}</b><span>${t("shelf.empty.body")}</span></div>`;
    const armed = Date.now() - this.armedClear <= 3000;
    const actions = this.items.length
      ? `<div class="shelf-actions">
          <span class="muted num">${t("shelf.summary", { count: this.items.length, size: bytes(total) })}</span>
          ${this.platform === "macos" ? `<button class="primary" data-act="airdrop">${icon.share}<span>${t("shelf.airdrop")}</span></button>` : ""}
          <button data-act="clear" class="${armed ? "danger" : ""}">${t(armed ? "shelf.clearConfirm" : "shelf.clear")}</button>
        </div>`
      : "";
    this.root.innerHTML = `<div class="drop">${list}</div>${actions}`;
  }
}
