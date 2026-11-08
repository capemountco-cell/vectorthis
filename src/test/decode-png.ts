import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

/** Minimal decoder for 8-bit RGBA, non-interlaced PNGs (enough for test fixtures). */
export function decodePng(path: string) {
  const buf = readFileSync(path);
  const width = buf.readUInt32BE(16),
    height = buf.readUInt32BE(20);
  const idat: Buffer[] = [];
  for (let o = 8; o < buf.length; ) {
    const length = buf.readUInt32BE(o);
    if (buf.toString("ascii", o + 4, o + 8) === "IDAT") idat.push(buf.subarray(o + 8, o + 8 + length));
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
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][raw[y * (stride + 1)]!]!;
      out[y * stride + x] = (raw[y * (stride + 1) + 1 + x]! + pred) & 255;
    }
  return { width, height, rgba: out };
}
