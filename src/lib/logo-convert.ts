import { withWhiteBackground } from "@/lib/png-background";
import { coverageFromRgba, toSvg, vectorizeDetailed, type TracedPath } from "@/lib/vectorize";
import { coverageSignature } from "@/lib/logo-fidelity";
import type { ViewBox } from "@/lib/outline";

// Turns a single-colour logo (any ink/background colours, or transparent) into a traced SVG
// plus black PNG variants rendered from that vector (browser only).
async function loadPixels(src: string) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare your logo image");
  // No white fill: transparent uploads keep their alpha, which is the most exact ink mask.
  ctx.drawImage(img, 0, 0);
  return { canvas, ctx, data: ctx.getImageData(0, 0, canvas.width, canvas.height) };
}

export const DEFAULT_PNG_SIZE = 2048;

async function decodeSvg(svg: string) {
  const vector = new Image();
  vector.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await vector.decode();
  return vector;
}

function canvas2d(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare your logo image");
  return { canvas, ctx };
}

/**
 * Both PNG backgrounds rendered from the same vector pixels, so switching background
 * never needs another render. `size` is the long side in px.
 */
export async function renderPngPair(svg: string, view: ViewBox, size = DEFAULT_PNG_SIZE) {
  const vector = await decodeSvg(svg);
  const scale = size / Math.max(view.width, view.height);
  const { canvas, ctx } = canvas2d(Math.max(1, Math.round(view.width * scale)), Math.max(1, Math.round(view.height * scale)));
  ctx.drawImage(vector, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const png = canvas.toDataURL("image/png");
  ctx.putImageData(new ImageData(withWhiteBackground(pixels.data), canvas.width, canvas.height), 0, 0);
  return { png, whitePng: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}

/** 1 = the vector covers exactly the same pixels as the traced image. */
async function pixelAccuracy(svg: string, view: ViewBox, coverage: Float32Array, width: number, height: number) {
  const vector = await decodeSvg(svg);
  const { ctx } = canvas2d(width, height);
  // The SVG's units are crop pixels and its viewBox starts at view.x/view.y: drawing the
  // image there at view size puts one unit on one source pixel.
  ctx.drawImage(vector, view.x, view.y, view.width, view.height);
  const drawn = ctx.getImageData(0, 0, width, height).data;
  let diff = 0, union = 0;
  for (let i = 0; i < coverage.length; i++) {
    const a = coverage[i] ?? 0, b = (drawn[i * 4 + 3] ?? 0) / 255;
    diff += Math.abs(a - b);
    union += Math.max(a, b);
  }
  return union ? Math.max(0, 1 - diff / union) : 0;
}

export type LogoOutputs = {
  png: string;
  whitePng: string;
  svg: string;
  signature: Float32Array;
  paths: TracedPath[];
  view: ViewBox;
  /** Pixel match between the SVG and the image it was traced from. */
  accuracy: number;
  source: { width: number; height: number; transparent: boolean };
};

export async function toOutputs(src: string): Promise<LogoOutputs> {
  const { data } = await loadPixels(src);
  const d = data.data;
  // Ink coverage from the untouched pixels (ink/background colours detected automatically).
  const coverage = coverageFromRgba(d, data.width, data.height);
  let transparent = false;
  for (let i = 3; i < d.length && !transparent; i += 4) if ((d[i] ?? 255) < 250) transparent = true;
  // Crop to the logo with a small margin.
  let x0 = data.width, y0 = data.height, x1 = 0, y1 = 0;
  for (let y = 0; y < data.height; y++)
    for (let x = 0; x < data.width; x++)
      if ((coverage[y * data.width + x] ?? 0) > 0.24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  const ink = { x0, y0, x1, y1 };
  let margin = 0;
  if (x1 > x0 && y1 > y0) {
    margin = Math.round(Math.max(x1 - x0, y1 - y0) * 0.06);
    x0 = Math.max(0, x0 - margin);
    y0 = Math.max(0, y0 - margin);
    x1 = Math.min(data.width - 1, x1 + margin);
    y1 = Math.min(data.height - 1, y1 + margin);
  } else {
    x0 = 0;
    y0 = 0;
    x1 = data.width - 1;
    y1 = data.height - 1;
  }
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const croppedCoverage = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    const row = (y + y0) * data.width + x0;
    croppedCoverage.set(coverage.subarray(row, row + cw), y * cw);
  }
  // Even SVG margin on every side, even where the logo touches the edge of its image.
  const view: ViewBox = margin
    ? { x: ink.x0 - margin - x0, y: ink.y0 - margin - y0, width: ink.x1 - ink.x0 + 1 + 2 * margin, height: ink.y1 - ink.y0 + 1 + 2 * margin }
    : { x: 0, y: 0, width: cw, height: ch };
  const paths = vectorizeDetailed(croppedCoverage, cw, ch);
  const svg = toSvg(paths, cw, ch, view);
  // Shape fingerprint, so a redraw can be scored against the original.
  const signature = coverageSignature(croppedCoverage, cw, ch);
  const [pngs, accuracy] = await Promise.all([
    renderPngPair(svg, view),
    pixelAccuracy(svg, view, croppedCoverage, cw, ch),
  ]);
  return {
    png: pngs.png,
    whitePng: pngs.whitePng,
    svg,
    signature,
    paths,
    view,
    accuracy,
    source: { width: data.width, height: data.height, transparent },
  };
}
