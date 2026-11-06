import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowUp, Copy, Download, Plus, RotateCw, Type } from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { renderPngPair } from "@/lib/logo-convert";
import { saveLogoSvg } from "@/lib/logo-files";
import { outlineStats } from "@/lib/outline";
import { pngPairFiles, type LogoResult, type PngPair } from "@/lib/result-model";
import { savePng } from "@/lib/save-png";
import { cn } from "@/lib/utils";
import { modeInfo } from "./modes";
import { PreviewCanvas, type CanvasBack, type PreviewView } from "./preview-canvas";
import { Segmented } from "./segmented";

export type Version = { name: string; src?: string; err?: string; match?: number | null };

type Props = {
  result: LogoResult;
  versions: Version[];
  onPickVersion: (src: string) => void;
  onNew: () => void;
  /** Re-run the same upload in another mode; absent when there is no upload (Recent). */
  onRerun?: ((mode: "trace" | "recreate" | "replace") => void) | undefined;
  /** Local fix for AI results (needs the AI draft). */
  onFix?: ((text: string) => void) | undefined;
  /** A problem from the last action (e.g. a failed re-run). */
  notice?: string | null;
};

const SIZES = [1024, 2048, 4096] as const;
type Format = "svg" | "png" | "png-white";

function Stat({ label, value, extra }: { label: string; value: string | number; extra?: string | undefined }) {
  return (
    <div className="rounded-xl bg-[#F7F7F5] px-3 py-2.5">
      <dt className="font-mono text-[10.5px] tracking-[0.04em] text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-semibold">
        {value}
        {extra && <span className="ml-1 text-xs font-medium text-muted-foreground">{extra}</span>}
      </dd>
    </div>
  );
}

const pct = (v: number) => `${(Math.floor(v * 1000) / 10).toFixed(1)}%`;

