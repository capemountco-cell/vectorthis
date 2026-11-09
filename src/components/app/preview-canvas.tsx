import { useId, useMemo, useState } from "react";
import { Copy, Minus, Plus } from "lucide-react";
import { outlineStats, type ViewBox } from "@/lib/outline";
import { BOARD } from "@/lib/board";
import type { LogoResult } from "@/lib/result-model";
import { isOverlay, radialTransform } from "@/lib/color-trace";
import { pathData } from "@/lib/vectorize";
import { cn } from "@/lib/utils";

export type PreviewView = "artwork" | "outlines" | "compare" | "code";
export type CanvasBack = "dots" | "white" | "black";

const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3, 4];
const BACKS: { id: CanvasBack; label: string; swatch: string }[] = [
  { id: "dots", label: "Dotted background", swatch: "#F6F6F4" },
  { id: "white", label: "White background", swatch: "#FFFFFF" },
  { id: "black", label: "Black background", swatch: "#111111" },
];

function backClass(back: CanvasBack) {
  return back === "black" ? "bg-[#111111]" : back === "white" ? "bg-white" : "bg-dots-light";
}

/**
 * The logo itself, drawn from its parsed layers (never from injected markup). Black & white
 * results take `ink` so they stay visible on a black canvas; colour results keep their fills.
 */
function Vector({ result, ink, className, frame }: { result: LogoResult; ink: string; className?: string; frame?: ViewBox | undefined }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const layers = useMemo(() => result.layers.map((l) => ({ d: pathData(l.paths), fill: l.fill })), [result.layers]);
  const v = frame ?? result.view;
  const mono = result.variant === "mono";
  // Black & white draws each outline once (shading overlays repeat their shape's outline).
  const shown = mono ? layers.filter((_, i) => !isOverlay(result.layers[i]!.fill)) : layers;
  return (
    <svg viewBox={`${v.x} ${v.y} ${v.width} ${v.height}`} className={className} role="img" aria-label={`${result.name} vector`}>
      {!mono && (
        <defs>
          {layers.map((l, i) => {
            if (l.fill.type === "solid") return null;
            const stops = l.fill.stops.map((st, k) => <stop key={k} offset={st.offset} stopColor={st.color} stopOpacity={st.opacity ?? 1} />);
            return l.fill.type === "linear" ? (
              <linearGradient key={i} id={`${uid}g${i}`} gradientUnits="userSpaceOnUse" x1={l.fill.x1} y1={l.fill.y1} x2={l.fill.x2} y2={l.fill.y2}>
                {stops}
              </linearGradient>
            ) : (
              <radialGradient
                key={i}
                id={`${uid}g${i}`}
                gradientUnits="userSpaceOnUse"
                cx={l.fill.cx}
                cy={l.fill.cy}
                r={l.fill.r}
                gradientTransform={l.fill.sy !== 1 ? radialTransform(l.fill) : undefined}
              >
                {stops}
              </radialGradient>
            );
          })}
        </defs>
      )}
      {mono
        ? shown.map((l, i) => <path key={i} d={l.d} fill={ink} fillRule="evenodd" />)
        : layers.map((l, i) => <path key={i} d={l.d} fill={l.fill.type === "solid" ? l.fill.color : `url(#${uid}g${i})`} fillRule="evenodd" />)}
    </svg>
  );
}

function Outlines({ result, className }: { result: LogoResult; className?: string }) {
  const d = useMemo(() => pathData(result.paths), [result.paths]);
  const stats = useMemo(() => outlineStats(result.paths), [result.paths]);
  const v = result.view;
  const unit = Math.max(v.width, v.height) / 360; // ~1 screen px at the default size
  return (
    <svg viewBox={`${v.x} ${v.y} ${v.width} ${v.height}`} className={cn("overflow-visible", className)} role="img" aria-label={`Outlines with ${stats.anchors.length} anchor points`}>
      <path d={d} fill="none" stroke="#2F6BFF" strokeWidth={unit * 1.4} strokeLinejoin="round" />
      {stats.handles.map(([a, h], i) => (
        <g key={`h${i}`}>
          <line x1={a.x} y1={a.y} x2={h.x} y2={h.y} stroke="#2F6BFF" strokeWidth={unit * 0.8} />
          <circle cx={h.x} cy={h.y} r={unit * 2} fill="#2F6BFF" />
        </g>
      ))}
      {stats.anchors.map((a, i) => (
        <circle key={`a${i}`} cx={a.x} cy={a.y} r={unit * 3.4} fill="#FFFFFF" stroke="#2F6BFF" strokeWidth={unit * 1.4} />
      ))}
    </svg>
  );
}

