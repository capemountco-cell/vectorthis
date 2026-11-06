import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = { value: T; label: ReactNode; ariaLabel?: string };

/** Radio-group segmented control: arrow keys move between options, as native radios do. */
export function Segmented<T extends string>({
  value, options, onChange, label, size = "md", className, disabled,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
  disabled?: boolean;
}) {
  const index = options.findIndex((o) => o.value === value);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("grid gap-1 rounded-xl bg-muted p-1", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      onKeyDown={(e) => {
        if (disabled) return;
        const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = options[(index + step + options.length) % options.length];
        if (next) {
          onChange(next.value);
          const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]");
          buttons[(index + step + options.length) % options.length]?.focus();
        }
      }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.ariaLabel}
            tabIndex={on || (index < 0 && o === options[0]) ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center justify-center whitespace-nowrap rounded-[9px] border px-2 font-medium transition-colors disabled:opacity-50",
              size === "sm" ? "h-8 text-[13px]" : "h-10 text-sm",
              on ? "border-border bg-card text-foreground shadow-[0_1px_3px_rgba(17,17,17,0.08)]" : "border-transparent text-subtle hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
