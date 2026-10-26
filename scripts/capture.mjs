// Regenerates the README screenshots and demo video from the browser preview.
//
//   pnpm dev                    # in one terminal
//   node scripts/capture.mjs    # in another
//
// Needs Google Chrome, and ffmpeg on the PATH for the GIF and MP4.
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.PREVIEW_URL ?? "http://localhost:1420/preview.html";
const OUT = "docs/screenshots";
const VIDEO_DIR = "docs/screenshots/.video";

const SHOTS = [
  ["home", "home"],
  ["media", "media"],
  ["clipboard", "clipboard"],
  ["dev", "dev"],
  ["calls", "calls"],
  ["system", "system"],
  ["settings", "settings"],
  ["compact", "compact"],
  ["peek", "peek"],
  ["reminder-offer", "reminder-offer"],
  ["reminder-pick", "reminder-pick"],
  ["reminder-due", "reminder-due"],
  ["ai", "ai"],
  ["agent-peek", "agent-peek"],
  ["agent-ask", "agent-ask"],
  ["screenshot", "screenshot"],
  ["care", "care"],
  ["care-water", "care-water"],
];

/** The stage around the island, trimmed below the island's bottom edge. */
const stageBox = () =>
  document.querySelector("#stagebox") &&
  (() => {
    const s = document.querySelector("#stagebox").getBoundingClientRect();
    const i = document.querySelector("#shell").getBoundingClientRect();
    return { x: s.x, y: s.y, width: s.width, height: Math.min(s.height, i.bottom - s.y + 40) };
  })();

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });

for (const theme of ["dark", "light"]) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 2 });
  for (const [scene, name] of SHOTS) {
    if (theme === "light" && !["home", "media"].includes(scene)) continue;
    const page = await ctx.newPage();
    await page.goto(`${BASE}?scene=${scene}&theme=${theme}`);
    await page.waitForSelector("body[data-ready]", { timeout: 30000 });
    await page.waitForTimeout(700);
    const clip = await page.evaluate(stageBox);
    const file = join(OUT, theme === "dark" ? `${name}.png` : `${name}-light.png`);
    await page.screenshot({ path: file, clip });
    console.log("saved", file);
    await page.close();
  }
  await ctx.close();
}

// The demo: Chrome streams frames while the tour plays; ffmpeg stitches them
// with their real timing, cropped to the island's stage.
await rm(VIDEO_DIR, { recursive: true, force: true });
await mkdir(VIDEO_DIR, { recursive: true });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  const file = join(VIDEO_DIR, `f${String(frames.length).padStart(5, "0")}.jpg`);
  frames.push({ file, t: metadata.timestamp });
  await writeFile(file, Buffer.from(data, "base64"));
  await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
await page.goto(`${BASE}?scene=demo&theme=dark`);
await page.waitForSelector("body[data-ready]", { timeout: 30000 });
const box = await page.evaluate(() => {
  const s = document.querySelector("#stagebox").getBoundingClientRect();
  return { x: Math.round(s.x), y: Math.round(s.y), width: Math.round(s.width), height: 330 };
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
await page.waitForSelector("body[data-done]", { timeout: 60000 });
// Frames only arrive when something changes; the last one lasts until here.
const stoppedAt = Date.now() / 1000;
await cdp.send("Page.stopScreencast");
await ctx.close();
await browser.close();

// Each frame lasts until the next one arrived.
const list = frames
  .map((f, i) => `file '${f.file.split("/").pop()}'\nduration ${Math.max(0.001, (frames[i + 1]?.t ?? Math.max(stoppedAt, f.t + 0.04)) - f.t).toFixed(3)}`)
  .join("\n");
await writeFile(join(VIDEO_DIR, "frames.txt"), `${list}\nfile '${frames.at(-1).file.split("/").pop()}'\n`);
const crop = `crop=${box.width}:${box.height}:${box.x}:${box.y}`;
const input = ["-f", "concat", "-safe", "0", "-i", join(VIDEO_DIR, "frames.txt")];
execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...input, "-vf", `${crop},fps=30`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(OUT, "demo.mp4")]);
execFileSync("ffmpeg", [
  "-y", "-loglevel", "error", ...input,
  "-vf", `${crop},fps=15,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
  join(OUT, "demo.gif"),
]);
await rm(VIDEO_DIR, { recursive: true, force: true });
console.log("saved", join(OUT, "demo.mp4"), "and demo.gif,", frames.length, "frames");
