<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep logo edit instructions in the shared prompt builder, with reference roles matching upload order, so exact-text and correction fidelity rules can be regression-tested without live AI calls.
- Export saves distinguish mobile devices (including iPads with desktop user agents) from desktop computers: desktop downloads prepared Files via blob URLs, while mobile PNG saves synchronously invoke Web Share with explicit errors and no link fallback to avoid navigating away.
- Logo requests carry an explicit replacement or recreation mode through the shared prompt builder; both PNG backgrounds are rendered from the same traced vector before saving (renderPngPair), and other PNG sizes are prepared when picked, so a save tap never awaits work before native sharing.
- Shape-reshape mode first has a vision model write a text brief from both images, then sends only the original logo to the image editor, so it cannot copy the shape reference; uploads are flattened onto white first because transparency reads as solid black.
- Batch jobs snapshot their inputs and own their stream, abort controller, progress, and prepared exports; no shared busy flag or task count cap may serialize or overwrite independent results.
- Upload targets share useImageDrop for drag highlighting, image filtering, disabled-state handling, and file-drop navigation prevention; drops reuse the file-picker callbacks so task behavior stays identical.
- SVG export uses the in-house sub-pixel vectorizer in src/lib/vectorize.ts (auto ink/background detection incl. transparency, marching squares, corner sharpening, straight-line detection, cubic fitting at 0.35px, axis/edge alignment); keep it DOM-free so accuracy stays regression-tested against synthetic shapes and the real fixture in src/test/fixtures.
- "Exact trace" mode is client-only (TaskMode, not LogoMode): it vectorizes the untouched upload, keeps transparency, skips flattening and the AI, and renders PNGs from the vector when the source is under 1024px.
- AI redraw fidelity: clean uploads are sent as a 1024px black rendering of their exact trace (reference-prep.ts), with measured geometry passed as the "geometry"/"reference" form fields into the shared prompt builder (GEOMETRY LOCK for recreate only); recreate results show a shape-match score (hard IoU of normalized outlines, warn below 95%).
- UI: the single page moves start → processing → result workspace (src/components/app). The app starts on Exact trace (DEFAULT_TASK_MODE); DEFAULT_LOGO_MODE stays the default AI mode. The workspace draws the logo from parsed outlines (outline.ts), never injected SVG markup. Recent results live only in localStorage (recent.ts), every access guarded.
- Exact traces go through vectorizeDetailed: blurry uploads (edgeSoftness > 1.3) get looser fitting and stronger smoothing so edge noise does not become scallops; crisp small crops are bicubic-upsampled (≈3000px long side) before tracing and scaled back, because tiny lettering gave the fitter too few points and produced spikes/wobble.
