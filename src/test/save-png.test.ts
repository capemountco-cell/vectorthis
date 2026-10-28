import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isMobileSaveDevice, savePng } from "@/lib/save-png";

const file = new File([new Uint8Array([137, 80, 78, 71])], "logo.png", { type: "image/png" });

afterEach(() => vi.restoreAllMocks());
beforeEach(() => vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone)"));

function sharing(share: unknown, canShare: unknown = () => true) {
  Object.defineProperty(navigator, "share", { configurable: true, value: share });
  Object.defineProperty(navigator, "canShare", { configurable: true, value: canShare });
}

// jsdom has no Web Share API; getters allow per-test capability checks.
Object.defineProperty(navigator, "share", { configurable: true, get: () => undefined });
Object.defineProperty(navigator, "canShare", { configurable: true, get: () => undefined });
Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, get: () => 0 });

describe("PNG saving", () => {
  it("downloads the prepared PNG on desktop even when native sharing is available", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X)");
    const share = vi.fn();
    sharing(share);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:desktop-png") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    let downloaded: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloaded = this; });
    const open = vi.spyOn(window, "open");
    await expect(savePng(file)).resolves.toBe("downloaded");
    expect(downloaded?.download).toBe("logo.png");
    expect(downloaded?.href).toBe("blob:desktop-png");
    expect(share).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps iPads using a desktop user agent on the mobile save path", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X)");
    vi.spyOn(navigator, "maxTouchPoints", "get").mockReturnValue(5);
    expect(isMobileSaveDevice()).toBe(true);
  });

  it("opens native sharing synchronously with only the prepared image file", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    sharing(share);
    const result = savePng(file);
    expect(share).toHaveBeenCalledExactlyOnceWith({ files: [file] });
    await expect(result).resolves.toBe("shared");
  });

  it("attempts sharing when share exists but canShare is absent", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    sharing(share, undefined);
    await expect(savePng(file)).resolves.toBe("shared");
    expect(share).toHaveBeenCalledExactlyOnceWith({ files: [file] });
  });

  it.each(["missing", "unsupported"])("never opens a link when file sharing is %s", async (mode) => {
    const share = vi.fn();
    sharing(mode === "missing" ? undefined : share, () => false);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    const open = vi.spyOn(window, "open");
    await expect(savePng(file)).rejects.toThrow("Image sharing is unavailable");
    expect(share).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps cancellation quiet without starting a fallback navigation", async () => {
    sharing(vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError")));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    await expect(savePng(file)).resolves.toBe("cancelled");
    expect(click).not.toHaveBeenCalled();
  });

  it("reports blocked sharing instead of silently opening the image", async () => {
    sharing(vi.fn().mockRejectedValue(new DOMException("Blocked", "NotAllowedError")));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    await expect(savePng(file)).rejects.toThrow("Your browser blocked image sharing");
    expect(click).not.toHaveBeenCalled();
  });
});