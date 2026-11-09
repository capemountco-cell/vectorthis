import { describe, expect, it } from "vitest";
import { BOARD, boardView, pathsBounds, reframeSvg, SAFE } from "@/lib/board";
import { parseSvg } from "@/lib/outline";
import { toSvg, type TracedPath } from "@/lib/vectorize";

const rect = (x0: number, y0: number, x1: number, y1: number): TracedPath => ({
  start: { x: x0, y: y0 },
  segments: [
    { type: "L", to: { x: x1, y: y0 } },
    { type: "L", to: { x: x1, y: y1 } },
    { type: "L", to: { x: x0, y: y1 } },
    { type: "L", to: { x: x0, y: y0 } },
  ],
});

/** Where the logo lands on the board, in board pixels. */
function placed(paths: TracedPath[]) {
  const v = boardView(paths);
  const b = pathsBounds(paths);
  const s = BOARD.width / v.width;
  return { x0: (b.x0 - v.x) * s, y0: (b.y0 - v.y) * s, x1: (b.x1 - v.x) * s, y1: (b.y1 - v.y) * s, view: v };
}

describe("design board", () => {
  it("has the 1300 × 1200 board's proportions", () => {
    const v = boardView([rect(10, 20, 110, 70)]);
    expect(v.width / v.height).toBeCloseTo(BOARD.width / BOARD.height, 6);
  });

  it("centres a stacked mark and fills the safe height, like the reference board", () => {
    // Reference: a 384 × 505 mark + wordmark sits centred, 505px tall on the 1200px board.
    const p = placed([rect(-30, 5, 354, 510)]);
    expect((p.x0 + p.x1) / 2).toBeCloseTo(BOARD.width / 2, 3);
    expect((p.y0 + p.y1) / 2).toBeCloseTo(BOARD.height / 2, 3);
    expect(p.y1 - p.y0).toBeCloseTo(BOARD.height * SAFE.height, 3);
    expect(p.y1 - p.y0).toBeGreaterThan(500);
    expect(p.y1 - p.y0).toBeLessThan(510);
  });

  it("limits a long wordmark by width so it never runs to the edges", () => {
    const p = placed([rect(0, 0, 1200, 100)]);
    expect(p.x1 - p.x0).toBeCloseTo(BOARD.width * SAFE.width, 3);
    expect(p.x0).toBeGreaterThan(250);
    expect((p.y0 + p.y1) / 2).toBeCloseTo(BOARD.height / 2, 3);
  });

  it("centres on the true outline, curves included, not on control points", () => {
    // A curve whose handles reach far below its actual extent.
    const arch: TracedPath = { start: { x: 0, y: 0 }, segments: [{ type: "C", c1: { x: 0, y: 100 }, c2: { x: 100, y: 100 }, to: { x: 100, y: 0 } }, { type: "L", to: { x: 0, y: 0 } }] };
    const b = pathsBounds([arch]);
    expect(b.y1).toBeCloseTo(75, 0); // the curve peaks at 3/4 of the handle height
  });

  it("re-frames an exported SVG onto the board without touching its shapes", () => {
    const paths = [rect(5, 5, 45, 25)];
    const svg = toSvg(paths, 50, 30);
    const view = boardView(paths);
    const framed = reframeSvg(svg, view, BOARD.width, BOARD.height);
    expect(framed).toContain(`width="${BOARD.width}" height="${BOARD.height}"`);
    const parsed = parseSvg(framed);
    expect(parsed.paths).toEqual(parseSvg(svg).paths);
    expect(parsed.view!.width).toBeCloseTo(view.width, 2);
  });
});
