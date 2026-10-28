import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LOGO_MODE, executeLogoTask, type LogoTaskDependencies } from "@/lib/logo-task";

const options = { mode: DEFAULT_LOGO_MODE, text: "", shape: null, provider: "openai" as const };
const file = (name: string) => new File([name], name, { type: "image/png" });

describe("Independent logo tasks", () => {
  it("defaults to recreate without replacement text", async () => {
    expect(DEFAULT_LOGO_MODE).toBe("recreate");
    const stream = vi.fn(async (form: FormData, frame: (src: string, final: boolean) => void) => {
      expect(form.get("mode")).toBe("recreate");
      expect(form.get("text")).toBe("");
      frame("logo", true);
    });
    expect(await executeLogoTask(file("a"), options, new AbortController().signal, () => {}, { flatten: async (f) => f, stream, prepare: async (src) => src })).toBe("logo");
  });

  it("starts every task concurrently without an app-imposed count limit and preserves out-of-order results", async () => {
    const finish: Array<() => void> = [];
    const dependencies: LogoTaskDependencies<string> = {
      flatten: async (f) => f,
      stream: (form, frame) => new Promise((resolve) => {
        const name = (form.get("image") as File).name;
        finish.push(() => { frame(name, true); resolve(); });
      }),
      prepare: async (src) => src,
    };
    const tasks = Array.from({ length: 40 }, (_, i) => executeLogoTask(file(`${i}.png`), options, new AbortController().signal, () => {}, dependencies));
    await vi.waitFor(() => expect(finish).toHaveLength(40));
    finish.reverse().forEach((resolve) => resolve());
    expect(await Promise.all(tasks)).toEqual(Array.from({ length: 40 }, (_, i) => `${i}.png`));
  });

  it("a failed task does not prevent another task from finishing", async () => {
    const dependencies: LogoTaskDependencies<string> = {
      flatten: async (f) => f,
      stream: async (form, frame) => {
        if ((form.get("image") as File).name === "bad") throw new Error("Rate limited");
        frame("good output", true);
      },
      prepare: async (src) => src,
    };
    const results = await Promise.allSettled(["bad", "good"].map((name) => executeLogoTask(file(name), options, new AbortController().signal, () => {}, dependencies)));
    expect(results[0]?.status).toBe("rejected");
    expect(results[1]).toEqual({ status: "fulfilled", value: "good output" });
  });

  it("cancelling one task leaves another task running", async () => {
    const abort = new AbortController();
    const prepare = vi.fn(async (src: string) => src);
    const dependencies: LogoTaskDependencies<string> = {
      flatten: async (f) => f,
      stream: async (form, frame) => {
        const name = (form.get("image") as File).name;
        if (name === "cancel") abort.abort();
        frame(name, true);
      },
      prepare,
    };
    const results = await Promise.allSettled([executeLogoTask(file("cancel"), options, abort.signal, () => {}, dependencies), executeLogoTask(file("continue"), options, new AbortController().signal, () => {}, dependencies)]);
    expect(results[0]?.status).toBe("rejected");
    expect(results[1]).toEqual({ status: "fulfilled", value: "continue" });
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});