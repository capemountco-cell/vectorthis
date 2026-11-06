// Pure helpers for showing a traced SVG's structure (no DOM).
import type { Point, Segment, TracedPath } from "@/lib/vectorize";

export type ViewBox = { x: number; y: number; width: number; height: number };

/** Parses path data in the subset our vectorizer writes: absolute M, L, C and Z. */
export function parsePathData(d: string): TracedPath[] {
  const tokens = d.match(/[MLCZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const paths: TracedPath[] = [];
  let current: TracedPath | null = null;
  let i = 0;
  const num = () => Number(tokens[i++]);
  const pt = (): Point => ({ x: num(), y: num() });
  let command = "";
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (/^[MLCZ]$/i.test(t)) {
      command = t.toUpperCase();
      i++;
      if (command === "Z") {
        current = null;
        continue;
      }
    }
    if (command === "M") {
      current = { start: pt(), segments: [] };
      paths.push(current);
      command = "L"; // implicit lineto after a moveto
    } else if (command === "L" && current) {
      current.segments.push({ type: "L", to: pt() });
    } else if (command === "C" && current) {
      const c1 = pt(), c2 = pt(), to = pt();
      current.segments.push({ type: "C", c1, c2, to });
    } else {
      i++; // unknown token: skip
    }
  }
  return paths.filter((p) => p.segments.length > 0);
}

export function parseSvg(svg: string): { paths: TracedPath[]; view: ViewBox | null } {
  const vb = svg.match(/viewBox="([^"]+)"/)?.[1]?.trim().split(/[\s,]+/).map(Number);
  const view = vb && vb.length === 4 && vb.every(Number.isFinite) ? { x: vb[0]!, y: vb[1]!, width: vb[2]!, height: vb[3]! } : null;
  const ds = [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]!);
  return { paths: ds.flatMap(parsePathData), view };
}

function area(path: TracedPath) {
  const pts = [path.start, ...path.segments.map((s: Segment) => s.to)];
  let a = 0;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k]!, q = pts[(k + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export type OutlineStats = {
  anchors: Point[];
  /** Control handles as [anchor, handle] pairs. */
  handles: [Point, Point][];
  shapes: number;
  holes: number;
  curves: number;
  lines: number;
};

export function outlineStats(paths: TracedPath[]): OutlineStats {
  const anchors: Point[] = [];
  const handles: [Point, Point][] = [];
  let curves = 0, lines = 0;
  for (const p of paths) {
    let from = p.start;
    for (const s of p.segments) {
      anchors.push(s.to);
      if (s.type === "C") {
        curves++;
        handles.push([from, s.c1], [s.to, s.c2]);
      } else lines++;
      from = s.to;
    }
  }
  const areas = paths.map(area);
  let biggest = 0;
  areas.forEach((a, k) => { if (Math.abs(a) > Math.abs(areas[biggest] ?? 0)) biggest = k; });
  const sign = Math.sign(areas[biggest] ?? 1);
  const shapes = areas.filter((a) => Math.sign(a) === sign).length;
  return { anchors, handles, shapes, holes: paths.length - shapes, curves, lines };
}
