# The Cloud Corner — project notes for Claude

## Writing & UI copy: no fluff

Write only text that serves a function. Do not add decorative or "cute" copy.

- **No subtitles / taglines** under headings or titles unless they carry real,
  necessary information (a heading usually stands on its own).
- **No example placeholders.** Don't put `e.g. …` / sample-value text in inputs —
  the field's label already says what it's for. Leave inputs without a `placeholder`
  unless one is genuinely needed for clarity (e.g. a format like `YYYY-MM-DD`).
- **No filler words or flourishes** in labels/UI — avoid "a little", "fluffy",
  "your memories", decorative emoji, and marketing-style prose. Use plain, direct
  nouns: `Caption`, `Letter (optional)`, `Album name`.
- **Keep genuinely functional guidance**: field labels, real constraints (e.g. file
  size limits), factual empty states ("No photos yet."), and actionable hints that
  are the only affordance for a control. Cut everything else.
- Default to **terse and plain** over friendly/verbose. When in doubt, leave it out.

Applies to all HTML, UI strings, and code comments in this repo.
