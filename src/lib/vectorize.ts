// Sub-pixel logo vectorizer (pure TypeScript, no DOM).
// 1. Marching squares on the antialiased coverage map gives contours that sit
//    exactly on the 50% ink edge, instead of pixel staircases.
// 2. Corners are detected along each contour and sharpened to the intersection
//    of their neighbouring edges.
// 3. The runs between corners become straight lines or least-squares cubic
//    Béziers within a sub-pixel error tolerance.

export type Point = { x: number; y: number };
export type Segment = { type: "L"; to: Point } | { type: "C"; c1: Point; c2: Point; to: Point };
export type TracedPath = { start: Point; segments: Segment[] };

export type VectorizeOptions = {
  /** Coverage level treated as the ink edge (0..1). */
  threshold?: number;
  /** Max distance, in pixels, between the curve and the traced edge. */
  tolerance?: number;
  /** Contours enclosing less area than this (px²) are dropped as specks. */
  minArea?: number;
  /** Turning angle (degrees) above which a point is treated as a corner. */
  cornerAngle?: number;
  /** Optional Gaussian blur (px) of the coverage map before tracing. Rounds sharp tips, so off by default. */
  smooth?: number;
  /** Taubin smoothing passes over the traced outline between corners (removes compression wobble). */
  outlineSmoothing?: number;
  /**
   * Max distance (px) a curve may move when two neighbouring curves are merged into one.
   * Irons out low-frequency wobble (S-bumps) from noisy/resampled sources; 0 = off.
   */
  fairing?: number;
  /** Arc-length Gaussian smoothing radius (px) for slow edge wobble on noisy sources; 0 = off. */
  outlineSigma?: number;
};

const DEFAULTS = {
  threshold: 0.5,
  tolerance: 0.35,
  minArea: 16,
  cornerAngle: 55,
  smooth: 0,
  outlineSmoothing: 8,
  fairing: 0,
  outlineSigma: 0,
};

/** Separable Gaussian blur; straight edges keep their 50% position, noise averages out. */
export function blurCoverage(src: Float32Array, width: number, height: number, sigma: number) {
  if (sigma <= 0) return src;
  const r = Math.ceil(sigma * 3);
  const k: number[] = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(w);
    sum += w;
  }
  for (let i = 0; i < k.length; i++) k[i]! /= sum;
  const tmp = new Float32Array(src.length),
    out = new Float32Array(src.length);
  // Outside the image counts as paper (0).
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i;
        if (xx >= 0 && xx < width) acc += k[i + r]! * src[y * width + xx]!;
      }
      tmp[y * width + x] = acc;
    }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i;
        if (yy >= 0 && yy < height) acc += k[i + r]! * tmp[yy * width + x]!;
      }
      out[y * width + x] = acc;
    }
  return out;
}

/**
 * Ink coverage per pixel (0 = background, 1 = ink) for any single-colour logo:
 * black on white, beige on transparent, white on navy, etc.
 * - Transparent background: coverage is the alpha channel.
 * - Opaque background: the background colour is taken from the border, the ink
 *   colour from the pixels furthest from it, and coverage is the position of
 *   each pixel between the two (so antialiased edges keep their sub-pixel info).
 */
export function coverageFromRgba(rgba: Uint8ClampedArray, width: number, height: number) {
  const n = width * height;
  const out = new Float32Array(n);
  let clear = 0;
  for (let i = 0; i < n; i++) if ((rgba[i * 4 + 3] ?? 255) < 128) clear++;
  if (clear > n * 0.02) {
    for (let i = 0; i < n; i++) out[i] = (rgba[i * 4 + 3] ?? 255) / 255;
    return out;
  }
  // Background: per-channel median of the border pixels.
  const border: number[][] = [[], [], []];
  const pushPx = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) border[c]!.push(rgba[i + c] ?? 255);
  };
  for (let x = 0; x < width; x++) {
    pushPx(x, 0);
    pushPx(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    pushPx(0, y);
    pushPx(width - 1, y);
  }
  const median = (v: number[]) => v.sort((p, q) => p - q)[v.length >> 1] ?? 255;
  const bg = border.map(median) as [number, number, number];
  const dist = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const dr = (rgba[i * 4] ?? 255) - bg[0],
      dg = (rgba[i * 4 + 1] ?? 255) - bg[1],
      db = (rgba[i * 4 + 2] ?? 255) - bg[2];
    dist[i] = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist[i]! > max) max = dist[i]!;
  }
  if (max < 8) return out; // blank image
  // Ink strength: median distance of clearly-inked pixels (robust to a few outliers).
  const strong: number[] = [];
  for (let i = 0; i < n; i++) if (dist[i]! > max * 0.6) strong.push(dist[i]!);
  const ink = median(strong) || max;
  for (let i = 0; i < n; i++) out[i] = Math.min(1, dist[i]! / ink);
  return out;
}

// ---------- 1. Marching squares ----------

/** Closed contours, consistently oriented with ink on the right-hand side of travel. */
export function traceContours(
  coverage: Float32Array,
  width: number,
  height: number,
  threshold = 0.5,
): Point[][] {
  // Pad with one ring of paper so every shape is closed.
  const W = width + 2,
    H = height + 2;
  const v = (x: number, y: number) =>
    x <= 0 || y <= 0 || x > width || y > height ? 0 : (coverage[(y - 1) * width + (x - 1)] ?? 0);
  // Edge ids: horizontal edge (x,y)-(x+1,y) = 2*(y*W+x), vertical (x,y)-(x,y+1) = 2*(y*W+x)+1.
  const hId = (x: number, y: number) => 2 * (y * W + x);
  const vId = (x: number, y: number) => 2 * (y * W + x) + 1;
  const next = new Map<number, number>();
  const pos = new Map<number, Point>();
  const edgePoint = (id: number): Point => {
    let p = pos.get(id);
    if (p) return p;
    const cell = id >> 1,
      x = cell % W,
      y = Math.floor(cell / W);
    const a = v(x, y);
    if (id & 1) {
      p = { x: x - 1, y: y - 1 + crossing(a, v(x, y + 1), threshold) };
    } else {
      p = { x: x - 1 + crossing(a, v(x + 1, y), threshold), y: y - 1 };
    }
    // Pixel centers sit at integer coordinates here; shift to SVG pixel space (centers at +0.5).
    p = { x: p.x + 0.5, y: p.y + 0.5 };
    pos.set(id, p);
    return p;
  };
  const link = (from: number, to: number) => next.set(from, to);

  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const tl = v(x, y),
        tr = v(x + 1, y),
        br = v(x + 1, y + 1),
        bl = v(x, y + 1);
      const code =
        (tl >= threshold ? 8 : 0) |
        (tr >= threshold ? 4 : 0) |
        (br >= threshold ? 2 : 0) |
        (bl >= threshold ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const T = hId(x, y),
        B = hId(x, y + 1),
        L = vId(x, y),
        R = vId(x + 1, y);
      // Every segment keeps ink on its right (screen coords, y down), so contours chain cleanly.
      switch (code) {
        case 1:
          link(L, B);
          break;
        case 2:
          link(B, R);
          break;
        case 3:
          link(L, R);
          break;
        case 4:
          link(R, T);
          break;
        case 6:
          link(B, T);
          break;
        case 7:
          link(L, T);
          break;
        case 8:
          link(T, L);
          break;
        case 9:
          link(T, B);
          break;
        case 11:
          link(T, R);
          break;
        case 12:
          link(R, L);
          break;
        case 13:
          link(R, B);
          break;
        case 14:
          link(B, L);
          break;
        case 5:
        case 10: {
          const center = (tl + tr + br + bl) / 4 >= threshold;
          if (code === 5) {
            // tr & bl ink
            if (center) {
              link(L, T);
              link(R, B);
            } else {
              link(L, B);
              link(R, T);
            }
          } else {
            // tl & br ink
            if (center) {
              link(T, R);
              link(B, L);
            } else {
              link(T, L);
              link(B, R);
            }
          }
          break;
        }
      }
    }
  }

  const contours: Point[][] = [];
  const seen = new Set<number>();
  for (const startId of next.keys()) {
    if (seen.has(startId)) continue;
    const pts: Point[] = [];
    let id: number | undefined = startId;
    while (id !== undefined && !seen.has(id)) {
      seen.add(id);
      pts.push(edgePoint(id));
      id = next.get(id);
    }
    if (pts.length >= 3) contours.push(dedupe(pts));
  }
  return contours;
}

