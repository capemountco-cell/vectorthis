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
