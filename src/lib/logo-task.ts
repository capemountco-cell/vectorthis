import type { LogoMode } from "@/lib/logo-prompt";

export const DEFAULT_LOGO_MODE: LogoMode = "recreate";
/** "trace" vectorizes the upload itself in the browser: no AI, so the geometry is exact. */
export type TaskMode = LogoMode | "trace";
export type TaskOptions = {
  mode: TaskMode;
  text: string;
  shape: File | null;
  provider: "openai" | "gemini" | "grok";
};
export type LogoTaskDependencies<T> = {
  flatten: (file: File) => Promise<File>;
  stream: (
    form: FormData,
    frame: (src: string, final: boolean) => void,
    signal: AbortSignal,
  ) => Promise<void>;
  prepare: (src: string) => Promise<T>;
  /** Extra prompt facts about the original (measured geometry, clean traced reference). */
  describe?: (file: File) => Promise<{ geometry?: string; traced?: boolean }>;
  /** Reads the upload for trace mode (defaults to a data URL). */
  read?: (file: File) => Promise<string>;
};

export function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read your logo."));
    reader.readAsDataURL(file);
  });
}

// Every invocation owns its input, completion frame, and abort signal.
export async function executeLogoTask<T>(
  file: File,
  options: TaskOptions,
  signal: AbortSignal,
  onFrame: (src: string, final: boolean) => void,
  dependencies: LogoTaskDependencies<T>,
): Promise<T> {
  if (options.mode === "trace") {
    // Keep the original pixels (transparency included): the tracer reads them directly.
    const src = await (dependencies.read ?? readAsDataUrl)(file);
    signal.throwIfAborted();
    onFrame(src, true);
    const output = await dependencies.prepare(src);
    signal.throwIfAborted();
    return output;
  }
  const form = new FormData();
  const key = options.mode === "blend" ? "image[]" : "image";
  form.append(key, await dependencies.flatten(file));
  const facts = (await dependencies.describe?.(file)) ?? {};
  if (facts.geometry) form.append("geometry", facts.geometry);
  if (facts.traced) form.append("reference", "traced");
  if (options.mode === "blend") {
    if (!options.shape) throw new Error("Add a shape reference first.");
    form.append(key, await dependencies.flatten(options.shape));
  }
  signal.throwIfAborted();
  form.append("mode", options.mode);
  form.append("text", options.text.trim());
  form.append("provider", options.provider);
  let completed = "";
  await dependencies.stream(
    form,
    (src, final) => {
      if (signal.aborted) return;
      if (final) completed = src;
      onFrame(src, final);
    },
    signal,
  );
  signal.throwIfAborted();
  if (!completed) throw new Error("No completed logo was returned.");
  const output = await dependencies.prepare(completed);
  signal.throwIfAborted();
  return output;
}
