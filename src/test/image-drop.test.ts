import { act, renderHook } from "@testing-library/react";
import type { DragEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { useImageDrop, useWindowImageDrop } from "@/hooks/use-image-drop";

function windowDrop(files: File[]) {
  const event = new Event("drop", { cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files, types: ["Files"], dropEffect: "none" } });
  return event;
}

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

describe("Page-wide image drops", () => {
  it("uploads images dropped anywhere on the page", () => {
    const receive = vi.fn();
    renderHook(() => useWindowImageDrop(receive));
    const file = new File(["a"], "a.png", { type: "image/png" });
    const event = windowDrop([file, new File(["x"], "x.txt", { type: "text/plain" })]);
    window.dispatchEvent(event);
    expect(receive).toHaveBeenCalledExactlyOnceWith([file]);
    expect(event.defaultPrevented).toBe(true);
  });
  it("ignores page drops while disabled and never navigates away", () => {
    const receive = vi.fn();
    renderHook(() => useWindowImageDrop(receive, true));
    const event = windowDrop([new File(["a"], "a.png", { type: "image/png" })]);
    window.dispatchEvent(event);
    expect(receive).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });
  it("shows the overlay while a file is dragged over the page and hides it after", () => {
    const { result } = renderHook(() => useWindowImageDrop(vi.fn()));
    const enter = new Event("dragenter", { cancelable: true });
    Object.defineProperty(enter, "dataTransfer", { value: { types: ["Files"] } });
    act(() => window.dispatchEvent(enter));
    expect(result.current).toBe(true);
    const leave = new Event("dragleave", { cancelable: true });
    Object.defineProperty(leave, "dataTransfer", { value: { types: ["Files"] } });
    act(() => window.dispatchEvent(leave));
    expect(result.current).toBe(false);
  });
});