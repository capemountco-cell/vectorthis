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

function download(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
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

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-5 px-5 py-8">
      <header>
        <h1 className="text-3xl font-black tracking-tight">Relogo</h1>
        <p className="text-sm text-muted-foreground">Same logo, new text.</p>
      </header>

      <label className="flex aspect-[4/3] cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-border bg-muted">
        {preview ? (
          <img src={preview} alt="Uploaded logo" className="max-h-full max-w-full object-contain p-4" />
        ) : (
          <span className="text-sm text-muted-foreground">Tap to upload logo</span>
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

      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="New text"
        className="h-14 rounded-xl border border-input bg-background px-4 text-lg outline-none focus:border-foreground"
      />

      <button
        onClick={run}
        disabled={!file || !text.trim() || busy}
        className="h-14 rounded-xl bg-primary text-lg font-bold text-primary-foreground disabled:opacity-40"
      >
        {busy ? "Creating…" : "Create logo"}
      </button>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {(frame || out) && (
        <section className="flex flex-col gap-3">
          <div className="checker flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl border border-border">
            <img
              src={out?.png ?? frame!}
              alt="New logo"
              className={`max-h-full max-w-full object-contain transition-[filter] ${final ? "blur-0" : "blur-2xl"}`}
            />
          </div>
          {out && (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() =>
                  download(URL.createObjectURL(new Blob([out.svg], { type: "image/svg+xml" })), `${slug}.svg`)
                }
                className="h-12 rounded-xl border-2 border-foreground font-bold"
              >
                SVG
              </button>
              <button
                onClick={() => download(out.png, `${slug}.png`)}
                className="h-12 rounded-xl border-2 border-foreground font-bold"
              >
                PNG
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
