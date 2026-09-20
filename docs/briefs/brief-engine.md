# Mission: RobotArena pixel-art overhaul — ENGINE track

You are an autonomous build agent working in `/Users/stefan/dev/robotarena` (HEAD `c5487b0`).
The owner (Stefan) said: "make all the changes, review them yourself... go build a cool game."
You have full authority to make art/engineering judgment calls within the spec below.
When the spec leaves a detail open, choose the cooler option and note it in your final report.

## Read first (in this order)

1. `docs/PIXELART_BUILD_GUIDE.md` — the full spec. Follow it exactly unless this brief overrides.
2. `docs/COMPLEXITY_PLAN.md` — context only. **Do NOT touch** `src/sim/`, `src/robots/`,
   `src/engine*`, `tools/eval*`, `tools/hillclimb/`, or any replay/codec/fingerprint surface.
   That plan is a separate track. Your `BattleScene.ts` changes must be **rendering-only**
   (sprite frames, shadows, overlays) — never sim logic, never sense/event changes.
3. `docs/art-evidence/art_analysis.md` — repo-specific findings from the art audit.

## Owner decisions (already made — do not re-ask)

1. Slate-blue shadows ARE allowed (cool blue-gray shadow ramps). Pure purple stays banned.
2. Rotation: **8 baked direction frames**, no runtime `setRotation()` on pixel sprites.
3. Team color: **trim/lens accents only** via a NEW palette char `t` (amber for team 0,
   cyan for team 1). Full-hull team flood is removed; `w` becomes neutral steel gray.
4. Robot scale stays 2× (32px) for now — do not rescale.

## Your branch and files (DO NOT touch other tracks' files)

- Branch: `git checkout -b pixelart/engine` (from HEAD, do not push)
- YOU OWN: `src/game/art.ts`, `src/game/scenes/BattleScene.ts`,
  `docs/ART_STYLE_GUIDE.md` (new), `tools/art-qa.mjs` (new), `package.json` (one-line script add only)
- READ-ONLY: everything else, especially `src/game/art/*.ts` (other tracks edit those)
- NEVER touch: `dist/`, `eval/`, sim/robot/eval tools listed above

## Contract with the other two tracks (running in parallel)

- The **sprites** track will use your new `t` char in `chassis.ts` pixel maps and the
  Phase-3.1 shadow chars from the guide's palette table. You must add **exactly** the
  chars/hexes the guide's palette table specifies — no more, no less.
- Merge order will be engine → sprites → world, so your palette work lands first.
- If the guide's palette table is ambiguous, decide, document in `docs/ART_STYLE_GUIDE.md`,
  and print the decision in your final report.

## Work (follow the guide's phases; commit after each phase)

### Phase 0 — style guide + QA script
- Write `docs/ART_STYLE_GUIDE.md`: palette table + char legend, 1px outline rule,
  top-left lighting rule, team-color rule (`t` = trim/lens only), banned list
  (pure `#000000`, purple — with the slate-blue exception noted), per-sprite color
  budgets, rotation rule (8 baked frames; `setRotation` forbidden on pixel sprites),
  floor/border rules, QA checklist.
- Write `tools/art-qa.mjs` (plain node, no build step): parse `src/game/art/*.ts` as
  text, extract the `string[]` maps, and check: every char used exists in the `art.ts`
  palette; no banned hexes; rectangular maps (equal row lengths); per-sprite color
  count within budget. Report failures as `file:line` and exit non-zero on failure.
- Add `"art:qa": "node tools/art-qa.mjs"` to package.json scripts. Run it.

### Phase 1 — kill `setRotation`, bake 8 direction frames, trim-only team tint
- In `src/game/art.ts`: add `t` to the palette. Reuse the existing team logic from
  `bakeTeamChassis()` (amber vs cyan per team) but apply it to `t` only.
  `w` renders as neutral steel gray from now on.
- Bake 8 direction frames per robot chassis (0°, 45°, …, 315°) at texture-bake time.
  Follow the guide's specified rotation technique; clean up diagonal jaggies by hand
  in the baked output if the technique is nearest-neighbor.
- In `BattleScene.ts`: find EVERY `setRotation()` call on pixel-art sprites and replace
  with nearest-of-8 frame selection. Turret barrels: follow the guide (finer rotation
  only if the guide explicitly allows it for sub-parts).
- Any bake-time noise/variation MUST use a seeded PRNG (e.g. mulberry32 with a fixed
  seed) — never `Math.random`. Startup art must be pixel-identical every boot.

### Phase 3.1 — palette hue-shift
- Update shadow-ramp hexes in the `art.ts` palette toward cool slate-blue per the
  guide's palette table. Light ramps shift warm. Purple stays banned.

### Phase 4 (your parts) — contact shadows, damage, floor overlay
- Contact shadow: bake a dithered soft-ellipse shadow texture; render under every
  robot in `BattleScene.ts` at low alpha, tracking x/y. Pixel-styled (no blur filter
  — dithered dots), subtle.
- Damage: implement/upgrade the damage stamp or scorch overlay applied to robots at
  low HP per the guide. Rendering-only.
- Floor overlay: tone down `floorOverlay` alpha per the guide.

### Phase 2 (your part)
- Any `art.ts`-side floor support the world track needs is already in `floor.ts`
  (their file) — you only handle the overlay alpha above. Skip if nothing needed.

## Validation (every phase, before commit)

1. `npx tsc --noEmit -p tsconfig.json` — must pass.
2. `npm run build-nolog` — must succeed (skip only if it was already broken on HEAD;
   verify by stashing if unsure).
3. `npm run art:qa` — your files must pass; pre-existing failures elsewhere: report,
   don't fix (other tracks own those files).
4. Self-review the art: write a tiny node script that prints any `string[]` map to the
   terminal at 4–8× using ANSI background-color blocks (map chars → palette hex),
   then eyeball silhouettes, outlines, and shading. Check: readable silhouette at
   1×, no stray single-pixel noise, 1px outlines intact, team `t` accents visible but
   small, shadows cool blue-gray.

## Commit + report

- Commit per phase: `pixelart(engine): phase N - <what>`. Do NOT push.
- When all phases are done, print a FINAL REPORT: phases completed, files changed,
  commits (hashes), validation results, art decisions you made, and anything the
  sprites/world tracks or Stefan should know. Then stop and wait.
