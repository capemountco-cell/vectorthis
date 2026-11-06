import type { TaskMode } from "@/lib/logo-task";

export type ModeInfo = { id: TaskMode; label: string; hint: string; short: string; ai: boolean };

export const MODES: ModeInfo[] = [
  { id: "trace", label: "Exact trace", hint: "Pixel-exact vector of your file. Instant, no AI — best for clean logo files.", short: "Pixel-exact. Instant, no AI.", ai: false },
  { id: "recreate", label: "Recreate", hint: "AI redraws a clean black version from a photo or rough file, then traces it.", short: "AI cleans up a photo or rough file.", ai: true },
  { id: "replace", label: "Change text", hint: "Keeps your lettering style and icon, swaps in new wording.", short: "Same style, new wording.", ai: true },
  { id: "blend", label: "New shape", hint: "Reshapes your mark to take on the features of a second image.", short: "Reshape with a second image.", ai: true },
];

export const modeInfo = (id: TaskMode) => MODES.find((m) => m.id === id) ?? MODES[0]!;

/** Name for exported files: the upload's name without its extension. */
export function baseName(name: string) {
  const stem = name.replace(/\.[^.]+$/, "").trim();
  return stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "logo";
}
