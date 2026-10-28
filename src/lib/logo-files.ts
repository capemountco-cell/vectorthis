import { downloadFile, isMobileSaveDevice } from "@/lib/save-png";

export function logoFile(href: string, name: string, type: string) {
  const bin = href.startsWith("data:") && href.includes(";base64,")
    ? Uint8Array.from(atob(href.split(",")[1] ?? ""), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(href);
  return new File([bin], name, { type });
}

export async function flattenLogo(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not read your logo.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Could not prepare your logo.");
    return new File([blob], "upload.png", { type: "image/png" });
  } finally { bitmap.close(); }
}

export function saveLogoSvg(file: File) {
  if (isMobileSaveDevice() && navigator.canShare?.({ files: [file] }) && typeof navigator.share === "function") {
    return navigator.share({ files: [file] });
  }
  downloadFile(file);
  return Promise.resolve();
}