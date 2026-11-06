import { useState } from "react";
import { ImagePlus, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BatchLogoTask, type BatchJob } from "@/components/batch-logo-task";
import type { TaskMode, TaskOptions } from "@/lib/logo-task";
import { useImageDrop } from "@/hooks/use-image-drop";

export function BatchLogos({ mode }: { mode: TaskMode }) {
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [text, setText] = useState("");
  const [shape, setShape] = useState<File | null>(null);
  const [more, setMore] = useState(false);
  const [background, setBackground] = useState("transparent");
  const valid = mode === "recreate" || mode === "trace" || (mode === "replace" ? Boolean(text.trim()) : Boolean(shape));
  const pending = jobs.filter((j) => !j.options);
  function createJobs(file: File, start: boolean): BatchJob[] {
    const providers: TaskOptions["provider"][] = more && mode !== "trace" ? ["openai", "gemini", "grok"] : ["openai"];
    return (start ? providers : ["openai"] as const).map((provider) => ({ id: crypto.randomUUID(), file, options: start ? { mode, text, shape, provider } : null }));
  }
  function uploadLogos(files: File[]) {
    setJobs((current) => [...current, ...files.flatMap((file) => createJobs(file, valid))]);
  }
  const logoDrop = useImageDrop(uploadLogos);
  const shapeDrop = useImageDrop((files) => setShape(files[0] ?? null));
  return <>
    <label {...logoDrop.handlers} aria-label="Batch upload area" className={`${logoDrop.dragging ? "ring-2 ring-primary" : ""} flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30`}>
      <ImagePlus className="h-7 w-7 text-muted-foreground" />
      <span className="text-sm font-medium">Add logos</span>
      <input type="file" multiple accept="image/*" aria-label="Upload multiple logos" className="hidden" onChange={(e) => {
        const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
        uploadLogos(files);
        e.target.value = "";
      }} />
    </label>
    {(jobs.length > 0) && <>
      {mode !== "trace" && <label className="flex items-center justify-between gap-3 text-xs font-bold"><span>Get 3 versions</span><Switch checked={more} onCheckedChange={setMore} aria-label="Get 3 batch versions" /></label>}
      <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">PNG background</span><ToggleGroup type="single" value={background} onValueChange={(v) => v && setBackground(v)} aria-label="Batch PNG background" className="flex-1"><ToggleGroupItem value="transparent" className="flex-1 text-xs">Transparent</ToggleGroupItem><ToggleGroupItem value="white" className="flex-1 text-xs">White</ToggleGroupItem></ToggleGroup></div>
      {(mode === "replace" || mode === "blend") && <input aria-label="Batch text" placeholder={mode === "blend" ? "Direction (optional)" : "New text"} value={text} onChange={(e) => setText(e.target.value)} className="h-11 min-w-0 rounded-lg border border-input bg-background px-3" />}
      {mode === "blend" && <label {...shapeDrop.handlers} aria-label="Batch shape upload area" className={`${shapeDrop.dragging ? "ring-2 ring-primary" : ""} flex items-center gap-2 rounded text-xs`}><ImagePlus className="h-4 w-4" /><span className="min-w-0 truncate">{shape?.name ?? "Shape reference"}</span><input type="file" accept="image/*" aria-label="Batch shape reference" className="min-w-0 flex-1" onChange={(e) => setShape(e.target.files?.[0] ?? null)} /></label>}
      {pending.length > 0 && <Button disabled={!valid} onClick={() => setJobs((current) => current.flatMap((job) => job.options ? [job] : createJobs(job.file, true)))}><Play className="h-4 w-4" />Start {pending.length} logos</Button>}
    </>}
    {jobs.length > 0 && <div className="grid grid-cols-2 items-start gap-2 sm:grid-cols-3 lg:grid-cols-4">{jobs.map((job) => <BatchLogoTask key={job.id} job={job} background={background} onRemove={() => setJobs((current) => current.filter((j) => j.id !== job.id))} />)}</div>}
  </>;
}