/**
 * Where the threshold is crossed between two neighbouring pixel centres (0..1).
 * A crisp antialiased edge leaves exactly one partially covered pixel, whose
 * coverage gives the edge position directly (box-filter model); linear
 * interpolation would be off by up to ~0.1px. Soft edges fall back to linear.
 */
function crossing(a: number, b: number, t: number) {
  const lo = 0.02,
    hi = 0.98;
  let p: number;
  const rising = b > a;
  const partialA = a > lo && a < hi,
    partialB = b > lo && b < hi;
  if (partialA && !partialB) p = rising ? t - a : a - t;
  else if (partialB && !partialA) p = rising ? 1 + t - b : 1 + b - t;
  else p = (t - a) / (b - a);
  return Math.max(0, Math.min(1, p));
}

function dedupe(pts: Point[]) {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-3) out.push(p);
  }
  const first = out[0],
    last = out[out.length - 1];
  if (first && last && out.length > 1 && Math.hypot(first.x - last.x, first.y - last.y) <= 1e-3)
    out.pop();
  return out;
}

export function signedArea(pts: Point[]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!,
      q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

// ---------- 2. Corners ----------

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Point, s: number): Point => ({ x: a.x * s, y: a.y * s });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const len = (a: Point) => Math.hypot(a.x, a.y);
const norm = (a: Point): Point => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};

/** Point at arc length `dist` from index i walking in direction `dir` (closed contour). */
function walk(pts: Point[], i: number, dist: number, dir: 1 | -1): Point {
  const n = pts.length;
  let acc = 0,
    cur = pts[i]!;
  for (let k = 1; k < n; k++) {
    const nxt = pts[(i + dir * k + n * k) % n]!;
    const d = len(sub(nxt, cur));
    if (acc + d >= dist) return add(cur, mul(sub(nxt, cur), (dist - acc) / (d || 1)));
    acc += d;
    cur = nxt;
  }
  return cur;
}

function findCorners(pts: Point[], cornerAngle: number): number[] {
  const n = pts.length;
  if (n < 8) return [];
  const window = 2.5;
  const turnAt = (i: number, w: number) => {
    const a = norm(sub(pts[i]!, walk(pts, i, w, -1)));
    const b = norm(sub(walk(pts, i, w, 1), pts[i]!));
    return Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * (180 / Math.PI);
  };
  const turn = new Float64Array(n);
  for (let i = 0; i < n; i++) turn[i] = turnAt(i, window);
  const corners: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = turn[i]!;
    // A real corner still turns sharply when seen from further away; pixel noise does not.
    if (t < cornerAngle || turnAt(i, window * 2.4) < cornerAngle * 0.75) continue;
    // Local maximum within ±window of arc length.
    let isMax = true;
    let acc = 0;
    for (let k = 1; k < n && acc < window && isMax; k++) {
      acc += len(sub(pts[(i + k) % n]!, pts[(i + k - 1) % n]!));
      if (turn[(i + k) % n]! > t) isMax = false;
    }
    acc = 0;
    for (let k = 1; k < n && acc < window && isMax; k++) {
      acc += len(sub(pts[(i - k + n) % n]!, pts[(i - k + 1 + n) % n]!));
      if (turn[(i - k + n) % n]! >= t) isMax = false;
    }
    if (isMax) corners.push(i);
  }
  return corners;
}

