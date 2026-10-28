// Calls the user's own Gemini / Grok keys and wraps the result as a single SSE "completed" event,
// so the browser's stream reader handles every provider the same way.
async function fileToB64(f: File) {
  const bytes = new Uint8Array(await f.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function sse(b64: string) {
  const body = `event: image_edit.completed\ndata: ${JSON.stringify({ type: "image_edit.completed", b64_json: b64 })}\n\n`;
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

async function fail(name: string, res: Response) {
  const t = await res.text().catch(() => "");
  console.error(`${name} failed [${res.status}]: ${t}`);
  return new Response(`${name} failed: ${res.status} ${t}`, { status: res.status >= 400 ? res.status : 502 });
}

export async function geminiEdit(prompt: string, images: File[]) {
  const key = process.env["GOOGLE_API_KEY"];
  if (!key) return new Response("Missing Gemini key", { status: 500 });
  const parts = [{ text: prompt }, ...(await Promise.all(images.map(async (f) => ({ inlineData: { mimeType: f.type || "image/png", data: await fileToB64(f) } }))))];
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent", {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }),
  });
  if (!res.ok) return fail("Gemini", res);
  const json = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[] };
  const b64 = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!b64) return new Response("Gemini returned no image", { status: 502 });
  return sse(b64);
}

export async function grokEdit(prompt: string, images: File[]) {
  const key = process.env["XAI_API_KEY"];
  if (!key) return new Response("Missing Grok key", { status: 500 });
  const last = images[images.length - 1]!;
  const res = await fetch("https://api.x.ai/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "grok-imagine-image",
      prompt,
      image: { url: `data:${last.type || "image/png"};base64,${await fileToB64(last)}`, type: "image_url" },
      response_format: "b64_json",
    }),
  });
  if (!res.ok) return fail("Grok", res);
  const json = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) return new Response("Grok returned no image", { status: 502 });
  return sse(b64);
}
