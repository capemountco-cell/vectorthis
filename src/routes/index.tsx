import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { streamImage } from "@/lib/stream-image";
import { toOutputs } from "@/lib/logo-convert";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Relogo — Change the text on any logo" },
      { name: "description", content: "Upload a logo, type new text, download a black SVG and transparent PNG." },
      { property: "og:title", content: "Relogo — Change the text on any logo" },
      { property: "og:description", content: "Upload a logo, type new text, download a black SVG and transparent PNG." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

async function save(href: string, name: string, type: string) {
  const blob = await (await fetch(href)).blob();
  const file = new File([blob], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function Index() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [frame, setFrame] = useState<string | null>(null);
  const [final, setFinal] = useState(false);
  const [out, setOut] = useState<{ png: string; svg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!file || !text.trim()) return;
    setBusy(true);
    setError(null);
    setOut(null);
    setFrame(null);
    setFinal(false);
    try {
      const form = new FormData();
      form.append("image", file);
      form.append("text", text.trim());
      let last = "";
      await streamImage("/api/edit-image", form, (src, isFinal) => {
        setFrame(src);
        setFinal(isFinal);
        if (isFinal) last = src;
      });
      if (last) setOut(await toOutputs(last));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const slug = text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "logo";

  const shown = out?.png ?? frame;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-3 px-4 py-5">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-black tracking-tight">Relogo</h1>
        <p className="text-xs text-muted-foreground">Same logo, new text.</p>
      </header>

      <div className="checker relative flex aspect-[16/9] items-center justify-center overflow-hidden rounded-xl border border-border">
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
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setFile(f);
                setPreview(URL.createObjectURL(f));
              }
            }}
          />
        </label>
      </div>

      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="New text"
          className="h-12 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-base outline-none focus:border-foreground"
        />
        <button
          onClick={run}
          disabled={!file || !text.trim() || busy}
          className="h-12 rounded-xl bg-primary px-5 font-bold text-primary-foreground disabled:opacity-40"
        >
          {busy ? "…" : "Create"}
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {out && (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => save(out.png, `${slug}.png`, "image/png")}
            className="h-12 rounded-xl bg-primary font-bold text-primary-foreground"
          >
            Save PNG to Photos
          </button>
          <button
            onClick={() => save(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(out.svg)}`, `${slug}.svg`, "image/svg+xml")}
            className="h-12 rounded-xl border-2 border-foreground font-bold"
          >
            Save SVG
          </button>
        </div>
      )}
    </main>
  );
}
