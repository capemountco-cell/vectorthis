import { createFileRoute } from "@tanstack/react-router";
import { editImage, imageSettings } from "@/lib/image-gateway.server";
import { buildLogoPrompt } from "@/lib/logo-prompt";

export const Route = createFileRoute("/api/edit-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        const form = await request.formData();
        const mode = String(form.get("mode") ?? "replace");
        if (mode !== "replace" && mode !== "recreate") return new Response("Invalid logo mode", { status: 400 });
        form.delete("mode");
        const text = String(form.get("text") ?? "").trim();
        if (mode === "replace" && !text) return new Response("Text is required", { status: 400 });
        form.delete("text");
        const fix = String(form.get("fix") ?? "").trim();
        form.delete("fix");
        const images = [...form.entries()].filter(([name, value]) =>
          (name === "image" || name === "image[]") && value instanceof File,
        );
        if (images.length !== (fix ? 2 : 1)) {
          return new Response(fix ? "A draft and original logo are required for corrections" : "An original logo is required", { status: 400 });
        }
        form.set("prompt", buildLogoPrompt(text, fix, mode));
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
