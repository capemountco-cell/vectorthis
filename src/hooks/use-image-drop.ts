import { useEffect, useRef, useState, type DragEvent } from "react";

export function useImageDrop(onFiles: (files: File[]) => void, disabled = false) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    // Never let dropping a file navigate the browser away from the app.
    const preventFileNavigation = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", preventFileNavigation);
    window.addEventListener("drop", preventFileNavigation);
    return () => {
      window.removeEventListener("dragover", preventFileNavigation);
      window.removeEventListener("drop", preventFileNavigation);
    };
  }, []);
  const isFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
  return {
    dragging: dragging && !disabled,
    handlers: {
      onDragEnter(event: DragEvent) {
        if (!isFiles(event)) return;
        event.preventDefault(); event.stopPropagation();
        depth.current += 1;
        if (!disabled) setDragging(true);
      },
      onDragOver(event: DragEvent) {
        if (!isFiles(event)) return;
        event.preventDefault(); event.stopPropagation();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      },
      onDragLeave(event: DragEvent) {
        event.preventDefault(); event.stopPropagation();
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      },
      onDrop(event: DragEvent) {
        event.preventDefault(); event.stopPropagation();
        depth.current = 0; setDragging(false);
        if (disabled) return;
        const images = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/"));
        if (images.length) onFiles(images);
      },
    },
  };
}