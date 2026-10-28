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
        const fix = String(form.get("fix") ?? "").trim();
        form.delete("fix");
        const letters = [...text].map((c) => (c === " " ? "[space]" : c)).join(" ");
        const spelling = `The text must read exactly "${text}" — ${[...text].length} characters, in this order: ${letters}. Match the original's letter case. No extra, missing, repeated or swapped letters.`;
        const style = `Preserve the original lettering style precisely: same typeface/custom letterforms, stroke weight, x-height, letter widths, corner shapes, terminals, kerning and any icons or decorative details. Where the new text reuses letters from the original, copy those exact glyphs; draw any new letters so they look like they were designed by the same hand.`;
        const output = `Output a flat solid pure black (#000000) logo on a plain pure white background, centered with margin. No gradients, shadows, textures, mockups or extra elements.`;
        form.set(
          "prompt",
          fix
            ? `The first image is a logo draft; the second is the original logo it is based on. Edit the draft to apply this correction: "${fix}". Change nothing else. ${spelling} ${style} ${output}`
            : `Find the logo/wordmark in this image (it may be light-colored on a photo or textured background — ignore the background entirely) and recreate only that logo as a clean vector-style mark with new wording. ${spelling} ${style} ${output}`,
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
