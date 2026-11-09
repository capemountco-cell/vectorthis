// Colour vectorizing (pure, no DOM): splits a logo into colour regions, fits each with a
// flat colour or a linear gradient, and traces every region with the detailed tracer.
//
// 1. Regions grow across small colour steps only, so a smooth gradient stays one region
//    while any real edge (including the antialiased pixels on it) stops the growth.
// 2. Each region gets a flat colour or a multi-stop linear gradient fitted to its pixels.
// 3. Edge pixels (too mixed to belong to any region) are shared out between the two
//    regions whose colours mix to make them, which keeps edges sub-pixel accurate.
// 4. Every region is traced from its own coverage, and slightly overlaps the regions drawn
//    on top of it so no hairline seams show between neighbours.
import { coverageFromRgba, edgeSoftness, pathData, vectorizeScaled, type TracedPath } from "@/lib/vectorize";
import { dE, distanceInside, hex, labOf, rgbOf } from "@/lib/color-math";
import { fillAt, fitShading } from "@/lib/shading";

/** opacity < 1 only on soft shading overlays (highlights and shadows), which fade out. */
export type GradientStop = { offset: number; color: string; opacity?: number | undefined };
export type Fill =
  | { type: "solid"; color: string }
  | { type: "linear"; x1: number; y1: number; x2: number; y2: number; stops: GradientStop[] }
  /** Elliptical radial gradient: radius r across, r × sy down, centred on (cx, cy). */
  | { type: "radial"; cx: number; cy: number; r: number; sy: number; stops: GradientStop[] };

/** A shading overlay: drawn over the shape below it with the same outline, fading to clear. */
export function isOverlay(fill: Fill) {
  return fill.type !== "solid" && fill.stops.some((s) => (s.opacity ?? 1) < 1);
}
export type ColorLayer = { paths: TracedPath[]; fill: Fill };

export type ColorAdvice = {
  recommend: "color" | "mono";
  /** 0–100: how much is lost by going black & white. */
  score: number;
  colors: number;
  gradients: number;
  palette: string[];
  reason: string;
};

export { hex } from "@/lib/color-math";

// ---------- regions ----------

type Model =
  | { kind: "flat"; rgb: [number, number, number] }
  | { kind: "shaded"; fill: Fill; overlays: Fill[] };

type Region = {
  id: number;
  area: number;
  lab: [number, number, number];
  rgb: [number, number, number];
  x0: number; y0: number; x1: number; y1: number;
  background: boolean;
  model: Model;
};

export type Segmentation = {
  width: number;
  height: number;
  transparent: boolean;
  /** Region id per pixel; 0 = transparent, -1 = edge pixel shared between regions. */
  labels: Int32Array;
  regions: Map<number, Region>;
  alpha: Float32Array;
  rgb: Float32Array;
  lab: Float32Array;
  bgRgb: [number, number, number];
};

const STEP = 5; // max colour step (ΔE) between neighbours inside one region
const SPREAD = 110; // max distance (ΔE) from the region's running mean (wide enough for long gradients)
const TRAIL = 8; // max distance (ΔE) from the trail colour the region grew along
const TRAIL_FOLLOW = 0.4; // how fast the trail follows (higher = shorter lag behind a soft edge)
const BG_FLOOD = 14; // background flood from the border: max ΔE from the background colour
const BG_ANY = 5; // anywhere in the image: this close to the background colour is background
const BG_DE = 12; // regions this close to the background colour are background