/** Fit a line through points (total least squares); returns centroid and direction. */
function fitLine(points: Point[]) {
  let cx = 0,
    cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;
  let sxx = 0,
    syy = 0,
    sxy = 0;
  for (const p of points) {
    const dx = p.x - cx,
      dy = p.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { c: { x: cx, y: cy }, d: { x: Math.cos(angle), y: Math.sin(angle) } };
}

/** Moves a rounded-off corner point to where its two neighbouring edges meet. */
function sharpenCorner(pts: Point[], i: number, prevCorner: number, nextCorner: number): Point {
  const n = pts.length;
  const collect = (dir: 1 | -1, limit: number) => {
    const out: Point[] = [];
    let acc = 0;
    for (let k = 1; k < limit; k++) {
      const a = pts[(i + dir * (k - 1) + n * k) % n]!,
        b = pts[(i + dir * k + n * k) % n]!;
      acc += len(sub(b, a));
      if (acc > 7) break;
      if (acc >= 1.2) out.push(b);
    }
    return out;
  };
  const back = collect(-1, (i - prevCorner + n) % n || n);
  const fwd = collect(1, (nextCorner - i + n) % n || n);
  const p = pts[i]!;
  if (back.length < 2 || fwd.length < 2) return p;
  const l1 = fitLine(back),
    l2 = fitLine(fwd);
  const cross = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
  if (Math.abs(cross) < 0.25) return p;
  const t = ((l2.c.x - l1.c.x) * l2.d.y - (l2.c.y - l1.c.y) * l2.d.x) / cross;
  const hit = add(l1.c, mul(l1.d, t));
  return len(sub(hit, p)) <= 2.5 ? hit : p;
}

// ---------- 3. Curve fitting (Schneider) ----------

function chordParams(points: Point[]) {
  const u = [0];
  for (let i = 1; i < points.length; i++) u.push(u[i - 1]! + len(sub(points[i]!, points[i - 1]!)));
  const total = u[u.length - 1] || 1;
  return u.map((x) => x / total);
}

function bez(c: Point[], t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt,
    b = 3 * mt * mt * t,
    d = 3 * mt * t * t,
    e = t * t * t;
  return {
    x: a * c[0]!.x + b * c[1]!.x + d * c[2]!.x + e * c[3]!.x,
    y: a * c[0]!.y + b * c[1]!.y + d * c[2]!.y + e * c[3]!.y,
  };
}

function generateBezier(points: Point[], u: number[], t1: Point, t2: Point): Point[] {
  const p0 = points[0]!,
    p3 = points[points.length - 1]!;
  let c00 = 0,
    c01 = 0,
    c11 = 0,
    x0 = 0,
    x1 = 0;
  for (let i = 0; i < points.length; i++) {
    const t = u[i]!,
      mt = 1 - t;
    const b0 = mt * mt * mt,
      b1 = 3 * mt * mt * t,
      b2 = 3 * mt * t * t,
      b3 = t * t * t;
    const a1 = mul(t1, b1),
      a2 = mul(t2, b2);
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const tmp = sub(points[i]!, add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  const segLen = len(sub(p3, p0));
  let alpha1 = det === 0 ? 0 : (x0 * c11 - x1 * c01) / det;
  let alpha2 = det === 0 ? 0 : (c00 * x1 - c01 * x0) / det;
  const eps = 1e-6 * segLen;
  if (alpha1 < eps || alpha2 < eps) alpha1 = alpha2 = segLen / 3;
  return [p0, add(p0, mul(t1, alpha1)), add(p3, mul(t2, alpha2)), p3];
}

function reparameterize(c: Point[], points: Point[], u: number[]) {
  return u.map((t, i) => {
    const p = points[i]!;
    const d = sub(bez(c, t), p);
    const mt = 1 - t;
    const q1 = add(
      add(mul(sub(c[1]!, c[0]!), 3 * mt * mt), mul(sub(c[2]!, c[1]!), 6 * mt * t)),
      mul(sub(c[3]!, c[2]!), 3 * t * t),
    );
    const q2 = add(
      mul(add(sub(c[2]!, mul(c[1]!, 2)), c[0]!), 6 * mt),
      mul(add(sub(c[3]!, mul(c[2]!, 2)), c[1]!), 6 * t),
    );
    const den = dot(q1, q1) + dot(d, q2);
    if (Math.abs(den) < 1e-12) return t;
    return Math.max(0, Math.min(1, t - dot(d, q1) / den));
  });
}

function maxError(c: Point[], points: Point[], u: number[]) {
  let max = 0,
    split = Math.floor(points.length / 2);
  for (let i = 1; i < points.length - 1; i++) {
    const d = len(sub(bez(c, u[i]!), points[i]!));
    if (d > max) {
      max = d;
      split = i;
    }
  }
  return { max, split };
}

function fitCubic(points: Point[], t1: Point, t2: Point, tol: number, out: Segment[], depth = 0) {
  const p0 = points[0]!,
    p3 = points[points.length - 1]!;
  if (points.length === 2) {
    const d = len(sub(p3, p0)) / 3;
    out.push({ type: "C", c1: add(p0, mul(t1, d)), c2: add(p3, mul(t2, d)), to: p3 });
    return;
  }
  let u = chordParams(points);
  let c = generateBezier(points, u, t1, t2);
  let { max, split } = maxError(c, points, u);
  if (max > tol && max < tol * 4) {
    for (let k = 0; k < 12 && max > tol; k++) {
      u = reparameterize(c, points, u);
      c = generateBezier(points, u, t1, t2);
      ({ max, split } = maxError(c, points, u));
    }
  }
  if (max <= tol || depth > 24 || points.length < 4) {
    out.push({ type: "C", c1: c[1]!, c2: c[2]!, to: c[3]! });
    return;
  }
  split = Math.max(1, Math.min(points.length - 2, split));
  // Tangent at the split from points ~3px either side, so pixel noise can't kink the join.
  let lo = split,
    hi = split;
  while (lo > 0 && len(sub(points[split]!, points[lo]!)) < 3) lo--;
  while (hi < points.length - 1 && len(sub(points[hi]!, points[split]!)) < 3) hi++;
  const center = norm(sub(points[lo]!, points[hi]!));
  fitCubic(points.slice(0, split + 1), t1, center, tol, out, depth + 1);
  fitCubic(points.slice(split), mul(center, -1), t2, tol, out, depth + 1);
}

/** Direction estimate from an end of a run, using points within a few pixels. */
function endTangent(points: Point[], fromStart: boolean) {
  const origin = fromStart ? points[0]! : points[points.length - 1]!;
  const sum = { x: 0, y: 0 };
  for (let k = 1; k < points.length; k++) {
    const p = fromStart ? points[k]! : points[points.length - 1 - k]!;
    const d = sub(p, origin);
    const l = len(d);
    if (l > 4) break;
    sum.x += d.x;
    sum.y += d.y;
  }
  if (len(sum) === 0) return norm(sub(fromStart ? points[1]! : points[points.length - 2]!, origin));
  return norm(sum);
}

function lineFits(points: Point[], tol: number) {
  const a = points[0]!,
    b = points[points.length - 1]!;
  const d = sub(b, a),
    l = len(d);
  if (l < 1e-9) return false;
  for (const p of points) {
    const dist = Math.abs(d.x * (p.y - a.y) - d.y * (p.x - a.x)) / l;
    if (dist > tol) return false;
  }
  return true;
}

/** Perpendicular distance of p from the infinite line through c with unit direction d. */
const lineDist = (p: Point, c: Point, d: Point) => Math.abs(d.x * (p.y - c.y) - d.y * (p.x - c.x));
const project = (p: Point, c: Point, d: Point) => add(c, mul(d, dot(sub(p, c), d)));

/**
 * Finds genuinely straight stretches inside a run: long enough, within tolerance,
 * and without the systematic bow an arc has (so big curves stay curves).
 */
function findLineSpans(points: Point[], tol: number, minLen: number, minInterior = minLen) {
  const n = points.length;
  const reach = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let j = i + 1;
    for (; j < n; j++) {
      const a = points[i]!,
        b = points[j]!,
        d = sub(b, a),
        l = len(d);
      if (l < 1e-9) continue;
      let ok = true;
      for (let k = i + 1; k < j && ok; k++)
        if (Math.abs(d.x * (points[k]!.y - a.y) - d.y * (points[k]!.x - a.x)) / l > tol) ok = false;
      if (!ok) break;
    }
    reach[i] = j - 1;
  }
  const candidates: { i: number; j: number; length: number }[] = [];
  for (let i = 0; i < n; i++) {
    const j = reach[i]!;
    const length = len(sub(points[j]!, points[i]!));
    if (j > i && length >= minLen && (i === 0 || reach[i - 1]! < j))
      candidates.push({ i, j, length });
  }
  candidates.sort((p, q) => q.length - p.length);
  const taken = new Uint8Array(n);
  const spans: { i: number; j: number; c: Point; d: Point }[] = [];
  for (const cand of candidates) {
    let { i, j } = cand;
    while (i < j && taken[i]) i++;
    while (j > i && taken[j]) j--;
    // Allow touching at a shared endpoint only.
    // Lines leaving a corner may be short; a "line" in the middle of a curve must be long.
    const need = i === 0 || j === points.length - 1 ? minLen : minInterior;
    if (j <= i || len(sub(points[j]!, points[i]!)) < need) continue;
    let clash = false;
    for (let k = i + 1; k < j; k++) if (taken[k]) clash = true;
    if (clash) continue;
    const pts = points.slice(i, j + 1);
    const { c, d: dir } = fitLine(pts);
    const d = dot(dir, sub(points[j]!, points[i]!)) < 0 ? mul(dir, -1) : dir;
    // Bow test: an arc's middle sits on the opposite side of the fitted line from its ends.
    const signed = (p: Point) => d.x * (p.y - c.y) - d.y * (p.x - c.x);
    const third = Math.max(1, Math.floor(pts.length / 3));
    let mid = 0,
      ends = 0;
    for (let k = 0; k < pts.length; k++) {
      if (k >= third && k < pts.length - third)
        mid += signed(pts[k]!) / Math.max(1, pts.length - 2 * third);
      else ends += signed(pts[k]!) / (2 * third);
    }
    if (Math.abs(mid - ends) > Math.max(0.06, tol * 0.2)) continue;
    // Pull ends that drift off the line back to where it truly is straight, so the
    // curve takes over gently instead of bending abruptly at the end of a long line.
    const tight = Math.min(0.12, tol * 0.4);
    while (j > i + 2 && j !== points.length - 1 && lineDist(points[j]!, c, d) > tight) j--;
    while (i < j - 2 && i !== 0 && lineDist(points[i]!, c, d) > tight) i++;
    const need2 = i === 0 || j === points.length - 1 ? minLen : minInterior;
    if (len(sub(points[j]!, points[i]!)) < need2) continue;
    for (let k = i + 1; k < j; k++) taken[k] = 1;
    spans.push({ i, j, c, d });
  }
  spans.sort((p, q) => p.i - q.i);
  // Chains of shallow-angled lines with nothing between them are really a big arc.
  const keep = spans.map(() => true);
  for (let k = 0; k + 1 < spans.length; k++) {
    const p = spans[k]!,
      q = spans[k + 1]!;
    if (q.i - p.j <= 1 && dot(p.d, q.d) > Math.cos((8 * Math.PI) / 180))
      keep[k] = keep[k + 1] = false;
  }
  return spans.filter((_, k) => keep[k]);
}

/** Intersection of two lines (point + direction), or null when nearly parallel. */
function intersect(c1: Point, d1: Point, c2: Point, d2: Point) {
  const cross = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(cross) < 1e-6) return null;
  const t = ((c2.x - c1.x) * d2.y - (c2.y - c1.y) * d2.x) / cross;
  return add(c1, mul(d1, t));
}

/**
 * Fits one corner-to-corner run (or a whole smooth loop when t1/t2 are given):
 * straight stretches become exact lines, the parts between them become cubic
 * curves that leave and join each line along its own direction (no kinks).
 */
function fitRun(
  points: Point[],
  tol: number,
  out: Segment[],
  t1?: Point,
  t2?: Point,
  minLen = 5,
  minInterior = minLen,
) {
  const n = points.length;
  if (n < 2) return;
  if (n === 2) {
    out.push({ type: "L", to: points[1]! });
    return;
  }
  const spans = findLineSpans(points, tol, minLen, minInterior);
  let cursor = 0;
  let from = points[0]!;
  let tanIn: Point | undefined = t1;
  const curve = (pts: Point[], a?: Point, b?: Point) => {
    if (pts.length < 2 || (pts.length === 2 && len(sub(pts[1]!, pts[0]!)) < 1e-6)) return;
    if (pts.length === 2 && !a && !b) {
      out.push({ type: "L", to: pts[1]! });
      return;
    }
    fitCubic(pts, a ?? endTangent(pts, true), b ?? endTangent(pts, false), tol, out);
  };
  for (let s = 0; s < spans.length; s++) {
    const { i, j, c, d } = spans[s]!;
    let start = i === 0 ? points[0]! : project(points[i]!, c, d);
    const end = j === n - 1 ? points[n - 1]! : project(points[j]!, c, d);
    if (i - cursor <= 1 && s > 0) {
      // Two lines meet with no curve between them: join them where they cross.
      const prev = spans[s - 1]!;
      const hit = intersect(prev.c, prev.d, c, d);
      if (hit && len(sub(hit, from)) < tol * 4) {
        const last = out[out.length - 1];
        if (last && last.type === "L") last.to = hit;
        start = hit;
      }
    } else if (i > cursor || cursor === 0) {
      curve([from, ...points.slice(cursor + 1, i), start], tanIn, mul(d, -1));
    }
    out.push({ type: "L", to: end });
    from = end;
    cursor = j;
    tanIn = d;
  }
  if (cursor < n - 1) curve([from, ...points.slice(cursor + 1)], tanIn, t2);
  else if (len(sub(from, points[n - 1]!)) > 1e-6) out.push({ type: "L", to: points[n - 1]! });
}

/** Taubin λ/μ smoothing: irons out pixel wobble without shrinking curves. Fixed indices stay put. */
function smoothOutline(pts: Point[], fixed: Set<number>, passes: number) {
  const n = pts.length;
  let cur = pts;
  for (let pass = 0; pass < passes * 2; pass++) {
    const f = pass % 2 === 0 ? 0.5 : -0.53;
    const nxt = cur.slice();
    for (let i = 0; i < n; i++) {
      if (fixed.has(i)) continue;
      const a = cur[(i - 1 + n) % n]!,
        b = cur[i]!,
        c = cur[(i + 1) % n]!;
      nxt[i] = { x: b.x + f * ((a.x + c.x) / 2 - b.x), y: b.y + f * ((a.y + c.y) / 2 - b.y) };
    }
    cur = nxt;
  }
  return cur;
}

/**
 * Arc-length Gaussian smoothing of a closed outline, for noisy sources whose edge wobble is
 * too slow (10-30px) for a few neighbour-averaging passes. The radius shrinks towards each
 * corner so corners stay put without the hooks fixed-point smoothing leaves beside them,
 * and 2G - G² cancels the first-order shrinkage on curves.
 */
function gaussianOutline(pts: Point[], corners: number[], sigma: number) {
  const n = pts.length;
  if (sigma <= 0 || n < 8) return pts;
  const s = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) s[i] = s[i - 1]! + len(sub(pts[i % n]!, pts[i - 1]!));
  // Anchors: real corners plus any tight bend (e.g. a blunt leaf tip) — blurring across
  // those would round them off and the shrink compensation would then overshoot into a hook.
  const anchor = new Uint8Array(n);
  for (const c of corners) anchor[c] = 1;
  const cos30 = Math.cos((30 * Math.PI) / 180);
  for (let i = 0; i < n; i++) {
    const a = norm(sub(pts[i]!, walk(pts, i, 3, -1)));
    const b = norm(sub(walk(pts, i, 3, 1), pts[i]!));
    if (dot(a, b) < cos30) anchor[i] = 1;
  }
  // Arc distance to the nearest anchor: two sweeps each way around the closed outline.
  const dist = new Float64Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) if (anchor[i]) dist[i] = 0;
  for (let pass = 0; pass < 2; pass++)
    for (let k = 1; k <= n; k++) {
      const i = k % n,
        p = k - 1;
      dist[i] = Math.min(dist[i]!, dist[p]! + (s[k]! - s[k - 1]!));
    }
  for (let pass = 0; pass < 2; pass++)
    for (let k = n - 1; k >= 0; k--) {
      const i = k,
        nx = (k + 1) % n;
      dist[i] = Math.min(dist[i]!, dist[nx]! + (s[k + 1]! - s[k]!));
    }
  const sig = new Float64Array(n);
  for (let i = 0; i < n; i++) sig[i] = Math.min(sigma, dist[i]! / 3);
  const blur = (src: Point[]) => {
    const out = src.slice();
    for (let i = 0; i < n; i++) {
      const g = sig[i]!;
      if (g < 0.3) continue;
      const reach = 3 * g;
      let wx = 0,
        wy = 0,
        ws = 0;
      for (const dir of [1, -1] as const) {
        let acc = 0;
        for (let k = dir === 1 ? 0 : 1; k < n; k++) {
          const j = (i + dir * k + n * 2) % n;
          if (k > 0) {
            const prev = (j - dir + n) % n;
            acc += len(sub(pts[j]!, pts[prev]!));
          }
          if (acc > reach) break;
          const w = Math.exp(-(acc * acc) / (2 * g * g));
          wx += w * src[j]!.x;
          wy += w * src[j]!.y;
          ws += w;
        }
      }
      out[i] = { x: wx / ws, y: wy / ws };
    }
    return out;
  };
  const once = blur(pts);
  const twice = blur(once);
  return once.map((p, i) => ({ x: 2 * p.x - twice[i]!.x, y: 2 * p.y - twice[i]!.y }));
}

