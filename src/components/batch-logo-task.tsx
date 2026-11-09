import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, RotateCcw, X } from "lucide-react";
import { executeLogoTask, type TaskMode, type TaskOptions } from "@/lib/logo-task";
import { flattenLogo, logoFile, saveLogoSvg } from "@/lib/logo-files";
import { streamImage } from "@/lib/stream-image";
import { toOutputs } from "@/lib/logo-convert";
import { prepareReference, shapeMatch } from "@/lib/reference-prep";
import { savePng } from "@/lib/save-png";
import { baseName } from "@/components/app/modes";

export type BatchJob = { id: string; file: File; options: TaskOptions | null };
export type BatchFiles = { svgFile: File; pngFile: File; whiteFile: File };
type Output = BatchFiles & { png: string; match: number | null; accuracy: number };

export function BatchLogoTask({
  job, background, onRemove, onReady, onSwitchMode,
}: {
  job: BatchJob;
  background: "transparent" | "white";
  onRemove: () => void;
  /** Reports finished files (or null when they go away) so the list can save them all at once. */
  onReady: (files: BatchFiles | null) => void;
  /** Re-run this logo in another mode as a new task. */
  onSwitchMode: (mode: TaskMode) => void;
}) {
  const [preview, setPreview] = useState("");
  const [frame, setFrame] = useState("");
  const [output, setOutput] = useState<Output | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Waiting");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const report = useRef(onReady);
  report.current = onReady;
  useEffect(() => {
    const url = URL.createObjectURL(job.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [job.file]);
  useEffect(() => {
    if (!job.options) return;
    const abort = new AbortController();
    controller.current = abort;
    setStatus("Working"); setError(""); setOutput(null); setFrame(""); setProgress(2);
    report.current(null);
    const start = Date.now();
    const pace = job.options.mode === "trace" ? 600 : 25000;
    const timer = setInterval(() => setProgress((p) => Math.max(p, Math.min(90, 90 * (1 - Math.exp(-(Date.now() - start) / pace))))), 200);
    void executeLogoTask(job.file, job.options, abort.signal, (src, final) => {
      setFrame(src); setProgress((p) => Math.max(p, final ? 92 : 60));
      if (final) setStatus("Preparing files");
    }, {
      // The original goes as a clean traced rendering when possible; the shape reference is just flattened.
      flatten: async (f) => (f === job.file ? (await prepareReference(f)).file : flattenLogo(f)),
      describe: async (f) => {
        const ref = await prepareReference(f);
        return { geometry: ref.geometry, traced: ref.traced };
      },
      stream: (form, frameCallback, signal) => streamImage("/api/edit-image", form, frameCallback, signal),
      prepare: async (src) => {
        const converted = await toOutputs(src);
        const match = job.options?.mode === "recreate" ? shapeMatch(await prepareReference(job.file), converted.signature) : null;
        const name = baseName(job.file.name);
        return {
          // Batch saves the default export: the logo centred on the 1300 × 1200 board.
          png: converted.board.png,
          match,
          accuracy: converted.accuracy,
          pngFile: logoFile(converted.board.png, `${name}.png`, "image/png"),
          whiteFile: logoFile(converted.board.whitePng, `${name}-white.png`, "image/png"),
          svgFile: logoFile(converted.board.svg, `${name}.svg`, "image/svg+xml"),
        };
      },
    }).then((result) => {
      if (abort.signal.aborted) return;
      setOutput(result); setProgress(100); setStatus("Ready");
      report.current({ svgFile: result.svgFile, pngFile: result.pngFile, whiteFile: result.whiteFile });
    }).catch((e: unknown) => {
      if (abort.signal.aborted) return;
      setStatus("Failed"); setError(e instanceof Error ? e.message : "Could not create this logo.");
    }).finally(() => clearInterval(timer));
    return () => { abort.abort(); clearInterval(timer); };
  }, [job.file, job.options, attempt]);

  const running = status === "Working" || status === "Preparing files";
  const drifted = output?.match != null && output.match < 0.95;
  const label = job.options ? (job.options.mode === "trace" ? "Exact trace" : job.options.provider) : "Pending";
  return (
    <li aria-label={`Task ${job.file.name} ${job.options?.provider ?? "pending"}`} className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card ${drifted ? "border-warn-border" : "border-border"}`}>
      <div className={`relative flex aspect-[4/3] items-center justify-center p-4 ${background === "white" ? "bg-white" : "bg-dots-light"}`}>
        {output ? (
          <img src={output.png} alt={`Vector of ${job.file.name}`} className="h-full w-full object-contain" />
        ) : (
          (frame || preview) && <img src={frame || preview} alt={job.file.name} className={`h-full w-full object-contain ${running ? "opacity-70 blur-[6px]" : ""}`} />
        )}
        {running && (
          <span className="absolute rounded-[10px] border border-border bg-card px-3 py-2 text-[13px] text-subtle shadow-[0_6px_18px_rgba(17,17,17,0.08)]">
            {job.options?.mode === "trace" ? "Tracing…" : "Redrawing…"}
          </span>
        )}
        <button
          type="button"
          title={running ? "Cancel task" : "Remove task"}
          aria-label={running ? "Cancel task" : "Remove task"}
          onClick={() => { controller.current?.abort(); report.current(null); onRemove(); }}
          className="absolute top-2 right-2 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold" title={job.file.name}>{job.file.name}</p>
          <span role="status" className="shrink-0 text-xs">
            {running ? (
              <span className="font-mono text-subtle">{Math.round(progress)}%</span>
            ) : drifted ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-warn"><AlertCircle className="h-3 w-3" aria-hidden="true" />{Math.round(output!.match! * 100)}% match</span>
            ) : status === "Ready" ? (
              <span className="inline-flex items-center gap-1.5"><Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />Ready{output?.match != null ? ` · ${Math.round(output.match * 100)}% match` : ""}</span>
            ) : (
              <span className={status === "Failed" ? "font-medium text-destructive" : "text-muted-foreground"}>{status}</span>
            )}
          </span>
        </div>
        <p className="-mt-1.5 font-mono text-[10px] uppercase text-muted-foreground">{label}</p>
        {running && (
          <div role="progressbar" aria-label={`${job.file.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} className="h-1 overflow-hidden rounded-full bg-[#EDEDEA]">
            <div className="h-full bg-foreground transition-[width] motion-reduce:transition-none" style={{ width: `${progress}%` }} />
          </div>
        )}
        {status === "Failed" && (
          <button type="button" onClick={() => setAttempt((a) => a + 1)} className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] border border-border text-[13px] font-medium">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Retry
          </button>
        )}
        {output && drifted && (
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={() => onSwitchMode("trace")} className="h-10 rounded-[10px] bg-primary text-[13px] font-semibold text-primary-foreground">Exact trace</button>
            <button type="button" onClick={() => setAttempt((a) => a + 1)} className="h-10 rounded-[10px] border border-border text-[13px] font-medium">Redraw</button>
          </div>
        )}
        {output && !drifted && (
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" aria-label={`Save SVG ${job.file.name}`} onClick={() => { void saveLogoSvg(output.svgFile).catch((e: unknown) => setError(e instanceof Error ? e.message : "Saving failed.")); }} className="h-10 rounded-[10px] bg-primary text-[13px] font-semibold text-primary-foreground">SVG</button>
            <button
              type="button"
              disabled={saving}
              aria-label={`Save PNG ${job.file.name}`}
              onClick={() => {
                const promise = savePng(background === "white" ? output.whiteFile : output.pngFile);
                setSaving(true); setError("");
                promise.catch((e: unknown) => setError(e instanceof Error ? e.message : "Saving failed.")).finally(() => setSaving(false));
              }}
              className="h-10 rounded-[10px] border border-border text-[13px] font-medium"
            >
              PNG
            </button>
          </div>
        )}
        {error && <p role="alert" className="break-words text-[11px] text-destructive">{error}</p>}
      </div>
    </li>
  );
}
