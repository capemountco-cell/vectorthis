import { useEffect, useRef, useState, type DragEvent } from "react";

const isFileDrag = (event: globalThis.DragEvent) => Boolean(event.dataTransfer?.types.includes("Files"));

/**
 * Drop images anywhere on the page. Local drop targets still win: their
 * React handlers stopPropagation, so these window listeners never see
 * drops that land on them.
 */
export function useWindowImageDrop(onFiles: (files: File[]) => void, disabled = false) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  useEffect(() => {
    const enter = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      depth.current += 1;
      if (!disabledRef.current) setDragging(true);
    };
    const over = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = disabledRef.current ? "none" : "copy";
    };
    const leave = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const drop = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (disabledRef.current) return;
      const images = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith("image/"));
      if (images.length) onFilesRef.current(images);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);
  return dragging && !disabled;
}

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