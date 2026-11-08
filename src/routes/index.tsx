import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { BatchLogos } from "@/components/batch-logos";
import { BrandMark } from "@/components/app/brand";
import { baseName, modeInfo } from "@/components/app/modes";
import { ProcessingScreen } from "@/components/app/processing-screen";
import { ResultWorkspace, type Version } from "@/components/app/result-workspace";
import { StartScreen } from "@/components/app/start-screen";
import { PageDropOverlay } from "@/components/app/page-drop-overlay";
import { useWindowImageDrop } from "@/hooks/use-image-drop";
import { toColorOutputs, toOutputs } from "@/lib/logo-convert";
import { flattenLogo, logoFile } from "@/lib/logo-files";
import { DEFAULT_TASK_MODE, readAsDataUrl, type TaskMode } from "@/lib/logo-task";
import { addRecent, clearRecent, loadRecent, removeRecent, type RecentItem } from "@/lib/recent";
import { prepareReference, shapeMatch, type PreparedReference } from "@/lib/reference-prep";
import { buildResult, resultFromRecent, type LogoResult } from "@/lib/result-model";
import { streamImage } from "@/lib/stream-image";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vectorthis — Clean, exact vectors from any logo" },
      { name: "description", content: "Drop a logo and get a clean, exact SVG and transparent PNG. Trace it pixel-exact, recreate it with AI, or change its text." },
      { property: "og:title", content: "Vectorthis — Clean, exact vectors from any logo" },
      { property: "og:description", content: "Drop a logo and get a clean, exact SVG and transparent PNG." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  const [mode, setMode] = useState<TaskMode>(DEFAULT_TASK_MODE);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dims, setDims] = useState("");
  const [shape, setShape] = useState<File | null>(null);
  const [shapePreview, setShapePreview] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [more, setMore] = useState(false);
  const [batch, setBatch] = useState(false);

  const [busy, setBusy] = useState(false);
  const [busyMode, setBusyMode] = useState<TaskMode>(DEFAULT_TASK_MODE);
  const [progress, setProgress] = useState(0);
  const [frame, setFrame] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LogoResult | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [reference, setReference] = useState<PreparedReference | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const controller = useRef<AbortController | null>(null);
  // Exact-trace source and both of its versions, so switching colour is instant after the first time.
  const traced = useRef<{ src: string; mono: LogoResult; color?: LogoResult } | null>(null);
  const [colorBusy, setColorBusy] = useState(false);

  // Drop an image anywhere on the start screen to upload it.
  const pageDragging = useWindowImageDrop((files) => {
    const f = files[0];
    if (f) chooseFile(f);
  }, busy || Boolean(result) || batch);

  useEffect(() => setRecent(loadRecent()), []);

  function chooseFile(f: File) {
    if (preview) URL.revokeObjectURL(preview);
    const url = URL.createObjectURL(f);
    setFile(f);
    setPreview(url);
    setError(null);
    setDims("");
    void createImageBitmap(f).then((b) => { setDims(`${b.width} × ${b.height}`); b.close(); }).catch(() => {});
    if (mode === "trace" || mode === "recreate") void run({ source: f, m: mode, original: url });
  }

  function chooseShape(f: File) {
    if (shapePreview) URL.revokeObjectURL(shapePreview);
    setShape(f);
    setShapePreview(URL.createObjectURL(f));
  }

  // Paste an image anywhere on the start screen (⌘V / Ctrl+V).
  useEffect(() => {
    if (busy || result || batch) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (item) { e.preventDefault(); chooseFile(item); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  async function finish(src: string, m: TaskMode, ref: PreparedReference | null, name: string, original: string | null) {
    const o = await toOutputs(src);
    const match = m === "recreate" ? shapeMatch(ref, o.signature) : null;
    const accuracy = m === "trace" ? { kind: "pixel" as const, value: o.accuracy } : match !== null ? { kind: "shape" as const, value: match } : null;
    const detail = m === "trace" ? `${o.source.width} × ${o.source.height}${o.source.transparent ? " · transparent" : ""}` : modeInfo(m).ai ? "AI redraw" : "";
    const next = buildResult(o, { name, mode: m, accuracy, original, detail });
    traced.current = m === "trace" ? { src, mono: next } : null;
    setResult(next);
    setRecent(addRecent({ name, mode: m, svg: o.svg }));
    return match;
  }

  async function run({ source = file, m = mode, correction, original = preview }: { source?: File | null; m?: TaskMode; correction?: string; original?: string | null } = {}) {
    if (!source) return;
    if (m === "replace" && !text.trim()) { setError("Type the new text first."); return; }
    if (m === "blend" && !shape) { setError("Add a shape reference first."); return; }
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const name = baseName(source.name);
    setBusy(true);
    setBusyMode(m);
    setError(null);
    setFrame(original);
    setProgress(2);
    if (!correction) setVersions([]);
    const start = Date.now();
    const pace = m === "trace" ? 400 : 25000;
    const timer = setInterval(() => setProgress((p) => Math.max(p, Math.min(90, 90 * (1 - Math.exp(-(Date.now() - start) / pace))))), 120);
    try {
      if (m === "trace") {
        // Exact trace: vectorize the untouched upload on this device, no AI.
        setReference(null);
        setRaw(null);
        const src = await readAsDataUrl(source);
        abort.signal.throwIfAborted();
        setProgress(60);
        await finish(src, m, null, name, original);
        return;
      }
      const form = new FormData();
      const multi = m === "blend" || (correction && raw);
      const key = multi ? "image[]" : "image";
      if (correction && raw) {
        form.append(key, logoFile(raw, "draft.png", "image/png"));
        form.append("fix", correction);
      }
      // Clean logos go to the AI as a crisp 1024px rendering of their exact trace, plus measured geometry.
      const ref = await prepareReference(source);
      setReference(ref);
      form.append(key, ref.file);
      if (ref.geometry) form.append("geometry", ref.geometry);
      if (ref.traced) form.append("reference", "traced");
      if (m === "blend" && shape) form.append(key, await flattenLogo(shape));
      form.append("text", text.trim());
      form.append("mode", m);
      setProgress((p) => Math.max(p, 12));
      if (more && !correction) {
        const names = [["gemini", "Gemini"], ["grok", "Grok"]] as const;
        setVersions([{ name: "OpenAI" }, ...names.map(([, n]) => ({ name: n }))]);
        names.forEach(([id, n]) => {
          const f = new FormData();
          form.forEach((v, k) => f.append(k, v));
          f.append("provider", id);
          let got = "";
          streamImage("/api/edit-image", f, (src, fin) => { if (fin) got = src; }, abort.signal)
            .then(async () => {
              const match = got ? shapeMatch(ref, (await toOutputs(got)).signature) : null;
              setVersions((a) => a.map((x) => (x.name === n ? { name: n, src: got, match } : x)));
            })
            .catch((e: unknown) => setVersions((a) => a.map((x) => (x.name === n ? { name: n, err: e instanceof Error ? e.message : "Failed" } : x))));
        });
      }
      form.append("provider", "openai");
      let last = "";
      await streamImage("/api/edit-image", form, (src, isFinal) => {
        setFrame(src);
        setProgress((p) => Math.max(p, isFinal ? 92 : 60));
        if (isFinal) last = src;
      }, abort.signal);
      abort.signal.throwIfAborted();
      if (!last) throw new Error("No logo came back. Please try again.");
      setRaw(last);
      setProgress(96);
      const match = await finish(last, m, ref, name, original);
      if (more && !correction) setVersions((a) => a.map((x) => (x.name === "OpenAI" ? { name: "OpenAI", src: last, match } : x)));
    } catch (e) {
      if (abort.signal.aborted) return;
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      clearInterval(timer);
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  /** Black & white is the default; colour is traced on first request, then kept. */
  async function chooseVariant(variant: "mono" | "color") {
    const t = traced.current;
    if (!t || colorBusy) return;
    if (variant === "mono") { setResult(t.mono); return; }
    if (t.color) { setResult(t.color); return; }
    setColorBusy(true);
    setError(null);
    try {
      // Let the button show its busy state before the (synchronous) colour trace runs.
      await new Promise((r) => setTimeout(r, 30));
      const o = await toColorOutputs(t.src);
      const color = buildResult(o, {
        name: t.mono.name,
        mode: "trace",
        accuracy: { kind: "color", value: o.accuracy },
        original: t.mono.original,
        detail: `${t.mono.detail} · colour`,
        variant: "color",
      });
      if (traced.current !== t) return; // a new upload replaced this one meanwhile
      t.color = color;
      setResult(color);
      setRecent(addRecent({ name: t.mono.name, mode: "trace", svg: o.svg }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The colour version could not be made.");
    } finally {
      setColorBusy(false);
    }
  }

  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
  }

  function startOver() {
    cancel();
    setResult(null);
    setVersions([]);
    setRaw(null);
    setError(null);
  }

  async function pickVersion(src: string) {
    if (!result || !file) return;
    setRaw(src);
    await finish(src, result.mode, reference, result.name, result.original);
  }

  function rerun(next: "trace" | "recreate" | "replace") {
    setMode(next);
    if (next === "replace") {
      // Needs the new wording: back to the start card with the same upload selected.
      setResult(null);
      setVersions([]);
      return;
    }
    void run({ m: next });
  }

  async function openRecent(item: RecentItem) {
    try {
      traced.current = null; // Recent keeps the SVG only, not the upload to re-trace
      setResult(await resultFromRecent(item));
      setVersions([]);
      setRaw(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That saved logo could not be opened.");
    }
  }

  if (busy) {
    return (
      <ProcessingScreen
        name={file?.name ?? "Your logo"}
        detail={[dims, modeInfo(busyMode).label].filter(Boolean).join(" · ")}
        image={frame}
        mode={busyMode}
        progress={progress}
        onCancel={cancel}
      />
    );
  }

  if (result && !batch) {
    return (
      <ResultWorkspace
        result={result}
        versions={versions}
        onPickVersion={(src) => void pickVersion(src)}
        onNew={startOver}
        onRerun={file ? rerun : undefined}
        onFix={raw && result.mode !== "trace" ? (fix) => void run({ m: result.mode, correction: fix }) : undefined}
        notice={error}
        onVariant={traced.current && result.mode === "trace" ? (v) => void chooseVariant(v) : undefined}
        colorBusy={colorBusy}
      />
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-dots">
      {pageDragging && <PageDropOverlay label="Drop your logo to upload" />}
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-7">
        <button type="button" onClick={() => setBatch(false)} className="flex items-center gap-2.5 text-foreground" aria-label="Vectorthis home">
          <BrandMark />
          <span className="text-[17px] font-semibold tracking-[-0.01em]">Vectorthis</span>
        </button>
        <button
          type="button"
          aria-pressed={batch}
          onClick={() => setBatch((b) => !b)}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-3.5 text-sm font-medium"
        >
          <LayoutGrid className="h-4 w-4" aria-hidden="true" />
          {batch ? "Single logo" : "Batch"}
        </button>
      </header>
      {batch ? (
        <BatchLogos mode={mode} onMode={setMode} />
      ) : (
        <StartScreen
          mode={mode}
          onMode={(m) => { setMode(m); setError(null); }}
          file={file}
          preview={preview}
          onFile={chooseFile}
          text={text}
          onText={setText}
          shape={shape}
          shapePreview={shapePreview}
          onShape={chooseShape}
          more={more}
          onMore={setMore}
          canRun={Boolean(file) && (mode !== "replace" || Boolean(text.trim())) && (mode !== "blend" || Boolean(shape))}
          onRun={() => void run()}
          error={error}
          recent={recent}
          onOpenRecent={(item) => void openRecent(item)}
          onDeleteRecent={(item) => setRecent((list) => removeRecent(item.id, list))}
          onClearRecent={() => setRecent(clearRecent())}
        />
      )}
    </div>
  );
}
