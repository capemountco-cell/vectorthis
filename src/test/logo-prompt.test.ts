import { describe, expect, it } from "vitest";
import { ARTWORK_FIDELITY, buildLogoPrompt, SHAPE_BRIEF_INSTRUCTIONS, SHAPE_FIDELITY, TIGHT_NESTING } from "@/lib/logo-prompt";

describe("Logo recreation requirements", () => {
  it("recreates original lettering and artwork without replacement text", () => {
    const prompt = buildLogoPrompt("", "", "recreate");
    expect(prompt).toContain("without replacing any text");
    expect(prompt).toContain("If there is no text, reproduce only the original artwork");
    expect(prompt).toContain("Convert the logo itself to solid black");
    expect(prompt).toContain("Remove the entire photo, scene, surface, background");
    expect(prompt).not.toContain("REQUIRED WORDMARK:");
  });

  it("corrects recreation using the original without inventing replacement wording", () => {
    const prompt = buildLogoPrompt("", "restore the curve", "recreate");
    expect(prompt).toContain("Image 1 is the generated draft to correct. Image 2 is the original uploaded logo");
    expect(prompt).toContain("Corrections must not change the original wording or lettering style");
    expect(prompt).not.toContain("REQUIRED WORDMARK:");
  });
  it("preserves exact replacement case instead of matching the original case", () => {
    const prompt = buildLogoPrompt("Bridgt");
    expect(prompt).toContain('REQUIRED WORDMARK: "Bridgt". Render it exactly once.');
    expect(prompt).toContain('1="B"; 2="r"; 3="i"; 4="d"; 5="g"; 6="t"');
    expect(prompt).toContain("Never change its case to match the original");
  });

  it("preserves repeated letters, internal spaces and punctuation in the inventory", () => {
    const prompt = buildLogoPrompt("Aa  ll!");
    expect(prompt).toContain('REQUIRED WORDMARK: "Aa  ll!"');
    expect(prompt).toContain('1="A"; 2="a"; 3=" "; 4=" "; 5="l"; 6="l"; 7="!"');
  });

  it("uses the original, not the draft, as the correction lettering authority", () => {
    const prompt = buildLogoPrompt("Bridgt", "fix the second letter");
    expect(prompt).toContain("Image 1 is the generated draft to correct. Image 2 is the original uploaded logo");
    expect(prompt).toContain("sole source of lettering style, never the generated draft");
    expect(prompt).toContain("local edit to the draft, not a new redesign");
    expect(prompt).toContain('REQUESTED CORRECTION: "fix the second letter"');
    expect(prompt).toContain("required wordmark and original style take priority");
  });
});
describe("Shape hybrid", () => {
  it("editor gets only the original plus a text brief, never the shape image", () => {
    const prompt = buildLogoPrompt("", "", "blend", "turn each half into a note");
    expect(prompt).toContain("REDESIGN BRIEF: turn each half into a note");
    expect(prompt).toContain("same number of separate elements");
    expect(prompt).not.toContain("Image 2");
  });
  it("brief writer must map each original element to the reference features", () => {
    expect(SHAPE_BRIEF_INSTRUCTIONS).toContain("will see ONLY Image A");
    expect(SHAPE_BRIEF_INSTRUCTIONS).toContain("element by element");
  });
  it("both AI steps require the mirrored elements to nest with one narrow gap", () => {
    const prompt = buildLogoPrompt("", "", "blend", "brief");
    for (const text of [prompt, SHAPE_BRIEF_INSTRUCTIONS]) {
      expect(text).toContain(TIGHT_NESTING);
    }
    expect(TIGHT_NESTING).toContain("mirrored composition");
    expect(TIGHT_NESTING).toContain("never wider than the narrowest gap in the original");
    expect(TIGHT_NESTING).toContain("must never touch or merge");
    expect(prompt).toContain("move them closer until only one narrow, even channel separates them");
  });
});

describe("Redraw fidelity", () => {
  const geometry = "Overall width:height = 1.01. Only 2 rounded corners: top-left; top-right.";
  it("locks recreate to the measured geometry and re-checks it", () => {
    const prompt = buildLogoPrompt("", "", "recreate", "", { geometry, tracedReference: true });
    expect(prompt).toContain(SHAPE_FIDELITY);
    expect(prompt).toContain(`GEOMETRY LOCK (measured from a precise vector trace of the original; the result must match every point): ${geometry}`);
    expect(prompt).toContain("Re-check every GEOMETRY LOCK fact");
    expect(prompt).toContain("Image 1 is a clean, high-resolution black rendering of the original logo");
  });
  it("points the traced-reference note at the original, which is Image 2 during corrections", () => {
    const prompt = buildLogoPrompt("", "straighten the edge", "recreate", "", { geometry, tracedReference: true });
    expect(prompt).toContain("Image 2 is a clean, high-resolution black rendering");
    expect(prompt).toContain("GEOMETRY LOCK");
  });
  it("keeps icons exact in change-text mode without locking the new wordmark's proportions", () => {
    const prompt = buildLogoPrompt("Acme", "", "replace", "", { geometry });
    expect(prompt).toContain(ARTWORK_FIDELITY);
    expect(prompt).not.toContain("GEOMETRY LOCK");
    expect(prompt).not.toContain(SHAPE_FIDELITY);
  });
  it("leaves shape hybrids free to reshape", () => {
    const prompt = buildLogoPrompt("", "", "blend", "brief", { geometry });
    expect(prompt).not.toContain("GEOMETRY LOCK");
    expect(prompt).not.toContain(SHAPE_FIDELITY);
  });
  it("caps client-supplied geometry and omits notes it wasn't given", () => {
    const prompt = buildLogoPrompt("", "", "recreate", "", { geometry: "x ".repeat(5000) });
    expect(prompt.length).toBeLessThan(buildLogoPrompt("", "", "recreate").length + 1800);
    expect(buildLogoPrompt("", "", "recreate")).not.toContain("REFERENCE QUALITY");
    expect(buildLogoPrompt("", "", "recreate")).not.toContain("\n\n\n");
  });
});
