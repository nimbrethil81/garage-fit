# PickSetGo agent instructions

PickSetGo is a dependency-free browser PWA in `nimbrethil81/garage-fit`.

## Scope and delivery

- Refresh `main` and read the complete approved issue, addenda, dependencies and applicable instructions. Inspect the relevant implementation, tests and contracts. Ask whether two reasonable implementations could materially differ in behaviour or acceptance. Resolve routine choices from approved evidence. Stop the affected work for a material ambiguity, scope, safety or compatibility conflict.
- GitHub Issues own approved requirements. Code, tests, schemas and configuration own executable behaviour. Read the domain documentation relevant to the change. Preserve established behaviour, stable IDs, saved-record contracts and released definitions unless expressly superseded. Prefer general rules and existing intrinsic metadata, and keep the app dependency-free.
- With implementation authority, branch from current `main`, implement, validate, commit, push and create one PR to `main`. Put relevant evidence and limitations in the PR and stop. Skip routine implementation or release reports, roadmap logs and retrospectives. Merge, auto-merge, hosted changes and deployment each require applicable explicit authority. Respect required checks and independent review. Check whether merge would publish and keep unrelated work untouched.
- Check prior correction usage. Allow at most two autonomous diagnose → bounded correction → focused retest cycles per issue across sessions and PRs. At exhaustion preserve the evidence and seek authority for further corrections. Classify test failures before changing expectations. Keep meaningful counterexamples and avoid blind snapshot updates.

## Product and implementation safeguards

- Follow [exercise metadata and editorial rules](data/EXERCISE_METADATA.md) for catalogue work. Preserve safe eligibility, phase reachability and protocol feasibility. Treat released programme, workout-family and mapping versions as immutable. Keep progression idempotent, save results before updating state and clear drafts only after durable reconciliation. Keep exclusive backup locking, journal/reserve, checksums and non-destructive failure intact.
- For shared UI, reuse existing patterns, theme tokens and navigation. Primary tabs use `js/masthead.js`, `data-masthead`, `showScreen()` and `#bottomNav`; extend `tests/primary-masthead.test.js` for a new tab. More information list/detail views follow Exercise Library cards, shared back/swipe navigation and `info-detail` spacing. Settings, forms and equipment management use their own established patterns. Keep choices scannable, distinguish controls from information, and use restrained colour with text, keyboard access and visible focus.
- Keep player changes within the [shared viewport and audio contract](docs/PLAYER_VIEWPORT.md). Put immediate exercise, target, timer and brief actionable status inline; use existing details for longer instructions. Preserve accessible focus and controls, safe areas and all workout progression/evidence. For material UI changes, use accessible approved references and inspect comparable rendered states, including relevant mobile sizes, modes and interactions.
- Check first-use guidance when it could change. New users can explore, optionally configure equipment, complete a workout and understand what was saved without an account or programme. Check FAQ accuracy when impact warrants it. Substantive FAQ, About and Help edits require explicit approval (#375).
- Preserve GitHub Pages front matter and `site.github.build_revision` in `index.html` and `css/player-layout.css`. Use `python3 scripts/preview_server.py` for browser previews. About and the rendered CSS identify the build actually loaded on the device.

## Validation

- Run the smallest meaningful targeted checks first. Documentation changes need proportionate reference and contract checks. Automatic Fast CI runs on PRs to `main`; preserve it.
- Run Fast before PR for isolated low-risk UI, copy and player layout changes. Run Full for Generator, Coach construction, exercise eligibility, protocol or persistence contract changes. Catalogue batches and material generator-policy changes also need the separate exhaustive reachability audit. New exercises need bounded deterministic reachability for every flagged generated phase.
- Fast: `node --test --test-skip-pattern='\[Full\]' tests/*.test.js`.
  Full: `node --test tests/*.test.js`.
  Audit: `node scripts/audit-exercise-reachability.js` (outside both tiers).
- Tests are Fast by default. Mark expensive sweeps `[Full]` only when they cover a distinct risk beyond cheaper representative cases. Use small deterministic fixtures and explain a new Full-only sweep in the PR. Run costly suites near readiness and repeat for relevant changes or diagnosis. Keep essential safety, construction and persistence checks.

## Documentation and external evidence

Update docs for enduring implementation-critical facts or procedures, or when expressly
requested. Keep one current owner per contract. Use Issues, PRs and Git history for
completed work. This file is the sole standing agent entry. After material edits, check
the size and loading headroom of applicable instructions for the tools in use.

Drive is owner-managed and read-only by default. Use only specific required references
with verified access. Routine searching, maintenance and synchronisation are outside
implementation scope. Drive updates require explicit Issue authority. Bring necessary
unauthorised changes to the owner and keep private evidence out of public issues and PRs.
