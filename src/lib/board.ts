// The design board every export lands on by default (pure, no DOM): a 1300 × 1200 canvas with
// the logo centred on its true outline and scaled into a safe box, like a brand presentation board.
import type { ViewBox } from "@/lib/outline";
import type { TracedPath } from "@/lib/vectorize";

export const BOARD = { width: 1300, height: 1200 } as const;
/**
 * The logo's bounding box may use at most this share of the board. Taken from the reference
 * board: a stacked mark + wordmark fills 42% of the height; 56% of the width keeps long
 * wordmarks clear of the edges.
 */
export const SAFE = { width: 0.56, height: 0.42 } as const;

/** Exact extent of the outlines, curves included (sampled), in the paths' own units. */
export function pathsBounds(paths: TracedPath[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  for (const p of paths) {
    let from = p.start;
    add(from.x, from.y);
    for (const s of p.segments) {
      if (s.type === "L") add(s.to.x, s.to.y);
      else
        for (let i = 1; i <= 16; i++) {
          const t = i / 16, mt = 1 - t;
          add(
            mt ** 3 * from.x + 3 * mt * mt * t * s.c1.x + 3 * mt * t * t * s.c2.x + t ** 3 * s.to.x,
            mt ** 3 * from.y + 3 * mt * mt * t * s.c1.y + 3 * mt * t * t * s.c2.y + t ** 3 * s.to.y,
          );
        }
      from = s.to;
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 1, y1: 1 };
}

/**
 * The viewBox (in the paths' units) that shows the logo centred on the board and as large as
 * the safe box allows. Rendering it at board size gives the export.
 */
export function boardView(paths: TracedPath[], board: { width: number; height: number } = BOARD): ViewBox {
  const b = pathsBounds(paths);
  const w = Math.max(1e-6, b.x1 - b.x0), h = Math.max(1e-6, b.y1 - b.y0);
  // Board pixels per source unit.
  const scale = Math.min((board.width * SAFE.width) / w, (board.height * SAFE.height) / h);
  const vw = board.width / scale, vh = board.height / scale;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  return { x: cx - vw / 2, y: cy - vh / 2, width: vw, height: vh };
}

const num = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};

/** Re-frames one of this app's SVGs: new viewBox and pixel size, same shapes. */
export function reframeSvg(svg: string, view: ViewBox, width: number, height: number) {
  return svg.replace(
    /^<svg\b[^>]*>/,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(view.x)} ${num(view.y)} ${num(view.width)} ${num(view.height)}" width="${width}" height="${height}">`,
  );
}
