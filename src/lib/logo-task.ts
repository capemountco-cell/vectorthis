import type { LogoMode } from "@/lib/logo-prompt";

export const DEFAULT_LOGO_MODE: LogoMode = "recreate";
export type TaskOptions = { mode: LogoMode; text: string; shape: File | null; provider: "openai" | "gemini" | "grok" };
export type LogoTaskDependencies<T> = {
  flatten: (file: File) => Promise<File>;
  stream: (form: FormData, frame: (src: string, final: boolean) => void, signal: AbortSignal) => Promise<void>;
  prepare: (src: string) => Promise<T>;
};

// Every invocation owns its input, completion frame, and abort signal.
export async function executeLogoTask<T>(file: File, options: TaskOptions, signal: AbortSignal, onFrame: (src: string, final: boolean) => void, dependencies: LogoTaskDependencies<T>): Promise<T> {
  const form = new FormData();
  const key = options.mode === "blend" ? "image[]" : "image";
  form.append(key, await dependencies.flatten(file));
  if (options.mode === "blend") {
    if (!options.shape) throw new Error("Add a shape reference first.");
    form.append(key, await dependencies.flatten(options.shape));
  }
  signal.throwIfAborted();
  form.append("mode", options.mode);
  form.append("text", options.text.trim());
  form.append("provider", options.provider);
  let completed = "";
  await dependencies.stream(form, (src, final) => {
    if (signal.aborted) return;
    if (final) completed = src;
    onFrame(src, final);
  }, signal);
  signal.throwIfAborted();
  if (!completed) throw new Error("No completed logo was returned.");
  const output = await dependencies.prepare(completed);
  signal.throwIfAborted();
  return output;
}