import { createFileRoute } from "@tanstack/react-router";
import { editImage, imageSettings } from "@/lib/image-gateway.server";

export const Route = createFileRoute("/api/edit-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        const form = await request.formData();
        const text = String(form.get("text") ?? "").trim();
        if (!text) return new Response("Text is required", { status: 400 });
        form.delete("text");
        form.set(
          "prompt",
          `Find the logo/wordmark in this image (it may be light-colored on a photo or textured background — ignore the background entirely). Recreate only that logo exactly as a clean vector-style mark, keeping the same typeface style, letter weight, spacing, layout, icons and proportions, but replace the wording with exactly: "${text}" (spelled letter for letter). Custom letterforms (like stylised or wavy letters) must be adapted to the new letters in the same style. Render it as a flat solid pure black (#000000) logo on a plain pure white background. No gradients, shadows, textures, mockups or extra elements. Centered with margin around it.`,
        );
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