export function ResultWorkspace({ result, versions, onPickVersion, onNew, onRerun, onFix, notice }: Props) {
  const [view, setView] = useState<PreviewView>("artwork");
  const [back, setBack] = useState<CanvasBack>("dots");
  const [format, setFormat] = useState<"svg" | "png">("svg");
  const [pngBack, setPngBack] = useState<"transparent" | "white">("transparent");
  const [size, setSize] = useState<number>(result.pngs.size);
  const [prepared, setPrepared] = useState<Record<number, PngPair>>({ [result.pngs.size]: result.pngs });
  const [preparing, setPreparing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [sheetFormat, setSheetFormat] = useState<Format>("svg");
  const [fix, setFix] = useState("");
  const stats = useMemo(() => outlineStats(result.paths), [result.paths]);
  const info = modeInfo(result.mode);

  // A new result starts over with its own prepared files.
  useEffect(() => {
    setPrepared({ [result.pngs.size]: result.pngs });
    setSize(result.pngs.size);
    setSaveError(null);
  }, [result]);

  // Other PNG sizes are rendered when picked, so saving stays a synchronous tap.
  useEffect(() => {
    if (prepared[size]) {
      setPreparing(false);
      return;
    }
    let live = true;
    setPreparing(true);
    renderPngPair(result.svg, result.view, size)
      .then((pair) => { if (live) setPrepared((p) => ({ ...p, [size]: pngPairFiles(result.name, size, pair) })); })
      .catch(() => { if (live) setSaveError("That PNG size could not be prepared. Try a smaller size."); })
      .finally(() => { if (live) setPreparing(false); });
    return () => { live = false; };
  }, [size, prepared, result]);

  const copy = () => {
    void navigator.clipboard?.writeText(result.svg).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }).catch(() => setSaveError("Copy isn't available here. Use Download SVG instead."));
  };

  // Must run straight from the tap: mobile sharing refuses a share started after an await.
  const save = (f: Format, pngs: PngPair | undefined) => {
    setSaveError(null);
    if (f === "svg") {
      saveLogoSvg(result.svgFile).catch((e: unknown) => {
        if (!(e instanceof Error && e.name === "AbortError")) setSaveError("The SVG could not be saved. Try again.");
      });
      return;
    }
    if (!pngs) return;
    const promise = savePng(f === "png-white" ? pngs.whiteFile : pngs.pngFile);
    setSaving(true);
    promise.catch((e: unknown) => setSaveError(e instanceof Error ? e.message : "Saving failed.")).finally(() => setSaving(false));
  };

  const scored = versions.map((v) => v.match).filter((m): m is number => typeof m === "number");
  const best = scored.length > 1 ? Math.max(...scored) : null;
  const drifted = result.accuracy?.kind === "shape" && result.accuracy.value < 0.95;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onNew} aria-label="Back to start" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border">
            <ArrowLeft className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold">{result.name}</span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">{info.label} · {result.detail}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={copy} aria-label="Copy SVG" className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-medium sm:px-3.5">
            <Copy className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{copied ? "Copied" : "Copy SVG"}</span>
          </button>
          <button type="button" onClick={onNew} className="hidden h-11 items-center gap-2 rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground sm:inline-flex">
            <Plus className="h-4 w-4" aria-hidden="true" />
            New logo
          </button>
        </div>
      </header>

      {notice && (
        <p role="alert" className="border-b border-warn-border bg-warn-bg px-5 py-2.5 text-sm text-warn">{notice}</p>
      )}
      <div className="flex flex-1 flex-wrap gap-4 p-3 pb-28 sm:p-4 lg:pb-4">
        <section aria-label="Preview" className="flex min-w-0 flex-[999_1_560px] flex-col gap-3">
          <PreviewCanvas result={result} view={view} onView={setView} back={back} onBack={setBack} onCopy={copy} copied={copied} />
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap gap-2">
              {onRerun && result.mode === "trace" && (
                <button type="button" onClick={() => onRerun("recreate")} className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-3.5 text-sm font-medium">
                  <RotateCw className="h-4 w-4" aria-hidden="true" />
                  Redraw with AI
                </button>
              )}
              {onRerun && result.mode !== "trace" && (
                <button type="button" onClick={() => onRerun(result.mode === "recreate" ? "recreate" : "replace")} className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-3.5 text-sm font-medium">
                  <RotateCw className="h-4 w-4" aria-hidden="true" />
                  Try again
                </button>
              )}
              {onRerun && result.mode !== "replace" && (
                <button type="button" onClick={() => onRerun("replace")} className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-3.5 text-sm font-medium">
                  <Type className="h-4 w-4" aria-hidden="true" />
                  Change text
                </button>
              )}
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">{result.view.width.toFixed(0)} × {result.view.height.toFixed(0)} viewBox</span>
          </div>
          {onFix && (
            <form
              className="flex h-12 items-center gap-2 rounded-[14px] border border-border bg-card pr-1.5 pl-3.5"
              onSubmit={(e) => { e.preventDefault(); if (fix.trim()) onFix(fix.trim()); }}
            >
              <label className="flex flex-1">
                <span className="sr-only">Describe a fix</span>
                <input value={fix} onChange={(e) => setFix(e.target.value)} placeholder="Fix something… e.g. square the inner corner" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
              </label>
              <button type="submit" aria-label="Apply fix" disabled={!fix.trim()} className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[10px] bg-muted disabled:opacity-40">
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
              </button>
            </form>
          )}
        </section>

        <aside aria-label="Details and export" className="flex max-w-full flex-[1_1_300px] flex-col gap-3">
          <section className={cn("flex flex-col gap-3.5 rounded-[18px] border p-[18px]", drifted ? "border-warn-border bg-warn-bg" : "border-border bg-card")}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{result.accuracy?.kind === "shape" ? "Shape match" : "Accuracy"}</h2>
              <span className="rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-subtle">{info.ai ? "AI REDRAW" : "NO AI"}</span>
            </div>
            {result.accuracy ? (
              <>
                <div className="flex items-baseline gap-2">
                  <span className={cn("text-[40px] font-semibold tracking-[-0.03em]", drifted && "text-warn")}>{pct(result.accuracy.value)}</span>
                  <span className={cn("text-[13px]", drifted ? "text-warn" : "text-muted-foreground")}>
                    {result.accuracy.kind === "pixel" ? "pixel match with your file" : "match with your original"}
                  </span>
                </div>
                <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-[#EDEDEA]">
                  <div className={cn("h-full", drifted ? "bg-warn" : "bg-foreground")} style={{ width: pct(result.accuracy.value) }} />
                </div>
                {drifted && (
                  <div role="status" className="flex flex-col gap-2.5">
                    <p className="flex items-start gap-2 text-[13px] leading-snug text-warn">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      The AI changed some proportions of your mark. An exact trace keeps it identical.
                    </p>
                    {onRerun && (
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => onRerun("trace")} className="h-11 rounded-xl bg-primary text-sm font-semibold text-primary-foreground">Use exact trace</button>
                        <button type="button" onClick={() => onRerun("recreate")} className="h-11 rounded-xl border border-warn-border bg-card text-sm font-medium">Try again</button>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                {result.original ? "This is a new design, so it isn't scored against the original." : "Opened from Recent."}
              </p>
            )}
            <dl className="grid grid-cols-2 gap-2.5">
              <Stat label="ANCHORS" value={stats.anchors.length} />
              <Stat label="SHAPES" value={stats.shapes} extra={stats.holes ? `${stats.holes} holes` : undefined} />
              <Stat label="CURVES" value={stats.curves} />
              <Stat label="STRAIGHT" value={stats.lines} />
            </dl>
          </section>

          {versions.length > 0 && (
            <section className="flex flex-col gap-2.5 rounded-[18px] border border-border bg-card p-[18px]">
              <h2 className="text-sm font-semibold">Versions</h2>
              <ul className="grid grid-cols-3 gap-2">
                {versions.map((v) => (
                  <li key={v.name}>
                    <button
                      type="button"
                      disabled={!v.src}
                      onClick={() => v.src && onPickVersion(v.src)}
                      className="flex w-full flex-col items-center gap-1 rounded-xl border border-border p-1.5 text-[11px] disabled:opacity-60"
                    >
                      <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-[#F7F7F5]">
                        {v.src ? <img src={v.src} alt={`${v.name} version`} className="max-h-full max-w-full object-contain" /> : <span className="px-1 text-center text-muted-foreground">{v.err ? "Failed" : "Working…"}</span>}
                      </span>
                      <span className="font-semibold">{v.name}</span>
                      {typeof v.match === "number" && (
                        <span className={v.match === best ? "font-semibold text-foreground" : "text-muted-foreground"}>
                          {Math.round(v.match * 100)}%{v.match === best ? " · best" : ""}
                        </span>
                      )}
                      {v.err && <span className="line-clamp-2 text-destructive" title={v.err}>{v.err}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="hidden flex-col gap-3.5 rounded-[18px] border border-border bg-card p-[18px] lg:flex">
            <h2 className="text-sm font-semibold">Export</h2>
            <Segmented label="Format" value={format} onChange={setFormat} options={[{ value: "svg", label: "SVG" }, { value: "png", label: "PNG" }]} />
            {format === "png" && (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] text-subtle">Background</span>
                  <Segmented size="sm" label="PNG background" value={pngBack} onChange={setPngBack} options={[{ value: "transparent", label: "Transparent" }, { value: "white", label: "White" }]} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] text-subtle">Size</span>
                  <Segmented size="sm" label="PNG size" value={String(size)} onChange={(v) => setSize(Number(v))} options={SIZES.map((s) => ({ value: String(s), label: String(s) }))} />
                </div>
              </div>
            )}
            <button
              type="button"
              disabled={(format === "png" && (!prepared[size] || preparing)) || saving}
              onClick={() => save(format === "svg" ? "svg" : pngBack === "white" ? "png-white" : "png", prepared[size])}
              className="inline-flex h-[50px] items-center justify-center gap-2.5 rounded-[13px] bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-50"
            >
              <Download className="h-[18px] w-[18px]" aria-hidden="true" />
              {format === "png" && preparing ? "Preparing PNG…" : format === "png" ? "Download PNG" : "Download SVG"}
            </button>
            <p className="text-center text-xs text-muted-foreground">
              {format === "png" ? "Rendered from the vector, so it stays crisp at any size." : "One clean path · opens in Figma, Illustrator and Canva."}
            </p>
            {saveError && <p role="alert" className="text-[13px] text-destructive">{saveError}</p>}
          </section>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-[1fr_auto] gap-2 bg-gradient-to-t from-background via-background to-transparent px-4 pt-6 pb-5 lg:hidden">
        <button type="button" onClick={() => setSheet(true)} className="inline-flex h-[54px] items-center justify-center gap-2.5 rounded-[15px] bg-primary text-base font-semibold text-primary-foreground">
          <Download className="h-[18px] w-[18px]" aria-hidden="true" />
          Save
        </button>
        <button type="button" onClick={onNew} aria-label="New logo" className="inline-flex h-[54px] w-[54px] items-center justify-center rounded-[15px] border border-border bg-card">
          <Plus className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <Drawer open={sheet} onOpenChange={setSheet}>
        <DrawerContent className="bg-card px-4 pb-7">
          <div className="flex flex-col gap-4 pt-3">
            <DrawerTitle className="text-lg font-semibold">Save logo</DrawerTitle>
            <DrawerDescription className="sr-only">Choose a format, then save it to Files or Photos.</DrawerDescription>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-xs font-semibold text-subtle">Format</legend>
              {([
                ["svg", "SVG vector", "Infinitely sharp · for Figma, Canva, print"],
                ["png", "PNG · transparent", `${result.pngs.size} px · for socials and slides`],
                ["png-white", "PNG · white background", `${result.pngs.size} px · for documents and email`],
              ] as const).map(([id, title, note]) => (
                <label key={id} className={cn("flex min-h-16 cursor-pointer items-center gap-3 rounded-[14px] border px-3.5", sheetFormat === id ? "border-foreground ring-1 ring-foreground" : "border-border")}>
                  <input type="radio" name="save-format" checked={sheetFormat === id} onChange={() => setSheetFormat(id)} className="h-5 w-5 accent-foreground" />
                  <span className="flex flex-1 flex-col gap-0.5">
                    <span className="text-[15px] font-semibold">{title}</span>
                    <span className="text-xs text-muted-foreground">{note}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <button type="button" disabled={saving} onClick={() => save(sheetFormat, result.pngs)} className="inline-flex h-[54px] items-center justify-center gap-2.5 rounded-[15px] bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50">
              <Download className="h-[18px] w-[18px]" aria-hidden="true" />
              {saving ? "Opening save options…" : sheetFormat === "svg" ? "Save SVG" : "Save PNG"}
            </button>
            <button type="button" onClick={copy} className="inline-flex h-12 items-center justify-center gap-2.5 rounded-[14px] border border-border bg-card text-[15px] font-medium">
              <Copy className="h-4 w-4" aria-hidden="true" />
              {copied ? "Copied" : "Copy SVG code"}
            </button>
            {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
