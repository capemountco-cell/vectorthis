import { expect, it } from "vitest";
import { withWhiteBackground } from "@/lib/png-background";

it("keeps the logo black and makes the PNG background opaque white without changing transparent pixels", () => {
  const transparent = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 128]);
  expect(Array.from(withWhiteBackground(transparent))).toEqual([255, 255, 255, 255, 0, 0, 0, 255, 127, 127, 127, 255]);
  expect(Array.from(transparent)).toEqual([0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 128]);
});