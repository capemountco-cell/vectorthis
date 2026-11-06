// Pure helpers (no DOM) that keep AI redraws close to the original logo:
// - isCleanLogo: is the upload a clean logo file (vs. a photo of a logo)?
// - geometryBrief: measured facts from the vector trace, written for the image model.
// - coverageSignature / matchScore: how closely a redraw's shape matches the original.
import type { Point, TracedPath } from "@/lib/vectorize";

/** A clean logo file has a flat background and crisp, mostly fully-inked pixels. */
export function isCleanLogo(coverage: Float32Array, width: number, height: number) {
  let ink = 0,
    mid = 0;
  for (let i = 0; i < coverage.length; i++) {
    const c = coverage[i]!;
    if (c >= 0.5) ink++;
    if (c > 0.2 && c < 0.8) mid++;
  }
  const area = width * height;
  if (ink < area * 0.002 || ink > area * 0.9) return false;
  // Antialiased edges give some mid-tones; photos, textures and shading give far more.
  return mid / ink < 0.2;
}

function flatten(path: TracedPath, steps = 8): Point[] {
  const pts: Point[] = [path.start];
  let from = path.start;
  for (const s of path.segments) {
    if (s.type === "L") pts.push(s.to);
    else
      for (let i = 1; i <= steps; i++) {
        const t = i / steps,
          mt = 1 - t;
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

function area(pts: Point[]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!,
      q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const segLen = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Plain-language geometry of a traced logo, for the image model: proportions,
 * separate shapes and their extents, holes, edge character, rounded corners and
 * symmetry. Positions are percentages of the mark's bounding box so they hold at
 * any output size.
 */
export function geometryBrief(paths: TracedPath[], signature?: Float32Array) {
  if (!paths.length) return "";
  const polys = paths.map((p) => flatten(p));
  const areas = polys.map(area);
  let biggest = 0;
  areas.forEach((a, i) => {
    if (Math.abs(a) > Math.abs(areas[biggest]!)) biggest = i;
  });
  const outerSign = Math.sign(areas[biggest]!);
  const all = polys.flat();
  const minX = Math.min(...all.map((p) => p.x)),
    maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y)),
    maxY = Math.max(...all.map((p) => p.y));
  const W = maxX - minX || 1,
    H = maxY - minY || 1;
  const outers = polys
    .map((poly, i) => ({ poly, a: areas[i]! }))
    .filter(({ a }) => Math.sign(a) === outerSign)
    .sort((p, q) => Math.abs(q.a) - Math.abs(p.a));
  const holes = polys.length - outers.length;

  let straight = 0,
    curved = 0,
    axis = 0,
    sharp = 0,
    right = 0;
  const rounded: string[] = [];
  for (const p of paths) {
    const n = p.segments.length;
    const starts = [p.start, ...p.segments.slice(0, -1).map((s) => s.to)];
    const dirOut = (k: number) => {
      const s = p.segments[k]!,
        a = starts[k]!;
      const t = s.type === "L" ? s.to : s.c1;
      return Math.atan2(t.y - a.y, t.x - a.x);
    };
    const dirIn = (k: number) => {
      const s = p.segments[k]!,
        a = starts[k]!;
      const f = s.type === "L" ? a : s.c2;
      return Math.atan2(s.to.y - f.y, s.to.x - f.x);
    };
    for (let k = 0; k < n; k++) {
      const s = p.segments[k]!,
        a = starts[k]!;
      const l = segLen(a, s.to);
      if (s.type === "L") {
        straight += l;
        if (a.x === s.to.x || a.y === s.to.y) axis += l;
      } else {
        curved += l;
        // A short curve between two straight edges meeting at ~90° is a rounded corner.
        const prev = p.segments[(k - 1 + n) % n]!,
          next = p.segments[(k + 1) % n]!;
        if (prev.type === "L" && next.type === "L" && l < Math.max(W, H) * 0.2) {
          let turn = Math.abs(dirOut((k + 1) % n) - dirIn((k - 1 + n) % n));
          if (turn > Math.PI) turn = 2 * Math.PI - turn;
          if (Math.abs(turn - Math.PI / 2) < 0.35) {
            const mx = (a.x + s.to.x) / 2,
              my = (a.y + s.to.y) / 2;
            const v = my < minY + H / 3 ? "top" : my > maxY - H / 3 ? "bottom" : "middle";
            const h = mx < minX + W / 3 ? "left" : mx > maxX - W / 3 ? "right" : "centre";
            const radius = Math.max(Math.abs(s.to.x - a.x), Math.abs(s.to.y - a.y));
            rounded.push(
              `${v}-${h} (radius about ${pct(radius / Math.min(W, H))} of the mark's ${W >= H ? "height" : "width"})`,
            );
          }
        }
      }
      // Corner at the end of this segment.
      const next = (k + 1) % n;
      let turn = Math.abs(dirOut(next) - dirIn(k));
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      if (turn > 0.5) {
        sharp++;
        if (Math.abs(turn - Math.PI / 2) < 0.05) right++;
      }
    }
  }
  const total = straight + curved || 1;
  const lines: string[] = [];
  lines.push(
    `Overall width:height = ${(W / H).toFixed(2)} (${W >= H ? `${pct(H / W)} as tall as wide` : `${pct(W / H)} as wide as tall`}).`,
  );
  lines.push(
    `${outers.length} separate solid shape${outers.length === 1 ? "" : "s"} and ${holes} enclosed hole${holes === 1 ? "" : "s"}.`,
  );
  if (outers.length <= 6)
    outers.forEach(({ poly }, i) => {
      const xs = poly.map((q) => q.x),
        ys = poly.map((q) => q.y);
      lines.push(
        `Shape ${i + 1} spans x ${pct((Math.min(...xs) - minX) / W)}–${pct((Math.max(...xs) - minX) / W)}, y ${pct((Math.min(...ys) - minY) / H)}–${pct((Math.max(...ys) - minY) / H)} of the mark (0% = left/top).`,
      );
    });
  else
    lines.push("Keep every separate shape (e.g. each letter) in its original position and size.");
  if (straight / total > 0.9 && axis / Math.max(straight, 1e-9) > 0.95)
    lines.push(
      "Built from perfectly straight horizontal and vertical edges; keep every edge ruler-straight and axis-aligned.",
    );
  else
    lines.push(
      `Outline is about ${pct(straight / total)} straight edges and ${pct(curved / total)} curves.`,
    );
  if (sharp)
    lines.push(
      `${sharp} sharp corner${sharp === 1 ? "" : "s"}${right === sharp ? ", all exact right angles" : ""}; keep them crisp, not rounded.`,
    );
  lines.push(
    !rounded.length
      ? "No rounded corners."
      : rounded.length <= 6
        ? `Only ${rounded.length} rounded corner${rounded.length === 1 ? "" : "s"}: ${rounded.join("; ")}.`
        : `${rounded.length} small rounded corners or stroke ends; keep their softness exactly as in the original.`,
  );
  if (signature) {
    const sym = symmetry(signature);
    if (sym.length) lines.push(`${sym.join(" and ")} symmetric.`);
    else lines.push("Not symmetric; do not mirror or balance it.");
  }
  return lines.join(" ");
}

/** Ink coverage resampled so the mark's bounding box fills a size×size grid, aspect preserved and centred. */
export function coverageSignature(
  coverage: Float32Array,
  width: number,
  height: number,
  size = 128,
) {
  let x0 = width,
    y0 = height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (coverage[y * width + x]! >= 0.5) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  const out = new Float32Array(size * size);
  if (x1 < x0) return out;
  // Sub-pixel box: partial coverage just outside/inside the 50% box shifts each edge.
  const colMax = (x: number) => {
    let m = 0;
    if (x >= 0 && x < width)
      for (let y = y0; y <= y1; y++) m = Math.max(m, coverage[y * width + x]!);
    return m;
  };
  const rowMax = (y: number) => {
    let m = 0;
    if (y >= 0 && y < height)
      for (let x = x0; x <= x1; x++) m = Math.max(m, coverage[y * width + x]!);
    return m;
  };
  const left = x0 + 1 - colMax(x0) - colMax(x0 - 1),
    right = x1 + colMax(x1) + colMax(x1 + 1),
    top = y0 + 1 - rowMax(y0) - rowMax(y0 - 1),
    bottom = y1 + rowMax(y1) + rowMax(y1 + 1);
  const bw = right - left,
    bh = bottom - top;
  const scale = size / Math.max(bw, bh);
  const ox = (size - bw * scale) / 2,
    oy = (size - bh * scale) / 2;
  // Bilinear samples (4×4 per cell) treating pixel centres at +0.5, so tiny and large
  // renderings of the same shape produce the same signature.
  const at = (x: number, y: number) =>
    x < x0 || x > x1 || y < y0 || y > y1 ? 0 : coverage[y * width + x]!;
  for (let gy = 0; gy < size; gy++)
    for (let gx = 0; gx < size; gx++) {
      let acc = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const fx = left + (gx + (sx + 0.5) / 4 - ox) / scale - 0.5;
          const fy = top + (gy + (sy + 0.5) / 4 - oy) / scale - 0.5;
          const ix = Math.floor(fx),
            iy = Math.floor(fy),
            tx = fx - ix,
            ty = fy - iy;
          acc +=
            at(ix, iy) * (1 - tx) * (1 - ty) +
            at(ix + 1, iy) * tx * (1 - ty) +
            at(ix, iy + 1) * (1 - tx) * ty +
            at(ix + 1, iy + 1) * tx * ty;
        }
      out[gy * size + gx] = acc / 16;
    }
  return out;
}

/**
 * Intersection-over-union of the two shapes' 50% outlines (1 = identical shape).
 * Hard outlines, not soft coverage, so a blurry low-res original isn't penalised for its blur.
 */
export function matchScore(a: Float32Array, b: Float32Array) {
  let inter = 0,
    union = 0;
  for (let i = 0; i < a.length; i++) {
    const p = a[i]! >= 0.5,
      q = (b[i] ?? 0) >= 0.5;
    if (p && q) inter++;
    if (p || q) union++;
  }
  return union ? inter / union : 0;
}

function symmetry(sig: Float32Array) {
  const size = Math.round(Math.sqrt(sig.length));
  const flip = (f: (x: number, y: number) => number) => {
    const out = new Float32Array(sig.length);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[y * size + x] = sig[f(x, y)]!;
    return matchScore(sig, out);
  };
  const result: string[] = [];
  if (flip((x, y) => y * size + (size - 1 - x)) > 0.96) result.push("Left-right mirror");
  if (flip((x, y) => (size - 1 - y) * size + x) > 0.96) result.push("Top-bottom mirror");
  if (!result.length && flip((x, y) => (size - 1 - y) * size + (size - 1 - x)) > 0.96)
    result.push("180° rotationally");
  return result;
}
