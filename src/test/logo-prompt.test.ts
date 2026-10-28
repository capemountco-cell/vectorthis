import { describe, expect, it } from "vitest";
import { buildLogoPrompt } from "@/lib/logo-prompt";

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