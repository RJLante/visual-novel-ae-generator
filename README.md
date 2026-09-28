# Visual Novel AE Generator

A personal tool for turning visual-novel UI assets and a structured script into an editable Adobe After Effects project.

## Goal

Input:

- UI image assets: backgrounds, dialogue boxes, buttons, cursor, and related elements.
- A structured script containing narration, dialogue, choices, and scene transitions.

Output:

- An After Effects project that can be refined by hand.
- Separate, meaningfully named layers and compositions for backgrounds, UI, text, and choices, so effects, color, graphics, and audio can be added later.

The first version does **not** need character animation, intermediate story illustrations, a video renderer, or a general-purpose visual editor.

## First-version scope

1. Define and validate a small, documented script format.
2. Import UI image assets and place them in a fixed-size composition.
3. Animate dialogue with a typewriter effect; support narration and speaker names.
4. Reveal choices and switch scenes according to the script timeline.
5. Generate an editable AE project using a reproducible workflow.
6. Include a tiny sample script, placeholder assets where needed, and instructions for opening and checking the result in After Effects.

## Implementation guidance

Before coding the generator, write a short design note explaining the selected AE project-generation method (for example, an AE script executed by After Effects), its platform and version assumptions, and how users run it. Prefer a reliable, editable native workflow over reverse-engineering the binary `.aep` format. Keep script parsing and timeline planning separate from AE-specific output. Document any required manual steps honestly.

Do not commit licensed UI artwork, credentials, or proprietary scripts. Use original placeholder assets for the example.

## First Codex task

Design and implement the smallest end-to-end proof of concept: one background, one dialogue box, two dialogue lines with typewriter animation, and two choices appearing at the end. Deliver the source files, sample input, setup instructions, and a concise account of what was actually tested. If After Effects is unavailable in the coding environment, test the parser and generated script as far as possible and state that the AE import still needs local verification.
