import { createFileRoute } from "@tanstack/react-router";
import { editImage, imageSettings } from "@/lib/image-gateway.server";
import { buildLogoPrompt } from "@/lib/logo-prompt";
import { describeShapeHybrid } from "@/lib/shape-brief.server";
import { geminiEdit, grokEdit } from "@/lib/own-providers.server";

export const Route = createFileRoute("/api/edit-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["OPENAI_API_KEY"];
        if (!apiKey) return new Response("Missing OpenAI key", { status: 500 });
        const form = await request.formData();
        const provider = String(form.get("provider") ?? "openai");
        if (provider !== "openai" && provider !== "gemini" && provider !== "grok") return new Response("Invalid provider", { status: 400 });
        form.delete("provider");
        const mode = String(form.get("mode") ?? "replace");
        if (mode !== "replace" && mode !== "recreate" && mode !== "blend") return new Response("Invalid logo mode", { status: 400 });
        form.delete("mode");
        const text = String(form.get("text") ?? "").trim();
        if (mode === "replace" && !text) return new Response("Text is required", { status: 400 });
        form.delete("text");
        const fix = String(form.get("fix") ?? "").trim();
        form.delete("fix");
        // Client-side trace of the original: measured geometry and whether a clean rendering was sent.
        const geometry = String(form.get("geometry") ?? "");
        const tracedReference = form.get("reference") === "traced";
        form.delete("geometry");
        form.delete("reference");
        const images = [...form.entries()].filter(([name, value]) =>
          (name === "image" || name === "image[]") && value instanceof File,
        );
        if (images.length !== (fix ? 2 : 1) + (mode === "blend" ? 1 : 0)) {
          return new Response(mode === "blend" ? "An original logo and a shape reference are required" : fix ? "A draft and original logo are required for corrections" : "An original logo is required", { status: 400 });
        }
        let brief = "";
        if (mode === "blend") {
          // Strip the shape reference so the image editor can only work from the original logo.
          const files = images.map(([, v]) => v as File);
          const shape = files[files.length - 1]!;
          const original = files[files.length - 2]!;
          form.delete("image[]");
          form.delete("image");
          for (const f of files.slice(0, -1)) form.append(files.length > 2 ? "image[]" : "image", f);
          try {
            brief = await describeShapeHybrid(original, shape, text);
          } catch (e) {
            console.error("shape brief failed", e);
            return new Response("Couldn't read the shape image. Please try again.", { status: 502 });
          }
        }
        form.set("prompt", buildLogoPrompt(mode === "blend" ? "" : text, fix, mode, brief, { geometry, tracedReference }));
        if (provider !== "openai") {
          const files = [...form.entries()].filter(([n, v]) => (n === "image" || n === "image[]") && v instanceof File).map(([, v]) => v as File);
          return provider === "gemini" ? geminiEdit(String(form.get("prompt")), files) : grokEdit(String(form.get("prompt")), files);
        }
        form.set("quality", "high");
        const upstream = await editImage({ ...imageSettings, apiKey }, form);
        return new Response(upstream.body, {
          status: upstream.status,
          headers: {
            "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
            "Cache-Control": "no-cache",
          },
        });
      },
    },
  },
});
