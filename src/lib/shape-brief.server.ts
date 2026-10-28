import { SHAPE_BRIEF_INSTRUCTIONS } from "./logo-prompt";

async function toDataUrl(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${file.type || "image/png"};base64,${btoa(bin)}`;
}

// Looks at both images and writes a text-only redesign brief, so the image editor never sees (and can't copy) the shape reference.
// Uses the user's own OpenAI key.
export async function describeShapeHybrid(original: File, shape: File, direction: string) {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) throw new Error("Missing OpenAI key");
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4.1",
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: SHAPE_BRIEF_INSTRUCTIONS + (direction ? `\nUser direction: ${JSON.stringify(direction)}` : "") },
          { type: "input_text", text: "Image A — original logo:" },
          { type: "input_image", image_url: await toDataUrl(original), detail: "high" },
          { type: "input_text", text: "Image B — shape reference:" },
          { type: "input_image", image_url: await toDataUrl(shape), detail: "high" },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI brief failed [${res.status}]: ${await res.text()}`);
  const json = (await res.json()) as { output?: { type: string; content?: { type: string; text?: string }[] }[] };
  const text = (json.output ?? [])
    .flatMap((i) => (i.type === "message" ? i.content ?? [] : []))
    .map((c) => (c.type === "output_text" ? c.text ?? "" : ""))
    .join("")
    .trim();
  if (!text) throw new Error("Could not analyse the shape reference");
  return text;
}
