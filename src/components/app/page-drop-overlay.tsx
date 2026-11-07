import { Upload } from "lucide-react";

export function PageDropOverlay({ label }: { label: string }) {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 bg-background/70 p-4 backdrop-blur-sm sm:p-6">
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-[24px] border-2 border-dashed border-blue bg-[#F4F7FF]/80">
        <Upload className="h-8 w-8 text-foreground" aria-hidden="true" />
        <span className="text-lg font-semibold">{label}</span>
      </div>
    </div>
  );
}
