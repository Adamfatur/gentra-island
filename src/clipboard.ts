import { invoke } from "@tauri-apps/api/core";
import { cleanText, hasTracking, maskSensitive } from "./clean";
import { ago, esc, whenLabel } from "./format";
import { t, type Key } from "./i18n";
import { icon } from "./icons";
import { findTime, quickTimes } from "./timeparse";
import { analyze, type Insight } from "./insight";

export interface ClipItem {
  id: number;
  kind: "text" | "link" | "code" | "color" | "image";
  /** For secrets this is already masked by the backend. */
  text?: string;
  thumb?: string;
  size?: [number, number];
  app?: string;
  created: number;
  pinned: boolean;
  secret?: string;
  expires?: number;
}

type Filter = "all" | "text" | "image" | "link" | "pinned";

interface Action {
  kind: "decode" | "tracking" | "tidy" | "masked";
  label: string;
  text: string;
}

export interface Smart {
  insight?: Insight;
  actions: Action[];
}

const smartCache = new Map<number, Smart>();
let smartOn = true;

/** The user's mode can switch decoders and clean paste off entirely. */
export function setSmart(on: boolean) {
  smartOn = on;
  smartCache.clear();
}

/** Decoders and clean-paste options for an item; cached per item id. */
export function smart(item: ClipItem): Smart {
  if (!smartOn) return { actions: [] };
  const hit = smartCache.get(item.id);
  if (hit) return hit;
  const result: Smart = { actions: [] };
  const text = item.text;
  if (text && !item.secret) {
    result.insight = analyze(text)[0];
    const { insight } = result;
    if (insight?.output) result.actions.push({ kind: "decode", label: insight.outputLabel ?? t("insight.copy.result"), text: insight.output });
    const clean = cleanText(text);
    if (clean !== text.trim()) {
      const tracking = hasTracking(text);
      result.actions.push({ kind: tracking ? "tracking" : "tidy", label: t(tracking ? "clip.action.noTracking" : "clip.action.tidy"), text: clean });
    }
    const masked = maskSensitive(clean);
    if (masked !== clean) result.actions.push({ kind: "masked", label: t("clip.action.masked"), text: masked });
  }
  smartCache.set(item.id, result);
  return result;
}

export const ICON: Record<ClipItem["kind"] | "secret", string> = {
  text: icon.text,
  link: icon.link,
  code: icon.code,
  color: icon.drop,
  image: icon.image,
  secret: icon.lock,
};
const kindName = (k: ClipItem["kind"]) => t(`clip.kind.${k}` as Key);

/** Secret kinds arrive from the backend as ids such as "aws". */
export function secretName(kind: string): string {
  const key = `secret.${kind}` as Key;
  const name = t(key);
  return name === key ? t("secret.unknown") : name;
}

const seconds = (n: number) => t("clip.seconds", { count: n });
const PIN = icon.pin;

export const secondsLeft = (item: ClipItem) => Math.max(0, Math.ceil(((item.expires ?? 0) - Date.now()) / 1000));

/** Text worth a reminder: not secrets (masked anyway) and not images. */
export const remindable = (i: ClipItem) => !i.secret && i.kind !== "image" && !!i.text?.trim();

export class ClipboardPanel {
  items: ClipItem[] = [];
  private filter: Filter = "all";
  private query = "";
  private sel = 0;
  private visible: ClipItem[] = [];
  private known = new Set<number>();
  private strip = document.getElementById("strip")!;
  private inspector = document.getElementById("inspector")!;
  private input = document.getElementById("clipQ") as HTMLInputElement;
  /** Reminders are on in the current mode. */
  remindOn = true;
  /** The item whose reminder times are showing in the inspector. */
  private choosing: number | null = null;

