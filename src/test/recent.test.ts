import { describe, expect, it } from "vitest";
import { addRecent, clearRecent, loadRecent, removeRecent } from "@/lib/recent";

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}
const svg = '<svg viewBox="0 0 1 1"><path d="M0 0L1 1Z"/></svg>';

describe("recent logos", () => {
  it("keeps the newest first, replaces same-name entries and caps the list", () => {
    const store = memory();
    for (let i = 0; i < 10; i++) addRecent({ name: `logo-${i}`, mode: "trace", svg }, store);
    addRecent({ name: "logo-9", mode: "trace", svg }, store);
    const list = loadRecent(store);
    expect(list).toHaveLength(8);
    expect(list[0]!.name).toBe("logo-9");
    expect(list.filter((r) => r.name === "logo-9")).toHaveLength(1);
  });

  it("works without storage and ignores corrupt data", () => {
    expect(loadRecent(undefined)).toEqual([]);
    expect(loadRecent({ getItem: () => "{not json" })).toEqual([]);
    expect(loadRecent({ getItem: () => JSON.stringify([{ name: 1 }, { id: "a", name: "x", mode: "trace", svg: "<script>", createdAt: 1 }]) })).toEqual([]);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    // Blocked storage: still usable for this session.
    expect(addRecent({ name: "a", mode: "trace", svg }, throwing).map((r) => r.name)).toEqual(["a"]);
  });

  it("deletes one saved logo or clears them all", () => {
    const store = memory();
    addRecent({ name: "a", mode: "trace", svg }, store);
    addRecent({ name: "b", mode: "trace", svg }, store);
    const [b, a] = loadRecent(store);
    expect(removeRecent(b!.id, undefined, store).map((r) => r.name)).toEqual(["a"]);
    expect(loadRecent(store).map((r) => r.id)).toEqual([a!.id]);
    expect(removeRecent("missing", undefined, store)).toHaveLength(1);
    expect(clearRecent(store)).toEqual([]);
    expect(loadRecent(store)).toEqual([]);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    // Blocked storage: deletes from the list on screen.
    const onScreen = [{ id: "k", name: "keep", mode: "trace", svg, createdAt: 1 }, { id: "x", name: "drop", mode: "trace", svg, createdAt: 2 }];
    expect(removeRecent("x", onScreen, throwing).map((r) => r.name)).toEqual(["keep"]);
    expect(clearRecent(throwing)).toEqual([]);
  });
});
