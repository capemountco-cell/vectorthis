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

function Index() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<LogoMode>("replace");
  const [background, setBackground] = useState("transparent");
  const [frame, setFrame] = useState<string | null>(null);
  const [final, setFinal] = useState(false);
  const [out, setOut] = useState<{ png: string; whitePng: string; svg: string; pngFile: File; whitePngFile: File; svgFile: File } | null>(null);
  const [progress, setProgress] = useState(0);
  const [raw, setRaw] = useState<string | null>(null);
  const [fix, setFix] = useState("");
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
    setFinal(false);
    setFix("");
    setError(null);
    setSaveError(null);
  }

  async function run(correction?: string) {
    if (!file || (mode === "replace" && !text.trim())) return;
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
      if (correction && raw) {
        form.append("image[]", new File([toFile(raw, "draft.png", "image/png")], "draft.png", { type: "image/png" }));
        form.append("image[]", file);
        form.append("fix", correction);
      } else {
        form.append("image", file);
      }
      form.append("text", text.trim());
      form.append("mode", mode);
      let last = "";
      await streamImage("/api/edit-image", form, (src, isFinal) => {
        setFrame(src);
        setProgress((p) => Math.max(p, isFinal ? 92 : 60));
        setFinal(isFinal);
        if (isFinal) last = src;
      });
      if (last) {
        setProgress(95);
        setRaw(last);
        setFix("");
        const o = await toOutputs(last);
        const slug = mode === "recreate" ? "logo" : text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "logo";
        setOut({ ...o, pngFile: toFile(o.png, `${slug}.png`, "image/png"), whitePngFile: toFile(o.whitePng, `${slug}-white.png`, "image/png"), svgFile: toFile(o.svg, `${slug}.svg`, "image/svg+xml") });
        setProgress(100);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      clearInterval(timer);
      setBusy(false);
    }
  }


  const shown = (background === "white" ? out?.whitePng : out?.png) ?? frame;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-3 px-4 py-5">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-black tracking-tight">Relogo</h1>
        <p className="text-xs text-muted-foreground">Your logo, recreated.</p>
      </header>

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
            <span className="text-[10px] font-bold leading-tight text-muted-foreground">+ Upload</span>
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
      </div>

      <ToggleGroup type="single" value={mode} onValueChange={(value) => {
        if (value === "replace" || value === "recreate") {
          setMode(value);
          resetResult();
        }
      }} disabled={busy || savingPng} aria-label="Logo mode" className="grid grid-cols-2">
        <ToggleGroupItem value="replace" className="h-10 border border-border">Change text</ToggleGroupItem>
        <ToggleGroupItem value="recreate" className="h-10 border border-border">Recreate original</ToggleGroupItem>
      </ToggleGroup>

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
        {mode === "replace" && (
        <input
          value={text}
          disabled={busy || savingPng}
          onChange={(e) => { setText(e.target.value); resetResult(); }}
          aria-label="New text"
          placeholder="New text"
          className="h-12 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-base outline-none focus:border-foreground"
        />
        )}
        <Button
          onClick={() => run()}
          disabled={!file || (mode === "replace" && !text.trim()) || busy || savingPng}
          className={`h-12 rounded-xl px-5 font-bold disabled:opacity-40 ${mode === "recreate" ? "w-full" : ""}`}
        >
          {busy ? `${Math.round(progress)}%` : mode === "recreate" ? "Recreate logo" : "Create"}
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
