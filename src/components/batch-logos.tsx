import { useCallback, useState } from "react";
import { Download, Play, Plus, Upload } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { BatchLogoTask, type BatchFiles, type BatchJob } from "@/components/batch-logo-task";
import { MODES } from "@/components/app/modes";
import { Segmented } from "@/components/app/segmented";
import { downloadFile, isMobileSaveDevice } from "@/lib/save-png";
import type { TaskMode, TaskOptions } from "@/lib/logo-task";
import { useImageDrop } from "@/hooks/use-image-drop";
import { cn } from "@/lib/utils";

export function BatchLogos({ mode, onMode }: { mode: TaskMode; onMode: (mode: TaskMode) => void }) {
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [text, setText] = useState("");
  const [shape, setShape] = useState<File | null>(null);
  const [more, setMore] = useState(false);
  const [background, setBackground] = useState<"transparent" | "white">("transparent");
  const [ready, setReady] = useState<Record<string, BatchFiles>>({});
  const [saveError, setSaveError] = useState("");
  const valid = mode === "recreate" || mode === "trace" || (mode === "replace" ? Boolean(text.trim()) : Boolean(shape));
  const pending = jobs.filter((j) => !j.options);
  const ai = mode !== "trace";

  function createJobs(file: File, start: boolean, m: TaskMode = mode): BatchJob[] {
    const providers: TaskOptions["provider"][] = more && m !== "trace" ? ["openai", "gemini", "grok"] : ["openai"];
    return (start ? providers : (["openai"] as const)).map((provider) => ({ id: crypto.randomUUID(), file, options: start ? { mode: m, text, shape, provider } : null }));
  }
  function uploadLogos(files: File[]) {
    setJobs((current) => [...current, ...files.flatMap((file) => createJobs(file, valid))]);
  }
  const markReady = useCallback((id: string, files: BatchFiles | null) => {
    setReady((r) => {
      if (!files) { const { [id]: _gone, ...rest } = r; return rest; }
      return { ...r, [id]: files };
    });
  }, []);
  const logoDrop = useImageDrop(uploadLogos);
  const shapeDrop = useImageDrop((files) => setShape(files[0] ?? null));
  const readyFiles = Object.values(ready);

  // Started straight from the tap so mobile sharing is allowed.
  function saveAll() {
    setSaveError("");
    const files = readyFiles.map((f) => f.svgFile);
    if (!files.length) return;
    if (isMobileSaveDevice() && typeof navigator.share === "function" && navigator.canShare?.({ files })) {
      navigator.share({ files }).catch((e: unknown) => {
        if (!(e instanceof Error && e.name === "AbortError")) setSaveError("The share sheet could not open. Save each logo from its card instead.");
      });
      return;
    }
    files.forEach((f, i) => setTimeout(() => downloadFile(f), i * 250));
  }

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 pb-10 sm:px-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.01em]">Batch</h1>
          <p className="font-mono text-[11px] text-muted-foreground">
            {jobs.length} logo{jobs.length === 1 ? "" : "s"} · {readyFiles.length} ready
          </p>
        </div>
        {readyFiles.length > 0 && (
          <button type="button" onClick={saveAll} className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">
            <Download className="h-4 w-4" aria-hidden="true" />
            Download {readyFiles.length} ready
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-[18px] border border-border bg-card p-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented label="Mode for new logos" value={mode} onChange={onMode} options={MODES.map((m) => ({ value: m.id, label: m.label }))} className="min-w-0 flex-[1_1_420px] sm:max-w-[560px]" />
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[13px] text-subtle">PNG</span>
            <Segmented size="sm" label="Batch PNG background" value={background} onChange={setBackground} options={[{ value: "transparent", label: "Transparent" }, { value: "white", label: "White" }]} />
          </div>
        </div>
        {ai && (
          <div className="flex flex-wrap items-center gap-3">
            {(mode === "replace" || mode === "blend") && (
              <label className="flex min-w-[220px] flex-1">
                <span className="sr-only">{mode === "blend" ? "Direction (optional)" : "New text"}</span>
                <input aria-label="Batch text" placeholder={mode === "blend" ? "Direction (optional)" : "New text"} value={text} onChange={(e) => setText(e.target.value)} className="h-11 flex-1 rounded-xl border border-border bg-[#FAFAF8] px-3.5 text-base outline-none focus:border-foreground" />
              </label>
            )}
            {mode === "blend" && (
              <label {...shapeDrop.handlers} aria-label="Batch shape upload area" className={cn("inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border-[1.5px] border-dashed px-3.5 text-sm font-medium", shapeDrop.dragging ? "border-blue" : "border-[#D4D4D0]")}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span className="max-w-40 truncate">{shape?.name ?? "Shape reference"}</span>
                <input type="file" accept="image/*" aria-label="Batch shape reference" className="sr-only" onChange={(e) => setShape(e.target.files?.[0] ?? null)} />
              </label>
            )}
            <label className="flex items-center gap-2 text-[13px] font-medium text-subtle">
              <Switch checked={more} onCheckedChange={setMore} aria-label="Get 3 batch versions" />
              Compare 3 AI versions
            </label>
          </div>
        )}
      </div>

      <label
        {...logoDrop.handlers}
        aria-label="Batch upload area"
        className={cn(
          "flex min-h-[88px] cursor-pointer items-center justify-center gap-3 rounded-2xl border-[1.5px] border-dashed bg-card px-4 text-center text-sm text-subtle",
          logoDrop.dragging ? "border-blue bg-[#F4F7FF]" : "border-[#D4D4D0]",
        )}
      >
        <Upload className="h-[18px] w-[18px] text-foreground" aria-hidden="true" />
        <span><span className="font-semibold text-foreground">Add logos</span> — drop files or browse. Each one runs on its own.</span>
        <input type="file" multiple accept="image/*" aria-label="Upload multiple logos" className="sr-only" onChange={(e) => {
          const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
          uploadLogos(files);
          e.target.value = "";
        }} />
      </label>

      {pending.length > 0 && (
        <button type="button" disabled={!valid} onClick={() => setJobs((current) => current.flatMap((job) => (job.options ? [job] : createJobs(job.file, true))))} className="inline-flex h-11 items-center justify-center gap-2 self-start rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40">
          <Play className="h-4 w-4" aria-hidden="true" />
          Start {pending.length} logo{pending.length === 1 ? "" : "s"}
        </button>
      )}
      {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}

      {jobs.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] items-start gap-3.5">
          {jobs.map((job) => (
            <BatchLogoTask
              key={job.id}
              job={job}
              background={background}
              onRemove={() => setJobs((current) => current.filter((j) => j.id !== job.id))}
              onReady={(files) => markReady(job.id, files)}
              onSwitchMode={(m) => setJobs((current) => current.flatMap((j) => (j.id === job.id ? createJobs(j.file, true, m) : [j])))}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
