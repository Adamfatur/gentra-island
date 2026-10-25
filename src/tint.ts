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

/** Reads artwork through a tiny canvas; 12×12 pixels are plenty for one color. */
export function artTint(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 12;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, 12, 12);
        resolve(pickTint(ctx.getImageData(0, 0, 12, 12).data));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