export function segment(rgba: Uint8ClampedArray, width: number, height: number, opts: { shading?: boolean } = {}): Segmentation {
  const n = width * height;
  const rgb = new Float32Array(n * 3), lab = new Float32Array(n * 3), alpha = new Float32Array(n);
  let clear = 0;
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4]!, g = rgba[i * 4 + 1]!, b = rgba[i * 4 + 2]!;
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
    const L = labOf(r, g, b);
    lab[i * 3] = L[0]; lab[i * 3 + 1] = L[1]; lab[i * 3 + 2] = L[2];
    alpha[i] = (rgba[i * 4 + 3] ?? 255) / 255;
    if (alpha[i]! < 0.5) clear++;
  }
  const transparent = clear > n * 0.02;

  // Background colour for opaque images: median of the border.
  const border: number[][] = [[], [], []];
  const push = (x: number, y: number) => { const i = y * width + x; for (let c = 0; c < 3; c++) border[c]!.push(rgb[i * 3 + c]!); };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { push(0, y); push(width - 1, y); }
  const med = (v: number[]) => v.sort((p, q) => p - q)[v.length >> 1] ?? 255;
  const bgRgb = border.map(med) as [number, number, number];
  const bgLab = labOf(...bgRgb);

  const labels = new Int32Array(n).fill(-2);
  const queue = new Int32Array(n);
  // Trail colour: a running blend of the colours along the path the region grew by. A
  // gradient changes slowly, so its trail keeps up; a soft edge changes fast, so a pixel
  // across it no longer matches the trail and growth stops there.
  const trail = new Float32Array(n * 3);
  const regions = new Map<number, Region>();
  let next = 1;

  // Background first (opaque images): flood in from the border over pixels close to the
  // background colour, plus near-exact background colour anywhere (enclosed gaps). Ink
  // regions then grow only among what is left, so a soft edge can never merge a shape into
  // the background, or the background into a shape.
  if (!transparent) {
    const id = next++;
    const near = (i: number) => Math.hypot(lab[i * 3]! - bgLab[0], lab[i * 3 + 1]! - bgLab[1], lab[i * 3 + 2]! - bgLab[2]);
    let head = 0, tail = 0, area = 0;
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    const seed = (i: number) => {
      if (labels[i] !== -2 || near(i) > BG_FLOOD) return;
      labels[i] = id;
      queue[tail++] = i;
    };
    for (let x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { seed(y * width); seed(y * width + width - 1); }
    for (let i = 0; i < n; i++) if (labels[i] === -2 && near(i) <= BG_ANY) { labels[i] = id; queue[tail++] = i; }
    while (head < tail) {
      const p = queue[head++]!;
      area++;
      const x = p % width, y = (p / width) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0) seed(p - 1);
      if (x < width - 1) seed(p + 1);
      if (y > 0) seed(p - width);
      if (y < height - 1) seed(p + width);
    }
    if (area)
      regions.set(id, { id, area, lab: bgLab, rgb: bgRgb, x0, y0, x1, y1, background: true, model: { kind: "flat", rgb: bgRgb } });
  }

  for (let s = 0; s < n; s++) {
    if (labels[s] !== -2) continue;
    if (transparent && alpha[s]! < 0.5) { labels[s] = 0; continue; }
    const id = next++;
    let head = 0, tail = 0, area = 0;
    let mL = 0, ma = 0, mb = 0, sr = 0, sg = 0, sb = 0;
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    labels[s] = id;
    queue[tail++] = s;
    trail[s * 3] = lab[s * 3]!; trail[s * 3 + 1] = lab[s * 3 + 1]!; trail[s * 3 + 2] = lab[s * 3 + 2]!;
    while (head < tail) {
      const p = queue[head++]!;
      area++;
      mL += (lab[p * 3]! - mL) / area; ma += (lab[p * 3 + 1]! - ma) / area; mb += (lab[p * 3 + 2]! - mb) / area;
      sr += rgb[p * 3]!; sg += rgb[p * 3 + 1]!; sb += rgb[p * 3 + 2]!;
      const x = p % width, y = (p / width) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      const nb = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1];
      for (const q of nb) {
        if (q < 0 || labels[q] !== -2) continue;
        if (transparent && alpha[q]! < 0.5) continue;
        if (dE(lab, p * 3, lab, q * 3) > STEP) continue;
        if (dE(trail, p * 3, lab, q * 3) > TRAIL) continue;
        if (Math.hypot(lab[q * 3]! - mL, lab[q * 3 + 1]! - ma, lab[q * 3 + 2]! - mb) > SPREAD) continue;
        labels[q] = id;
        queue[tail++] = q;
        for (let c = 0; c < 3; c++) trail[q * 3 + c] = (1 - TRAIL_FOLLOW) * trail[p * 3 + c]! + TRAIL_FOLLOW * lab[q * 3 + c]!;
      }
    }
    regions.set(id, {
      id, area, lab: [mL, ma, mb], rgb: [sr / area, sg / area, sb / area],
      x0, y0, x1, y1, background: false, model: { kind: "flat", rgb: [sr / area, sg / area, sb / area] },
    });
  }

  // Tiny or sliver-thin regions are edge pixels (antialiasing halos, compression noise):
  // they are shared out between their neighbours later instead of becoming shapes.
  const minArea = Math.max(24, Math.round(n * 0.0002));
  const rim = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const l = labels[i]!;
    if (l <= 0) continue;
    const x = i % width, y = (i / width) | 0;
    if ((x > 0 && labels[i - 1] !== l) || (x < width - 1 && labels[i + 1] !== l) || (y > 0 && labels[i - width] !== l) || (y < height - 1 && labels[i + width] !== l))
      rim.set(l, (rim.get(l) ?? 0) + 1);
  }
  // Thickness ≈ area / rim pixels: a real shape is several px thick, a halo is 1–2.
  const suspect = (r: Region) => !r.background && (r.area < minArea || r.area / Math.max(1, rim.get(r.id) ?? 1) < 2.2);
  // Small or thin is not enough to call a region a halo: fine lettering is small and thin too.
  // A halo's colour is a blend of the regions beside it; a real shape has its own colour.
  const neighbours = new Map<number, Set<number>>();
  for (let i = 0; i < n; i++) {
    const l = labels[i]!;
    const r = regions.get(l);
    if (!r || !suspect(r)) continue;
    const x = i % width, y = (i / width) | 0;
    for (const q of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) {
      if (q < 0) continue;
      const m = labels[q]!;
      if (m !== l && m > 0) {
        let set = neighbours.get(l);
        if (!set) neighbours.set(l, (set = new Set()));
        set.add(m);
      }
    }
  }
  const blendOfNeighbours = (r: Region) => {
    const ids = [...(neighbours.get(r.id) ?? [])].filter((id) => regions.has(id));
    const c = r.rgb;
    const near = (A: number[]) => Math.hypot(c[0] - A[0]!, c[1] - A[1]!, c[2] - A[2]!) < 14;
    // Next to a region of (almost) its own colour: a fragment of it, not a separate shape.
    if (ids.some((id) => near(regions.get(id)!.rgb))) return true;
    for (let u = 0; u < ids.length; u++)
      for (let v = u + 1; v < ids.length; v++) {
        const A = regions.get(ids[u]!)!.rgb, B = regions.get(ids[v]!)!.rgb;
        const d = [A[0] - B[0], A[1] - B[1], A[2] - B[2]];
        const dd = d[0]! * d[0]! + d[1]! * d[1]! + d[2]! * d[2]!;
        if (dd < 100) continue;
        const t = Math.max(0, Math.min(1, ((c[0] - B[0]) * d[0]! + (c[1] - B[1]) * d[1]! + (c[2] - B[2]) * d[2]!) / dd));
        if (near([B[0] + t * d[0]!, B[1] + t * d[1]!, B[2] + t * d[2]!])) return true;
      }
    return false;
  };
  // Interior pixels (all four neighbours in the same region): a 1–2px sliver has none, while
  // a real shape, even lettering with 3px strokes, does.
  const interior = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const l = labels[i]!;
    if (l <= 0) continue;
    const x = i % width, y = (i / width) | 0;
    if (x > 0 && x < width - 1 && y > 0 && y < height - 1 && labels[i - 1] === l && labels[i + 1] === l && labels[i - width] === l && labels[i + width] === l)
      interior.set(l, (interior.get(l) ?? 0) + 1);
  }
  const isEdge = (r: Region) => suspect(r) && (r.area < 6 || !interior.get(r.id) || ids0(r) || blendOfNeighbours(r));
  // A sliver touching only one other region (e.g. a halo ring inside a shape) is part of it.
  const ids0 = (r: Region) => (neighbours.get(r.id)?.size ?? 0) === 0;
  const drop = [...regions.values()].filter(isEdge).map((r) => r.id);
  const dropSet = new Set(drop);
  for (let i = 0; i < n; i++) if (dropSet.has(labels[i]!)) labels[i] = -1;
  for (const id of drop) regions.delete(id);
  // Any other region that is still background-coloured (e.g. an enclosed off-white patch).
  if (!transparent)
    for (const r of regions.values())
      if (!r.background && Math.hypot(r.lab[0] - bgLab[0], r.lab[1] - bgLab[1], r.lab[2] - bgLab[2]) < BG_DE) {
        r.background = true;
        r.model = { kind: "flat", rgb: bgRgb };
      }
  if (opts.shading) next = splitAppendages(labels, lab, rgb, width, regions, next);
  const seg: Segmentation = { width, height, transparent, labels, regions, alpha, rgb, lab, bgRgb };
  for (const r of regions.values()) if (!r.background) r.model = fitModel(seg, r, opts.shading ?? false);
  return seg;
}

