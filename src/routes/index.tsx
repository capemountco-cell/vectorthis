import { Image as ImageIcon } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { streamImage } from "@/lib/stream-image";
import { toOutputs } from "@/lib/logo-convert";
import { downloadFile, isMobileSaveDevice, savePng } from "@/lib/save-png";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { LogoMode } from "@/lib/logo-prompt";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Relogo — Recreate logos or change their text" },
      { name: "description", content: "Recreate your logo or replace its text, remove the background, and save black SVGs or transparent and white PNGs." },
      { property: "og:title", content: "Relogo — Recreate logos or change their text" },
      { property: "og:description", content: "Recreate your logo or replace its text, remove the background, and save black SVGs or transparent and white PNGs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function toFile(href: string, name: string, type: string) {
  const bin = href.startsWith("data:") && href.includes(";base64,")
    ? Uint8Array.from(atob(href.split(",")[1] ?? ""), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(href);
  return new File([bin], name, { type });
}

// Must be called directly from the tap (no awaits before share) or iPhone opens the image instead.
function saveSvg(file: File) {
  if (isMobileSaveDevice() && typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file] }).catch(() => {});
    return;
  }
  downloadFile(file);
}

// Transparent uploads read as solid black to the AI, so place them on white first.
async function onWhite(f: File): Promise<File> {
  const bmp = await createImageBitmap(f);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
  return blob ? new File([blob], "upload.png", { type: "image/png" }) : f;
}

