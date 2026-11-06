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
};

const DEFAULTS = {
  threshold: 0.5,
  tolerance: 0.35,
  minArea: 16,
  cornerAngle: 55,
  smooth: 0,
  outlineSmoothing: 8,
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

/** Darkness (0 = paper, 1 = ink) per pixel from RGBA, composited on white. */
export function coverageFromRgba(rgba: Uint8ClampedArray, width: number, height: number) {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const a = (rgba[i * 4 + 3] ?? 255) / 255;
    const lum =
      0.299 * (rgba[i * 4] ?? 255) +
      0.587 * (rgba[i * 4 + 1] ?? 255) +
      0.114 * (rgba[i * 4 + 2] ?? 255);
    out[i] = (1 - lum / 255) * a;
  }
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

function fitRun(points: Point[], tol: number, out: Segment[], t1?: Point, t2?: Point) {
  if (points.length < 2) return;
  if (points.length === 2 || (!t1 && lineFits(points, tol * 0.75))) {
    out.push({ type: "L", to: points[points.length - 1]! });
    return;
  }
  fitCubic(points, t1 ?? endTangent(points, true), t2 ?? endTangent(points, false), tol, out);
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

function fitContour(raw: Point[], opts: typeof DEFAULTS): TracedPath {
  const corners = findCorners(raw, opts.cornerAngle);
  const pts = smoothOutline(raw, new Set(corners), opts.outlineSmoothing);
  const n = pts.length;
  if (corners.length === 0) {
    // Smooth loop: start at the leftmost point (curve tangent is vertical there).
    let s = 0;
    for (let i = 1; i < n; i++) if (pts[i]!.x < pts[s]!.x) s = i;
    const loop = [...pts.slice(s), ...pts.slice(0, s), pts[s]!];
    const t = norm(sub(walk(pts, s, 2, 1), walk(pts, s, 2, -1)));
    const segments: Segment[] = [];
    fitRun(loop, opts.tolerance, segments, t, mul(t, -1));
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
    );
  }
  return { start: pts[corners[0]!]!, segments };
}

// ---------- 4. Axis snapping ----------

/** Straightens lines that are within a hair of horizontal/vertical, moving attached handles too. */
function snapAxisLines(path: TracedPath): TracedPath {
  const segs = path.segments.map((s) => ({ ...s }));
  const n = segs.length;
  if (n < 2) return path;
  // vertex k = start of segment k (vertex 0 = path.start = end of last segment).
  const verts: Point[] = [{ ...path.start }, ...segs.slice(0, -1).map((s) => ({ ...s.to }))];
  const orig = verts.map((p) => ({ ...p }));
  const maxSlope = Math.tan((1.2 * Math.PI) / 180);
  for (let k = 0; k < n; k++) {
    if (segs[k]!.type !== "L") continue;
    const a = verts[k]!,
      b = verts[(k + 1) % n]!;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    if (Math.abs(dy) <= 1.5 && Math.abs(dy) <= Math.abs(dx) * maxSlope) {
      const y = (a.y + b.y) / 2;
      a.y = y;
      b.y = y;
    } else if (Math.abs(dx) <= 1.5 && Math.abs(dx) <= Math.abs(dy) * maxSlope) {
      const x = (a.x + b.x) / 2;
      a.x = x;
      b.x = x;
    }
  }
  for (let k = 0; k < n; k++) {
    const s = segs[k]!,
      endIdx = (k + 1) % n;
    const d0 = sub(verts[k]!, orig[k]!),
      d1 = sub(verts[endIdx]!, orig[endIdx]!);
    if (s.type === "C") {
      s.c1 = add(s.c1, d0);
      s.c2 = add(s.c2, d1);
    }
    s.to = verts[endIdx]!;
  }
  return { start: verts[0]!, segments: segs as Segment[] };
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
  return traceContours(smoothed, width, height, opts.threshold)
    .filter((c) => Math.abs(signedArea(c)) >= opts.minArea)
    .map((c) => snapAxisLines(fitContour(c, opts)));
}

const fmt = (n: number) => {
  const r = Math.round(n * 100) / 100;
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

export function toSvg(paths: TracedPath[], width: number, height: number) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
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