// ---------- colour models ----------

/**
 * Fits a region's fill from its inner pixels (those a few px from its outline: edge pixels
 * are part background, which would wash out the colours).
 */
function fitModel(seg: Segmentation, r: Region, shading: boolean): Model {
  const { width, labels, rgb } = seg;
  const bw = r.x1 - r.x0 + 1, bh = r.y1 - r.y0 + 1;
  const mask = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (labels[(y + r.y0) * width + x + r.x0] === r.id) mask[y * bw + x] = 1;
  const dist = distanceInside(mask, bw, bh);
  let deepest = 0;
  for (let j = 0; j < bw * bh; j++) if (dist[j]! > deepest) deepest = dist[j]!;
  const dmin = deepest >= 8 ? 3 : deepest >= 3 ? 1.5 : 1;
  let n = 0;
  for (let j = 0; j < bw * bh; j++) if (dist[j]! >= dmin) n++;
  const xs = new Float32Array(n), ys = new Float32Array(n), cs = new Float32Array(n * 3);
  let k = 0;
  for (let j = 0; j < bw * bh; j++) {
    if (dist[j]! < dmin) continue;
    const x = (j % bw) + r.x0, y = ((j / bw) | 0) + r.y0, i = y * width + x;
    xs[k] = x; ys[k] = y;
    cs[k * 3] = rgb[i * 3]!; cs[k * 3 + 1] = rgb[i * 3 + 1]!; cs[k * 3 + 2] = rgb[i * 3 + 2]!;
    k++;
  }
  if (n < 30) return { kind: "flat", rgb: r.rgb };
  // Overlays only for regions big enough to carry visible shading.
  const big = r.area >= Math.max(2000, seg.width * seg.height * 0.01);
  const { base, overlays } = fitShading({ xs, ys, cs, n }, r, { soft: shading, overlays: shading && big ? 5 : 0 });
  if (base.type === "solid" && !overlays.length) return { kind: "flat", rgb: rgbOf(base.color) };
  return { kind: "shaded", fill: base, overlays };
}

