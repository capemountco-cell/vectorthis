// Shading fits for one colour region (pure, no DOM): a flat colour, a linear gradient or an
// (elliptical) radial gradient as the base, plus soft radial overlays (highlights, shadows)
// that fade to transparent. This is how a designer rebuilds soft-shaded artwork in vector:
// the overlays reuse the region's own outline, so they never spill outside it.
import type { Fill, GradientStop } from "@/lib/color-trace";
import { dE, hex, labOf, rgbOf } from "@/lib/color-math";

type RGB = [number, number, number];

/** Region pixels used for fitting (interior only: edge pixels are mixed with neighbours). */
export type ShadeSample = { xs: Float32Array; ys: Float32Array; cs: Float32Array; n: number };
export type Shading = { base: Fill; overlays: Fill[] };

const BINS = 24;

// ---------- evaluating a fill ----------

function stopColor(stops: GradientStop[], t: number): { c: RGB; a: number } {
  const at = (s: GradientStop) => ({ c: rgbOf(s.color), a: s.opacity ?? 1 });
  if (t <= stops[0]!.offset) return at(stops[0]!);
  for (let k = 0; k + 1 < stops.length; k++) {
    const p = stops[k]!, q = stops[k + 1]!;
    if (t <= q.offset) {
      const u = q.offset > p.offset ? (t - p.offset) / (q.offset - p.offset) : 0;
      const A = at(p), B = at(q);
      return { c: [0, 1, 2].map((i) => A.c[i]! + (B.c[i]! - A.c[i]!) * u) as RGB, a: A.a + (B.a - A.a) * u };
    }
  }
  return at(stops[stops.length - 1]!);
}

/** Gradient position (0–1) of a point, before clamping. */
function position(f: Exclude<Fill, { type: "solid" }>, x: number, y: number) {
  if (f.type === "linear") {
    const dx = f.x2 - f.x1, dy = f.y2 - f.y1;
    return ((x - f.x1) * dx + (y - f.y1) * dy) / Math.max(1e-9, dx * dx + dy * dy);
  }
  return Math.hypot(x - f.cx, (y - f.cy) / f.sy) / f.r;
}

/** Colour and opacity a fill paints at (x, y). */
export function fillAt(f: Fill, x: number, y: number): { c: RGB; a: number } {
  if (f.type === "solid") return { c: rgbOf(f.color), a: 1 };
  return stopColor(f.stops, position(f, x, y));
}

// ---------- gradient stops ----------

type Bin = { t: number; n: number; rgb: RGB };

/** Mean colour per position bin (positions already mapped to 0–1). */
function binColors(t: Float32Array, cs: Float32Array, n: number): Bin[] {
  const acc = Array.from({ length: BINS }, () => ({ n: 0, r: 0, g: 0, b: 0, t: 0 }));
  for (let k = 0; k < n; k++) {
    const b = acc[Math.min(BINS - 1, Math.max(0, Math.floor(t[k]! * BINS)))]!;
    b.n++; b.t += t[k]!; b.r += cs[k * 3]!; b.g += cs[k * 3 + 1]!; b.b += cs[k * 3 + 2]!;
  }
  const minBin = Math.max(3, n * 0.003);
  return acc.filter((b) => b.n >= minBin).map((b) => ({ t: b.t / b.n, n: b.n, rgb: [b.r / b.n, b.g / b.n, b.b / b.n] as RGB }));
}

/** Fewest stops (greedy, up to maxStops) that follow the binned colours within ~2.5 ΔE. */
function chooseStops(bins: Bin[], maxStops: number): GradientStop[] {
  const labs = bins.map((b) => labOf(...b.rgb));
  const stops = [0, bins.length - 1];
  const interp = (t: number): RGB => {
    let a = stops[0]!, b = stops[stops.length - 1]!;
    for (let k = 0; k + 1 < stops.length; k++) if (bins[stops[k]!]!.t <= t && t <= bins[stops[k + 1]!]!.t) { a = stops[k]!; b = stops[k + 1]!; }
    const ta = bins[a]!.t, tb = bins[b]!.t, u = tb > ta ? (t - ta) / (tb - ta) : 0;
    return [0, 1, 2].map((c) => bins[a]!.rgb[c]! + (bins[b]!.rgb[c]! - bins[a]!.rgb[c]!) * u) as RGB;
  };
  while (stops.length < maxStops) {
    let worst = -1, worstErr = 2.5;
    bins.forEach((b, k) => {
      if (stops.includes(k)) return;
      const e = dE(labOf(...interp(b.t)), 0, labs[k]!, 0);
      if (e > worstErr) { worstErr = e; worst = k; }
    });
    if (worst < 0) break;
    stops.push(worst);
    stops.sort((p, q) => p - q);
  }
  return stops.map((k) => ({ offset: Math.round(Math.max(0, Math.min(1, bins[k]!.t)) * 1000) / 1000, color: hex(...bins[k]!.rgb) }));
}

