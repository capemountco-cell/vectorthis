// Reference order matches the multipart upload in the logo editor.
export type LogoMode = "replace" | "recreate";

export function buildLogoPrompt(text: string, correction = "", mode: LogoMode = "replace") {
  const glyphs = Array.from(text);
  const spelling = mode === "recreate" ? [
    "ORIGINAL CONTENT IS AUTHORITATIVE: Recreate the original uploaded logo without replacing any text. Preserve every original character, case, space, punctuation mark, repeated letter and its position. If there is no text, reproduce only the original artwork; do not invent a wordmark.",
    "Preserve all original logo symbols, silhouettes, proportions and negative spaces. Remove the entire photo, scene, surface, background and any shadows behind the logo. Convert the logo itself to solid black even if the original logo is white or colored. Do not redraw background objects as part of the logo.",
  ].join("\n") : [
    `REQUIRED WORDMARK: ${JSON.stringify(text)}. Render it exactly once.`,
    `The replacement contains ${glyphs.length} characters. Ordered character inventory: ${glyphs.map((glyph, index) => `${index + 1}=${JSON.stringify(glyph)}`).join("; ")}.`,
    "The replacement text is authoritative, including its uppercase/lowercase, spaces, punctuation and repeated letters. Never change its case to match the original. Do not autocorrect, translate, expand abbreviations or substitute a familiar brand name. Do not retain any original wording or add any other text.",
    "Construct each character separately in that order; keep adjacent letters distinguishable. Ligatures and decorative strokes must not hide, merge, duplicate or resemble an extra letter. Adapt the overall wordmark width to fit the new text rather than squeezing, omitting or distorting characters.",
  ].join("\n");
  const style = [
    "LETTERING REFERENCE: The original uploaded logo is the sole source of lettering style, never the generated draft. Inspect its actual letterforms rather than substituting a similar stock font.",
    "Retain the original stroke weight and contrast, slant, baseline, x-height, cap height, proportions, curves, corners, terminals, negative spaces and spacing rhythm. Reuse original glyph shapes when the same character and case appear; construct missing glyphs and different-case glyphs with the same design language. Preserve non-text icons and decorative details and their relationship to the wordmark. Ignore the photo or background behind the original logo.",
  ].join("\n");
  const task = correction
    ? `REFERENCE ROLES: Image 1 is the generated draft to correct. Image 2 is the original uploaded logo and the authoritative lettering reference.\nREQUESTED CORRECTION: ${JSON.stringify(correction)}. Apply this as a local edit to the draft, not a new redesign. Preserve already-correct glyphs, layout and decoration; repair the affected letter(s) using Image 2's design language, not malformed shapes from Image 1. If the correction conflicts with the required wordmark or the original lettering style, the required wordmark and original style take priority.`
    : mode === "recreate"
      ? "REFERENCE ROLES: Image 1 is the original uploaded logo and the authoritative reference for all lettering and artwork. Faithfully recreate that same logo, removing only the background and converting the logo to black. Do not redesign or reinterpret it."
      : "REFERENCE ROLES: Image 1 is the original uploaded logo and the authoritative lettering reference. Recreate its logo with only the wordmark text replaced. Do not redesign or reinterpret the brand.";
  return [
    task,
    spelling,
    style,
    "OUTPUT: A flat solid pure black (#000000) logo on a plain pure white background, fully visible and centered with margin. No gradients, shadows, textures, mockups or extra elements.",
    mode === "recreate"
      ? "FINAL CHECK BEFORE RETURNING: Compare all lettering and artwork directly against the original uploaded logo, never the draft. Restore every original glyph and detail, repair any style drift, and ensure no background remains. Corrections must not change the original wording or lettering style. Return only the image."
      : `FINAL CHECK BEFORE RETURNING: Read the rendered wordmark left to right and compare every character, case and space against ${JSON.stringify(text)} and the numbered inventory. Repair any extra, missing, repeated or swapped characters. Then compare lettering to the original reference and restore any style drift. Return only the image.`,
  ].join("\n\n");
}