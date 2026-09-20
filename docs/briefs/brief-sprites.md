# Mission: RobotArena pixel-art overhaul — SPRITES track

You are an autonomous build agent working in `/Users/stefan/dev/robotarena` (HEAD `c5487b0`).
The owner (Stefan) said: "make all the changes, review them yourself... go build a cool game."
You have full authority to make art judgment calls within the spec below.
When the spec leaves a detail open, choose the cooler option and note it in your final report.

## Read first (in this order)

1. `docs/PIXELART_BUILD_GUIDE.md` — the full spec. Follow it exactly unless this brief overrides.
2. `docs/COMPLEXITY_PLAN.md` — context only. **Do NOT touch** `src/sim/`, `src/robots/`,
   `src/engine*`, `tools/eval*`, `tools/hillclimb/`, or any replay/codec/fingerprint surface.
   You work purely in pixel-map data files; no scene or engine code.
3. `docs/art-evidence/art_analysis.md` — repo-specific findings from the art audit.

## Owner decisions (already made — do not re-ask)

1. Slate-blue shadows ARE allowed (cool blue-gray shadow ramps). Pure purple stays banned.
2. Rotation: 8 baked direction frames (the **engine** track implements the baking).
3. Team color: **trim/lens accents only** via the NEW palette char `t` (amber team 0 /
   cyan team 1 — the engine track adds it to the `art.ts` palette). `w` is now neutral
   steel gray. Your job: decide WHICH pixels become `t`.
4. Robot scale stays 2× (32px) — do not rescale.

## Your branch and files (DO NOT touch other tracks' files)

- Branch: `git checkout -b pixelart/sprites` (from HEAD, do not push)
- YOU OWN: `src/game/art/chassis.ts`, `src/game/art/towers.ts`,
  `src/game/art/wrecks.ts`, `src/game/art/anim.ts`
- READ-ONLY: `src/game/art.ts` (read the palette so you use valid chars — NEVER edit it),
  everything else.
- NEVER touch: `dist/`, `eval/`, sim/robot/eval tools.

## Contract with the engine track (running in parallel)

- The engine track adds to the `art.ts` palette **exactly** the chars/hexes in the
  guide's Phase-3.1 palette table, including `t` (team trim) and the slate-blue shadow
  chars. You may use **only** chars from that table. Do not invent new chars.
- If you need a char that isn't in the table, do NOT edit `art.ts` — note it in your
  final report instead.
- Merge order is engine → sprites → world, so the palette lands before your maps do.
  (Your branch can use `t` immediately; it resolves at merge.)

## Work (follow the guide's phases; commit after each phase)

### Phase 1.2 — team tint: `w` → `t` on trim/lens ONLY
- Current chassis maps flood the hull with `w` (old team color). After the engine change,
  `w` renders as steel gray and `t` renders as the team color.
- For EVERY chassis map: keep the hull body as `w` (now steel — correct), and convert
  ONLY trim strips, cockpit lens, and small accent pixels to `t`. Design the trim so
  each robot reads clearly as its team at 1×: a visor/cockpit stripe plus 1–2 trim
  lines is the pattern. No large `t` areas — accents, not paint jobs.

### Phase 3 — shading, specular, AO, tower redesign
- Shading pass on all chassis maps: hue-shifted ramps — highlights toward warm
  off-white, shadows toward the new slate-blue shadow chars (per the guide's palette
  table). Add specular dots on canopies/lenses, 1px ambient-occlusion darkening where
  parts meet (turret base, tread tops). Keep the 1px outline rule and top-left light.
- Towers (`towers.ts`): the light/heavy/twin towers currently share a silhouette.
  Redesign to THREE instantly-distinguishable silhouettes, e.g. light = slim mast +
  antenna, heavy = wide fortified block + thick barrel, twin = split dual barrels.
  Same 16×16 canvas, same palette discipline, unmistakable at 1×.

### Phase 4 — wrecks
- Redraw wrecks (`wrecks.ts`): 3 visually DISTINCT wreck variants (not palette swaps) —
  different broken silhouettes, exposed internals, scattered panels. They should read
  as "dead robot", never as a live one.

### Phase 6 — animation
- `anim.ts`: tread rework (treads that read as moving), a short death-sequence frame
  set per the guide, and any idle-bob frames the guide specifies. If idle bob needs
  scene-code support, implement the frames and note the hook needed in your report
  (do not edit `BattleScene.ts` — engine track owns it).

## How to "see" your art (self-review, every phase)

- Write a tiny node script that reads a `string[]` map + the palette from `art.ts`
  and prints it to the terminal at 4–8× using ANSI background-color blocks.
  Eyeball every changed sprite at both sizes. Checklist: silhouette readable at 1×,
  1px outlines unbroken, no orphan noisy pixels, shading follows top-left light,
  `t` accents small and well-placed, towers distinguishable from each other at a
  glance, wrecks read as destroyed.
- Grayscale check: print the sprite with all colors mapped to luminance — values
  must still separate (dark outline, mid body, light highlight).
- Validation: `npx tsc --noEmit -p tsconfig.json` must pass.
  `npm run art:qa` may not exist until the engine track creates it — if present, run
  it; your files must pass.

## Commit + report

- Commit per phase: `pixelart(sprites): phase N - <what>`. Do NOT push.
- When done, print a FINAL REPORT: phases completed, files changed, commits (hashes),
  validation results, art decisions you made (especially trim placement and tower
  designs), any palette chars you wished existed, and anything Stefan should know.
  Then stop and wait.