/** Within-bin squared error of colours binned by position: how well a gradient along t fits. */
function binnedError(t: Float32Array, cs: Float32Array, n: number) {
  const N = new Float64Array(BINS), S = new Float64Array(BINS * 3);
  let sq = 0;
  for (let k = 0; k < n; k++) {
    const b = Math.min(BINS - 1, Math.max(0, Math.floor(t[k]! * BINS)));
    N[b]!++;
    for (let c = 0; c < 3; c++) { const v = cs[k * 3 + c]!; S[b * 3 + c]! += v; sq += v * v; }
  }
  let explained = 0;
  for (let b = 0; b < BINS; b++) if (N[b]) for (let c = 0; c < 3; c++) explained += (S[b * 3 + c]! * S[b * 3 + c]!) / N[b]!;
  return Math.max(0, sq - explained);
}

// ---------- base fits ----------

function subsample(s: ShadeSample, max: number): ShadeSample {
  if (s.n <= max) return s;
  const step = s.n / max, n = Math.floor(s.n / step);
  const xs = new Float32Array(n), ys = new Float32Array(n), cs = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const j = Math.floor(k * step);
    xs[k] = s.xs[j]!; ys[k] = s.ys[j]!;
    cs[k * 3] = s.cs[j * 3]!; cs[k * 3 + 1] = s.cs[j * 3 + 1]!; cs[k * 3 + 2] = s.cs[j * 3 + 2]!;
  }
  return { xs, ys, cs, n };
}

function solve3(m: number[][], v: number[]): number[] {
  const det = (a: number[][]) =>
    a[0]![0]! * (a[1]![1]! * a[2]![2]! - a[1]![2]! * a[2]![1]!) -
    a[0]![1]! * (a[1]![0]! * a[2]![2]! - a[1]![2]! * a[2]![0]!) +
    a[0]![2]! * (a[1]![0]! * a[2]![1]! - a[1]![1]! * a[2]![0]!);
  const d = det(m);
  if (Math.abs(d) < 1e-9) return [v[0]! / Math.max(1, m[0]![0]!), 0, 0];
  return [0, 1, 2].map((c) => det(m.map((row, r) => row.map((x, k) => (k === c ? v[r]! : x)))) / d);
}

/** Direction of strongest colour change (least-squares plane per channel). */
function linearDirection(s: ShadeSample) {
  let cx = 0, cy = 0;
  for (let k = 0; k < s.n; k++) { cx += s.xs[k]!; cy += s.ys[k]!; }
  cx /= s.n; cy /= s.n;
  let sxx = 0, sxy = 0, syy = 0;
  const scx = [0, 0, 0], scy = [0, 0, 0], sc = [0, 0, 0];
  for (let k = 0; k < s.n; k++) {
    const x = s.xs[k]! - cx, y = s.ys[k]! - cy;
    sxx += x * x; sxy += x * y; syy += y * y;
    for (let c = 0; c < 3; c++) { const v = s.cs[k * 3 + c]!; sc[c]! += v; scx[c]! += v * x; scy[c]! += v * y; }
  }
  const M = [[s.n, 0, 0], [0, sxx, sxy], [0, sxy, syy]];
  const gx: number[] = [], gy: number[] = [];
  for (let c = 0; c < 3; c++) { const [, b, d] = solve3(M, [sc[c]!, scx[c]!, scy[c]!]); gx.push(b!); gy.push(d!); }
  const A = gx.reduce((t, v) => t + v * v, 0), B = gx.reduce((t, v, c) => t + v * gy[c]!, 0), C = gy.reduce((t, v) => t + v * v, 0);
  const theta = 0.5 * Math.atan2(2 * B, A - C);
  return { cx, cy, vx: Math.cos(theta), vy: Math.sin(theta) };
}