function Index() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [shape, setShape] = useState<File | null>(null);
  const [shapePreview, setShapePreview] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<LogoMode>("replace");
  const [background, setBackground] = useState("transparent");
  const [frame, setFrame] = useState<string | null>(null);
  const [final, setFinal] = useState(false);
  const [out, setOut] = useState<{ png: string; whitePng: string; svg: string; pngFile: File; whitePngFile: File; svgFile: File } | null>(null);
  const [progress, setProgress] = useState(0);
  const [raw, setRaw] = useState<string | null>(null);
  const [fix, setFix] = useState("");
  const [more, setMore] = useState(false);
  const [alts, setAlts] = useState<{ name: string; src?: string; err?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingPng, setSavingPng] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mobileSave, setMobileSave] = useState(false);
  useEffect(() => setMobileSave(isMobileSaveDevice()), []);

  function resetResult() {
    setOut(null);
    setFrame(null);
    setRaw(null);
    setAlts([]);
    setFinal(false);
    setFix("");
    setError(null);
    setSaveError(null);
  }

  async function run(correction?: string) {
    if (!file || (mode === "replace" && !text.trim()) || (mode === "blend" && !shape)) return;
    setBusy(true);
    setError(null);
    setSaveError(null);
    setOut(null);
    setFrame(null);
    setFinal(false);
    setProgress(2);
    const start = Date.now();
    const timer = setInterval(() => setProgress((p) => Math.max(p, Math.min(90, 90 * (1 - Math.exp(-(Date.now() - start) / 25000))))), 300);
    try {
      const form = new FormData();
      const multi = mode === "blend" || (correction && raw);
      const key = multi ? "image[]" : "image";
      if (correction && raw) {
        form.append(key, new File([toFile(raw, "draft.png", "image/png")], "draft.png", { type: "image/png" }));
        form.append("fix", correction);
      }
      form.append(key, await onWhite(file));
      if (mode === "blend" && shape) form.append(key, await onWhite(shape));
      form.append("text", text.trim());
      form.append("mode", mode);
      let last = "";
      if (more) {
        const names = [["gemini", "Gemini"], ["grok", "Grok"]] as const;
        setAlts([{ name: "OpenAI" }, ...names.map(([, n]) => ({ name: n }))]);
        names.forEach(([id, n]) => {
          const f = new FormData();
          form.forEach((v, k) => f.append(k, v));
          f.append("provider", id);
          let got = "";
          streamImage("/api/edit-image", f, (src, fin) => { if (fin) got = src; })
            .then(() => setAlts((a) => a.map((x) => (x.name === n ? { name: n, src: got } : x))))
            .catch((e) => setAlts((a) => a.map((x) => (x.name === n ? { name: n, err: e instanceof Error ? e.message : "Failed" } : x))));
        });
      } else setAlts([]);
      form.append("provider", "openai");
      await streamImage("/api/edit-image", form, (src, isFinal) => {
        setFrame(src);
        setProgress((p) => Math.max(p, isFinal ? 92 : 60));
        setFinal(isFinal);
        if (isFinal) last = src;
      });
      if (last) {
        if (more) setAlts((a) => a.map((x) => (x.name === "OpenAI" ? { name: "OpenAI", src: last } : x)));
        await pickVersion(last);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      clearInterval(timer);
      setBusy(false);
    }
  }

  async function pickVersion(last: string) {
    {
      {
        setFrame(last);
        setFinal(true);
        setProgress(95);
        setRaw(last);
        setFix("");
        const o = await toOutputs(last);
        const slug = mode === "recreate" ? "logo" : text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "logo";
        setOut({ ...o, pngFile: toFile(o.png, `${slug}.png`, "image/png"), whitePngFile: toFile(o.whitePng, `${slug}-white.png`, "image/png"), svgFile: toFile(o.svg, `${slug}.svg`, "image/svg+xml") });
        setProgress(100);
      }
    }
  }


  const shown = (background === "white" ? out?.whitePng : out?.png) ?? frame;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-3 px-4 py-5">

      <div className={`${background === "transparent" ? "checker" : "bg-background"} relative flex aspect-[16/9] items-center justify-center overflow-hidden rounded-xl border border-border`}>
        {shown ? (
          <img
            src={shown}
            alt="New logo"
            className={`max-h-full max-w-full object-contain p-3 transition-[filter] ${final ? "blur-0" : "blur-xl"}`}
          />
        ) : (
          <span className="text-sm text-muted-foreground">Your new logo appears here</span>
        )}
        <label className="absolute bottom-2 left-2 flex h-14 w-14 cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-background bg-muted shadow">
          {preview ? (
            <img src={preview} alt="Original logo" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          )}
          <input
            type="file"
            accept="image/*"
            aria-label="Upload original logo"
            disabled={busy || savingPng}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                resetResult();
                if (preview) URL.revokeObjectURL(preview);
                setFile(f);
                setPreview(URL.createObjectURL(f));
              }
            }}
          />
        </label>
        {mode === "blend" && (
          <label className="absolute bottom-2 left-[4.5rem] flex h-14 w-14 cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-background bg-muted shadow">
            {shapePreview ? (
              <img src={shapePreview} alt="Shape reference" className="h-full w-full object-cover" />
            ) : (
              <span className="text-center text-[10px] font-bold leading-tight text-muted-foreground">+ Shape</span>
            )}
            <input
              type="file"
              accept="image/*"
              aria-label="Upload shape reference"
              disabled={busy || savingPng}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  resetResult();
                  if (shapePreview) URL.revokeObjectURL(shapePreview);
                  setShape(f);
                  setShapePreview(URL.createObjectURL(f));
                }
              }}
            />
          </label>
        )}
      </div>

      <ToggleGroup type="single" value={mode} onValueChange={(value) => {
        if (value === "replace" || value === "recreate" || value === "blend") {
          setMode(value);
          resetResult();
        }
      }} disabled={busy || savingPng} aria-label="Logo mode" className="grid grid-cols-3">
        <ToggleGroupItem value="replace" className="h-10 border border-border text-xs">Change text</ToggleGroupItem>
        <ToggleGroupItem value="recreate" className="h-10 border border-border text-xs">Recreate</ToggleGroupItem>
        <ToggleGroupItem value="blend" className="h-10 border border-border text-xs">New shape</ToggleGroupItem>
      </ToggleGroup>
      {mode === "blend" && (
        <p className="text-xs text-muted-foreground">Add a second image (e.g. a music note). Your logo's style gets reshaped to look like it.</p>
      )}
      <button
        type="button"
        aria-pressed={more}
        disabled={busy}
        onClick={() => setMore((m) => !m)}
        className={`h-10 rounded-xl border text-xs font-bold ${more ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}
      >
        {more ? "3 versions: OpenAI + Gemini + Grok" : "OpenAI only · tap for 3 versions"}
      </button>
      {alts.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {alts.map((a) => (
            <button
              key={a.name}
              type="button"
              disabled={!a.src || busy}
              onClick={() => a.src && pickVersion(a.src)}
              className={`flex flex-col items-center gap-1 rounded-lg border p-1 text-[10px] ${a.src && raw === a.src ? "border-primary" : "border-border"}`}
            >
              <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded bg-background">
                {a.src ? <img src={a.src} alt={`${a.name} version`} className="max-h-full max-w-full object-contain" /> : <span className="px-1 text-center text-muted-foreground">{a.err ? "Failed" : "Working…"}</span>}
              </div>
              <span className="font-bold">{a.name}</span>
              {a.err && <span className="line-clamp-2 text-destructive" title={a.err}>{a.err}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">PNG background</span>
        <ToggleGroup type="single" value={background} onValueChange={(value) => {
          if (value) { setBackground(value); setSaveError(null); }
        }} disabled={savingPng} aria-label="PNG background" className="flex-1">
          <ToggleGroupItem value="transparent" className="flex-1 text-xs">Transparent</ToggleGroupItem>
          <ToggleGroupItem value="white" className="flex-1 text-xs">White</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="flex gap-2">
        {mode !== "recreate" && (
        <input
          value={text}
          disabled={busy || savingPng}
          onChange={(e) => { setText(e.target.value); resetResult(); }}
          aria-label="New text"
          placeholder={mode === "blend" ? "Direction (optional) e.g. make each half a note" : "New text"}
          className="h-12 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-base outline-none focus:border-foreground"
        />
        )}
        <Button
          onClick={() => run()}
          disabled={!file || (mode === "replace" && !text.trim()) || (mode === "blend" && !shape) || busy || savingPng}
          className={`h-12 rounded-xl px-5 font-bold disabled:opacity-40 ${mode === "recreate" ? "w-full" : ""}`}
        >
          {busy ? `${Math.round(progress)}%` : mode === "recreate" ? "Recreate logo" : mode === "blend" ? "Reshape logo" : "Create"}
        </Button>
      </div>

      {busy && (
        <div className="flex flex-col gap-1">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">
            {progress < 60 ? "Reading your logo…" : progress < 92 ? (mode === "recreate" ? "Recreating your logo…" : "Drawing new text…") : "Preparing files…"} {Math.round(progress)}%
          </p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {out && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={() => {
              if (savingPng) return;
              // Start native sharing synchronously, while this tap is active.
              const share = savePng(background === "white" ? out.whitePngFile : out.pngFile);
              setSavingPng(true);
              setSaveError(null);
              share.catch((e: unknown) => {
                setSaveError(e instanceof Error ? e.message : "Image sharing could not open. Your logo is still here.");
              }).finally(() => setSavingPng(false));
            }}
            disabled={savingPng}
            className="h-12 whitespace-normal rounded-xl px-2 font-bold"
          >
             {savingPng ? (mobileSave ? "Opening save options…" : "Downloading…") : (mobileSave ? "Save PNG to Photos" : "Download PNG")}
          </Button>
          <Button
            onClick={() => saveSvg(out.svgFile)}
            variant="outline"
            className="h-12 rounded-xl border-2 border-foreground font-bold"
          >
            {mobileSave ? "Save SVG" : "Download SVG"}
          </Button>
        </div>
      )}
      {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
      {out && !busy && (
        <div className="flex gap-2">
          <input
            value={fix}
            onChange={(e) => setFix(e.target.value)}
            placeholder="Fix something? e.g. make the R wavier"
            className="h-12 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-base outline-none focus:border-foreground"
          />
           <Button
            onClick={() => run(fix.trim())}
             disabled={!fix.trim() || savingPng}
             variant="outline"
            className="h-12 rounded-xl border-2 border-foreground px-4 font-bold disabled:opacity-40"
          >
            Fix
           </Button>
        </div>
      )}
    </main>
  );
}
