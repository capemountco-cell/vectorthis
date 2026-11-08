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

export type GradientStop = { offset: number; color: string };
export type Fill =
  | { type: "solid"; color: string }
  | { type: "linear"; x1: number; y1: number; x2: number; y2: number; stops: GradientStop[] };
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

// ---------- colour maths ----------

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const LIN = Array.from({ length: 256 }, (_, i) => toLinear(i));

function labOf(r: number, g: number, b: number): [number, number, number] {
  const R = LIN[Math.max(0, Math.min(255, Math.round(r)))]!,
    G = LIN[Math.max(0, Math.min(255, Math.round(g)))]!,
    B = LIN[Math.max(0, Math.min(255, Math.round(b)))]!;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const dE = (a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number) =>
  Math.hypot(a[ai]! - b[bi]!, a[ai + 1]! - b[bi + 1]!, a[ai + 2]! - b[bi + 2]!);

export function hex(r: number, g: number, b: number) {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

// ---------- regions ----------

type Model =
  | { kind: "flat"; rgb: [number, number, number] }
  | { kind: "linear"; cx: number; cy: number; base: [number, number, number]; gx: number[]; gy: number[]; fill: Fill };

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
};

const STEP = 6; // max colour step (ΔE) between neighbours inside one region
const SPREAD = 110; // max distance (ΔE) from the region's running mean (wide enough for long gradients)
const TRAIL = 9; // max distance (ΔE) from the trail colour the region grew along
const BG_DE = 12; // regions this close to the background colour are background

export function segment(rgba: Uint8ClampedArray, width: number, height: number): Segmentation {
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
        for (let c = 0; c < 3; c++) trail[q * 3 + c] = 0.75 * trail[p * 3 + c]! + 0.25 * lab[q * 3 + c]!;
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
  const isEdge = (r: Region) => r.area < minArea || r.area / Math.max(1, rim.get(r.id) ?? 1) < 2.2;
  for (let i = 0; i < n; i++) {
    const r = regions.get(labels[i]!);
    if (r && isEdge(r)) labels[i] = -1;
  }
  for (const [id, r] of regions) if (isEdge(r)) regions.delete(id);
  if (!transparent)
    for (const r of regions.values())
      if (Math.hypot(r.lab[0] - bgLab[0], r.lab[1] - bgLab[1], r.lab[2] - bgLab[2]) < BG_DE) {
        r.background = true;
        r.model = { kind: "flat", rgb: bgRgb };
      }
  const seg: Segmentation = { width, height, transparent, labels, regions, alpha, rgb, lab };
  for (const r of regions.values()) if (!r.background) r.model = fitModel(seg, r);
  return seg;
}

// ---------- colour models ----------

function solve3(m: number[][], v: number[]): number[] {
  // Cramer's rule for a 3×3 system (well-conditioned: coordinates are centred).
  const det = (a: number[][]) =>
    a[0]![0]! * (a[1]![1]! * a[2]![2]! - a[1]![2]! * a[2]![1]!) -
    a[0]![1]! * (a[1]![0]! * a[2]![2]! - a[1]![2]! * a[2]![0]!) +
    a[0]![2]! * (a[1]![0]! * a[2]![1]! - a[1]![1]! * a[2]![0]!);
  const d = det(m);
  if (Math.abs(d) < 1e-9) return [v[0]! / Math.max(1, m[0]![0]!), 0, 0];
  return [0, 1, 2].map((c) => det(m.map((row, r) => row.map((x, k) => (k === c ? v[r]! : x)))) / d);
}

/** Flat colour, or a linear gradient with up to 6 stops when the region visibly shades. */
function fitModel(seg: Segmentation, r: Region): Model {
  const { width, labels, rgb } = seg;
  const pts: number[] = [];
  for (let y = r.y0; y <= r.y1; y++)
    for (let x = r.x0; x <= r.x1; x++) {
      const i = y * width + x;
      if (labels[i] !== r.id) continue;
      // Interior pixels only: edge pixels are partly another colour.
      if (labels[i - 1] !== r.id || labels[i + 1] !== r.id || labels[i - width] !== r.id || labels[i + width] !== r.id) continue;
      pts.push(i);
    }
  const use = pts.length >= 30 ? pts : [];
  if (!use.length) return { kind: "flat", rgb: r.rgb };
  const step = Math.max(1, Math.floor(use.length / 40000));
  let cx = 0, cy = 0, cnt = 0;
  for (let k = 0; k < use.length; k += step) { const i = use[k]!; cx += i % width; cy += (i / width) | 0; cnt++; }
  cx /= cnt; cy /= cnt;
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0;
  const sc = [0, 0, 0], scx = [0, 0, 0], scy = [0, 0, 0];
  for (let k = 0; k < use.length; k += step) {
    const i = use[k]!, x = (i % width) - cx, y = ((i / width) | 0) - cy;
    sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y;
    for (let c = 0; c < 3; c++) { const v = rgb[i * 3 + c]!; sc[c]! += v; scx[c]! += v * x; scy[c]! += v * y; }
  }
  const M = [[cnt, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]];
  const base: number[] = [], gx: number[] = [], gy: number[] = [];
  for (let c = 0; c < 3; c++) {
    const [a, b, d] = solve3(M, [sc[c]!, scx[c]!, scy[c]!]);
    base.push(a!); gx.push(b!); gy.push(d!);
  }
  // Direction of strongest colour change: top eigenvector of GᵀG.
  const A = gx.reduce((s, v) => s + v * v, 0), B = gx.reduce((s, v, c) => s + v * gy[c]!, 0), C = gy.reduce((s, v) => s + v * v, 0);
  const theta = 0.5 * Math.atan2(2 * B, A - C);
  const vx = Math.cos(theta), vy = Math.sin(theta);
  // Bin colours along that direction; gradient stops come from the bin means.
  const proj: number[] = [];
  for (let k = 0; k < use.length; k += step) { const i = use[k]!; proj.push(((i % width) - cx) * vx + (((i / width) | 0) - cy) * vy); }
  const sorted = proj.slice().sort((p, q) => p - q);
  const s1 = sorted[Math.floor(sorted.length * 0.01)]!, s2 = sorted[Math.floor(sorted.length * 0.99)]!;
  const flat = (): Model => ({ kind: "flat", rgb: [base[0]!, base[1]!, base[2]!] });
  if (s2 - s1 < 4) return flat();
  const BINS = 16;
  const bins = Array.from({ length: BINS }, () => ({ n: 0, r: 0, g: 0, b: 0 }));
  let idx = 0;
  for (let k = 0; k < use.length; k += step) {
    const i = use[k]!, s = proj[idx++]!;
    const bi = Math.min(BINS - 1, Math.max(0, Math.floor(((s - s1) / (s2 - s1)) * BINS)));
    const bin = bins[bi]!;
    bin.n++; bin.r += rgb[i * 3]!; bin.g += rgb[i * 3 + 1]!; bin.b += rgb[i * 3 + 2]!;
  }
  const minBin = Math.max(3, cnt * 0.004);
  const cols = bins
    .map((b, bi) => ({ t: (bi + 0.5) / BINS, n: b.n, rgb: [b.r / b.n, b.g / b.n, b.b / b.n] as [number, number, number] }))
    .filter((b) => b.n >= minBin);
  if (cols.length < 2) return flat();
  const labs = cols.map((c) => labOf(...c.rgb));
  const first = 0, last = cols.length - 1;
  if (dE(labs[first]!, 0, labs[last]!, 0) < 5) {
    // Ends match: still a gradient if the middle differs (e.g. light band in the middle).
    const mid = labs.reduce((m, l, k) => Math.max(m, dE(l, 0, labs[first]!, 0)), 0);
    if (mid < 6) return flat();
  }
  // Greedy stops: add the bin furthest from the current piecewise-linear gradient.
  const stops = [first, last];
  const interp = (t: number) => {
    let a = stops[0]!, b = stops[stops.length - 1]!;
    for (let k = 0; k + 1 < stops.length; k++) if (cols[stops[k]!]!.t <= t && t <= cols[stops[k + 1]!]!.t) { a = stops[k]!; b = stops[k + 1]!; }
    const ta = cols[a]!.t, tb = cols[b]!.t, u = tb > ta ? (t - ta) / (tb - ta) : 0;
    return [0, 1, 2].map((c) => cols[a]!.rgb[c]! + (cols[b]!.rgb[c]! - cols[a]!.rgb[c]!) * u) as [number, number, number];
  };
  while (stops.length < 6) {
    let worst = -1, worstErr = 2.5;
    cols.forEach((c, k) => {
      if (stops.includes(k)) return;
      const e = dE(labOf(...interp(c.t)), 0, labs[k]!, 0);
      if (e > worstErr) { worstErr = e; worst = k; }
    });
    if (worst < 0) break;
    stops.push(worst);
    stops.sort((p, q) => p - q);
  }
  const P = (t: number) => ({ x: cx + vx * (s1 + (s2 - s1) * t), y: cy + vy * (s1 + (s2 - s1) * t) });
  const p1 = P(0), p2 = P(1);
  const fill: Fill = {
    type: "linear",
    x1: p1.x + 0.5, y1: p1.y + 0.5, x2: p2.x + 0.5, y2: p2.y + 0.5, // pixel centres sit at +0.5
    stops: stops.map((k) => ({ offset: Math.round(cols[k]!.t * 1000) / 1000, color: hex(...cols[k]!.rgb) })),
  };
  return { kind: "linear", cx, cy, base: [base[0]!, base[1]!, base[2]!], gx, gy, fill };
}

function modelColor(r: Region, x: number, y: number): [number, number, number] {
  if (r.model.kind === "flat") return r.model.rgb;
  const m = r.model, dx = x - m.cx, dy = y - m.cy;
  return [0, 1, 2].map((c) => m.base[c]! + m.gx[c]! * dx + m.gy[c]! * dy) as [number, number, number];
}

// ---------- edge pixels ----------

type Share = { a: number; wa: number; b: number; wb: number };

/** Splits each edge pixel between the two regions whose colours mix to make it. */
function shareEdges(seg: Segmentation): Map<number, Share> {
  const { width, height, labels, regions, rgb, alpha, transparent } = seg;
  const shares = new Map<number, Share>();
  for (let i = 0; i < labels.length; i++) {
    const lab = labels[i]!;
    const edge = lab === -1 || (transparent && lab === 0 && alpha[i]! > 0.02);
    if (!edge) continue;
    const x = i % width, y = (i / width) | 0;
    const cand = new Set<number>();
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const l = labels[yy * width + xx]!;
        if (l > 0 && regions.has(l)) cand.add(l);
      }
    if (!cand.size) continue;
    const p = [rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!];
    const list = [...cand].map((id) => ({ id, c: modelColor(regions.get(id)!, x, y) }));
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
    if (r.model.kind !== "linear" || r.area / total < 0.01) return false;
    const st = r.model.fill.type === "linear" ? r.model.fill.stops : [];
    const a = st[0], b = st[st.length - 1];
    if (!a || !b) return false;
    const la = labOf(...rgbOf(a.color)), lb = labOf(...rgbOf(b.color));
    return dE(la, 0, lb, 0) >= 8;
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

function rgbOf(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
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
  const seg = segment(rgba, width, height);
  const shares = shareEdges(seg);
  const advice = colorAdvice(seg);
  const { labels, regions, alpha, transparent } = seg;
  const softness = edgeSoftness(coverageFromRgba(rgba, width, height), width, height);
  const k = Math.max(1, Math.min(4, Math.floor(targetLongSide / Math.max(width, height))));
  const ink = [...regions.values()].filter((r) => !r.background).sort((a, b) => b.area - a.area);
  const order = new Map(ink.map((r, i) => [r.id, i]));
  const own = (i: number, id: number) => {
    if (labels[i] === id) return transparent ? alpha[i]! : 1;
    const s = shares.get(i);
    return s ? (s.a === id ? s.wa : 0) + (s.b === id ? s.wb : 0) : 0;
  };
  /** Coverage of regions drawn above `rank` at pixel i (for the seam-hiding overlap). */
  const above = (i: number, rank: number) => {
    const l = labels[i]!;
    if (l > 0) { const o = order.get(l); return o !== undefined && o > rank ? (transparent ? alpha[i]! : 1) : 0; }
    const s = shares.get(i);
    if (!s) return 0;
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
    const fill: Fill = r.model.kind === "linear" ? r.model.fill : { type: "solid", color: hex(...r.model.rgb) };
    layers.push({ paths, fill });
  }
  return { layers, advice };
}

// ---------- SVG ----------

const num = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};

/** One path per layer, back to front; gradients in <defs>, in source-pixel units. */
export function toLayeredSvg(layers: ColorLayer[], width: number, height: number, view = { x: 0, y: 0, width, height }) {
  const display = Math.max(1, 1024 / Math.max(view.width, view.height));
  const defs: string[] = [];
  const body = layers.map((layer, i) => {
    let fill: string;
    if (layer.fill.type === "solid") fill = layer.fill.color;
    else {
      const f = layer.fill;
      defs.push(
        `<linearGradient id="g${i}" gradientUnits="userSpaceOnUse" x1="${num(f.x1)}" y1="${num(f.y1)}" x2="${num(f.x2)}" y2="${num(f.y2)}">` +
          f.stops.map((s) => `<stop offset="${num(s.offset)}" stop-color="${s.color}"/>`).join("") +
          `</linearGradient>`,
      );
      fill = `url(#g${i})`;
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