function percentiles(v: Float32Array, n: number) {
  const s = Array.from(v.subarray(0, n)).sort((a, b) => a - b);
  return [s[Math.floor(n * 0.01)]!, s[Math.min(n - 1, Math.floor(n * 0.99))]!] as const;
}

type Candidate = { fill: (stops: GradientStop[]) => Fill; t: Float32Array; err: number };

function linearCandidate(s: ShadeSample): Candidate | null {
  const { cx, cy, vx, vy } = linearDirection(s);
  const proj = new Float32Array(s.n);
  for (let k = 0; k < s.n; k++) proj[k] = (s.xs[k]! - cx) * vx + (s.ys[k]! - cy) * vy;
  const [s1, s2] = percentiles(proj, s.n);
  if (s2 - s1 < 4) return null;
  const t = proj.map((p) => (p - s1) / (s2 - s1));
  const P = (u: number) => ({ x: cx + vx * (s1 + (s2 - s1) * u) + 0.5, y: cy + vy * (s1 + (s2 - s1) * u) + 0.5 });
  const p1 = P(0), p2 = P(1);
  return { t, err: binnedError(t, s.cs, s.n), fill: (stops) => ({ type: "linear", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stops }) };
}

/** Best elliptical radial gradient: grid search over centre and aspect, then local refinement. */
function radialCandidate(s: ShadeSample, box: { x0: number; y0: number; x1: number; y1: number }): Candidate | null {
  const w = box.x1 - box.x0 + 1, h = box.y1 - box.y0 + 1;
  if (Math.min(w, h) < 12) return null;
  const quick = subsample(s, 3000);
  const t = new Float32Array(quick.n);
  const score = (cx: number, cy: number, sy: number) => {
    let max = 0;
    for (let k = 0; k < quick.n; k++) {
      const d = Math.hypot(quick.xs[k]! - cx, (quick.ys[k]! - cy) / sy);
      t[k] = d;
      if (d > max) max = d;
    }
    for (let k = 0; k < quick.n; k++) t[k] = t[k]! / Math.max(1e-6, max);
    return binnedError(t, quick.cs, quick.n);
  };
  const aspects = [0.6, 0.75, 0.9, 1, 1.15, 1.35, 1.6];
  let best = { cx: 0, cy: 0, sy: 1, err: Infinity };
  const G = 8;
  for (let gy = 0; gy <= G; gy++)
    for (let gx = 0; gx <= G; gx++) {
      const cx = box.x0 - 0.25 * w + (1.5 * w * gx) / G, cy = box.y0 - 0.25 * h + (1.5 * h * gy) / G;
      for (const sy of aspects) {
        const err = score(cx, cy, sy);
        if (err < best.err) best = { cx, cy, sy, err };
      }
    }
  let sx = (1.5 * w) / G / 2, sY = (1.5 * h) / G / 2, sa = 1.1;
  for (let it = 0; it < 6; it++) {
    const c0 = best;
    for (const dx of [-sx, 0, sx])
      for (const dy of [-sY, 0, sY])
        for (const f of [1 / sa, 1, sa]) {
          if (!dx && !dy && f === 1) continue;
          const err = score(c0.cx + dx, c0.cy + dy, c0.sy * f);
          if (err < best.err) best = { cx: c0.cx + dx, cy: c0.cy + dy, sy: c0.sy * f, err };
        }
    sx /= 2; sY /= 2; sa = Math.sqrt(sa);
  }
  const { cx, cy, sy } = best;
  const dist = new Float32Array(s.n);
  for (let k = 0; k < s.n; k++) dist[k] = Math.hypot(s.xs[k]! - cx, (s.ys[k]! - cy) / sy);
  const [, r] = percentiles(dist, s.n);
  if (r < 4) return null;
  const tt = dist.map((d) => d / r);
  return { t: tt, err: binnedError(tt, s.cs, s.n), fill: (stops) => ({ type: "radial", cx: cx + 0.5, cy: cy + 0.5, r, sy, stops }) };
}

function flatError(s: ShadeSample) {
  const m = [0, 0, 0];
  for (let k = 0; k < s.n; k++) for (let c = 0; c < 3; c++) m[c]! += s.cs[k * 3 + c]!;
  for (let c = 0; c < 3; c++) m[c]! /= s.n;
  let e = 0;
  for (let k = 0; k < s.n; k++) for (let c = 0; c < 3; c++) e += (s.cs[k * 3 + c]! - m[c]!) ** 2;
  return { err: e, rgb: m as RGB };
}

