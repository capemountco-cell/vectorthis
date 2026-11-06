import { ArrowRight, ImagePlus, Plus, Upload } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useImageDrop } from "@/hooks/use-image-drop";
import type { RecentItem } from "@/lib/recent";
import type { TaskMode } from "@/lib/logo-task";
import { cn } from "@/lib/utils";
import { MODES, modeInfo } from "./modes";

type Props = {
  mode: TaskMode;
  onMode: (mode: TaskMode) => void;
  file: File | null;
  preview: string | null;
  onFile: (file: File) => void;
  text: string;
  onText: (text: string) => void;
  shape: File | null;
  shapePreview: string | null;
  onShape: (file: File) => void;
  more: boolean;
  onMore: (more: boolean) => void;
  canRun: boolean;
  onRun: () => void;
  error: string | null;
  recent: RecentItem[];
  onOpenRecent: (item: RecentItem) => void;
};

export function StartScreen(p: Props) {
  const info = modeInfo(p.mode);
  const logoDrop = useImageDrop((files) => { const f = files[0]; if (f) p.onFile(f); });
  const shapeDrop = useImageDrop((files) => { const f = files[0]; if (f) p.onShape(f); });
  return (
    <main className="flex flex-1 flex-col items-center gap-8 px-4 pt-6 pb-28 sm:gap-10 sm:px-5 sm:pt-12 sm:pb-16">
      <h1 className="max-w-[760px] text-balance text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-[#8A8A86] sm:text-center sm:text-[52px] sm:leading-[1.08] sm:tracking-[-0.035em]">
        Drop a logo. Get a <span className="text-foreground">clean, exact vector.</span>
      </h1>

      <section
        aria-label="Upload your logo"
        className="flex w-full max-w-[760px] flex-col gap-3.5 rounded-[22px] border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(17,17,17,0.04),0_18px_48px_rgba(17,17,17,0.07)]"
      >
        <label
          {...logoDrop.handlers}
          aria-label="Logo upload area"
          className={cn(
            "relative flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-3 rounded-[14px] border-[1.5px] border-dashed bg-[#FAFAF8] p-6 text-center transition-colors sm:min-h-[240px]",
            logoDrop.dragging ? "border-blue bg-[#F4F7FF]" : "border-[#D4D4D0] hover:border-[#BDBDB8]",
          )}
        >
          <input
            type="file"
            accept="image/*"
            aria-label="Upload original logo"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) p.onFile(f);
              e.target.value = "";
            }}
          />
          {p.preview && p.file ? (
            <>
              <img src={p.preview} alt="Your logo" className="max-h-36 max-w-[70%] object-contain" />
              <span className="text-sm font-medium">{p.file.name}</span>
              <span className="text-[13px] text-muted-foreground">Tap to choose a different file</span>
            </>
          ) : (
            <>
              <span className="inline-flex h-[52px] w-[52px] items-center justify-center rounded-[14px] border border-border bg-card shadow-[0_2px_6px_rgba(17,17,17,0.06)]">
                <Upload className="h-[22px] w-[22px]" aria-hidden="true" />
              </span>
              <span className="text-base font-semibold">
                <span className="sm:hidden">Choose a logo</span>
                <span className="hidden sm:inline">Drop your logo here, or <span className="underline underline-offset-[3px]">browse</span></span>
              </span>
              <span className="text-[13px] text-muted-foreground">
                <span className="sm:hidden">Photos, Files or camera</span>
                <span className="hidden sm:inline">PNG, JPG, WebP or SVG · paste with ⌘V</span>
              </span>
            </>
          )}
        </label>

        <div role="radiogroup" aria-label="What should we do?" className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-1.5 sm:rounded-xl sm:bg-muted sm:p-1">
          {MODES.map((m) => {
            const on = m.id === p.mode;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => p.onMode(m.id)}
                className={cn(
                  "flex min-h-[72px] flex-col items-start justify-center gap-1 rounded-[14px] border bg-card px-3 text-left transition-colors sm:min-h-0 sm:h-10 sm:items-center sm:rounded-[9px] sm:px-2",
                  on
                    ? "border-foreground ring-1 ring-foreground sm:border-border sm:ring-0 sm:shadow-[0_1px_3px_rgba(17,17,17,0.08)]"
                    : "border-border sm:border-transparent sm:bg-transparent sm:text-subtle sm:hover:text-foreground",
                )}
              >
                <span className="text-sm font-semibold sm:font-medium">{m.label}</span>
                <span className="text-xs leading-snug text-muted-foreground sm:hidden">{m.short}</span>
              </button>
            );
          })}
        </div>

        {p.mode === "replace" && (
          <label className="flex flex-col gap-1.5 px-1">
            <span className="text-xs font-semibold text-subtle">New text</span>
            <input
              value={p.text}
              onChange={(e) => p.onText(e.target.value)}
              aria-label="New text"
              placeholder="e.g. Purely Lagom"
              className="h-12 rounded-xl border border-border bg-[#FAFAF8] px-3.5 text-base outline-none focus:border-foreground"
            />
          </label>
        )}

        {p.mode === "blend" && (
          <div className="flex flex-wrap gap-2.5 px-1">
            <label
              {...shapeDrop.handlers}
              aria-label="Shape upload area"
              className={cn(
                "inline-flex h-12 cursor-pointer items-center gap-2.5 rounded-xl border-[1.5px] border-dashed px-3.5 text-sm font-medium",
                shapeDrop.dragging ? "border-blue" : "border-[#D4D4D0]",
              )}
            >
              <input
                type="file"
                accept="image/*"
                aria-label="Upload shape reference"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) p.onShape(f);
                  e.target.value = "";
                }}
              />
              {p.shapePreview ? (
                <img src={p.shapePreview} alt="Shape reference" className="h-8 w-8 rounded object-cover" />
              ) : (
                <Plus className="h-4 w-4" aria-hidden="true" />
              )}
              {p.shape ? "Change shape" : "Shape reference"}
            </label>
            <label className="flex min-w-[220px] flex-1">
              <span className="sr-only">Direction (optional)</span>
              <input
                value={p.text}
                onChange={(e) => p.onText(e.target.value)}
                placeholder="Direction (optional), e.g. make each half a note"
                className="h-12 flex-1 rounded-xl border border-border bg-[#FAFAF8] px-3.5 text-base outline-none focus:border-foreground"
              />
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <p className="hidden min-w-[200px] flex-1 text-[13px] text-muted-foreground sm:block">{info.hint}</p>
          {info.ai && (
            <label className="flex items-center gap-2 text-[13px] font-medium text-subtle">
              <Switch checked={p.more} onCheckedChange={p.onMore} aria-label="Compare 3 AI versions" />
              Compare 3 AI versions
            </label>
          )}
          <div className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-background via-background/95 to-transparent px-4 pt-6 pb-5 sm:static sm:bg-none sm:p-0">
            <button
              type="button"
              onClick={p.onRun}
              disabled={!p.canRun}
              className="inline-flex h-[54px] w-full items-center justify-center gap-2 rounded-[15px] bg-primary px-6 text-base font-semibold text-primary-foreground transition-opacity disabled:opacity-40 sm:h-[46px] sm:w-auto sm:rounded-xl sm:text-[15px]"
            >
              Vectorize
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        {p.error && <p role="alert" className="px-1 text-sm text-destructive">{p.error}</p>}
      </section>

      {p.recent.length > 0 && (
        <section aria-labelledby="recent-h" className="flex w-full max-w-[760px] flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 id="recent-h" className="text-[13px] font-semibold text-subtle">Recent</h2>
            <span className="text-xs text-muted-foreground">Saved on this device</span>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {p.recent.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => p.onOpenRecent(r)} className="flex w-full flex-col gap-2 text-left">
                  <span className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-[14px] border border-border bg-card p-4">
                    <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.svg)}`} alt="" className="max-h-full max-w-full object-contain" />
                  </span>
                  <span className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="truncate font-medium">{r.name}</span>
                    <span className="shrink-0 font-mono text-[11px] uppercase text-muted-foreground">{modeInfo(r.mode as TaskMode).label}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.recent.length === 0 && (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
          Your logos stay on this device. Exact trace never uploads them.
        </p>
      )}
    </main>
  );
}
