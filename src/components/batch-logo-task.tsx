import { useEffect, useRef, useState } from "react";
import { Download, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { executeLogoTask, type TaskOptions } from "@/lib/logo-task";
import { flattenLogo, logoFile, saveLogoSvg } from "@/lib/logo-files";
import { streamImage } from "@/lib/stream-image";
import { toOutputs } from "@/lib/logo-convert";
import { savePng } from "@/lib/save-png";

export type BatchJob = { id: string; file: File; options: TaskOptions | null };
type Output = Awaited<ReturnType<typeof toOutputs>> & { pngFile: File; whiteFile: File; svgFile: File };

export function BatchLogoTask({ job, background, onRemove }: { job: BatchJob; background: string; onRemove: () => void }) {
  const [preview, setPreview] = useState("");
  const [frame, setFrame] = useState("");
  const [output, setOutput] = useState<Output | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Waiting");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const controller = useRef<AbortController | null>(null);
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
    const start = Date.now();
    const timer = setInterval(() => setProgress((p) => Math.max(p, Math.min(90, 90 * (1 - Math.exp(-(Date.now() - start) / 25000))))), 300);
    void executeLogoTask(job.file, job.options, abort.signal, (src, final) => {
      setFrame(src); setProgress((p) => Math.max(p, final ? 92 : 60));
      if (final) setStatus("Preparing files");
    }, {
      flatten: flattenLogo,
      stream: (form, frameCallback, signal) => streamImage("/api/edit-image", form, frameCallback, signal),
      prepare: async (src) => {
        const converted = await toOutputs(src);
        const name = job.file.name.replace(/\.[^.]+$/, "") || "logo";
        return { ...converted, pngFile: logoFile(converted.png, `${name}.png`, "image/png"), whiteFile: logoFile(converted.whitePng, `${name}-white.png`, "image/png"), svgFile: logoFile(converted.svg, `${name}.svg`, "image/svg+xml") };
      },
    }).then((result) => {
      if (abort.signal.aborted) return;
      setOutput(result); setProgress(100); setStatus("Ready");
    }).catch((e: unknown) => {
      if (abort.signal.aborted) return;
      setStatus("Failed"); setError(e instanceof Error ? e.message : "Could not create this logo.");
    }).finally(() => clearInterval(timer));
    return () => { abort.abort(); clearInterval(timer); };
  }, [job.file, job.options, attempt]);
  const shown = output ? (background === "white" ? output.whitePng : output.png) : frame || preview;
  const running = status === "Working" || status === "Preparing files";
  return (
    <article aria-label={`Task ${job.file.name} ${job.options?.provider ?? "pending"}`} className="min-w-0 overflow-hidden rounded-lg border border-border">
      <div className={`${background === "white" ? "bg-background" : "checker"} relative flex aspect-square items-center justify-center p-3`}>
        {shown && <img src={shown} alt={output ? `Recreated ${job.file.name}` : job.file.name} className="h-full w-full object-contain" />}
        <Button size="icon" variant="secondary" title={running ? "Cancel task" : "Remove task"} aria-label={running ? "Cancel task" : "Remove task"} onClick={() => { controller.current?.abort(); onRemove(); }} className="absolute right-1 top-1 h-7 w-7"><X className="h-4 w-4" /></Button>
      </div>
      <div className="flex flex-col gap-2 p-2">
        <p className="truncate text-xs font-medium" title={job.file.name}>{job.file.name}</p>
        <div className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground"><span className="capitalize">{job.options ? (job.options.mode === "trace" ? "Exact trace" : job.options.provider) : "Pending"}</span><span role="status">{running ? `${Math.round(progress)}%` : status}</span></div>
        <div role="progressbar" aria-label={`${job.file.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${progress}%` }} /></div>
        {status === "Failed" && <Button variant="outline" size="sm" onClick={() => setAttempt((a) => a + 1)}><RotateCcw className="h-3 w-3" />Retry</Button>}
        {output && <div className="grid grid-cols-2 gap-1">
          <Button size="sm" disabled={saving} aria-label={`Save PNG ${job.file.name}`} onClick={() => {
            const promise = savePng(background === "white" ? output.whiteFile : output.pngFile);
            setSaving(true); setError("");
            promise.catch((e: unknown) => setError(e instanceof Error ? e.message : "Saving failed.")).finally(() => setSaving(false));
          }}><Download className="h-3 w-3" />PNG</Button>
          <Button size="sm" variant="outline" aria-label={`Save SVG ${job.file.name}`} onClick={() => { void saveLogoSvg(output.svgFile).catch((e: unknown) => setError(e instanceof Error ? e.message : "Saving failed.")); }}>SVG</Button>
        </div>}
        {error && <p role="alert" className="break-words text-[10px] text-destructive">{error}</p>}
      </div>
    </article>
  );
}