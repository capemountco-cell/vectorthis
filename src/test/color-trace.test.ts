import { describe, expect, it } from "vitest";
import { adviseColor, isOverlay, toLayeredSvg, traceColor } from "@/lib/color-trace";
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
    expect(svg).toMatch(/fill="url\(#v[0-9a-z]+g\d+\)"/);
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

  it("keeps fine lettering on a coloured background instead of treating it as edge halo", () => {
    // Regression: "LANDSCAPE GROUP" (small letters, ~3px strokes) was dropped as too small.
    const { width, height, rgba } = decodePng("src/test/fixtures/benchmark-logo.png");
    const { layers } = traceColor(rgba, width, height);
    const shapes = layers.flatMap((l) => l.paths);
    // Mark (one shape per stripe) + BENCHMARK + LANDSCAPE GROUP letters.
    expect(shapes.length).toBeGreaterThanOrEqual(30);
    const lowest = Math.max(...shapes.flatMap((p) => [p.start.y, ...p.segments.map((s) => s.to.y)]));
    expect(lowest).toBeGreaterThan(830); // the small second line of text is there
    const white = layers.filter((l) => l.fill.type === "solid" && close(l.fill.color, [252, 253, 253], 20));
    expect(white.length).toBeGreaterThanOrEqual(20);
  }, 30000);

  it("rebuilds soft shaded artwork: radial base, highlight and shadow overlays, a separate stem, smooth outline", () => {
    // A soft airbrushed apple on a textured off-white background (photo-like, Display P3 → sRGB).
    const { width, height, rgba } = decodePng("src/test/fixtures/shaded-apple.png");
    const { layers } = traceColor(rgba, width, height);
    const shapes = layers.filter((l) => !isOverlay(l.fill));
    expect(shapes).toHaveLength(3); // fruit, leaf, stem
    const fruit = layers[0]!;
    expect(fruit.fill.type).toBe("radial");
    const overlays = layers.slice(1).filter((l) => isOverlay(l.fill) && l.paths === fruit.paths).map((l) => l.fill);
    expect(overlays.length).toBeGreaterThanOrEqual(2);
    const lum = (h: string) => { const [r, g, b] = rgbOf(h); return 0.3 * r! + 0.59 * g! + 0.11 * b!; };
    const centre = (f: (typeof overlays)[number]) => (f.type === "radial" ? { x: f.cx, y: f.cy, c: f.stops[0]!.color } : null);
    const blobs = overlays.map(centre).filter((b) => b !== null);
    // Pale highlight on the upper left, darker shading on the upper right.
    expect(blobs.some((b) => b.x < 300 && b.y < 150 && lum(b.c) > 150)).toBe(true);
    expect(blobs.some((b) => b.x > 330 && b.y < 170 && lum(b.c) < 90)).toBe(true);
    // The stem is brown, not painted with the fruit's red.
    const stem = shapes[2]!;
    const stemColours = stem.fill.type === "solid" ? [stem.fill.color] : stem.fill.stops.map((s) => s.color);
    const avg = [0, 1, 2].map((k) => stemColours.reduce((t, c) => t + rgbOf(c)[k]!, 0) / stemColours.length);
    expect(avg[1]!).toBeGreaterThan(60);
    expect(avg[0]! - avg[1]!).toBeLessThan(120);
    // Soft edges trace as a smooth outline, not a wobbly one.
    expect(fruit.paths.reduce((n, p) => n + p.segments.length, 0)).toBeLessThanOrEqual(26);
  }, 30000);

  it("fits an off-centre radial gradient as a radial gradient", () => {
    const img = paint(160, 160, (x, y) => {
      const d = Math.hypot(x - 80, y - 80);
      if (d > 60) return WHITE;
      const t = Math.min(1, Math.hypot(x - 60, (y - 50) / 1.3) / 90);
      return [250 - 40 * t, 200 - 170 * t, 60 - 40 * t];
    });
    const { layers } = traceColor(img, 160, 160);
    expect(layers.filter((l) => !isOverlay(l.fill))).toHaveLength(1);
    const f = layers[0]!.fill;
    expect(f.type).toBe("radial");
    if (f.type !== "radial") return;
    expect(Math.abs(f.cx - 60.5)).toBeLessThan(8);
    expect(Math.abs(f.cy - 50.5)).toBeLessThan(10);
    expect(Math.abs(f.sy - 1.3)).toBeLessThan(0.25);
  });
});