function fitContour(raw: Point[], opts: typeof DEFAULTS): TracedPath {
  const corners = findCorners(raw, opts.cornerAngle);
  const pts = smoothOutline(
    gaussianOutline(raw, corners, opts.outlineSigma),
    new Set(corners),
    opts.outlineSmoothing,
  );
  const n = pts.length;
  // A "straight" stretch must be long for its shape: short near-flat bits of a big
  // bowl (an O, a U) are curve, and turning them into lines leaves visible flats.
  let bx0 = Infinity,
    by0 = Infinity,
    bx1 = -Infinity,
    by1 = -Infinity;
  for (const p of pts) {
    bx0 = Math.min(bx0, p.x);
    bx1 = Math.max(bx1, p.x);
    by0 = Math.min(by0, p.y);
    by1 = Math.max(by1, p.y);
  }
  const minLine = Math.max(5, 0.1 * Math.min(bx1 - bx0, by1 - by0));
  const minInterior = Math.max(minLine, 0.25 * Math.min(bx1 - bx0, by1 - by0));
  if (corners.length === 0) {
    // Smooth loop: start at the leftmost point (curve tangent is vertical there).
    let s = 0;
    for (let i = 1; i < n; i++) if (pts[i]!.x < pts[s]!.x) s = i;
    const loop = [...pts.slice(s), ...pts.slice(0, s), pts[s]!];
    const t = norm(sub(walk(pts, s, 2, 1), walk(pts, s, 2, -1)));
    const segments: Segment[] = [];
    // No corners: the seam is arbitrary, so every straight stretch counts as interior.
    fitRun(loop, opts.tolerance, segments, t, mul(t, -1), minInterior, minInterior);
    return { start: loop[0]!, segments };
  }
  const sharp = corners.map((ci, k) =>
    sharpenCorner(
      pts,
      ci,
      corners[(k - 1 + corners.length) % corners.length]!,
      corners[(k + 1) % corners.length]!,
    ),
  );
  corners.forEach((ci, k) => {
    pts[ci] = sharp[k]!;
  });
  const segments: Segment[] = [];
  for (let k = 0; k < corners.length; k++) {
    const a = corners[k]!,
      b = corners[(k + 1) % corners.length]!;
    const run: Point[] = [];
    for (let i = a; ; i = (i + 1) % n) {
      run.push(pts[i]!);
      if (i === b && run.length > 1) break;
      if (run.length > n + 1) break;
    }
    // Drop points right next to a sharpened corner; they belong to the old rounded tip.
    const trimmed = run.filter(
      (p, idx) =>
        idx === 0 ||
        idx === run.length - 1 ||
        (len(sub(p, run[0]!)) > 1.2 && len(sub(p, run[run.length - 1]!)) > 1.2),
    );
    fitRun(
      trimmed.length >= 2 ? trimmed : [run[0]!, run[run.length - 1]!],
      opts.tolerance,
      segments,
      undefined,
      undefined,
      minLine,
      minInterior,
    );
  }
  return { start: pts[corners[0]!]!, segments };
}

