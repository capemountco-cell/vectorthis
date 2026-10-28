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
- Logo requests carry an explicit replacement or recreation mode through the shared prompt builder; prepare both PNG backgrounds from the same cropped pixels before saving so background changes never require inference or delay native sharing.
- Shape-reshape mode first has a vision model write a text brief from both images, then sends only the original logo to the image editor, so it cannot copy the shape reference; uploads are flattened onto white first because transparency reads as solid black.
