import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { outlineStats, parsePathData, parseSvg } from "@/lib/outline";
import { pathData, toSvg, type TracedPath } from "@/lib/vectorize";
import { toLayeredSvg, type ColorLayer } from "@/lib/color-trace";

const square: TracedPath = {
  start: { x: 0, y: 0 },
  segments: [
    { type: "L", to: { x: 10, y: 0 } },
    { type: "C", c1: { x: 12, y: 0 }, c2: { x: 12, y: 2 }, to: { x: 12, y: 4 } },
    { type: "L", to: { x: 12, y: 10 } },
    { type: "L", to: { x: 0, y: 10 } },
    { type: "L", to: { x: 0, y: 0 } },
  ],
};
const hole: TracedPath = {
  start: { x: 3, y: 3 },
  segments: [
    { type: "L", to: { x: 3, y: 6 } },
    { type: "L", to: { x: 6, y: 6 } },
    { type: "L", to: { x: 6, y: 3 } },
    { type: "L", to: { x: 3, y: 3 } },
  ],
};

describe("outline parsing", () => {
  it("round-trips the vectorizer's own path data", () => {
    expect(parsePathData(pathData([square, hole]))).toEqual([square, hole]);
  });

  it("reads the viewBox and paths back from an exported SVG", () => {
    const svg = toSvg([square], 20, 20, { x: -2, y: -1, width: 24, height: 22 });
    const parsed = parseSvg(svg);
    expect(parsed.view).toEqual({ x: -2, y: -1, width: 24, height: 22 });
    expect(parsed.paths).toEqual([square]);
  });

  it("counts anchors, handles, shapes and holes", () => {
    const stats = outlineStats([square, hole]);
    expect(stats.anchors).toHaveLength(9);
    expect(stats.handles).toHaveLength(2);
    expect(stats.curves).toBe(1);
    expect(stats.lines).toBe(8);
    expect(stats.shapes).toBe(1);
    expect(stats.holes).toBe(1);
  });

  it("parses an SVG the app exported for the Greek-key mark", () => {
    const fixture = readFileSync("src/test/fixtures/greek-key-mark.png");
    expect(fixture.length).toBeGreaterThan(0);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-5 0 98 98" width="1024" height="1024"><path fill="#000" fill-rule="evenodd" d="M88 65.023L53.71 65.023L53.71 51.498L74.55 51.498L74.55 18.948L13.502 18.948L13.502 92.51L0 92.51L0 11.522C0 8.065 2.784 5.262 6.242 5.262L81.744 5.262C85.202 5.262 88 8.065 88 11.522L88 65.023ZM26.951 32.71L40.502 32.71L40.502 79.026L88 79.026L88 92.51L26.951 92.51L26.951 32.71Z"/></svg>';
    const { paths, view } = parseSvg(svg);
    const stats = outlineStats(paths);
    expect(view?.width).toBe(98);
    expect(stats.anchors).toHaveLength(18);
    expect(stats.curves).toBe(2);
    expect(stats.shapes).toBe(2);
  });

  it("reads colour layers and gradients back from a colour SVG", () => {
    const layers: ColorLayer[] = [
      { paths: [square], fill: { type: "solid", color: "#e6194b" } },
      { paths: [hole], fill: { type: "linear", x1: 1, y1: 2, x2: 30, y2: 4.5, stops: [{ offset: 0.03, color: "#2d6115" }, { offset: 0.97, color: "#69a00d" }] } },
    ];
    const parsed = parseSvg(toLayeredSvg(layers, 40, 40));
    expect(parsed.layers).toEqual(layers);
    expect(parsed.paths).toEqual([square, hole]);
  });

  it("never trusts foreign fills: anything but a hex colour or own gradient reads as black", () => {
    const svg = '<svg viewBox="0 0 10 10"><path fill="url(javascript:alert(1))" d="M0 0L5 0L5 5Z"/><path fill="red" d="M1 1L4 1L4 4Z"/></svg>';
    expect(parseSvg(svg).layers.map((l) => l.fill)).toEqual([{ type: "solid", color: "#000000" }, { type: "solid", color: "#000000" }]);
  });
});