/** The colour a region's model paints at a pixel (overlays included). */
function modelColor(r: Region, x: number, y: number): [number, number, number] {
  if (r.model.kind === "flat") return r.model.rgb;
  const c = fillAt(r.model.fill, x + 0.5, y + 0.5).c.slice() as [number, number, number];
  for (const o of r.model.overlays) {
    const { c: oc, a } = fillAt(o, x + 0.5, y + 0.5);
    for (let k = 0; k < 3; k++) c[k] = c[k]! + (oc[k]! - c[k]!) * a;
  }
  return c;
}

// ---------- appendages ----------

/**
 * Splits off thin parts of a large region that are clearly another colour, such as an apple's
 * stem joined to the fruit through soft shading: region growth can walk across that blend,
 * but a morphological opening cuts the stem off at the fruit's outline, and its colour
 * decides whether it is a separate shape.
 */
function splitAppendages(labels: Int32Array, lab: Float32Array, rgb: Float32Array, width: number, regions: Map<number, Region>, nextId: number) {
  for (const r of [...regions.values()]) {
    if (r.background) continue;
    const bw = r.x1 - r.x0 + 1, bh = r.y1 - r.y0 + 1;
    if (r.area < 1500 || Math.min(bw, bh) < 40) continue;
    const rad = Math.max(3, Math.min(20, Math.round(0.03 * Math.min(bw, bh))));
    const mask = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (labels[(y + r.y0) * width + x + r.x0] === r.id) mask[y * bw + x] = 1;
    const inner = distanceInside(mask, bw, bh);
    const eroded = new Uint8Array(bw * bh);
    let any = false;
    for (let j = 0; j < bw * bh; j++) if (inner[j]! > rad) { eroded[j] = 1; any = true; }
    if (!any) continue;
    // Opening = erosion then dilation (distance to the eroded set ≤ rad).
    const notEroded = new Uint8Array(bw * bh);
    for (let j = 0; j < bw * bh; j++) notEroded[j] = eroded[j] ? 0 : 1;
    const toEroded = distanceInside(notEroded, bw, bh, true);
    const residue = new Uint8Array(bw * bh);
    for (let j = 0; j < bw * bh; j++) if (mask[j] && toEroded[j]! > rad + 0.5) residue[j] = 1;
    let body: number[] | null = null;
    const bodyMean = () => {
      if (body) return body;
      const m = [0, 0, 0];
      let cnt = 0;
      for (let j = 0; j < bw * bh; j++) {
        if (!mask[j] || residue[j]) continue;
        const i = ((j / bw) | 0) * width + r.y0 * width + (j % bw) + r.x0;
        for (let k = 0; k < 3; k++) m[k]! += lab[i * 3 + k]!;
        cnt++;
      }
      return (body = m.map((v) => v / Math.max(1, cnt)));
    };
    // Connected parts of what the opening removed.
    const comp = new Int32Array(bw * bh).fill(-1);
    const stack: number[] = [];
    let c = 0;
    for (let j0 = 0; j0 < bw * bh; j0++) {
      if (!residue[j0] || comp[j0]! >= 0) continue;
      const pix: number[] = [];
      comp[j0] = c; stack.push(j0);
      while (stack.length) {
        const j = stack.pop()!;
        pix.push(j);
        const x = j % bw, y = (j / bw) | 0;
        // Gaps of up to 2 px are bridged: a stem's tip can hang on by edge pixels only.
        for (let yy = Math.max(0, y - 2); yy <= Math.min(bh - 1, y + 2); yy++)
          for (let xx = Math.max(0, x - 2); xx <= Math.min(bw - 1, x + 2); xx++) {
            const q = yy * bw + xx;
            if (residue[q] && comp[q]! < 0) { comp[q] = c; stack.push(q); }
          }
      }
      c++;
      if (pix.length < Math.max(60, r.area * 0.002)) continue;
      // Its colour against the body right where it joins (body pixels within a few px).
      const near = new Set<number>();
      let frontier = pix;
      for (let it = 0; it < 4; it++) {
        const nxt: number[] = [];
        for (const j of frontier) {
          const x = j % bw, y = (j / bw) | 0;
          for (const q of [x > 0 ? j - 1 : -1, x < bw - 1 ? j + 1 : -1, y > 0 ? j - bw : -1, y < bh - 1 ? j + bw : -1])
            if (q >= 0 && mask[q] && !residue[q] && !near.has(q)) { near.add(q); nxt.push(q); }
        }
        frontier = nxt;
      }
      if (near.size < 10) continue; // not attached to the body: leave it
      const mean = (js: Iterable<number>) => {
        const m = [0, 0, 0];
        let cnt = 0;
        for (const j of js) { const i = ((j / bw) | 0) * width + r.y0 * width + (j % bw) + r.x0; for (let k = 0; k < 3; k++) m[k]! += lab[i * 3 + k]!; cnt++; }
        return m.map((v) => v / Math.max(1, cnt));
      };
      const own = mean(pix);
      if (dE(own, 0, mean(near), 0) < 18 && dE(own, 0, bodyMean(), 0) < 25) continue;
      const id = nextId++;
      let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
      const sum = [0, 0, 0], sumL = [0, 0, 0];
      for (const j of pix) {
        const x = (j % bw) + r.x0, y = ((j / bw) | 0) + r.y0, i = y * width + x;
        labels[i] = id;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (let k = 0; k < 3; k++) { sum[k]! += rgb[i * 3 + k]!; sumL[k]! += lab[i * 3 + k]!; }
      }
      const m = pix.length;
      const rgbM = sum.map((v) => v / m) as [number, number, number];
      regions.set(id, { id, area: m, lab: sumL.map((v) => v / m) as [number, number, number], rgb: rgbM, x0, y0, x1, y1, background: false, model: { kind: "flat", rgb: rgbM } });
      r.area -= m;
    }
  }
  return nextId;
}