// ---------- 4. Axis snapping ----------

/**
 * Lets `edit` move a path's vertices (vertex k = start of segment k); curve
 * handles attached to a moved vertex move with it so the curve shape is kept.
 */
function editVertices(
  path: TracedPath,
  edit: (verts: Point[], segs: Segment[]) => void,
): TracedPath {
  const segs = path.segments.map((s) => ({ ...s }));
  const n = segs.length;
  if (n < 2) return path;
  const verts: Point[] = [{ ...path.start }, ...segs.slice(0, -1).map((s) => ({ ...s.to }))];
  const orig = verts.map((p) => ({ ...p }));
  edit(verts, segs);
  for (let k = 0; k < n; k++) {
    const s = segs[k]!,
      endIdx = (k + 1) % n;
    if (s.type === "C") {
      s.c1 = add(s.c1, sub(verts[k]!, orig[k]!));
      s.c2 = add(s.c2, sub(verts[endIdx]!, orig[endIdx]!));
    }
    s.to = verts[endIdx]!;
  }
  return { start: verts[0]!, segments: segs };
}

/** Straightens lines that are within a hair of horizontal/vertical. */
function snapAxisLines(path: TracedPath): TracedPath {
  const maxSlope = Math.tan((1.2 * Math.PI) / 180);
  return editVertices(path, (verts, segs) => {
    const n = segs.length;
    for (let k = 0; k < n; k++) {
      if (segs[k]!.type !== "L") continue;
      const a = verts[k]!,
        b = verts[(k + 1) % n]!;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      if (Math.abs(dy) <= 1.5 && Math.abs(dy) <= Math.abs(dx) * maxSlope)
        a.y = b.y = (a.y + b.y) / 2;
      else if (Math.abs(dx) <= 1.5 && Math.abs(dx) <= Math.abs(dy) * maxSlope)
        a.x = b.x = (a.x + b.x) / 2;
    }
  });
}

