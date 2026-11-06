import { describe, expect, it } from "vitest";
import { addRecent, loadRecent } from "@/lib/recent";

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
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
});