export function PreviewCanvas({
  result, view, onView, back, onBack, onCopy, copied, board, boardFill = "white",
}: {
  result: LogoResult;
  view: PreviewView;
  onView: (view: PreviewView) => void;
  back: CanvasBack;
  onBack: (back: CanvasBack) => void;
  onCopy: () => void;
  copied: boolean;
  /** Show the artwork framed on the export board (the default export). */
  board?: ViewBox | null | undefined;
  /** The board's background as it will export: "transparent", "white" or a colour. */
  boardFill?: string | undefined;
}) {
  const [zoom, setZoom] = useState(1);
  const zi = ZOOMS.indexOf(zoom);
  const views: { id: PreviewView; label: string }[] = [
    { id: "artwork", label: "Artwork" },
    { id: "outlines", label: "Outlines" },
    { id: "compare", label: "Compare" },
    { id: "code", label: "Code" },
  ];
  const ink = back === "black" ? "#FFFFFF" : "#111111";
  const art = "h-auto w-[min(360px,70vw)] max-w-full";
  return (
    <div className={cn("relative flex min-h-[340px] flex-1 flex-col overflow-hidden rounded-[18px] border border-border sm:min-h-[600px]", view === "code" ? "bg-card" : backClass(back))}>
      <div className="absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2">
        <div role="tablist" aria-label="View" className="flex gap-0.5 rounded-xl border border-border bg-card p-[3px] shadow-[0_2px_8px_rgba(17,17,17,0.06)]">
          {views.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={view === t.id}
              onClick={() => onView(t.id)}
              className={cn(
                "h-9 rounded-[9px] px-3 text-[13px] font-medium sm:px-3.5",
                view === t.id ? "bg-foreground text-primary-foreground" : "text-subtle hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {(view === "artwork" || view === "outlines") && (
          <div className="flex gap-2">
            <div className="hidden items-center gap-0.5 rounded-xl border border-border bg-card p-[3px] shadow-[0_2px_8px_rgba(17,17,17,0.06)] sm:flex">
              <button type="button" aria-label="Zoom out" disabled={zi <= 0} onClick={() => setZoom(ZOOMS[Math.max(0, zi - 1)]!)} className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[9px] disabled:opacity-30">
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => setZoom(1)} aria-label="Reset zoom" className="min-w-12 text-center font-mono text-xs text-subtle">{Math.round(zoom * 100)}%</button>
              <button type="button" aria-label="Zoom in" disabled={zi >= ZOOMS.length - 1} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zi + 1)]!)} className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[9px] disabled:opacity-30">
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {view === "artwork" && (
              <div role="radiogroup" aria-label="Canvas background" className="hidden items-center sm:flex gap-1 rounded-xl border border-border bg-card px-[5px] py-[3px] shadow-[0_2px_8px_rgba(17,17,17,0.06)]">
                {BACKS.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    role="radio"
                    aria-checked={back === b.id}
                    aria-label={b.label}
                    onClick={() => onBack(b.id)}
                    className="inline-flex h-[34px] w-[30px] items-center justify-center"
                  >
                    <span className={cn("h-6 w-6 rounded-full", back === b.id ? "ring-2 ring-blue" : "border border-[#D4D4D0]")} style={{ background: b.swatch }} />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {(view === "artwork" || view === "outlines") && (
        <div className="flex flex-1 items-center justify-center overflow-auto px-6 pt-20 pb-8">
          <div style={{ transform: `scale(${zoom})`, transformOrigin: "center" }} className="transition-transform duration-150 motion-reduce:transition-none">
            {view === "artwork" && board ? (
              <figure className="m-0 flex flex-col items-center gap-2">
                <div
                  className={cn(
                    "relative w-[min(560px,78vw)] overflow-hidden rounded-[4px] shadow-[0_0_0_1px_rgba(17,17,17,0.12),0_12px_32px_rgba(17,17,17,0.08)]",
                    boardFill === "transparent" ? "checker" : boardFill === "white" ? "bg-white" : "",
                  )}
                  style={{ aspectRatio: `${BOARD.width} / ${BOARD.height}`, ...(boardFill.startsWith("#") ? { background: boardFill } : {}) }}
                >
                  <Vector result={result} ink="#000000" frame={board} className="absolute inset-0 h-full w-full" />
                </div>
                <figcaption className="font-mono text-[11px] text-muted-foreground">
                  {BOARD.width} × {BOARD.height} board{boardFill === "transparent" ? " · transparent" : boardFill.startsWith("#") ? ` · ${boardFill}` : ""}
                </figcaption>
              </figure>
            ) : view === "artwork" ? (
              <Vector result={result} ink={ink} className={art} />
            ) : (
              <Outlines result={result} className={art} />
            )}
          </div>
        </div>
      )}

      {view === "compare" && (
        <div className="grid flex-1 grid-cols-2 gap-3 px-3 pt-20 pb-3">
          <figure className="checker flex flex-col items-center justify-center gap-3 rounded-xl border border-border p-4">
            {result.original ? (
              <img src={result.original} alt="Your original" className="h-auto max-h-[360px] w-full object-contain [image-rendering:pixelated]" />
            ) : (
              <span className="text-center text-[13px] text-muted-foreground">The original isn't kept for items opened from Recent.</span>
            )}
            <figcaption className="font-mono text-[11px] text-muted-foreground">ORIGINAL</figcaption>
          </figure>
          <figure className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-white p-4">
            <Vector result={result} ink="#111111" className="h-auto max-h-[360px] w-full" />
            <figcaption className="font-mono text-[11px] text-muted-foreground">VECTOR</figcaption>
          </figure>
        </div>
      )}

      {view === "code" && (
        <div className="relative flex flex-1 flex-col px-3 pt-[68px] pb-3">
          <button type="button" onClick={onCopy} className="absolute top-[72px] right-6 z-10 inline-flex h-9 items-center gap-2 rounded-lg bg-white/10 px-3 text-xs font-medium text-white hover:bg-white/20">
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            {copied ? "Copied" : "Copy"}
          </button>
          <pre className="max-h-[70vh] flex-1 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-foreground p-5 pr-24 font-mono text-[12.5px] leading-relaxed text-[#E8E8E4]">{board ? result.board.svg : result.svg}</pre>
        </div>
      )}
    </div>
  );
}
