import { describe, expect, it } from "vitest";
import { adviseColor, toLayeredSvg, traceColor } from "@/lib/color-trace";
import { decodePng } from "./decode-png";

/** Renders an RGBA image from a colour function, 4×4 supersampled for antialiased edges. */
function paint(width: number, height: number, color: (x: number, y: number) => [number, number, number]) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const c = color(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4);
          for (let k = 0; k < 3; k++) acc[k]! += c[k]!;
        }
      const i = (y * width + x) * 4;
      out[i] = acc[0]! / 16; out[i + 1] = acc[1]! / 16; out[i + 2] = acc[2]! / 16; out[i + 3] = 255;
    }
  return out;
}
const WHITE: [number, number, number] = [255, 255, 255];
const rgbOf = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const close = (h: string, rgb: number[], tol = 12) => rgbOf(h).every((v, k) => Math.abs(v - rgb[k]!) <= tol);

describe("colour tracing", () => {
  it("keeps two touching flat colours as two exact solid shapes", () => {
    const img = paint(120, 80, (x, y) => (y < 15.3 || y > 64.7 || x < 10.4 ? WHITE : x < 60.2 ? [220, 30, 40] : x < 109.6 ? [30, 70, 200] : WHITE));
    const { layers, advice } = traceColor(img, 120, 80);
    expect(layers).toHaveLength(2);
    const fills = layers.map((l) => (l.fill.type === "solid" ? l.fill.color : ""));
    expect(fills.some((f) => close(f, [220, 30, 40]))).toBe(true);
    expect(fills.some((f) => close(f, [30, 70, 200]))).toBe(true);
    expect(advice.recommend).toBe("color");
    expect(advice.colors).toBe(2);
  });

  it("fits a smooth gradient as one linear gradient, not bands", () => {
    // Red → yellow, left to right.
    const img = paint(160, 90, (x, y) => (x < 10 || x > 150 || y < 15 || y > 75 ? WHITE : [230, Math.round(20 + ((x - 10) / 140) * 200), 30]));
    const { layers, advice } = traceColor(img, 160, 90);
    expect(layers).toHaveLength(1);
    const fill = layers[0]!.fill;
    expect(fill.type).toBe("linear");
    if (fill.type !== "linear") return;
    // Mostly horizontal, and the end colours are near the true ends.
    expect(Math.abs(fill.y2 - fill.y1)).toBeLessThan(Math.abs(fill.x2 - fill.x1) * 0.15);
    const [a, b] = fill.x1 < fill.x2 ? [fill.stops[0]!, fill.stops.at(-1)!] : [fill.stops.at(-1)!, fill.stops[0]!];
    expect(rgbOf(a.color)[1]).toBeLessThan(50);
    expect(rgbOf(b.color)[1]).toBeGreaterThan(190);
    expect(advice.gradients).toBe(1);
  });

  it("recommends black & white for grey or single muted logos", () => {
    const grey = paint(100, 100, (x, y) => (Math.hypot(x - 50, y - 50) < 30 ? [40, 40, 40] : WHITE));
    expect(adviseColor(grey, 100, 100)).toMatchObject({ recommend: "mono", reason: expect.stringMatching(/near-neutral/) });
    const mark = decodePng("src/test/fixtures/greek-key-mark.png");
    expect(adviseColor(mark.rgba, mark.width, mark.height).recommend).toBe("mono");
  });

  it("keeps the green B's colours and gradients", () => {
    const { width, height, rgba } = decodePng("src/test/fixtures/green-b-logo.png");
    expect(adviseColor(rgba, width, height)).toMatchObject({ recommend: "color" });
    const { layers, advice } = traceColor(rgba, width, height);
    expect(advice.recommend).toBe("color");
    expect(advice.score).toBeGreaterThanOrEqual(80);
    expect(advice.gradients).toBeGreaterThanOrEqual(3);
    // Its 8 separate shapes (two stripes wrap round into one) survive, and halo pixels
    // along the white gaps don't become extra slivers.
    const shapes = layers.reduce((s, l) => s + l.paths.length, 0);
    expect(shapes).toBe(8);
    expect(layers).toHaveLength(8);
    const svg = toLayeredSvg(layers, width, height);
    expect(svg).toContain("<linearGradient");
    expect(svg).toMatch(/fill="url\(#g\d+\)"/);
    expect(svg).not.toContain("stroke");
  }, 30000);

  it("keeps the white background and every stripe of a soft-edged multi-colour logo", () => {
    // Regression: the background used to leak through soft edges into the stripes, became one
    // huge tinted shape and swallowed four stripes.
    const { width, height, rgba } = decodePng("src/test/fixtures/stripes-logo.png");
    const { layers, advice } = traceColor(rgba, width, height);
    expect(layers).toHaveLength(8);
    const area = (l: (typeof layers)[number]) => {
      const xs = l.paths.flatMap((p) => [p.start.x, ...p.segments.map((s) => s.to.x)]);
      const ys = l.paths.flatMap((p) => [p.start.y, ...p.segments.map((s) => s.to.y)]);
      return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    };
    // No layer covers (nearly) the whole canvas: the background is never traced as a shape.
    for (const l of layers) expect(area(l)).toBeLessThan(width * height * 0.6);
    // Its purple, lilac, gold, greens and orange are all there.
    const colours = layers.flatMap((l) => (l.fill.type === "solid" ? [l.fill.color] : l.fill.stops.map((s) => s.color)));
    for (const target of [[127, 78, 142], [225, 171, 77], [45, 88, 42], [187, 106, 43]])
      expect(colours.some((c) => close(c, target, 30))).toBe(true);
    expect(advice.recommend).toBe("color");
  }, 30000);
});
