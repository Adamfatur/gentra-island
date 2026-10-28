import { contrast, readableAccent } from "./theme";

// The color of a song: the most vivid color in its artwork, used to tint the
// Media tab and the level meter on the small island.

const hex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();

/**
 * Picks the pixel with the most saturation from RGBA data, skipping
 * transparent, near-black, near-white, and grey pixels. Null when nothing is
 * colorful enough to be worth a tint.
 */
export function pickTint(data: Uint8ClampedArray): string | null {
  let best: [number, number, number] | null = null;
  let bestScore = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 40 || min > 225) continue;
    const saturation = (max - min) / max;
    if (saturation < 0.25) continue;
    // Vivid and reasonably bright wins; a dark red loses to a clear one.
    const score = saturation * (max / 255);
    if (score > bestScore) {
      bestScore = score;
      best = [r, g, b];
    }
  }
  return best ? `#${best.map(hex).join("")}` : null;
}

/**
 * The color at the artwork's right edge, where the open player fades the
 * cover into the panel: the average of the right quarter of a `size`×`size`
 * RGBA image. Matching the edge, not the most vivid pixel, makes the fade
 * seamless, the way a cream album cover fades into cream.
 */
export function edgeColor(data: Uint8ClampedArray, size: number): string | null {
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = 0; y < size; y++) {
    for (let x = Math.floor(size * 0.75); x < size; x++) {
      const i = (y * size + x) * 4;
      if (data[i + 3] < 128) continue;
      sum[0] += data[i];
      sum[1] += data[i + 1];
      sum[2] += data[i + 2];
      n++;
    }
  }
  return n ? `#${sum.map((v) => hex(Math.round(v / n))).join("")}` : null;
}

/** The artwork's most vivid color and its right-edge color, read in one pass. */
export function artColors(src: string): Promise<{ tint: string | null; edge: string | null }> {
  return new Promise((resolve) => {
    const none = { tint: null, edge: null };
    const img = new Image();
    img.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(none);
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        resolve({ tint: pickTint(data), edge: edgeColor(data, size) });
      } catch {
        resolve(none);
      }
    };
    img.onerror = () => resolve(none);
    // A page in the background may hold the image back; never wait on it forever.
    window.setTimeout(() => resolve(none), 4000);
    img.src = src;
  });
}

/** The ink the open player uses on a cover's color, in its CSS terms. */
export type CoverInk = "on-dark" | "on-light";

const LIGHT_INK = "#FFFFFF";
const DARK_INK = "#14183A";

/**
 * The panel color and ink for a cover whose edge is `edge`. The edge color is
 * kept when the ink reads at 5:1 on it (so the dimmer labels still make
 * 4.5:1); a mid-tone edge is nudged darker or lighter until it does.
 */
export function coverBackdrop(edge: string): { bg: string; ink: CoverInk } {
  const ink: CoverInk = contrast(edge, LIGHT_INK) >= contrast(edge, DARK_INK) ? "on-dark" : "on-light";
  return { bg: readableAccent(edge, ink === "on-dark" ? LIGHT_INK : DARK_INK, 5), ink };
}