/**
 * Logos reuse the same edge positions (stem widths, baselines, the canvas edge).
 * Horizontal/vertical lines whose positions differ by less than `gap` px are
 * merged to one shared coordinate (length-weighted); lines hugging the image
 * border land exactly on it.
 */
function alignAxes(paths: TracedPath[], width: number, height: number, gap = 0.25): TracedPath[] {
  type Entry = { value: number; weight: number };
  const xs: Entry[] = [
    { value: 0, weight: Infinity },
    { value: width, weight: Infinity },
  ];
  const ys: Entry[] = [
    { value: 0, weight: Infinity },
    { value: height, weight: Infinity },
  ];
  for (const p of paths) {
    let from = p.start;
    for (const s of p.segments) {
      if (s.type === "L") {
        const l = len(sub(s.to, from));
        if (s.to.x === from.x) xs.push({ value: from.x, weight: l });
        else if (s.to.y === from.y) ys.push({ value: from.y, weight: l });
      }
      from = s.to;
    }
  }
  const clusters = (entries: Entry[]) => {
    entries.sort((a, b) => a.value - b.value);
    const map = new Map<number, number>();
    let group: Entry[] = [];
    const flush = () => {
      let w = 0,
        v = 0;
      for (const e of group) {
        w += e.weight;
        v += e.value * e.weight;
      }
      // A canvas edge in the group wins outright, so border lines land exactly on it.
      const anchor = group.find((e) => e.weight === Infinity);
      for (const e of group) map.set(e.value, anchor ? anchor.value : v / w);
      group = [];
    };
    for (const e of entries) {
      if (group.length && e.value - group[group.length - 1]!.value > gap) flush();
      group.push(e);
    }
    flush();
    return map;
  };
  const xMap = clusters(xs),
    yMap = clusters(ys);
  return paths.map((p) =>
    editVertices(p, (verts, segs) => {
      const n = segs.length;
      const orig = verts.map((v) => ({ ...v }));
      for (let k = 0; k < n; k++) {
        if (segs[k]!.type !== "L") continue;
        const a = orig[k]!,
          b = orig[(k + 1) % n]!;
        if (a.x === b.x) {
          const x = xMap.get(a.x);
          if (x !== undefined) verts[k]!.x = verts[(k + 1) % n]!.x = x;
        } else if (a.y === b.y) {
          const y = yMap.get(a.y);
          if (y !== undefined) verts[k]!.y = verts[(k + 1) % n]!.y = y;
        }
      }
    }),
  );
}

// ---------- 5. Rounded corners as true arcs ----------

function bezierAt(from: Point, s: Extract<Segment, { type: "C" }>, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt ** 3 * from.x + 3 * mt * mt * t * s.c1.x + 3 * mt * t * t * s.c2.x + t ** 3 * s.to.x,
    y: mt ** 3 * from.y + 3 * mt * mt * t * s.c1.y + 3 * mt * t * t * s.c2.y + t ** 3 * s.to.y,
  };
}

type ArcCandidate = {
  path: number;
  /** Index of the line before the curve run; the run is (prev+1 .. next-1). */
  prev: number;
  next: number;
  corner: Point;
  dA: Point;
  dB: Point;
  turn: number;
  side: number;
  samples: Point[];
  maxT: number;
  radius: number;
  rms: number;
};

/** RMS distance from the samples to the arc of radius r tangent to both lines. */
function arcError(c: ArcCandidate, r: number) {
  const t = r * Math.tan(c.turn / 2);
  const t1 = sub(c.corner, mul(c.dA, t));
  const centre = add(t1, mul({ x: -c.dA.y, y: c.dA.x }, r * c.side));
  let sum = 0;
  for (const p of c.samples) {
    const e = len(sub(p, centre)) - r;
    sum += e * e;
  }
  return Math.sqrt(sum / c.samples.length);
}

function bestRadius(c: ArcCandidate, lo: number, hi: number) {
  // Golden-section search; the error is unimodal in r for a single corner.
  const g = (Math.sqrt(5) - 1) / 2;
  let a = lo,
    b = hi;
  let x1 = b - g * (b - a),
    x2 = a + g * (b - a);
  let f1 = arcError(c, x1),
    f2 = arcError(c, x2);
  for (let i = 0; i < 40; i++) {
    if (f1 < f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = b - g * (b - a);
      f1 = arcError(c, x1);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + g * (b - a);
      f2 = arcError(c, x2);
    }
  }
  return (a + b) / 2;
}

/**
 * Logos are drawn with circular corner radii, but a small or soft raster only
 * hints at them, so a free-form fit comes out flattened. Every curve that joins
 * two straight edges is refitted as a circular arc tangent to both edges, and
 * corners with nearly the same radius are given exactly the same radius.
 */
