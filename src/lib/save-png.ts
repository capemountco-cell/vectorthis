export type PngSaveResult = "shared" | "cancelled";

const unsupported = "Image sharing is unavailable in this browser. Open the app directly in Safari on iPhone or Chrome on Android, then try Save PNG again. Your logo is still here.";

// Invoke from the click handler with an already-prepared File. Do not await
// conversion, fetch, or a permission query before calling navigator.share.
export function savePng(file: File): Promise<PngSaveResult> {
  try {
    if (typeof navigator.share !== "function") {
      return Promise.reject(new Error(unsupported));
    }
    const data = { files: [file] };
    if (typeof navigator.canShare === "function" && !navigator.canShare(data)) {
      return Promise.reject(new Error(unsupported));
    }
    return navigator.share(data).then(
      () => "shared" as const,
      (error: unknown) => {
        const name = typeof error === "object" && error !== null && "name" in error ? error.name : undefined;
        if (name === "AbortError") return "cancelled" as const;
        if (name === "NotAllowedError") {
          throw new Error("Your browser blocked image sharing. Open the app directly in Safari or Chrome instead of an embedded preview, then tap Save PNG again. Your logo is still here.");
        }
        throw new Error("The image share sheet could not open. Try Save PNG again or open the app directly in Safari or Chrome. Your logo is still here.");
      },
    );
  } catch {
    return Promise.reject(new Error(unsupported));
  }
}