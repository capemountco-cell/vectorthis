import { withBackground, withWhiteBackground } from "@/lib/png-background";
import { BOARD, boardView, reframeSvg } from "@/lib/board";
import { coverageFromRgba, toSvg, vectorizeDetailed, type TracedPath } from "@/lib/vectorize";
import { coverageSignature } from "@/lib/logo-fidelity";
import { adviseColor, toLayeredSvg, traceColor, type ColorAdvice, type ColorLayer } from "@/lib/color-trace";
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
export async function renderPngPair(svg: string, view: ViewBox, size = DEFAULT_PNG_SIZE, brand: string | null = null) {
  const vector = await decodeSvg(svg);
  const scale = size / Math.max(view.width, view.height);
  const { canvas, ctx } = canvas2d(Math.max(1, Math.round(view.width * scale)), Math.max(1, Math.round(view.height * scale)));
  ctx.drawImage(vector, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const png = canvas.toDataURL("image/png");
  ctx.putImageData(new ImageData(withWhiteBackground(pixels.data), canvas.width, canvas.height), 0, 0);
  const whitePng = canvas.toDataURL("image/png");
  let brandPng: string | null = null;
  if (brand) {
    const v = parseInt(brand.slice(1), 16);
    ctx.putImageData(new ImageData(withBackground(pixels.data, [(v >> 16) & 255, (v >> 8) & 255, v & 255]), canvas.width, canvas.height), 0, 0);
    brandPng = canvas.toDataURL("image/png");
  }
  return { png, whitePng, brandPng, width: canvas.width, height: canvas.height };
}

export type BoardOutputs = { svg: string; view: ViewBox; png: string; whitePng: string; brandPng: string | null };

/** The default export: the logo centred on the 1300 × 1200 design board. */
export async function boardOutputs(svg: string, paths: TracedPath[], brand: string | null): Promise<BoardOutputs> {
  const view = boardView(paths);
  const boardSvg = reframeSvg(svg, view, BOARD.width, BOARD.height);
  const pngs = await renderPngPair(boardSvg, view, BOARD.width, brand);
  return { svg: boardSvg, view, png: pngs.png, whitePng: pngs.whitePng, brandPng: pngs.brandPng };
}

/**
 * Shape match (hard IoU at the 50% ink edge) between the vector and the traced image;
 * 1 = identical. A soft per-pixel score punished blurry uploads for their blur, not the trace.
 */
async function pixelAccuracy(svg: string, view: ViewBox, coverage: Float32Array, width: number, height: number) {
  const vector = await decodeSvg(svg);
  const { ctx } = canvas2d(width, height);
  // The SVG's units are crop pixels and its viewBox starts at view.x/view.y: drawing the
  // image there at view size puts one unit on one source pixel.
  ctx.drawImage(vector, view.x, view.y, view.width, view.height);
  const drawn = ctx.getImageData(0, 0, width, height).data;
  let both = 0, union = 0;
  for (let i = 0; i < coverage.length; i++) {
    const a = (coverage[i] ?? 0) >= 0.5, b = (drawn[i * 4 + 3] ?? 0) >= 128;
    if (a && b) both++;
    if (a || b) union++;
  }
  return union ? both / union : 0;
}

export type LogoOutputs = {
  png: string;
  whitePng: string;
  svg: string;
  signature: Float32Array;
  paths: TracedPath[];
  /** Filled shapes back to front: one black layer for black & white, several for colour. */
  layers: ColorLayer[];
  view: ViewBox;
  /** Pixel match between the SVG and the image it was traced from. */
  accuracy: number;
  advice: ColorAdvice;
  /** Logo-only PNG on the brand background (colour results with a coloured upload). */
  brandPng?: string | null;
  /** The logo on the 1300 × 1200 design board (the default export). */
  board: BoardOutputs;
  /** The upload's background colour when it is a real colour (not white or transparent). */
  background: string | null;
  source: { width: number; height: number; transparent: boolean };
};

/** Border colour of an opaque upload when it is a real colour; null for white or near-white. */
function brandBackground(d: Uint8ClampedArray, width: number, height: number) {
  const ch: number[][] = [[], [], []];
  const push = (x: number, y: number) => { const i = (y * width + x) * 4; for (let c = 0; c < 3; c++) ch[c]!.push(d[i + c]!); };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { push(0, y); push(width - 1, y); }
  const med = ch.map((v) => v.sort((a, b) => a - b)[v.length >> 1] ?? 255);
  if (med.every((v) => v >= 235)) return null;
  return `#${med.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Loads an image and crops it to the logo plus an even margin (shared by both trace styles). */
async function loadCrop(src: string) {
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
  const rgba = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const row = (y + y0) * data.width + x0;
    croppedCoverage.set(coverage.subarray(row, row + cw), y * cw);
    rgba.set(d.subarray(row * 4, (row + cw) * 4), y * cw * 4);
  }
  // Even SVG margin on every side, even where the logo touches the edge of its image.
  const view: ViewBox = margin
    ? { x: ink.x0 - margin - x0, y: ink.y0 - margin - y0, width: ink.x1 - ink.x0 + 1 + 2 * margin, height: ink.y1 - ink.y0 + 1 + 2 * margin }
    : { x: 0, y: 0, width: cw, height: ch };
  return { cw, ch, view, coverage: croppedCoverage, rgba, background: transparent ? null : brandBackground(d, data.width, data.height), source: { width: data.width, height: data.height, transparent } };
}

export async function toOutputs(src: string): Promise<LogoOutputs> {
  const { cw, ch, view, coverage: croppedCoverage, rgba, source, background } = await loadCrop(src);
  const paths = vectorizeDetailed(croppedCoverage, cw, ch);
  const svg = toSvg(paths, cw, ch, view);
  // Shape fingerprint, so a redraw can be scored against the original.
  const signature = coverageSignature(croppedCoverage, cw, ch);
  const [pngs, accuracy, board] = await Promise.all([
    renderPngPair(svg, view),
    pixelAccuracy(svg, view, croppedCoverage, cw, ch),
    // Black & white never goes on the brand colour: black ink would vanish on dark brands.
    boardOutputs(svg, paths, null),
  ]);
  return {
    png: pngs.png,
    whitePng: pngs.whitePng,
    svg,
    signature,
    paths,
    layers: [{ paths, fill: { type: "solid", color: "#000000" } }],
    view,
    accuracy,
    // Cheap (downscaled) look at the colours, so the app can say whether colour is worth keeping.
    advice: adviseColor(rgba, cw, ch),
    board,
    background,
    source,
  };
}

/** 1 = the vector's colours match the image exactly (mean RGB difference over the logo). */
async function colorAccuracy(svg: string, view: ViewBox, rgba: Uint8ClampedArray, width: number, height: number, background: string | null) {
  const vector = await decodeSvg(svg);
  const { ctx } = canvas2d(width, height);
  ctx.drawImage(vector, view.x, view.y, view.width, view.height);
  const drawn = ctx.getImageData(0, 0, width, height).data;
  // Compare both on the upload's own background (white when it has none), so the background
  // the trace leaves transparent counts as matching, not as a miss.
  const bgv = background ? parseInt(background.slice(1), 16) : 0xffffff;
  const bg = [(bgv >> 16) & 255, (bgv >> 8) & 255, bgv & 255];
  const onBg = (v: number, a: number, c: number) => v * a + bg[c]! * (1 - a);
  let diff = 0, count = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const aa = (rgba[i + 3] ?? 255) / 255, ab = (drawn[i + 3] ?? 0) / 255;
    const A = [0, 1, 2].map((c) => onBg(rgba[i + c]!, aa, c)), B = [0, 1, 2].map((c) => onBg(drawn[i + c]!, ab, c));
    const isBg = (v: number[]) => v.every((x, c) => Math.abs(x - bg[c]!) < 10);
    if (isBg(A) && isBg(B)) continue; // background in both
    diff += (Math.abs(A[0]! - B[0]!) + Math.abs(A[1]! - B[1]!) + Math.abs(A[2]! - B[2]!)) / 3;
    count++;
  }
  return count ? Math.max(0, 1 - diff / count / 255) : 0;
}

/** Colour trace: one shape per colour region, flat or gradient filled. Slower than black & white. */
export async function toColorOutputs(src: string): Promise<LogoOutputs> {
  const { cw, ch, view, coverage, rgba, source, background } = await loadCrop(src);
  const { layers, advice } = traceColor(rgba, cw, ch);
  const svg = toLayeredSvg(layers, cw, ch, view);
  const paths = layers.flatMap((l) => l.paths);
  const [pngs, accuracy, board] = await Promise.all([
    renderPngPair(svg, view, DEFAULT_PNG_SIZE, background),
    colorAccuracy(svg, view, rgba, cw, ch, background),
    boardOutputs(svg, paths, background),
  ]);
  return {
    png: pngs.png,
    whitePng: pngs.whitePng,
    svg,
    signature: coverageSignature(coverage, cw, ch),
    paths,
    layers,
    view,
    accuracy,
    advice,
    board,
    background,
    brandPng: pngs.brandPng,
    source,
  };
}
