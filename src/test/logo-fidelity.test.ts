import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { coverageSignature, geometryBrief, isCleanLogo, matchScore } from "@/lib/logo-fidelity";
import { coverageFromRgba, vectorize } from "@/lib/vectorize";

function decodePng(path: string) {
  const buf = readFileSync(path);
  const width = buf.readUInt32BE(16),
    height = buf.readUInt32BE(20);
  const idat: Buffer[] = [];
  for (let o = 8; o < buf.length;) {
    const length = buf.readUInt32BE(o);
    if (buf.toString("ascii", o + 4, o + 8) === "IDAT")
      idat.push(buf.subarray(o + 8, o + 8 + length));
    o += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4,
    out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[y * stride + x - 4]! : 0,
        b = y > 0 ? out[(y - 1) * stride + x]! : 0,
        c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4]! : 0;
      const pa = Math.abs(b - c),
        pb = Math.abs(a - c),
        pc = Math.abs(a + b - 2 * c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][
        raw[y * (stride + 1)]!
      ]!;
      out[y * stride + x] = (raw[y * (stride + 1) + 1 + x]! + pred) & 255;
    }
  return { width, height, rgba: out };
}

// Antialiased coverage of an analytic shape.
function raster(width: number, height: number, inside: (x: number, y: number) => boolean) {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let hits = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) hits++;
      out[y * width + x] = hits / 16;
    }
  return out;
}

const mark = decodePng("src/test/fixtures/greek-key-mark.png");
const markCoverage = coverageFromRgba(mark.rgba, mark.width, mark.height);

describe("clean logo detection", () => {
  it("treats a crisp logo file as clean and a noisy photo-like image as not", () => {
    expect(isCleanLogo(markCoverage, mark.width, mark.height)).toBe(true);
    let seed = 7;
    const noise = new Float32Array(200 * 200).map(
      () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 0.9,
    );
    expect(isCleanLogo(noise, 200, 200)).toBe(false);
  });
});

describe("geometry brief", () => {
  it("describes the Greek-key mark's measured shape for the image model", () => {
    const paths = vectorize(markCoverage, mark.width, mark.height);
    const brief = geometryBrief(paths, coverageSignature(markCoverage, mark.width, mark.height));
    expect(brief).toContain("Overall width:height = 1.01");
    expect(brief).toContain("2 separate solid shapes and 0 enclosed holes");
    expect(brief).toContain("Shape 2 spans x 31%–100%, y 31%–100%");
    expect(brief).toContain("perfectly straight horizontal and vertical edges");
    expect(brief).toContain("all exact right angles");
    expect(brief).toMatch(/Only 2 rounded corners: top-left .*; top-right/);
    expect(brief).toContain("Not symmetric");
  });

  it("notices mirror symmetry", () => {
    const cov = raster(
      100,
      80,
      (x, y) => Math.abs(x - 50) < 30 && y > 10 && y < 70 && !(Math.abs(x - 50) < 8 && y < 40),
    );
    const brief = geometryBrief(vectorize(cov, 100, 80), coverageSignature(cov, 100, 80));
    expect(brief).toContain("Left-right mirror");
  });
});

describe("shape match", () => {
  it("ignores size and position but catches changed proportions", () => {
    const shape =
      (s: number, dx: number, dy: number, notch = 0.4) =>
      (x: number, y: number) => {
        const u = (x - dx) / s,
          v = (y - dy) / s;
        return u > 0 && u < 1 && v > 0 && v < 1 && !(u > notch && v > 0.3 && v < 0.6);
      };
    const original = coverageSignature(raster(60, 60, shape(40, 10, 10)), 60, 60);
    const resized = coverageSignature(raster(400, 300, shape(230, 120, 40)), 400, 300);
    const drifted = coverageSignature(raster(400, 300, shape(230, 120, 40, 0.15)), 400, 300);
    expect(matchScore(original, original)).toBe(1);
    expect(matchScore(original, resized)).toBeGreaterThan(0.97);
    expect(matchScore(original, drifted)).toBeLessThan(0.93);
  });
});