  constructor(
    private onCopied: (item: ClipItem) => void,
    private toast: (msg: string) => void,
    private remind: (item: ClipItem, at: Date) => void,
  ) {
    this.input.addEventListener("input", () => {
      this.query = this.input.value.trim().toLowerCase();
      this.sel = 0;
      this.render();
    });
    document.getElementById("filters")!.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-f]");
      if (!b) return;
      this.filter = b.dataset.f as Filter;
      document.querySelectorAll("#filters button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      this.sel = 0;
      this.render();
    });
    this.strip.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const pin = t.closest<HTMLElement>("[data-pin]");
      if (pin) return void this.pin(Number(pin.dataset.pin));
      const bell = t.closest<HTMLElement>("[data-remind]");
      if (bell) return this.chooseTime(Number(bell.dataset.remind));
      const card = t.closest<HTMLElement>(".card");
      if (card) this.copy(Number(card.dataset.id));
    });
    // A plain mouse wheel only scrolls vertically; turn it into sideways
    // scrolling so cards past the edge are reachable without a trackpad.
    this.strip.addEventListener(
      "wheel",
      (e) => {
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        e.preventDefault();
        this.strip.scrollLeft += e.deltaY;
      },
      { passive: false },
    );
    this.strip.addEventListener("scroll", () => this.updateEdges(), { passive: true });
    // Hovering a card shows what Gentra Island understood about it.
    this.strip.addEventListener("mouseover", (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>(".card");
      const n = card ? this.visible.findIndex((i) => i.id === Number(card.dataset.id)) : -1;
      this.strip.classList.add("navigating");
      if (n >= 0 && n !== this.sel) {
        this.sel = n;
        this.markSelected(false);
      }
    });
    this.strip.addEventListener("mouseleave", () => this.strip.classList.remove("navigating"));
    this.inspector.addEventListener("click", (e) => {
      const r = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
      if (r) return this.reminderAction(r.dataset.r!);
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
      const cur = this.visible[this.sel];
      if (!b || !cur) return;
      if (b.dataset.act === "forget") return void this.remove(cur.id);
      const action = smart(cur).actions[Number(b.dataset.act)];
      if (action) this.write(action.text, cur);
    });
    window.setInterval(() => this.tick(), 1000);
  }

  async load() {
    this.items = await invoke<ClipItem[]>("clip_list");
    this.render();
    return this.items;
  }

  get count() {
    return this.items.length;
  }

  focusSearch() {
    this.input.focus();
    this.input.select();
  }

  /** Shows the reminder times for an item in the inspector. */
  chooseTime(id: number) {
    const n = this.visible.findIndex((i) => i.id === id);
    if (n < 0 || !this.remindOn) return;
    this.sel = n;
    this.choosing = id;
    this.markSelected(false);
    this.renderInspector();
    this.inspector.querySelector<HTMLButtonElement>("[data-r]")?.focus();
  }

  private reminderAction(act: string) {
    const item = this.items.find((i) => i.id === this.choosing);
    if (act === "cancel" || !item) {
      this.choosing = null;
      return this.renderInspector();
    }
    let at: Date | null = null;
    if (act === "set") {
      const v = this.inspector.querySelector<HTMLInputElement>("#remindAt")?.value;
      at = v ? new Date(v) : null;
    } else {
      at = new Date(Number(act));
    }
    if (!at || Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) return this.toast(t("remind.past"));
    this.choosing = null;
    this.remind(item, at);
    this.renderInspector();
  }

  /** Arrow keys move the selection, Enter copies, P pins, R reminds, Backspace deletes. */
  key(e: KeyboardEvent): boolean {
    // Keys inside the reminder picker (the time field, its buttons) belong to it.
    if (this.inspector.contains(document.activeElement)) {
      if (e.key === "Escape" && this.choosing !== null) return this.reminderAction("cancel"), true;
      if (e.key === "Enter" && (document.activeElement as HTMLElement).id === "remindAt") return this.reminderAction("set"), true;
      return false;
    }
    const typing = document.activeElement === this.input;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      // While the caret is inside the search text, arrows move the caret.
      if (typing && this.input.value && this.input.selectionStart !== this.input.value.length) return false;
      this.strip.classList.add("navigating");
      this.sel = Math.max(0, Math.min(this.visible.length - 1, this.sel + (e.key === "ArrowRight" ? 1 : -1)));
      this.markSelected(true);
      return true;
    }
    const cur = this.visible[this.sel];
    if (!cur) return false;
    // ⇧Enter runs the first smart action (decode, clean link, …).
    if (e.key === "Enter" && e.shiftKey) {
      const first = smart(cur).actions[0];
      if (first) void this.write(first.text, cur);
      return true;
    }
    if (e.key === "Enter") return void this.copy(cur.id), true;
    if (!typing && e.key.toLowerCase() === "p") return void this.pin(cur.id), true;
    if (!typing && e.key.toLowerCase() === "r" && remindable(cur) && this.remindOn) return this.chooseTime(cur.id), true;
    if (!typing && (e.key === "Backspace" || e.key === "Delete")) return void this.remove(cur.id), true;
    return false;
  }

  async clear() {
    await invoke("clip_clear");
    await this.load();
    this.toast(t("clip.cleared"));
  }

  async copy(id: number) {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    try {
      await invoke("clip_copy", { id });
      this.onCopied(item);
    } catch (err) {
      this.toast(t("clip.copyFailed", { error: String(err) }));
    }
  }

  private async write(text: string, item: ClipItem) {
    try {
      await invoke("clip_write", { text });
      this.onCopied(item);
    } catch (err) {
      this.toast(t("clip.copyFailed", { error: String(err) }));
    }
  }

  private async pin(id: number) {
    const item = this.items.find((i) => i.id === id);
    if (item?.secret) return this.toast(t("clip.cantPinSecret"));
    const on = await invoke<boolean>("clip_pin", { id });
    if (item) item.pinned = on;
    this.toast(t(on ? "clip.pinned" : "clip.unpinned"));
    this.render();
  }

  private async remove(id: number) {
    await invoke("clip_delete", { id });
    this.items = this.items.filter((i) => i.id !== id);
    this.render();
  }

  private matches(i: ClipItem) {
    const f = this.filter;
    const kindOk =
      f === "all" ||
      (f === "pinned" ? i.pinned : f === "text" ? ["text", "code", "color"].includes(i.kind) : i.kind === f);
    if (!kindOk) return false;
    if (!this.query) return true;
    const label = smart(i).insight?.label ?? "";
    return `${i.text ?? ""} ${i.app ?? ""} ${kindName(i.kind)} ${label} ${i.secret ? secretName(i.secret) : ""}`.toLowerCase().includes(this.query);
  }

  render() {
    this.visible = this.items.filter((i) => this.matches(i));
    if (!this.visible.length) {
      this.strip.innerHTML = this.items.length
        ? `<div class="empty"><b>${t("clip.noMatch.title")}</b><span>${t("clip.noMatch.body")}</span></div>`
        : `<div class="empty"><b>${t("clip.empty.title")}</b><span>${t("clip.empty.body")}</span></div>`;
      this.inspector.hidden = true;
      return;
    }
    this.sel = Math.min(this.sel, this.visible.length - 1);
    this.input.placeholder = t("clip.search", { count: this.items.length });
    this.strip.innerHTML = this.visible.map((i) => this.card(i)).join("");
    this.visible.forEach((i) => this.known.add(i.id));
    this.markSelected(false);
    requestAnimationFrame(() => this.updateEdges());
  }

  /** Fades the strip's edges when more cards hide beyond them. */
  private updateEdges() {
    const { scrollLeft, scrollWidth, clientWidth } = this.strip;
    this.strip.classList.toggle("more-left", scrollLeft > 4);
    this.strip.classList.toggle("more-right", scrollLeft + clientWidth < scrollWidth - 4);
  }

  private card(i: ClipItem) {
    const fresh = this.known.size > 0 && !this.known.has(i.id) ? " fresh" : "";
    const text = esc(i.text ?? "");
    const s = smart(i);
    let body: string;
    if (i.kind === "image") {
      const dims = i.size ? `${i.size[0]} × ${i.size[1]}` : kindName("image");
      body = `<img alt="" src="${i.thumb ?? ""}"><div class="body" style="-webkit-line-clamp:1">${dims}</div>`;
    } else if (i.kind === "color") {
      body = `<div class="swatch-fill" style="background:${CSS.supports("color", i.text!) ? text : "transparent"}"></div><div class="body">${text}</div>`;
    } else {
      body = `<div class="body ${i.kind}${s.insight ? " short" : ""}">${text}</div>`;
    }
    const kind = i.secret
      ? `<span class="kind secret">${ICON.secret}${esc(secretName(i.secret))}</span>`
      : `<span class="kind${s.insight ? " smart" : ""}">${ICON[i.kind]}${esc(s.insight?.label ?? kindName(i.kind))}</span>`;
    const right = i.secret ? `<span class="ttl" data-expires="${i.expires}">${seconds(secondsLeft(i))}</span>` : `<span>${ago(i.created)}</span>`;
    const hint = s.insight && i.kind !== "color" ? `<div class="hint">${esc(s.insight.summary)}</div>` : "";
    return `<div class="card${fresh}${i.secret ? " is-secret" : ""}" data-id="${i.id}" role="option" tabindex="-1" aria-label="${esc(t("clip.card", { label: i.secret ? secretName(i.secret) : (s.insight?.label ?? kindName(i.kind)) }))}">
      ${kind}${body}${hint}
      <span class="foot"><span>${esc(i.app ?? "")}</span>${right}</span>
      ${i.secret ? "" : `<button class="pin${i.pinned ? " on" : ""}" data-pin="${i.id}" aria-label="${t(i.pinned ? "clip.unpin" : "clip.pin")}">${PIN}</button>`}
      ${this.remindOn && remindable(i) ? `<button class="bell" data-remind="${i.id}" aria-label="${t("remind.button")}" title="${t("remind.button")}">${icon.bell}</button>` : ""}
    </div>`;
  }

  private renderInspector() {
    const cur = this.visible[this.sel];
    if (!cur) return void (this.inspector.hidden = true);
    if (this.choosing !== null && this.choosing !== cur.id) this.choosing = null;
    if (this.choosing === cur.id) return this.renderChooser(cur);
    if (cur.secret) {
      this.inspector.hidden = false;
      this.inspector.className = "inspector warn";
      const countdown = `<span class="ttl" data-expires="${cur.expires}">${seconds(secondsLeft(cur))}</span>`;
      this.inspector.innerHTML = `<div class="ins-text"><b>${esc(t("clip.secret.title", { kind: secretName(cur.secret) }))}</b>
        <span>${t("clip.secret.body", { seconds: countdown })}</span></div>
        <div class="ins-actions"><button data-act="forget">${t("clip.secret.remove")}</button></div>`;
      return;
    }
    const s = smart(cur);
    if (!s.insight && !s.actions.length) return void (this.inspector.hidden = true);
    this.inspector.hidden = false;
    this.inspector.className = "inspector";
    // Without a decoder, preview exactly what the clean action will copy.
    const clean = s.actions.find((a) => a.kind === "tracking") ?? s.actions.find((a) => a.kind === "masked") ?? s.actions[0];
    const preview = s.insight?.detail ?? (s.insight ? undefined : clean?.text);
    const which = clean?.kind === "tracking" ? "tracking" : clean?.kind === "masked" ? "private" : "tidy";
    const title = s.insight
      ? `<b>${esc(s.insight.label)}</b><span>${esc(s.insight.summary)}</span>`
      : `<b>${t(`clip.clean.${which}.title` as Key)}</b><span>${t(`clip.clean.${which}.body` as Key)}</span>`;
    this.inspector.innerHTML = `<div class="ins-text">${title}${preview ? `<pre>${esc(preview)}</pre>` : ""}</div>
      <div class="ins-actions">${s.actions.map((a, n) => `<button data-act="${n}">${esc(a.label)}</button>`).join("")}</div>`;
  }

  /** Reminder times: what the text says (if anything), quick picks, or any time. */
  private renderChooser(cur: ClipItem) {
    const now = new Date();
    const found = findTime(cur.text ?? "", now);
    const pick = (at: Date, label: string, primary = false) =>
      `<button class="${primary ? "primary" : ""}" data-r="${at.getTime()}"><b>${esc(label)}</b><span>${esc(whenLabel(at, now))}</span></button>`;
    const quick = quickTimes(now).map((q) => pick(q.at, t(`remind.${q.id}` as Key)));
    const first = found ? pick(found, t("remind.found"), true) : "";
    const pad = (n: number) => String(n).padStart(2, "0");
    const min = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    this.inspector.hidden = false;
    this.inspector.className = "inspector remind";
    this.inspector.innerHTML = `<div class="remind-head"><b>${icon.bell}${t("remind.title")}</b>
        <button class="link-btn" data-r="cancel">${t("remind.cancel")}</button></div>
      <div class="remind-picks">${first}${quick.join("")}</div>
      <label class="remind-own"><span>${t("remind.pick")}</span><input type="datetime-local" id="remindAt" min="${min}">
        <button data-r="set">${t("remind.set")}</button></label>`;
  }

  /** Counts down secrets; reloads once one has expired. */
  private tick() {
    const timers = document.querySelectorAll<HTMLElement>(".ttl[data-expires]");
    if (!timers.length) return;
    timers.forEach((el) => {
      el.textContent = seconds(Math.max(0, Math.ceil((Number(el.dataset.expires) - Date.now()) / 1000)));
    });
  }

  /** Roving tabindex: only the selected card is in the Tab order, and
      keyboard moves put real focus on it. */
  private markSelected(focus: boolean) {
    const cards = this.strip.querySelectorAll<HTMLElement>(".card");
    cards.forEach((c, n) => {
      const on = n === this.sel;
      c.classList.toggle("sel", on);
      c.tabIndex = on ? 0 : -1;
      c.setAttribute("aria-selected", String(on));
    });
    if (focus) {
      cards[this.sel]?.focus({ preventScroll: true });
      cards[this.sel]?.scrollIntoView({ inline: "nearest", block: "nearest" });
    }
    this.renderInspector();
  }
}
