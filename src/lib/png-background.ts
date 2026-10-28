// Composite black, antialiased logo pixels onto an opaque white background.
export function withWhiteBackground(pixels: Uint8ClampedArray) {
  const result = new Uint8ClampedArray(pixels);
  for (let i = 0; i < result.length; i += 4) {
    const alpha = (pixels[i + 3] ?? 0) / 255;
    for (let channel = 0; channel < 3; channel++) {
      result[i + channel] = (pixels[i + channel] ?? 0) * alpha + 255 * (1 - alpha);
    }
    result[i + 3] = 255;
  }
  return result;
}