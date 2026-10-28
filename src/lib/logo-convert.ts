import { withWhiteBackground } from "@/lib/png-background";

// Turns a black-on-white image into PNG variants and a traced SVG (browser only).
async function loadPixels(src: string) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare your logo image");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return { canvas, ctx, data: ctx.getImageData(0, 0, canvas.width, canvas.height) };
}

export async function toOutputs(src: string) {
  const { canvas, ctx, data } = await loadPixels(src);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * (d[i] ?? 255) + 0.587 * (d[i + 1] ?? 255) + 0.114 * (d[i + 2] ?? 255);
    // darkness -> alpha, smooth edges
    const a = Math.max(0, Math.min(255, ((235 - lum) / 175) * 255));
    d[i] = d[i + 1] = d[i + 2] = 0;
    d[i + 3] = a;
  }
  // crop to the logo with a small margin
  let x0 = data.width, y0 = data.height, x1 = 0, y1 = 0;
  for (let y = 0; y < data.height; y++)
    for (let x = 0; x < data.width; x++)
      if ((d[(y * data.width + x) * 4 + 3] ?? 0) > 40) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
  if (x1 > x0 && y1 > y0) {
    const m = Math.round(Math.max(x1 - x0, y1 - y0) * 0.06);
    x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m);
    x1 = Math.min(data.width - 1, x1 + m); y1 = Math.min(data.height - 1, y1 + m);
  } else { x0 = 0; y0 = 0; x1 = data.width - 1; y1 = data.height - 1; }
  ctx.putImageData(data, 0, 0);
  const cropped = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  canvas.width = cropped.width; canvas.height = cropped.height;
  ctx.putImageData(cropped, 0, 0);
  const png = canvas.toDataURL("image/png");
  const cd = cropped.data;

  // Binary copy for tracing
  const bin = new ImageData(new Uint8ClampedArray(cd), cropped.width, cropped.height);
  for (let i = 0; i < bin.data.length; i += 4) {
    const on = (bin.data[i + 3] ?? 0) > 128;
    bin.data[i] = bin.data[i + 1] = bin.data[i + 2] = on ? 0 : 255;
    bin.data[i + 3] = 255;
  }
  const { default: ImageTracer } = await import("imagetracerjs");
  let svg: string = ImageTracer.imagedataToSVG(bin, {
    colorsampling: 0,
    numberofcolors: 2,
    pal: [
      { r: 0, g: 0, b: 0, a: 255 },
      { r: 255, g: 255, b: 255, a: 255 },
    ],
    ltres: 0.5,
    qtres: 0.5,
    pathomit: 8,
    roundcoords: 2,
    viewbox: true,
  });
  // drop white paths so background is transparent
  svg = svg.replace(/<path[^>]*fill="rgb\(255,255,255\)"[^>]*\/>/g, "");
  // Composite the same cropped pixels onto white, without another AI request.
  ctx.putImageData(new ImageData(withWhiteBackground(cd), cropped.width, cropped.height), 0, 0);
  const whitePng = canvas.toDataURL("image/png");
  return { png, whitePng, svg };
}
