// Colour maths shared by the colour tracer and its shading fits (pure, no DOM).

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const LIN = Array.from({ length: 256 }, (_, i) => toLinear(i));

/** sRGB (0–255) to CIE Lab. */
export function labOf(r: number, g: number, b: number): [number, number, number] {
  const R = LIN[Math.max(0, Math.min(255, Math.round(r)))]!,
    G = LIN[Math.max(0, Math.min(255, Math.round(g)))]!,
    B = LIN[Math.max(0, Math.min(255, Math.round(b)))]!;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Euclidean distance between two triples stored at offsets ai and bi. */
export const dE = (a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number) =>
  Math.hypot(a[ai]! - b[bi]!, a[ai + 1]! - b[bi + 1]!, a[ai + 2]! - b[bi + 2]!);

export function hex(r: number, g: number, b: number) {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function rgbOf(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * Chamfer distance (3-4 metric, in pixels) from each set pixel of a mask to the nearest
 * unset pixel. Pixels outside the image count as unset, or as set with `outsideSet`.
 */
export function distanceInside(mask: Uint8Array, w: number, h: number, outsideSet = false): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? INF : 0;
  const out = outsideSet ? INF : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? out : d[y * w + x]!);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  for (let i = 0; i < w * h; i++) d[i] = d[i]! / 3;
  return d;
}