// ---------- edge pixels ----------

type Share = { a: number; wa: number; b: number; wb: number };

/**
 * Splits each edge pixel between the two regions whose colours mix to make it. On opaque
 * images this covers a band a few px either side of every boundary, and each side's colour is
 * read from its own pixels just beyond the band: soft, shaded edges then get a true sub-pixel
 * outline instead of one that wobbles with the region's overall gradient.
 */
function shareEdges(seg: Segmentation): Map<number, Share> {
  const { width, height, labels, regions, rgb, alpha, transparent } = seg;
  const shares = new Map<number, Share>();
  // Soft edges can leave several px of unassigned pixels between two regions, so candidates
  // are looked for a little further out than the band.
  const BAND = 2, LOCAL = 7, REACH = transparent ? 2 : 4;
  const band = new Uint8Array(labels.length);
  if (!transparent) {
    const edge = new Uint8Array(labels.length);
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i]!, x = i % width, y = (i / width) | 0;
      if (l === -1 || (x > 0 && labels[i - 1] !== l) || (x < width - 1 && labels[i + 1] !== l) || (y > 0 && labels[i - width] !== l) || (y < height - 1 && labels[i + width] !== l))
        edge[i] = 1;
    }
    for (let i = 0; i < labels.length; i++) {
      if (!edge[i]) continue;
      const x = i % width, y = (i / width) | 0;
      for (let yy = Math.max(0, y - BAND); yy <= Math.min(height - 1, y + BAND); yy++)
        for (let xx = Math.max(0, x - BAND); xx <= Math.min(width - 1, x + BAND); xx++) band[yy * width + xx] = 1;
    }
  }
  /** Mean colour of a region's own pixels near (x, y), outside the band; model colour if none. */
  const localColor = (id: number, x: number, y: number): [number, number, number] => {
    const m = [0, 0, 0];
    let cnt = 0;
    for (let yy = Math.max(0, y - LOCAL); yy <= Math.min(height - 1, y + LOCAL); yy++)
      for (let xx = Math.max(0, x - LOCAL); xx <= Math.min(width - 1, x + LOCAL); xx++) {
        const j = yy * width + xx;
        if (labels[j] !== id || band[j]) continue;
        m[0]! += rgb[j * 3]!; m[1]! += rgb[j * 3 + 1]!; m[2]! += rgb[j * 3 + 2]!;
        cnt++;
      }
    return cnt >= 3 ? [m[0]! / cnt, m[1]! / cnt, m[2]! / cnt] : modelColor(regions.get(id)!, x, y);
  };
  for (let i = 0; i < labels.length; i++) {
    const lab = labels[i]!;
    const edge = lab === -1 || band[i] === 1 || (transparent && lab === 0 && alpha[i]! > 0.02);
    if (!edge) continue;
    const x = i % width, y = (i / width) | 0;
    const cand = new Set<number>();
    for (let dy = -REACH; dy <= REACH; dy++)
      for (let dx = -REACH; dx <= REACH; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const l = labels[yy * width + xx]!;
        if (l > 0 && regions.has(l)) cand.add(l);
      }
    if (!cand.size) continue;
    const p = [rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!];
    const list = [...cand].map((id) => ({ id, c: transparent ? modelColor(regions.get(id)!, x, y) : localColor(id, x, y) }));
    if (transparent) {
      // Alpha already says how much ink there is; colour picks which region it belongs to.
      let best = list[0]!, bestD = Infinity;
      for (const r of list) { const d = Math.hypot(p[0]! - r.c[0], p[1]! - r.c[1], p[2]! - r.c[2]); if (d < bestD) { bestD = d; best = r; } }
      shares.set(i, { a: best.id, wa: alpha[i]!, b: 0, wb: 0 });
      continue;
    }
    let best: Share = { a: list[0]!.id, wa: 1, b: 0, wb: 0 };
    let bestErr = Infinity;
    for (let u = 0; u < list.length; u++) {
      const A = list[u]!;
      const e1 = Math.hypot(p[0]! - A.c[0], p[1]! - A.c[1], p[2]! - A.c[2]);
      if (e1 < bestErr) { bestErr = e1; best = { a: A.id, wa: 1, b: 0, wb: 0 }; }
      for (let v = u + 1; v < list.length; v++) {
        const Bc = list[v]!;
        const d = [A.c[0] - Bc.c[0], A.c[1] - Bc.c[1], A.c[2] - Bc.c[2]];
        const dd = d[0]! * d[0]! + d[1]! * d[1]! + d[2]! * d[2]!;
        if (dd < 1) continue;
        const t = Math.max(0, Math.min(1, ((p[0]! - Bc.c[0]) * d[0]! + (p[1]! - Bc.c[1]) * d[1]! + (p[2]! - Bc.c[2]) * d[2]!) / dd));
        const e = Math.hypot(p[0]! - (Bc.c[0] + t * d[0]!), p[1]! - (Bc.c[1] + t * d[1]!), p[2]! - (Bc.c[2] + t * d[2]!));
        if (e < bestErr) { bestErr = e; best = { a: A.id, wa: t, b: Bc.id, wb: 1 - t }; }
      }
    }
    shares.set(i, best);
  }
  return shares;
}