// ---------- overlays ----------

/**
 * Soft radial highlights and shadows: repeatedly finds the strongest left-over shading in a
 * smoothed residual map and fits a round blob that fades from its colour to transparent.
 */
function fitOverlays(s: ShadeSample, base: Fill, box: { x0: number; y0: number; x1: number; y1: number }, max: number): Fill[] {
  const w = box.x1 - box.x0 + 1, h = box.y1 - box.y0 + 1;
  const cell = Math.max(2, Math.max(w, h) / 48);
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell), G = gw * gh;
  const cnt = new Float32Array(G), res = new Float32Array(G * 3), baseC = new Float32Array(G * 3);
  for (let k = 0; k < s.n; k++) {
    const gx = Math.min(gw - 1, Math.floor((s.xs[k]! - box.x0) / cell)), gy = Math.min(gh - 1, Math.floor((s.ys[k]! - box.y0) / cell));
    const g = gy * gw + gx;
    const b = fillAt(base, s.xs[k]! + 0.5, s.ys[k]! + 0.5).c;
    cnt[g]!++;
    for (let c = 0; c < 3; c++) { res[g * 3 + c]! += s.cs[k * 3 + c]! - b[c]!; baseC[g * 3 + c]! += b[c]!; }
  }
  const minCnt = Math.max(1, (s.n / Math.max(1, G)) * 0.15);
  const mask = new Uint8Array(G);
  for (let g = 0; g < G; g++)
    if (cnt[g]! >= minCnt) {
      mask[g] = 1;
      for (let c = 0; c < 3; c++) { res[g * 3 + c]! /= cnt[g]!; baseC[g * 3 + c]! /= cnt[g]!; }
    }
  // Light smoothing (mask-normalised) so grain and noise don't read as shading.
  const sm = new Float32Array(G * 3);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const g = y * gw + x;
      if (!mask[g]) continue;
      let wsum = 0;
      const acc = [0, 0, 0];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= gw || yy >= gh || !mask[yy * gw + xx]) continue;
          const wt = dx || dy ? (dx && dy ? 0.25 : 0.5) : 1;
          wsum += wt;
          for (let c = 0; c < 3; c++) acc[c]! += res[(yy * gw + xx) * 3 + c]! * wt;
        }
      for (let c = 0; c < 3; c++) sm[g * 3 + c] = acc[c]! / wsum;
    }
  const energy = () => { let e = 0; for (let g = 0; g < G; g++) if (mask[g]) e += sm[g * 3]! ** 2 + sm[g * 3 + 1]! ** 2 + sm[g * 3 + 2]! ** 2; return e; };
  const out: Fill[] = [];
  // Peaks are looked for away from the outline only (cells whose 8 neighbours are all inside):
  // cells on the outline are partly mixed with the background.
  const inner = new Uint8Array(G);
  for (let y = 1; y < gh - 1; y++)
    for (let x = 1; x < gw - 1; x++) {
      let all = true;
      for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) if (!mask[(y + dy) * gw + x + dx]) { all = false; break; }
      if (all) inner[y * gw + x] = 1;
    }
  const tried = new Uint8Array(G);
  for (let attempt = 0; attempt < max * 2 && out.length < max; attempt++) {
    let peak = -1, pv = 0;
    for (let g = 0; g < G; g++) {
      if (!inner[g] || tried[g]) continue;
      const v = Math.hypot(sm[g * 3]!, sm[g * 3 + 1]!, sm[g * 3 + 2]!);
      if (v > pv) { pv = v; peak = g; }
    }
    if (peak < 0 || pv < 16) break; // ~6 ΔE: anything weaker isn't visible shading
    const R0 = [sm[peak * 3]!, sm[peak * 3 + 1]!, sm[peak * 3 + 2]!], r2 = pv * pv;
    const px = (peak % gw) + 0.5, py = Math.floor(peak / gw) + 0.5;
    // Radial profile: how much of the peak's shading is left at each distance (in cells).
    const maxD = Math.ceil(Math.hypot(gw, gh));
    const ringS = new Float32Array(maxD + 1), ringN = new Float32Array(maxD + 1);
    for (let g = 0; g < G; g++) {
      if (!mask[g]) continue;
      const d = Math.hypot((g % gw) + 0.5 - px, Math.floor(g / gw) + 0.5 - py);
      const p = (sm[g * 3]! * R0[0]! + sm[g * 3 + 1]! * R0[1]! + sm[g * 3 + 2]! * R0[2]!) / r2;
      const ri = Math.min(maxD, Math.round(d));
      ringS[ri]! += Math.max(0, Math.min(1, p));
      ringN[ri]!++;
    }
    const prof: number[] = [];
    let last = 1;
    for (let d = 0; d <= maxD; d++) {
      const v = ringN[d] ? ringS[d]! / ringN[d]! : last;
      last = Math.min(last, d === 0 ? 1 : v);
      prof.push(last);
      if (last < 0.05) break;
    }
    const R = Math.max(1.5, prof.length - 1);
    const alpha = (dCells: number) => {
      if (dCells >= R) return 0;
      const i = Math.floor(dCells), u = dCells - i;
      const a = prof[i] ?? 0, b = prof[i + 1] ?? 0;
      return a + (b - a) * u;
    };
    const bp = [baseC[peak * 3]!, baseC[peak * 3 + 1]!, baseC[peak * 3 + 2]!];
    const C = [0, 1, 2].map((c) => Math.max(0, Math.min(255, bp[c]! + R0[c]!))) as RGB;
    const before = energy();
    const saved = sm.slice();
    for (let g = 0; g < G; g++) {
      if (!mask[g]) continue;
      const a = alpha(Math.hypot((g % gw) + 0.5 - px, Math.floor(g / gw) + 0.5 - py));
      if (!a) continue;
      for (let c = 0; c < 3; c++) sm[g * 3 + c]! -= a * (C[c]! - baseC[g * 3 + c]!);
    }
    if (energy() > before * 0.995) {
      // Not a blob (e.g. a ridge): leave it and look elsewhere.
      sm.set(saved);
      for (let g = 0; g < G; g++) if (Math.hypot((g % gw) + 0.5 - px, Math.floor(g / gw) + 0.5 - py) <= 2) tried[g] = 1;
      continue;
    }
    const stops: GradientStop[] = [];
    for (const o of [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1]) {
      const a = o === 1 ? 0 : alpha(o * R);
      if (stops.length && stops[stops.length - 1]!.opacity === 0) break;
      stops.push({ offset: o, color: hex(...C), opacity: Math.round(a * 1000) / 1000 });
    }
    if (stops[stops.length - 1]!.opacity !== 0) stops.push({ offset: 1, color: hex(...C), opacity: 0 });
    out.push({ type: "radial", cx: box.x0 + px * cell + 0.5, cy: box.y0 + py * cell + 0.5, r: R * cell, sy: 1, stops });
  }
  return out;
}

