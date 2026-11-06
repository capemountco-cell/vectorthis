import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { coverageFromRgba, toSvg, vectorize, type Point, type TracedPath } from "@/lib/vectorize";

// Minimal decoder for 8-bit RGBA, non-interlaced PNGs (enough for test fixtures).
function decodePng(path: string) {
  const buf = readFileSync(path);
  const width = buf.readUInt32BE(16),
    height = buf.readUInt32BE(20);
  const idat: Buffer[] = [];
  for (let o = 8; o < buf.length;) {
    const length = buf.readUInt32BE(o),
      type = buf.toString("ascii", o + 4, o + 8);
    if (type === "IDAT") idat.push(buf.subarray(o + 8, o + 8 + length));
    o += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4,
    out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const cur = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= 4 ? out[y * stride + x - 4]! : 0,
        b = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4]! : 0;
      const pa = Math.abs(b - c),
        pb = Math.abs(a - c),
        pc = Math.abs(a + b - 2 * c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter]!;
      out[y * stride + x] = (cur + pred) & 255;
    }
  }
  return { width, height, rgba: out };
}

/** Area coverage of traced paths per pixel (even-odd, 4×4 samples), for comparing with the source. */
function rasterizePaths(paths: TracedPath[], width: number, height: number) {
  const polys = paths.map((p) => [p.start, ...sample(p, 12)]);
  const inside = (x: number, y: number) => {
    let hit = false;
    for (const poly of polys)
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]!,
          b = poly[j]!;
        if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
      }
    return hit;
  };
  return raster(width, height, inside);
}

// Antialiased coverage of an analytic shape, 4×4 supersampled per pixel.
function raster(width: number, height: number, inside: (x: number, y: number) => boolean) {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let hits = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) hits++;
      out[y * width + x] = hits / 16;
    }
  return out;
}

// Exact box-filtered coverage of an axis-aligned rectangle.
function rectRaster(width: number, height: number, x0: number, y0: number, x1: number, y1: number) {
  const overlap = (a: number, b: number, lo: number, hi: number) =>
    Math.max(0, Math.min(b, hi) - Math.max(a, lo));
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      out[y * width + x] = overlap(x, x + 1, x0, x1) * overlap(y, y + 1, y0, y1);
  return out;
}

function sample(path: TracedPath, steps = 20): Point[] {
  const pts: Point[] = [];
  let from = path.start;
  for (const s of path.segments) {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps,
        mt = 1 - t;
      if (s.type === "L")
        pts.push({ x: from.x + (s.to.x - from.x) * t, y: from.y + (s.to.y - from.y) * t });
      else
        pts.push({
          x:
            mt ** 3 * from.x + 3 * mt * mt * t * s.c1.x + 3 * mt * t * t * s.c2.x + t ** 3 * s.to.x,
          y:
            mt ** 3 * from.y + 3 * mt * mt * t * s.c1.y + 3 * mt * t * t * s.c2.y + t ** 3 * s.to.y,
        });
    }
    from = s.to;
  }
  return pts;
}

describe("vectorize", () => {
  it("traces a square as four straight, axis-aligned edges with exact corners", () => {
    const cov = rectRaster(60, 60, 10.3, 12.2, 49.6, 47.8);
    const [path, ...rest] = vectorize(cov, 60, 60);
    expect(rest).toHaveLength(0);
    expect(path!.segments).toHaveLength(4);
    expect(path!.segments.every((s) => s.type === "L")).toBe(true);
    const corners = path!.segments.map((s) => s.to);
    for (const c of corners) {
      expect(Math.min(Math.abs(c.x - 10.3), Math.abs(c.x - 49.6))).toBeLessThan(0.05);
      expect(Math.min(Math.abs(c.y - 12.2), Math.abs(c.y - 47.8))).toBeLessThan(0.05);
    }
  });

  it("traces a circle as smooth curves that stay on the true outline", () => {
    const cx = 50.4,
      cy = 49.7,
      r = 31.3;
    const cov = raster(100, 100, (x, y) => Math.hypot(x - cx, y - cy) <= r);
    const [path] = vectorize(cov, 100, 100);
    expect(path!.segments.length).toBeGreaterThanOrEqual(2);
    expect(path!.segments.every((s) => s.type === "C")).toBe(true);
    expect(path!.segments.length).toBeLessThanOrEqual(8);
    for (const p of sample(path!))
      expect(Math.abs(Math.hypot(p.x - cx, p.y - cy) - r)).toBeLessThan(0.3);
  });

  it("keeps holes and drops specks", () => {
    const cov = raster(80, 80, (x, y) => {
      const ring = Math.hypot(x - 40, y - 40);
      const speck = Math.hypot(x - 5, y - 5) < 1.2;
      return (ring <= 30 && ring >= 15) || speck;
    });
    const paths = vectorize(cov, 80, 80);
    expect(paths).toHaveLength(2);
    const svg = toSvg(paths, 80, 80);
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).not.toContain("stroke");
    expect(svg.match(/M/g)).toHaveLength(2);
  });

  it("keeps a sharp tip sharp", () => {
    // Thin wedge pointing left: tip at (8, 30).
    const cov = raster(
      80,
      60,
      (x, y) => x >= 8 && x <= 70 && Math.abs(y - 30) <= ((x - 8) / 62) * 20,
    );
    const [path] = vectorize(cov, 80, 60);
    const minX = Math.min(...sample(path!).map((p) => p.x));
    expect(minX).toBeLessThan(8.8);
  });

  it("recreates the transparent Greek-key mark with exact straight edges and only its two rounded corners curved", () => {
    const { width, height, rgba } = decodePng("src/test/fixtures/greek-key-mark.png");
    const source = coverageFromRgba(rgba, width, height);
    const paths = vectorize(source, width, height);
    expect(paths).toHaveLength(2);
    const segments = paths.flatMap((p) => p.segments);
    expect(segments.filter((s) => s.type === "C")).toHaveLength(2);
    // Every straight edge is exactly horizontal or vertical.
    for (const p of paths) {
      let from = p.start;
      for (const s of p.segments) {
        if (s.type === "L") expect(s.to.x === from.x || s.to.y === from.y).toBe(true);
        from = s.to;
      }
    }
    // Edges touching the canvas sit exactly on it.
    const xs = segments.map((s) => s.to.x);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(width);
    // Pixel coverage matches the source almost everywhere.
    const traced = rasterizePaths(paths, width, height);
    let total = 0,
      worst = 0;
    for (let i = 0; i < source.length; i++) {
      const e = Math.abs(traced[i]! - source[i]!);
      total += e;
      worst = Math.max(worst, e);
    }
    expect(total / source.length).toBeLessThan(0.006);
    expect(worst).toBeLessThan(0.45);
  });
});