function roundCornersAsArcs(paths: TracedPath[], tol: number): TracedPath[] {
  // Rotate each path to start on a line so curve runs never wrap past the start.
  const rotated = paths.map((p) => {
    const n = p.segments.length;
    const starts = [p.start, ...p.segments.slice(0, -1).map((s) => s.to)];
    const k = p.segments.findIndex((s) => s.type === "L");
    if (k <= 0) return p;
    return {
      start: starts[k]!,
      segments: [...p.segments.slice(k), ...p.segments.slice(0, k)].slice(0, n),
    };
  });
  const candidates: ArcCandidate[] = [];
  rotated.forEach((p, pi) => {
    const segs = p.segments,
      n = segs.length;
    if (segs[0]?.type !== "L") return;
    const starts = [p.start, ...segs.slice(0, -1).map((s) => s.to)];
    for (let i = 0; i < n; i++) {
      if (segs[i]!.type !== "L") continue;
      let j = i + 1;
      while (j < n && segs[j]!.type === "C") j++;
      if (j === i + 1) continue;
      const next = j % n;
      if (segs[next]!.type !== "L" || next === i) continue;
      const a0 = starts[i]!,
        a1 = segs[i]!.to,
        b0 = starts[next]!,
        b1 = segs[next]!.to;
      const dA = norm(sub(a1, a0)),
        dB = norm(sub(b1, b0));
      const cross = dA.x * dB.y - dA.y * dB.x;
      const turn = Math.acos(Math.max(-1, Math.min(1, dot(dA, dB))));
      if (turn < (25 * Math.PI) / 180 || turn > (155 * Math.PI) / 180) continue;
      const corner = intersect(a0, dA, b0, dB);
      if (!corner) continue;
      const samples: Point[] = [];
      for (let k = i + 1; k < j; k++) {
        const s = segs[k]! as Extract<Segment, { type: "C" }>;
        for (let q = 1; q < 12; q++) samples.push(bezierAt(starts[k]!, s, q / 12));
        if (k < j - 1) samples.push(s.to);
      }
      // The arc may not eat more than (almost) the whole of either neighbouring line.
      const maxT = Math.min(len(sub(corner, a0)), len(sub(b1, corner))) * 0.98;
      if (maxT <= 0.3) continue;
      candidates.push({
        path: pi,
        prev: i,
        next,
        corner,
        dA,
        dB,
        turn,
        side: Math.sign(cross),
        samples,
        maxT,
        radius: 0,
        rms: Infinity,
      });
    }
  });
  const accepted: ArcCandidate[] = [];
  for (const c of candidates) {
    const rMax = c.maxT / Math.tan(c.turn / 2);
    if (rMax < 0.3) continue;
    c.radius = bestRadius(c, 0.2, rMax);
    c.rms = arcError(c, c.radius);
    // Only a genuine circular corner: the arc must stay within the normal fitting tolerance.
    if (c.rms <= tol) accepted.push(c);
  }
  // Equal radii for corners that are clearly meant to match.
  const sorted = [...accepted].sort((p, q) => p.radius - q.radius);
  for (let i = 0; i < sorted.length;) {
    let j = i + 1;
    while (j < sorted.length && sorted[j]!.radius <= sorted[i]!.radius * 1.12) j++;
    const group = sorted.slice(i, j);
    const mean = group.reduce((sum, c) => sum + c.radius, 0) / group.length;
    for (const c of group) {
      const rMax = c.maxT / Math.tan(c.turn / 2);
      const r = Math.min(mean, rMax);
      if (arcError(c, r) <= tol) c.radius = r;
    }
    i = j;
  }
  return rotated.map((p, pi) => {
    const mine = accepted.filter((c) => c.path === pi);
    if (!mine.length) return p;
    const segs = p.segments.map((s) => ({ ...s })) as Segment[];
    const replace = new Map<number, Segment[]>();
    const skip = new Set<number>();
    for (const c of mine) {
      const t = c.radius * Math.tan(c.turn / 2);
      const t1 = sub(c.corner, mul(c.dA, t)),
        t2 = add(c.corner, mul(c.dB, t));
      // The arc sweeps the same angle the outline turns; standard cubic circle handle length.
      const h = (4 / 3) * Math.tan(c.turn / 4) * c.radius;
      for (let k = c.prev + 1; k !== c.next; k = (k + 1) % segs.length) skip.add(k);
      replace.set(c.prev, [
        { type: "L", to: t1 },
        { type: "C", c1: add(t1, mul(c.dA, h)), c2: sub(t2, mul(c.dB, h)), to: t2 },
      ]);
    }
    const out: Segment[] = [];
    segs.forEach((s, k) => {
      if (skip.has(k)) return;
      out.push(...(replace.get(k) ?? [s]));
    });
    // A run that wrapped to the start moved the path's first point too.
    const last = out[out.length - 1]!;
    return { start: last.to, segments: out };
  });
}

// ---------- 6. Smooth line-to-curve joins ----------

/**
 * After straightening and aligning lines, a curve can leave a line at a slightly
 * different angle, which shows as a kink. Where a line and a curve meet at a
 * small angle (a smooth join, not a corner), the curve's handle is turned to
 * continue exactly along the line.
 */
function smoothJoins(paths: TracedPath[], maxAngle = (20 * Math.PI) / 180): TracedPath[] {
  const cosMax = Math.cos(maxAngle);
  return paths.map((p) => {
    const segs = p.segments.map((s) => ({ ...s })) as Segment[];
    const n = segs.length;
    const starts = [p.start, ...segs.slice(0, -1).map((s) => s.to)];
    const align = (handle: Point, anchorPt: Point, dir: Point) => {
      const v = sub(handle, anchorPt),
        l = len(v);
      if (l < 1e-9 || dot(norm(v), dir) < cosMax) return handle;
      return add(anchorPt, mul(dir, l));
    };
    for (let k = 0; k < n; k++) {
      const s = segs[k]!;
      if (s.type !== "C") continue;
      const prev = segs[(k - 1 + n) % n]!,
        next = segs[(k + 1) % n]!;
      const a = starts[k]!;
      if (prev.type === "L") {
        const d = norm(sub(a, starts[(k - 1 + n) % n]!));
        s.c1 = align(s.c1, a, d);
      }
      if (next.type === "L") {
        const d = norm(sub(s.to, next.to)); // pointing back from the join into the curve side
        s.c2 = align(s.c2, s.to, d);
      }
    }
    return { start: p.start, segments: segs };
  });
}

// ---------- 7. Fairing ----------

function sampleCubic(c: Point[], n: number) {
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) out.push(bez(c, i / n));
  return out;
}

/**
 * Merges neighbouring curves that meet smoothly whenever one cubic stays within `tol`
 * of both. Noisy sources make the fitter split long gentle edges into several curves
 * that wobble around the true edge; one curve through them is the cleaner, truer shape.
 * Corners and lines are never touched.
 */
function fairCurves(paths: TracedPath[], tol: number, maxAngle = (15 * Math.PI) / 180): TracedPath[] {
  if (tol <= 0) return paths;
  const cosMax = Math.cos(maxAngle);
  return paths.map((p) => {
    // Curves as [p0, c1, c2, p3]; lines kept as-is.
    type Item = { kind: "L"; to: Point } | { kind: "C"; c: Point[] };
    let from = p.start;
    let items: Item[] = p.segments.map((s) => {
      const it: Item = s.type === "L" ? { kind: "L", to: s.to } : { kind: "C", c: [from, s.c1, s.c2, s.to] };
      from = s.to;
      return it;
    });
    let changed = true;
    while (changed && items.length > 1) {
      changed = false;
      for (let k = 0; k + 1 < items.length; k++) {
        const a = items[k]!,
          b = items[k + 1]!;
        if (a.kind !== "C" || b.kind !== "C") continue;
        const tin = sub(a.c[3]!, a.c[2]!),
          tout = sub(b.c[1]!, b.c[0]!);
        if (len(tin) < 1e-9 || len(tout) < 1e-9 || dot(norm(tin), norm(tout)) < cosMax) continue;
        // Short curves are real detail (a blunt tip, a small nub), not wobble: leave them.
        const minChord = 30 * tol;
        if (len(sub(a.c[3]!, a.c[0]!)) < minChord || len(sub(b.c[3]!, b.c[0]!)) < minChord) continue;
        const pts = [...sampleCubic(a.c, 24), ...sampleCubic(b.c, 24).slice(1)];
        const t1 = norm(sub(a.c[1]!, a.c[0]!)),
          t2 = norm(sub(b.c[2]!, b.c[3]!));
        if (!Number.isFinite(t1.x) || !Number.isFinite(t2.x)) continue;
        let u = chordParams(pts);
        let c = generateBezier(pts, u, t1, t2);
        for (let it = 0; it < 8; it++) {
          u = reparameterize(c, pts, u);
          c = generateBezier(pts, u, t1, t2);
        }
        if (maxError(c, pts, u).max > tol) continue;
        items.splice(k, 2, { kind: "C", c });
        changed = true;
      }
    }
    // The last and first items meet at the path start; leave that seam alone.
    const segments: Segment[] = items.map((it) =>
      it.kind === "L" ? { type: "L", to: it.to } : { type: "C", c1: it.c[1]!, c2: it.c[2]!, to: it.c[3]! },
    );
    items = [];
    return { start: p.start, segments };
  });
}

