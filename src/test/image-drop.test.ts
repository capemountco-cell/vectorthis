import { act, renderHook } from "@testing-library/react";
import type { DragEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { useImageDrop } from "@/hooks/use-image-drop";

function dropEvent(files: File[]) {
  return { dataTransfer: { files, types: ["Files"], dropEffect: "none" }, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as DragEvent;
}
describe("Desktop image drops", () => {
  it("uploads every dropped image but not other files", () => {
    const receive = vi.fn();
    const { result } = renderHook(() => useImageDrop(receive));
    const first = new File(["a"], "a.png", { type: "image/png" });
    const second = new File(["b"], "b.jpg", { type: "image/jpeg" });
    const event = dropEvent([first, new File(["x"], "x.txt", { type: "text/plain" }), second]);
    act(() => result.current.handlers.onDrop(event));
    expect(receive).toHaveBeenCalledExactlyOnceWith([first, second]);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });
  it("does not replace a logo while uploads are disabled", () => {
    const receive = vi.fn();
    const { result } = renderHook(() => useImageDrop(receive, true));
    act(() => result.current.handlers.onDrop(dropEvent([new File(["a"], "a.png", { type: "image/png" })])));
    expect(receive).not.toHaveBeenCalled();
  });
  it("prevents dropped files outside upload targets from navigating away", () => {
    const { unmount } = renderHook(() => useImageDrop(vi.fn()));
    const event = new Event("drop", { cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"] } });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    unmount();
    const after = new Event("drop", { cancelable: true });
    Object.defineProperty(after, "dataTransfer", { value: { types: ["Files"] } });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});