// ---------- advice ----------

export function colorAdvice(seg: Segmentation): ColorAdvice {
  const ink = [...seg.regions.values()].filter((r) => !r.background).sort((a, b) => b.area - a.area);
  const total = ink.reduce((s, r) => s + r.area, 0) || 1;
  // Group regions into distinct colours (ΔE < 12), weighted by area.
  const groups: { lab: [number, number, number]; area: number; rgb: [number, number, number] }[] = [];
  for (const r of ink) {
    const g = groups.find((q) => dE(q.lab, 0, r.lab, 0) < 12);
    if (g) g.area += r.area;
    else groups.push({ lab: r.lab, area: r.area, rgb: r.rgb });
  }
  const main = groups.filter((g) => g.area / total >= 0.02).sort((a, b) => b.area - a.area);
  const chroma = (g: { lab: number[] }) => Math.hypot(g.lab[1]!, g.lab[2]!);
  const colourful = main.filter((g) => chroma(g) > 15 && g.area / total >= 0.05);
  const maxChroma = Math.max(0, ...main.map(chroma));
  const gradients = ink.filter((r) => {
    if (r.model.kind !== "shaded" || r.model.fill.type === "solid" || r.area / total < 0.01) return false;
    const labs = r.model.fill.stops.map((st) => labOf(...rgbOf(st.color)));
    return labs.some((l) => dE(l, 0, labs[0]!, 0) >= 8);
  }).length;
  let score = 0;
  if (colourful.length) score += 35 + Math.min(25, maxChroma * 0.4);
  if (main.length >= 2) score += Math.min(25, (main.length - 1) * 12);
  score += Math.min(15, gradients * 5);
  score = Math.round(Math.min(100, score));
  const recommend = score >= 50 ? "color" : "mono";
  const palette = main.slice(0, 6).map((g) => hex(...g.rgb));
  const n = main.length;
  const reason =
    recommend === "color"
      ? `${n} colour${n === 1 ? "" : "s"}${gradients ? ` and ${gradients} gradient${gradients === 1 ? "" : "s"}` : ""} — keep colour`
      : maxChroma < 10
        ? "Black, white or near-neutral — nothing is lost in black & white"
        : "One muted colour — black & white keeps the shape";
  return { recommend, score, colors: n, gradients, palette, reason };
}