// ---------- entry point ----------

/**
 * Fits a region's shading. `soft` allows radial bases and overlays (photographic or airbrushed
 * artwork); crisp logos keep the flat/linear fits, which are what their designers used.
 */
export function fitShading(sample: ShadeSample, box: { x0: number; y0: number; x1: number; y1: number }, opts: { soft: boolean; overlays: number }): Shading {
  const flat = flatError(sample);
  const solid: Fill = { type: "solid", color: hex(...flat.rgb) };
  if (sample.n < 30) return { base: solid, overlays: [] };
  const s = subsample(sample, 20000);
  // Spread: barely-varying regions stay flat (RMS below ~3 RGB units).
  if (flat.err / sample.n < 9) return { base: solid, overlays: [] };
  const lin = linearCandidate(s);
  let best: Candidate | null = lin;
  if (opts.soft) {
    const rad = radialCandidate(s, box);
    if (rad && (!lin || rad.err < lin.err * 0.75)) best = rad;
  }
  let base: Fill = solid;
  if (best) {
    const bins = binColors(best.t, s.cs, s.n);
    if (bins.length >= 2) {
      const labs = bins.map((b) => labOf(...b.rgb));
      const spread = labs.reduce((m, l) => Math.max(m, dE(l, 0, labs[0]!, 0)), 0);
      if (spread >= 6) base = best.fill(chooseStops(bins, best === lin ? 6 : 8));
    }
  }
  const overlays = opts.soft && opts.overlays > 0 ? fitOverlays(s, base, box, opts.overlays) : [];
  return { base, overlays };
}
