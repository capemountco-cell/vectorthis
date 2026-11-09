// What the result workspace shows and saves (browser only: builds Files and renders PNGs).
import { boardOutputs, DEFAULT_PNG_SIZE, renderPngPair, type LogoOutputs } from "@/lib/logo-convert";
import { BOARD } from "@/lib/board";
import { logoFile } from "@/lib/logo-files";
import type { TaskMode } from "@/lib/logo-task";
import { parseSvg, type ViewBox } from "@/lib/outline";
import type { RecentItem } from "@/lib/recent";
import type { TracedPath } from "@/lib/vectorize";
import type { ColorAdvice, ColorLayer } from "@/lib/color-trace";

export type Accuracy = { kind: "pixel" | "shape" | "color"; value: number };

export type Variant = "mono" | "color";

export type PngPair = { size: number; pngFile: File; whiteFile: File; brandFile?: File | undefined };

/** What an export is framed on: the 1300 × 1200 design board (default) or the logo alone. */
export type Canvas = "board" | "logo";

export type BoardExport = { svg: string; view: ViewBox; svgFile: File; pngs: PngPair; png: string };

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
  /** The logo centred on the 1300 × 1200 design board: the default export. */
  board: BoardExport;
  /** The upload's background colour, offered as a PNG background for colour results. */
  background: string | null;
  /** The upload (object URL), for Compare; null when reopened from Recent. */
  original: string | null;
  detail: string;
};

/** File names: `name.png` at the canvas's default size, `name-2600.png` etc. otherwise. */
export function pngPairFiles(
  name: string,
  size: number,
  pair: { png: string; whitePng: string; brandPng?: string | null | undefined },
  defaultSize = DEFAULT_PNG_SIZE,
): PngPair {
  const suffix = size === defaultSize ? "" : `-${size}`;
  return {
    size,
    pngFile: logoFile(pair.png, `${name}${suffix}.png`, "image/png"),
    whiteFile: logoFile(pair.whitePng, `${name}${suffix}-white.png`, "image/png"),
    brandFile: pair.brandPng ? logoFile(pair.brandPng, `${name}${suffix}-brand.png`, "image/png") : undefined,
  };
}

function boardExport(name: string, b: { svg: string; view: ViewBox; png: string; whitePng: string; brandPng: string | null }): BoardExport {
  return {
    svg: b.svg,
    view: b.view,
    png: b.png,
    svgFile: logoFile(b.svg, `${name}.svg`, "image/svg+xml"),
    pngs: pngPairFiles(name, BOARD.width, b, BOARD.width),
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
    // Logo-only files carry "-logo"; the board files get the plain name since they are the default.
    svgFile: logoFile(o.svg, `${fileName}-logo.svg`, "image/svg+xml"),
    pngs: pngPairFiles(`${fileName}-logo`, DEFAULT_PNG_SIZE, { png: o.png, whitePng: o.whitePng, brandPng: o.brandPng }),
    board: boardExport(fileName, o.board),
    background: o.background,
  };
}

export async function resultFromRecent(item: RecentItem): Promise<LogoResult> {
  const { paths, view, layers } = parseSvg(item.svg);
  const color = layers.length > 1 || layers.some((l) => l.fill.type !== "solid" || l.fill.color.toLowerCase() !== "#000000");
  if (!view || !paths.length) throw new Error("That saved logo could not be opened.");
  const [pair, board] = await Promise.all([renderPngPair(item.svg, view), boardOutputs(item.svg, paths, null)]);
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
    svgFile: logoFile(item.svg, `${item.name}-logo.svg`, "image/svg+xml"),
    pngs: pngPairFiles(`${item.name}-logo`, DEFAULT_PNG_SIZE, pair),
    board: boardExport(item.name, board),
    background: null,
    accuracy: null,
    original: null,
    detail: "Opened from Recent",
  };
}
