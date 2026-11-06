// Browser-only: turns an upload into the reference the AI sees, plus facts for the prompt.
// Clean logo files are re-rendered from their exact vector trace as large, crisp black art
// (tiny or pale originals are otherwise hard for the model to read); photos are flattened on white.
import { coverageSignature, geometryBrief, isCleanLogo, matchScore } from "@/lib/logo-fidelity";
import { coverageFromRgba, toSvg, vectorize } from "@/lib/vectorize";

export type PreparedReference = {
  /** The image to send as the original logo. */
  file: File;
  /** Measured geometry for the prompt ("" when the upload isn't a clean logo). */
  geometry: string;
  /** True when `file` is a rendering of the vector trace. */
  traced: boolean;
  /** Shape signature of the original, for scoring redraws (null for photos). */
  signature: Float32Array | null;
};

const SIZE = 1024;
const MAX_ANALYSIS = 2048;
const cache = new WeakMap<File, Promise<PreparedReference>>();

/** Same file → same work, so batch tasks and retries don't re-trace it. */
export function prepareReference(file: File) {
  let pending = cache.get(file);
  if (!pending) {
    pending = build(file);
    cache.set(file, pending);
    pending.catch(() => cache.delete(file));
  }
  return pending;
}

function canvasFile(canvas: HTMLCanvasElement, name: string) {
  return new Promise<File>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(new File([blob], name, { type: "image/png" }))
          : reject(new Error("Could not prepare your logo.")),
      "image/png",
    ),
  );
}

function context(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read your logo.");
  return ctx;
}

async function build(file: File): Promise<PreparedReference> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_ANALYSIS / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale)),
      h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = context(canvas);
    // No white fill: transparency is the most exact ink mask.
    ctx.drawImage(bitmap, 0, 0, w, h);
    const coverage = coverageFromRgba(ctx.getImageData(0, 0, w, h).data, w, h);

    if (isCleanLogo(coverage, w, h)) {
      const paths = vectorize(coverage, w, h);
      const signature = coverageSignature(coverage, w, h);
      // Square view around the ink with an even margin, rendered at 1024px.
      let x0 = w,
        y0 = h,
        x1 = 0,
        y1 = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if (coverage[y * w + x]! >= 0.5) {
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x + 1);
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y + 1);
          }
      const side = Math.max(x1 - x0, y1 - y0) * 1.16;
      const view = { x: (x0 + x1 - side) / 2, y: (y0 + y1 - side) / 2, width: side, height: side };
      const vector = new Image();
      vector.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(toSvg(paths, w, h, view))}`;
      await vector.decode();
      canvas.width = canvas.height = SIZE;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.drawImage(vector, 0, 0, SIZE, SIZE);
      return {
        file: await canvasFile(canvas, "original.png"),
        geometry: geometryBrief(paths, signature),
        traced: true,
        signature,
      };
    }

    // Photo or textured logo: keep it as-is on white, enlarged if small so details stay readable.
    const up = Math.max(1, SIZE / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * up);
    canvas.height = Math.round(bitmap.height * up);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return {
      file: await canvasFile(canvas, "upload.png"),
      geometry: "",
      traced: false,
      signature: null,
    };
  } finally {
    bitmap.close();
  }
}

/** Shape match (0–1) between a redraw's signature and the original's, or null if it can't be scored. */
export function shapeMatch(reference: PreparedReference | null, output: Float32Array | undefined) {
  return reference?.signature && output ? matchScore(reference.signature, output) : null;
}
