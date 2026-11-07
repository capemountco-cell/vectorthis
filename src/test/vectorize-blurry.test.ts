import { describe, expect, it } from "vitest";
import { blurCoverage, coverageFromRgba, vectorizeDetailed, type TracedPath } from "@/lib/vectorize";

// Even-odd point-in-paths test on sampled outlines.
function insideFn(paths: TracedPath[]) {
  const polys = paths.map((p) => {
    const pts = [p.start];
    let f = p.start;
    for (const s of p.segments) {
      for (let i = 1; i <= 12; i++) {
        const t = i / 12, m = 1 - t;
        pts.push(s.type === "L"
          ? { x: f.x + (s.to.x - f.x) * t, y: f.y + (s.to.y - f.y) * t }
          : { x: m ** 3 * f.x + 3 * m * m * t * s.c1.x + 3 * m * t * t * s.c2.x + t ** 3 * s.to.x, y: m ** 3 * f.y + 3 * m * m * t * s.c1.y + 3 * m * t * t * s.c2.y + t ** 3 * s.to.y });
      }
      f = s.to;
    }
    return pts;
  });
  return (x: number, y: number) => {
    let hit = false;
    for (const poly of polys)
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]!, b = poly[j]!;
        if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
      }
    return hit;
  };
}

describe("blurry, compressed uploads", () => {
  // A small, blurry green "LO" on white with compression-style background speckle, like a
  // logo screenshot saved as JPEG. The speckle used to read as soft edges everywhere, which
  // pushed smoothing so high that letters melted into blobs (≈67% shape match).
  it("traces thin letters faithfully instead of melting them", () => {
    const w = 200, h = 100;
    const shape = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const L = (x >= 20 && x < 30 && y >= 15 && y < 85) || (x >= 20 && x < 70 && y >= 75 && y < 85);
        const r = Math.hypot(x + 0.5 - 135, y + 0.5 - 50);
        shape[y * w + x] = L || (r <= 35 && r >= 25) ? 1 : 0;
      }
    const soft = blurCoverage(shape, w, h, 1.8);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = soft[i]!, n = (rand() - 0.5) * 24 + (rand() < 0.3 ? -14 : 0);
      rgba[i * 4] = 255 + (40 - 255) * v + n;
      rgba[i * 4 + 1] = 255 + (200 - 255) * v + n;
      rgba[i * 4 + 2] = 255 + (110 - 255) * v + n;
      rgba[i * 4 + 3] = 255;
    }
    const paths = vectorizeDetailed(coverageFromRgba(rgba, w, h), w, h);
    const inside = insideFn(paths);
    let both = 0, union = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const a = soft[y * w + x]! >= 0.5, b = inside(x + 0.5, y + 0.5);
        if (a && b) both++;
        if (a || b) union++;
      }
    expect(both / union).toBeGreaterThan(0.95);
  });
});