// ---------- Public API ----------

export function vectorize(
  coverage: Float32Array,
  width: number,
  height: number,
  options: VectorizeOptions = {},
): TracedPath[] {
  const opts = { ...DEFAULTS, ...options };
  const smoothed = blurCoverage(coverage, width, height, opts.smooth);
  const paths = traceContours(smoothed, width, height, opts.threshold)
    .filter((c) => Math.abs(signedArea(c)) >= opts.minArea)
    .map((c) => snapAxisLines(fitContour(c, opts)));
  // Arcs recompute line ends from intersections; re-straighten so axis lines stay exactly axis-aligned.
  const arced = roundCornersAsArcs(paths, opts.tolerance).map(snapAxisLines);
  return fairCurves(smoothJoins(alignAxes(arced, width, height)), opts.fairing);
}

const fmt = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};
const pt = (p: Point) => `${fmt(p.x)} ${fmt(p.y)}`;

export function pathData(paths: TracedPath[]) {
  return paths
    .map((p) => {
      let d = `M${pt(p.start)}`;
      for (const s of p.segments)
        d += s.type === "L" ? `L${pt(s.to)}` : `C${pt(s.c1)} ${pt(s.c2)} ${pt(s.to)}`;
      return `${d}Z`;
    })
    .join("");
}

export type ViewBox = { x: number; y: number; width: number; height: number };

/**
 * SVG in source-pixel units. `view` may extend past the traced area (e.g. to give
 * a logo that touches its canvas an even margin); tiny sources get a larger
 * default display size since vectors scale freely.
 */
export function toSvg(paths: TracedPath[], width: number, height: number, view?: ViewBox) {
  const v = view ?? { x: 0, y: 0, width, height };
  const display = Math.max(1, 1024 / Math.max(v.width, v.height));
  const w = Math.round(v.width * display),
    h = Math.round(v.height * display);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(v.x)} ${fmt(v.y)} ${fmt(v.width)} ${fmt(v.height)}" width="${w}" height="${h}">` +
    `<path fill="#000" fill-rule="evenodd" d="${pathData(paths)}"/></svg>`
  );
}

export function rgbaToSvg(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options?: VectorizeOptions,
) {
  return toSvg(
    vectorize(coverageFromRgba(rgba, width, height), width, height, options),
    width,
    height,
  );
}

/** Catmull-Rom (bicubic) upsampling of a coverage map, clamped to 0..1. */
export function upsampleCoverage(src: Float32Array, width: number, height: number, k: number) {
  const W = width * k, H = height * k;
  const out = new Float32Array(W * H);
  const at = (x: number, y: number) =>
    src[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]!;
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  for (let Y = 0; Y < H; Y++) {
    const sy = (Y + 0.5) / k - 0.5, y = Math.floor(sy), ty = sy - y;
    for (let X = 0; X < W; X++) {
      const sx = (X + 0.5) / k - 0.5, x = Math.floor(sx), tx = sx - x;
      const r = [-1, 0, 1, 2].map((j) => cr(at(x - 1, y + j), at(x, y + j), at(x + 1, y + j), at(x + 2, y + j), tx));
      out[Y * W + X] = Math.min(1, Math.max(0, cr(r[0]!, r[1]!, r[2]!, r[3]!, ty)));
    }
  }
  return out;
}

/**
 * Small or low-resolution logos (e.g. thin taglines a few px tall) give the curve fitter too few
 * points, which produces spikes and wobble. Trace a smooth bicubic upsample instead, then scale back.
 */
export function vectorizeDetailed(
  coverage: Float32Array,
  width: number,
  height: number,
  options: VectorizeOptions = {},
  targetLongSide = 3000,
): TracedPath[] {
  // Blurry / resampled uploads have wide, uneven edge ramps; tracing them tightly turns that
  // noise into scalloped edges, so fit looser and smooth harder instead of upsampling.
  const softness = edgeSoftness(coverage, width, height);
  if (softness > 1.3) {
    return vectorize(coverage, width, height, {
      tolerance: 0.35 * softness * softness,
      outlineSmoothing: Math.round(18 * softness * softness),
      // Resampled screenshots wobble slowly (10-30px period) along long edges: blur along
      // the outline at that scale, then merge any curves that still meet smoothly.
      outlineSigma: 3.5 * softness,
      fairing: 0.35 * softness,
      ...options,
    });
  }
  const k = Math.max(1, Math.min(6, Math.floor(targetLongSide / Math.max(width, height))));
  if (k === 1) return vectorize(coverage, width, height, options);
  const minArea = (options.minArea ?? DEFAULTS.minArea) * k * k;
  const paths = vectorize(upsampleCoverage(coverage, width, height, k), width * k, height * k, { ...options, minArea });
  const s = (p: Point): Point => ({ x: p.x / k, y: p.y / k });
  return paths.map((p) => ({
    start: s(p.start),
    segments: p.segments.map((g) => (g.type === "L" ? { type: "L", to: s(g.to) } : { type: "C", c1: s(g.c1), c2: s(g.c2), to: s(g.to) })),
  }));
}

/** Partial-coverage pixels per edge crossing: ~0.5-1 for crisp art, ~2+ for blurry or resampled images. */
export function edgeSoftness(c: Float32Array, width: number, height: number) {
  let partial = 0, cross = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = c[y * width + x]!;
      if (v > 0.05 && v < 0.95) partial++;
      if (x > 0 && v >= 0.5 !== c[y * width + x - 1]! >= 0.5) cross++;
      if (y > 0 && v >= 0.5 !== c[(y - 1) * width + x]! >= 0.5) cross++;
    }
  return cross ? partial / cross : 0;
}
