import { expect, it } from "vitest";
import { coverageFromRgba, vectorizeDetailed } from "@/lib/vectorize";

// A dark disc whose bottom fades to a pale colour (like a shaded apple), with film grain,
// on a near-white background: the pale part must stay solid ink up to its crisp edge.
it("keeps a logo's pale, grainy part solid up to its real edge", () => {
  const W = 300, H = 300, cx = 150, cy = 150, R = 100;
  const rgba = new Uint8ClampedArray(W * H * 4);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const inside = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < R;
      // Top of the disc ~black, bottom only ~40% of the way from the background to black.
      const t = Math.min(1, Math.max(0, (y - (cy - R)) / (2 * R)));
      const v = inside ? 250 - (1 - t * 0.6) * 230 + rand() * 20 : 250 + rand() * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  const cov = coverageFromRgba(rgba, W, H);
  let wrong = 0, total = 0;
  for (let y = cy; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (Math.abs(d - R) < 2) continue; // the edge itself
      total++;
      if ((cov[y * W + x]! >= 0.5) !== d < R) wrong++;
    }
  expect(wrong / total).toBeLessThan(0.002);
  expect(vectorizeDetailed(cov, W, H)).toHaveLength(1);
});
