// What the result workspace shows and saves (browser only: builds Files and renders PNGs).
import { DEFAULT_PNG_SIZE, renderPngPair, type LogoOutputs } from "@/lib/logo-convert";
import { logoFile } from "@/lib/logo-files";
import type { TaskMode } from "@/lib/logo-task";
import { parseSvg, type ViewBox } from "@/lib/outline";
import type { RecentItem } from "@/lib/recent";
import type { TracedPath } from "@/lib/vectorize";
import type { ColorAdvice, ColorLayer } from "@/lib/color-trace";

export type Accuracy = { kind: "pixel" | "shape" | "color"; value: number };

export type Variant = "mono" | "color";

export type PngPair = { size: number; pngFile: File; whiteFile: File };

export type LogoResult = {
  name: string;
  mode: TaskMode;
  svg: string;
  paths: TracedPath[];
  /** Filled shapes back to front (one black layer for black & white). */
  layers: ColorLayer[];
  variant: Variant;
  /** Whether colour is worth keeping (null when unknown, e.g. reopened from Recent). */
  advice: ColorAdvice | null;
  view: ViewBox;
  /** Transparent PNG data URL, for previews. */
  png: string;
  svgFile: File;
  /** Prepared PNGs at the default size, ready for a synchronous mobile share. */
  pngs: PngPair;
  accuracy: Accuracy | null;
  /** The upload (object URL), for Compare; null when reopened from Recent. */
  original: string | null;
  detail: string;
};

export function pngPairFiles(name: string, size: number, pair: { png: string; whitePng: string }): PngPair {
  const suffix = size === DEFAULT_PNG_SIZE ? "" : `-${size}`;
  return {
    size,
    pngFile: logoFile(pair.png, `${name}${suffix}.png`, "image/png"),
    whiteFile: logoFile(pair.whitePng, `${name}${suffix}-white.png`, "image/png"),
  };
}

export function buildResult(
  o: LogoOutputs,
  opts: { name: string; mode: TaskMode; accuracy: Accuracy | null; original: string | null; detail: string; variant?: Variant },
): LogoResult {
  const variant = opts.variant ?? "mono";
  const fileName = variant === "color" ? `${opts.name}-color` : opts.name;
  return {
    ...opts,
    variant,
    advice: o.advice,
    layers: o.layers,
    svg: o.svg,
    paths: o.paths,
    view: o.view,
    png: o.png,
    svgFile: logoFile(o.svg, `${fileName}.svg`, "image/svg+xml"),
    pngs: pngPairFiles(fileName, DEFAULT_PNG_SIZE, o),
  };
}

export async function resultFromRecent(item: RecentItem): Promise<LogoResult> {
  const { paths, view, layers } = parseSvg(item.svg);
  const color = layers.length > 1 || layers.some((l) => l.fill.type !== "solid" || l.fill.color.toLowerCase() !== "#000000");
  if (!view || !paths.length) throw new Error("That saved logo could not be opened.");
  const pair = await renderPngPair(item.svg, view);
  return {
    name: item.name,
    mode: item.mode as TaskMode,
    svg: item.svg,
    paths,
    layers,
    variant: color ? "color" : "mono",
    advice: null,
    view,
    png: pair.png,
    svgFile: logoFile(item.svg, `${item.name}.svg`, "image/svg+xml"),
    pngs: pngPairFiles(item.name, DEFAULT_PNG_SIZE, pair),
    accuracy: null,
    original: null,
    detail: "Opened from Recent",
  };
}