/** Quick advice from a downscaled copy (cheap enough to run on every trace). */
export function adviseColor(rgba: Uint8ClampedArray, width: number, height: number, maxSide = 320): ColorAdvice {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  if (scale >= 1) return colorAdvice(segment(rgba, width, height));
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  // Box-average downscale keeps colours true (nearest-neighbour would keep noise).
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x / scale), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) / scale));
      const sy0 = Math.floor(y / scale), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) / scale));
      const acc = [0, 0, 0, 0];
      let cnt = 0;
      for (let yy = sy0; yy < Math.min(height, sy1); yy++)
        for (let xx = sx0; xx < Math.min(width, sx1); xx++) {
          const i = (yy * width + xx) * 4;
          for (let c = 0; c < 4; c++) acc[c]! += rgba[i + c]!;
          cnt++;
        }
      for (let c = 0; c < 4; c++) out[(y * w + x) * 4 + c] = acc[c]! / Math.max(1, cnt);
    }
  return colorAdvice(segment(out, w, h));
}

// ---------- tracing ----------

export type ColorTrace = { layers: ColorLayer[]; advice: ColorAdvice };

export function traceColor(rgba: Uint8ClampedArray, width: number, height: number, targetLongSide = 2000): ColorTrace {
  const seg = segment(rgba, width, height, { shading: true });
  const shares = shareEdges(seg);
  const advice = colorAdvice(seg);
  const { labels, regions, alpha, transparent } = seg;
  const softness = edgeSoftness(coverageFromRgba(rgba, width, height), width, height);
  const k = Math.max(1, Math.min(4, Math.floor(targetLongSide / Math.max(width, height))));
  const ink = [...regions.values()].filter((r) => !r.background).sort((a, b) => b.area - a.area);
  const order = new Map(ink.map((r, i) => [r.id, i]));
  const own = (i: number, id: number) => {
    const s = shares.get(i);
    if (s) return (s.a === id ? s.wa : 0) + (s.b === id ? s.wb : 0);
    return labels[i] === id ? (transparent ? alpha[i]! : 1) : 0;
  };
  /** Coverage of regions drawn above `rank` at pixel i (for the seam-hiding overlap). */
  const above = (i: number, rank: number) => {
    const s = shares.get(i);
    const l = labels[i]!;
    if (!s) {
      if (l <= 0) return 0;
      const o = order.get(l);
      return o !== undefined && o > rank ? (transparent ? alpha[i]! : 1) : 0;
    }
    let v = 0;
    const oa = order.get(s.a), ob = order.get(s.b);
    if (oa !== undefined && oa > rank) v += s.wa;
    if (ob !== undefined && ob > rank) v += s.wb;
    return v;
  };

  const layers: ColorLayer[] = [];
  const PAD = 3, OVERLAP = 2;
  for (const [rank, r] of ink.entries()) {
    const x0 = Math.max(0, r.x0 - PAD), y0 = Math.max(0, r.y0 - PAD);
    const x1 = Math.min(width - 1, r.x1 + PAD), y1 = Math.min(height - 1, r.y1 + PAD);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const cov = new Float32Array(cw * ch);
    const mask = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        const v = own((y + y0) * width + x + x0, r.id);
        cov[y * cw + x] = v;
        if (v >= 0.5) mask[y * cw + x] = 1;
      }
    // Overlap: within OVERLAP px of this region, also cover what later layers paint on top.
    let band = mask;
    for (let it = 0; it < OVERLAP; it++) {
      const grown = band.slice();
      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++) {
          if (band[y * cw + x]) continue;
          if ((x > 0 && band[y * cw + x - 1]) || (x < cw - 1 && band[y * cw + x + 1]) || (y > 0 && band[(y - 1) * cw + x]) || (y < ch - 1 && band[(y + 1) * cw + x]))
            grown[y * cw + x] = 1;
        }
      band = grown;
    }
    for (let j = 0; j < cw * ch; j++)
      if (band[j]) {
        const i = ((j / cw) | 0) * width + y0 * width + (j % cw) + x0;
        cov[j] = Math.min(1, cov[j]! + above(i, rank));
      }
    const traced = vectorizeScaled(cov, cw, ch, k, softness, { minArea: 6 });
    if (!traced.length) continue;
    const shift = (p: { x: number; y: number }) => ({ x: p.x + x0, y: p.y + y0 });
    const paths = traced.map((p) => ({
      start: shift(p.start),
      segments: p.segments.map((s) => (s.type === "L" ? { type: "L" as const, to: shift(s.to) } : { type: "C" as const, c1: shift(s.c1), c2: shift(s.c2), to: shift(s.to) })),
    }));
    const fill: Fill = r.model.kind === "shaded" ? r.model.fill : { type: "solid", color: hex(...r.model.rgb) };
    layers.push({ paths, fill });
    // Highlights and shadows: the same outline again, filled with gradients that fade out.
    if (r.model.kind === "shaded") for (const o of r.model.overlays) layers.push({ paths, fill: o });
  }
  return { layers, advice };
}

