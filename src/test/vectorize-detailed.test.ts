import { describe, expect, it } from "vitest";
import { vectorizeDetailed } from "@/lib/vectorize";

describe("vectorizeDetailed", () => {
  it("traces a tiny 8px-tall bar without spikes outside its bounds", () => {
    const w = 40, h = 20, c = new Float32Array(w * h);
    for (let y = 6; y < 14; y++) for (let x = 5; x < 35; x++) c[y * w + x] = 1;
    const paths = vectorizeDetailed(c, w, h, { minArea: 4 });
    expect(paths.length).toBe(1);
    const pts = paths[0]!.segments.flatMap((s) => (s.type === "L" ? [s.to] : [s.c1, s.c2, s.to]));
    for (const p of pts) {
      expect(p.x).toBeGreaterThan(4.4); expect(p.x).toBeLessThan(35.6);
      expect(p.y).toBeGreaterThan(5.4); expect(p.y).toBeLessThan(14.6);
    }
  });
});

import { blurCoverage, edgeSoftness } from "@/lib/vectorize";
describe("edgeSoftness", () => {
  it("tells crisp art apart from blurry uploads", () => {
    const w = 80, h = 80, c = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) c[y * w + x] = (x - 40) ** 2 + (y - 40) ** 2 < 600 ? 1 : 0;
    expect(edgeSoftness(c, w, h)).toBeLessThan(1.3);
    expect(edgeSoftness(blurCoverage(c, w, h, 1.5), w, h)).toBeGreaterThan(1.3);
  });
});

import type { TracedPath } from "@/lib/vectorize";
describe("vectorizeDetailed on enlarged screenshots", () => {
  // A circle drawn small, nearest-neighbour enlarged 1.46x (as when a zoomed screenshot is saved)
  // and slightly softened: its edge wobbles slowly, which used to come out as bumps on long curves.
  it("keeps a big curve round instead of following the resampling wobble", () => {
    const lw = 160, R = 60, c0 = 80;
    const low = new Float32Array(lw * lw);
    for (let y = 0; y < lw; y++)
      for (let x = 0; x < lw; x++) {
        let a = 0;
        for (let sy = 0; sy < 4; sy++)
          for (let sx = 0; sx < 4; sx++) a += (x + (sx + 0.5) / 4 - c0) ** 2 + (y + (sy + 0.5) / 4 - c0) ** 2 < R * R ? 1 : 0;
        low[y * lw + x] = a / 16;
      }
    const r = 1.46, W = Math.round(lw * r);
    const up = new Float32Array(W * W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) up[y * W + x] = low[Math.floor(y / r) * lw + Math.floor(x / r)]!;
    const img = blurCoverage(up, W, W, 0.5);
    expect(edgeSoftness(img, W, W)).toBeGreaterThan(1.3);

    const paths: TracedPath[] = vectorizeDetailed(img, W, W);
    expect(paths.length).toBe(1);
    const pts: { x: number; y: number }[] = [];
    let from = paths[0]!.start;
    for (const s of paths[0]!.segments) {
      for (let t = 0; t <= 1; t += 0.02) {
        if (s.type === "L") pts.push({ x: from.x + (s.to.x - from.x) * t, y: from.y + (s.to.y - from.y) * t });
        else {
          const m = 1 - t;
          pts.push({
            x: m * m * m * from.x + 3 * m * m * t * s.c1.x + 3 * m * t * t * s.c2.x + t * t * t * s.to.x,
            y: m * m * m * from.y + 3 * m * m * t * s.c1.y + 3 * m * t * t * s.c2.y + t * t * t * s.to.y,
          });
        }
      }
      from = s.to;
    }
    const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const radii = pts.map((q) => Math.hypot(q.x - cx, q.y - cy));
    const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
    expect(Math.abs(mean - R * r)).toBeLessThan(0.5);
    // Previously ~0.77px out of round; now well under a pixel's half-width.
    expect(Math.max(...radii.map((v) => Math.abs(v - mean)))).toBeLessThan(0.6);
  });
});

describe("vectorizeDetailed on small crisp logos", () => {
  // A small antialiased circle goes through the bicubic-upsampled path. Upsampling an
  // antialiased edge leaves a one-pixel ripple that used to be traced as fine scallops.
  it("traces a smooth curve, not the upsampling ripple", () => {
    const w = 100, R = 38, c0 = 50, c = new Float32Array(w * w);
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++) {
        let a = 0;
        for (let sy = 0; sy < 4; sy++)
          for (let sx = 0; sx < 4; sx++) a += (x + (sx + 0.5) / 4 - c0) ** 2 + (y + (sy + 0.5) / 4 - c0) ** 2 < R * R ? 1 : 0;
        c[y * w + x] = a / 16;
      }
    const paths = vectorizeDetailed(c, w, w);
    expect(paths.length).toBe(1);
    // Previously ~200 tiny curves following the ripple.
    expect(paths[0]!.segments.length).toBeLessThan(40);
    const radii: number[] = [];
    let from = paths[0]!.start;
    for (const s of paths[0]!.segments) {
      for (let t = 0; t < 1; t += 0.05) {
        const m = 1 - t;
        const p =
          s.type === "L"
            ? { x: from.x + (s.to.x - from.x) * t, y: from.y + (s.to.y - from.y) * t }
            : {
                x: m * m * m * from.x + 3 * m * m * t * s.c1.x + 3 * m * t * t * s.c2.x + t * t * t * s.to.x,
                y: m * m * m * from.y + 3 * m * m * t * s.c1.y + 3 * m * t * t * s.c2.y + t * t * t * s.to.y,
              };
        radii.push(Math.hypot(p.x - c0, p.y - c0));
      }
      from = s.to;
    }
    for (const r of radii) expect(Math.abs(r - R)).toBeLessThan(0.12);
  });
});
