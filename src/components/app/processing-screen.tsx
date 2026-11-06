import { ArrowLeft, Check, Spline } from "lucide-react";
import type { TaskMode } from "@/lib/logo-task";
import { cn } from "@/lib/utils";

const STEPS: Record<"trace" | "ai", { label: string; at: number }[]> = {
  trace: [
    { label: "Reading pixels", at: 0 },
    { label: "Finding edges", at: 20 },
    { label: "Fitting curves", at: 45 },
    { label: "Squaring corners", at: 80 },
  ],
  ai: [
    { label: "Preparing reference", at: 0 },
    { label: "Redrawing with AI", at: 12 },
    { label: "Tracing the redraw", at: 92 },
    { label: "Checking the match", at: 97 },
  ],
};

export function processingSteps(mode: TaskMode, progress: number) {
  const steps = STEPS[mode === "trace" ? "trace" : "ai"];
  let current = 0;
  steps.forEach((s, i) => { if (progress >= s.at) current = i; });
  return steps.map((s, i) => ({ label: s.label, state: i < current ? "done" : i === current ? "active" : "todo" } as const));
}

export function ProcessingScreen({
  name, detail, image, mode, progress, onCancel,
}: {
  name: string;
  detail: string;
  image: string | null;
  mode: TaskMode;
  progress: number;
  onCancel: () => void;
}) {
  const steps = processingSteps(mode, progress);
  const active = steps.find((s) => s.state === "active")?.label ?? "Working";
  return (
    <div className="flex min-h-dvh flex-col bg-dots">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onCancel} aria-label="Back to start" className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card">
            <ArrowLeft className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold">{name}</span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">{detail}</span>
          </div>
        </div>
        <button type="button" onClick={onCancel} className="h-11 rounded-xl border border-border bg-card px-4 text-sm font-medium">Cancel</button>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-9 px-5 pb-16">
        <div className="relative flex aspect-square w-[min(360px,80vw)] items-center justify-center">
          {image && (
            <img src={image} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-contain opacity-80 blur-[10px] motion-safe:animate-pulse" />
          )}
          <div role="status" aria-live="polite" className="relative flex items-center gap-3 rounded-[14px] border border-border bg-card py-3 pr-[18px] pl-3 shadow-[0_10px_30px_rgba(17,17,17,0.10)]">
            <span className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-muted">
              <Spline className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="text-[15px] font-medium text-subtle">{active}…</span>
          </div>
        </div>

        <ol aria-label="Progress" className="flex flex-wrap justify-center gap-2">
          {steps.map((s) => (
            <li
              key={s.label}
              aria-current={s.state === "active" ? "step" : undefined}
              className={cn(
                "inline-flex h-[34px] items-center gap-2 rounded-full border px-3 text-[13px]",
                s.state === "done" && "border-border bg-card text-subtle",
                s.state === "active" && "border-foreground bg-foreground font-medium text-primary-foreground",
                s.state === "todo" && "border-dashed border-[#D4D4D0] text-muted-foreground",
              )}
            >
              {s.state === "done" && <Check className="h-3.5 w-3.5" strokeWidth={2.6} aria-hidden="true" />}
              {s.state === "active" && <span className="h-2 w-2 rounded-full bg-primary-foreground" aria-hidden="true" />}
              {s.label}
            </li>
          ))}
        </ol>

        <div className="flex w-[min(320px,80vw)] flex-col gap-2">
          <div role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} className="h-1 overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full bg-foreground transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-center font-mono text-[11px] text-muted-foreground">
            {mode === "trace" ? "Runs on your device · nothing is uploaded" : "Usually takes 20–60 seconds"}
          </p>
        </div>
      </main>
    </div>
  );
}
