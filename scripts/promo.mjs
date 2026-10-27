// Records the Threads video: a 4:5 frame around the live island preview.
//
//   pnpm dev                  # in one terminal
//   node scripts/promo.mjs    # in another
//
// Writes promo/threads-4x5.mp4 and promo/threads-cover.jpg. Needs Google
// Chrome, and ffmpeg on the PATH.
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const URL = process.env.PROMO_URL ?? "http://localhost:1420/scripts/promo/threads.html";
const OUT = "promo";
const FRAMES = join(OUT, ".frames");

await rm(FRAMES, { recursive: true, force: true });
await mkdir(FRAMES, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
// 900×1125 at 2× is recorded, then scaled to 1080×1350, the 4:5 size Threads shows largest.
const ctx = await browser.newContext({ viewport: { width: 900, height: 1125 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(URL);
await page.frameLocator("iframe").locator("body[data-ready]").waitFor({ timeout: 30000 });

const cdp = await ctx.newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  const file = join(FRAMES, `f${String(frames.length).padStart(5, "0")}.png`);
  frames.push({ file, t: metadata.timestamp });
  await writeFile(file, Buffer.from(data, "base64"));
  await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "png", maxWidth: 1800, maxHeight: 2250, everyNthFrame: 1 });
await page.waitForSelector("body[data-done]", { timeout: 90000 });
const stoppedAt = Date.now() / 1000;
await cdp.send("Page.stopScreencast");
await browser.close();

// Each frame lasts until the next one arrived, so the video keeps real timing.
const list = frames
  .map((f, i) => `file '${f.file.split("/").pop()}'\nduration ${Math.max(0.001, (frames[i + 1]?.t ?? Math.max(stoppedAt, f.t + 0.04)) - f.t).toFixed(3)}`)
  .join("\n");
await writeFile(join(FRAMES, "frames.txt"), `${list}\nfile '${frames.at(-1).file.split("/").pop()}'\n`);
const input = ["-f", "concat", "-safe", "0", "-i", join(FRAMES, "frames.txt")];
const video = join(OUT, "threads-4x5.mp4");
execFileSync("ffmpeg", [
  "-y", "-loglevel", "error", ...input,
  "-vf", "scale=1080:1350:flags=lanczos,fps=30,format=yuv420p",
  "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-movflags", "+faststart", video,
]);
// The cover: the music view, cover art and caption together.
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "6.2", "-i", video, "-frames:v", "1", "-q:v", "2", join(OUT, "threads-cover.jpg")]);
await rm(FRAMES, { recursive: true, force: true });
console.log("saved", video, "and threads-cover.jpg,", frames.length, "frames");
