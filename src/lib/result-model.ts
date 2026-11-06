// What the result workspace shows and saves (browser only: builds Files and renders PNGs).
import { DEFAULT_PNG_SIZE, renderPngPair, type LogoOutputs } from "@/lib/logo-convert";
import { logoFile } from "@/lib/logo-files";
import type { TaskMode } from "@/lib/logo-task";
import { parseSvg, type ViewBox } from "@/lib/outline";
import type { RecentItem } from "@/lib/recent";
import type { TracedPath } from "@/lib/vectorize";

export type Accuracy = { kind: "pixel" | "shape"; value: number };

export type PngPair = { size: number; pngFile: File; whiteFile: File };

export type LogoResult = {
  name: string;
  mode: TaskMode;
  svg: string;
  paths: TracedPath[];
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
  opts: { name: string; mode: TaskMode; accuracy: Accuracy | null; original: string | null; detail: string },
): LogoResult {
  return {
    ...opts,
    svg: o.svg,
    paths: o.paths,
    view: o.view,
    png: o.png,
    svgFile: logoFile(o.svg, `${opts.name}.svg`, "image/svg+xml"),
    pngs: pngPairFiles(opts.name, DEFAULT_PNG_SIZE, o),
  };
}

export async function resultFromRecent(item: RecentItem): Promise<LogoResult> {
  const { paths, view } = parseSvg(item.svg);
  if (!view || !paths.length) throw new Error("That saved logo could not be opened.");
  const pair = await renderPngPair(item.svg, view);
  return {
    name: item.name,
    mode: item.mode as TaskMode,
    svg: item.svg,
    paths,
    view,
    png: pair.png,
    svgFile: logoFile(item.svg, `${item.name}.svg`, "image/svg+xml"),
    pngs: pngPairFiles(item.name, DEFAULT_PNG_SIZE, pair),
    accuracy: null,
    original: null,
    detail: "Opened from Recent",
  };
}