// ---------- SVG ----------

const num = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};

/** Short content hash (FNV-1a over the fills and first points) for gradient ids. */
function idHash(layers: ColorLayer[]) {
  let h = 0x811c9dc5;
  const add = (v: string) => { for (let k = 0; k < v.length; k++) h = Math.imul(h ^ v.charCodeAt(k), 0x01000193); };
  for (const l of layers) {
    add(JSON.stringify(l.fill));
    const p = l.paths[0];
    if (p) add(`${num(p.start.x)},${num(p.start.y)},${p.segments.length}`);
  }
  return (h >>> 0).toString(36);
}

/** Scales an elliptical radial gradient vertically about its centre (SVG matrix form). */
export function radialTransform(f: { cy: number; sy: number }) {
  return `matrix(1 0 0 ${num(f.sy)} 0 ${num(f.cy * (1 - f.sy))})`;
}

/** One path per layer, back to front; gradients in <defs>, in source-pixel units. */
export function toLayeredSvg(layers: ColorLayer[], width: number, height: number, view = { x: 0, y: 0, width, height }) {
  const display = Math.max(1, 1024 / Math.max(view.width, view.height));
  const defs: string[] = [];
  // Gradient ids are unique per drawing, so two exported SVGs pasted into one page don't clash.
  const prefix = `v${idHash(layers)}`;
  const body = layers.map((layer, i) => {
    let fill: string;
    if (layer.fill.type === "solid") fill = layer.fill.color;
    else {
      const f = layer.fill;
      const stops = f.stops
        .map((s) => `<stop offset="${num(s.offset)}" stop-color="${s.color}"${s.opacity !== undefined && s.opacity < 1 ? ` stop-opacity="${num(s.opacity)}"` : ""}/>`)
        .join("");
      defs.push(
        f.type === "linear"
          ? `<linearGradient id="${prefix}g${i}" gradientUnits="userSpaceOnUse" x1="${num(f.x1)}" y1="${num(f.y1)}" x2="${num(f.x2)}" y2="${num(f.y2)}">${stops}</linearGradient>`
          : `<radialGradient id="${prefix}g${i}" gradientUnits="userSpaceOnUse" cx="${num(f.cx)}" cy="${num(f.cy)}" r="${num(f.r)}"` +
              (Math.abs(f.sy - 1) > 1e-3 ? ` gradientTransform="${radialTransform(f)}"` : "") +
              `>${stops}</radialGradient>`,
      );
      fill = `url(#${prefix}g${i})`;
    }
    return `<path fill="${fill}" fill-rule="evenodd" d="${pathData(layer.paths)}"/>`;
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(view.x)} ${num(view.y)} ${num(view.width)} ${num(view.height)}" width="${Math.round(view.width * display)}" height="${Math.round(view.height * display)}">` +
    (defs.length ? `<defs>${defs.join("")}</defs>` : "") +
    body.join("") +
    `</svg>`
  );
}
