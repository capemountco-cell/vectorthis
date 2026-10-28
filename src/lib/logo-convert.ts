// Turns a black-on-white image into a transparent PNG and a traced SVG (browser only).
async function loadPixels(src: string) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return { canvas, ctx, data: ctx.getImageData(0, 0, canvas.width, canvas.height) };
}

export async function toOutputs(src: string) {
  const { canvas, ctx, data } = await loadPixels(src);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
    // darkness -> alpha, smooth edges
    const a = Math.max(0, Math.min(255, ((235 - lum) / 175) * 255));
    d[i] = d[i + 1] = d[i + 2] = 0;
    d[i + 3] = a;
  }
  ctx.putImageData(data, 0, 0);
  const png = canvas.toDataURL("image/png");

  // Binary copy for tracing
  const bin = new ImageData(new Uint8ClampedArray(d), data.width, data.height);
  for (let i = 0; i < bin.data.length; i += 4) {
    const on = bin.data[i + 3]! > 128;
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
  return { png, svg };
}
