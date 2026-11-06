import { withWhiteBackground } from "@/lib/png-background";
import { coverageFromRgba, toSvg, vectorize } from "@/lib/vectorize";

// Turns a single-colour logo (any ink/background colours, or transparent) into black PNG variants and a traced SVG (browser only).
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

export async function toOutputs(src: string) {
  const { canvas, ctx, data } = await loadPixels(src);
  const d = data.data;
  // Ink coverage from the untouched pixels (ink/background colours detected automatically).
  // The SVG is traced from this; the PNG uses it as black alpha, lightly levelled to drop haze.
  const coverage = coverageFromRgba(d, data.width, data.height);
  for (let i = 0; i < coverage.length; i++) {
    const a = Math.max(0, Math.min(1, ((coverage[i] ?? 0) - 0.08) / 0.84));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 0;
    d[i * 4 + 3] = Math.round(a * 255);
  }
  // crop to the logo with a small margin
  let x0 = data.width, y0 = data.height, x1 = 0, y1 = 0;
  for (let y = 0; y < data.height; y++)
    for (let x = 0; x < data.width; x++)
      if ((d[(y * data.width + x) * 4 + 3] ?? 0) > 40) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
  const ink = { x0, y0, x1, y1 };
  let margin = 0;
  if (x1 > x0 && y1 > y0) {
    const m = Math.round(Math.max(x1 - x0, y1 - y0) * 0.06);
    margin = m;
    x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m);
    x1 = Math.min(data.width - 1, x1 + m); y1 = Math.min(data.height - 1, y1 + m);
  } else { x0 = 0; y0 = 0; x1 = data.width - 1; y1 = data.height - 1; }
  ctx.putImageData(data, 0, 0);
  const cropped = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  canvas.width = cropped.width; canvas.height = cropped.height;
  ctx.putImageData(cropped, 0, 0);
  const png = canvas.toDataURL("image/png");
  const cd = cropped.data;

  const cw = cropped.width;
  const ch = cropped.height;
  const croppedCoverage = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    const row = (y + y0) * data.width + x0;
    croppedCoverage.set(coverage.subarray(row, row + cw), y * cw);
  }
  // Even SVG margin on every side, even where the logo touches the edge of its image.
  const view = margin
    ? { x: ink.x0 - margin - x0, y: ink.y0 - margin - y0, width: ink.x1 - ink.x0 + 1 + 2 * margin, height: ink.y1 - ink.y0 + 1 + 2 * margin }
    : undefined;
  const svg = toSvg(vectorize(croppedCoverage, cw, ch), cw, ch, view);
  if (Math.max(cw, ch) < 1024) {
    // Small source: a pixel-sized PNG would be blurry, so render both PNGs from the traced vector.
    const vw = view?.width ?? cw,
      vh = view?.height ?? ch;
    const scale = 2048 / Math.max(vw, vh);
    const vector = new Image();
    vector.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await vector.decode();
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(vector, 0, 0, canvas.width, canvas.height);
    const big = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const largePng = canvas.toDataURL("image/png");
    ctx.putImageData(new ImageData(withWhiteBackground(big.data), canvas.width, canvas.height), 0, 0);
    return { png: largePng, whitePng: canvas.toDataURL("image/png"), svg };
  }
  // Composite the same cropped pixels onto white, without another AI request.
  ctx.putImageData(new ImageData(withWhiteBackground(cd), cropped.width, cropped.height), 0, 0);
  const whitePng = canvas.toDataURL("image/png");
  return { png, whitePng, svg };
}
