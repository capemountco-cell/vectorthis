// Pure helpers for showing a traced SVG's structure (no DOM).
import type { Point, Segment, TracedPath } from "@/lib/vectorize";
import type { ColorLayer, Fill } from "@/lib/color-trace";

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

const HEX = /^#[0-9a-f]{6}$/i;
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

/**
 * Reads back an SVG this app wrote: viewBox, and each path's outline and fill (a hex
 * colour or one of its own linear gradients). Anything else is ignored, never rendered.
 */
export function parseSvg(svg: string): { paths: TracedPath[]; view: ViewBox | null; layers: ColorLayer[] } {
  const vb = svg.match(/viewBox="([^"]+)"/)?.[1]?.trim().split(/[\s,]+/).map(Number);
  const view = vb && vb.length === 4 && vb.every(Number.isFinite) ? { x: vb[0]!, y: vb[1]!, width: vb[2]!, height: vb[3]! } : null;
  const gradients = new Map<string, Fill>();
  for (const m of svg.matchAll(/<linearGradient([^>]*)>([\s\S]*?)<\/linearGradient>/g)) {
    const tag = m[1]!, id = attr(tag, "id");
    const n = (k: string) => Number(attr(tag, k));
    const stops = [...m[2]!.matchAll(/<stop([^>]*)\/?>/g)]
      .map((st) => ({ offset: Number(attr(st[1]!, "offset")), color: attr(st[1]!, "stop-color") ?? "" }))
      .filter((st) => Number.isFinite(st.offset) && HEX.test(st.color));
    if (id && stops.length && ["x1", "y1", "x2", "y2"].every((k) => Number.isFinite(n(k))))
      gradients.set(id, { type: "linear", x1: n("x1"), y1: n("y1"), x2: n("x2"), y2: n("y2"), stops });
  }
  const layers: ColorLayer[] = [];
  for (const m of svg.matchAll(/<path([^>]*)\/?>/g)) {
    const tag = m[1]!, d = attr(tag, "d");
    if (!d) continue;
    const paths = parsePathData(d);
    if (!paths.length) continue;
    const f = attr(tag, "fill") ?? "#000000";
    const ref = f.match(/^url\(#([^)]+)\)$/)?.[1];
    const fill: Fill = ref && gradients.has(ref) ? gradients.get(ref)! : { type: "solid", color: HEX.test(f) ? f : "#000000" };
    layers.push({ paths, fill });
  }
  return { paths: layers.flatMap((l) => l.paths), view, layers };
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
