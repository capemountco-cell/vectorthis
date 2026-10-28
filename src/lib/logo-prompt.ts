// Reference order matches the multipart upload in the logo editor.
export type LogoMode = "replace" | "recreate" | "blend";

export const TIGHT_NESTING = "TIGHT NESTING: Keep the mirrored composition (180° rotational symmetry) and pull the elements together so they interlock into one compact, roughly square mark. Each element's inner edge must follow the contour of its neighbour (e.g. one note's head tucks into the curve beside the other note's stem), separated only by a single narrow channel of even width — about 4-6% of the mark's width, never wider than the narrowest gap in the original. No open empty space in the centre and no element drifting apart; the elements must never touch or merge.";


export const SHAPE_BRIEF_INSTRUCTIONS = [
  "You are briefing an image editor that will see ONLY Image A (the original logo), never Image B. Write a precise redesign brief (max 180 words) that turns Image A into a hybrid: keep Image A's exact composition (same number of separate elements, arrangement, orientation, mirrored/interlocking relationship, footprint, rounded geometry and stroke weight) and reshape EACH element so it takes on Image B's characteristic features.",
  "First list Image A's elements and their positions. Then name Image B's defining features (e.g. round note head, straight stem, curved flag). Then say, element by element, which part becomes which feature and where it sits. The result must still look like Image A's layout, not like Image B alone.",
  "Minimal change: keep each element's bold solid mass, thickness and footprint — do not thin elements into skinny lines. Map Image A's existing parts onto Image B's parts (e.g. a round bulb end becomes the head; a tapered body becomes a thick stem whose end flares into the flag).",
  TIGHT_NESTING,
  "Include the TIGHT NESTING requirement explicitly in the brief, with where each element's inner edge sits against the other. Output only the brief.",
].join("\n");

export function buildLogoPrompt(text: string, correction = "", mode: LogoMode = "replace", brief = "") {
  const glyphs = Array.from(text);
  const spelling = mode === "blend" ? [
    "HYBRID REDESIGN: Reshape the original logo's existing elements following the brief below. Keep the same number of separate elements, their arrangement, orientation, mirrored/interlocking relationship and overall footprint. Do not reduce it to a single standalone symbol.",
    `REDESIGN BRIEF: ${brief}`,
    "Keep the original's design language: bold solid mass, rounded geometry, stroke weight, corner treatment, symmetry and the same narrow gap between elements. Do not thin elements into skinny lines. Do not add text unless the original contains text.",
    "Remove the entire photo, scene, background and shadows. Convert everything to solid black even if the original is white or colored.",
  ].join("\n") : mode === "recreate" ? [
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
    : mode === "blend"
      ? "REFERENCE ROLES: Image 1 is the original uploaded logo and the authoritative style and composition reference. Transform it according to the redesign brief."
      : mode === "recreate"
        ? "REFERENCE ROLES: Image 1 is the original uploaded logo and the authoritative reference for all lettering and artwork. Faithfully recreate that same logo, removing only the background and converting the logo to black. Do not redesign or reinterpret it."
        : "REFERENCE ROLES: Image 1 is the original uploaded logo and the authoritative lettering reference. Recreate its logo with only the wordmark text replaced. Do not redesign or reinterpret the brand.";
  return [
    task,
    spelling,
    style,
    "OUTPUT: A flat solid pure black (#000000) logo on a plain pure white background, fully visible and centered with margin. No gradients, shadows, textures, mockups or extra elements.",
    mode === "blend"
      ? "FINAL CHECK BEFORE RETURNING: Count the separate elements and compare the layout against the original logo — they must match, with each element reshaped as the brief describes. Remove any background. Return only the image."
      : mode === "recreate"
        ? "FINAL CHECK BEFORE RETURNING: Compare all lettering and artwork directly against the original uploaded logo, never the draft. Restore every original glyph and detail, repair any style drift, and ensure no background remains. Corrections must not change the original wording or lettering style. Return only the image."
        : `FINAL CHECK BEFORE RETURNING: Read the rendered wordmark left to right and compare every character, case and space against ${JSON.stringify(text)} and the numbered inventory. Repair any extra, missing, repeated or swapped characters. Then compare lettering to the original reference and restore any style drift. Return only the image.`,
  ].join("\n\n");
}
