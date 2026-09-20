# Mission: RobotArena pixel-art overhaul — WORLD track

You are an autonomous build agent working in `/Users/stefan/dev/robotarena` (HEAD `c5487b0`).
The owner (Stefan) said: "make all the changes, review them yourself... go build a cool game."
You have full authority to make art judgment calls within the spec below.
When the spec leaves a detail open, choose the cooler option and note it in your final report.

## Read first (in this order)

1. `docs/PIXELART_BUILD_GUIDE.md` — the full spec. Follow it exactly unless this brief overrides.
2. `docs/COMPLEXITY_PLAN.md` — context only. **Do NOT touch** `src/sim/`, `src/robots/`,
   `src/engine*`, `tools/eval*`, `tools/hillclimb/`, or any replay/codec/fingerprint surface.
   You work purely in pixel-map data files (+ one PNG); no scene or engine code.
3. `docs/art-evidence/art_analysis.md` — repo-specific findings from the art audit.

## Owner decisions (already made — do not re-ask)

1. Slate-blue shadows ARE allowed (cool blue-gray shadow ramps). Pure purple stays banned.
2. Keep the existing floor palette family — de-grid it, don't re-theme it.
3. Robot scale stays 2× — irrelevant to you, noted for completeness.

## Your branch and files (DO NOT touch other tracks' files)

- Branch: `git checkout -b pixelart/world` (from HEAD, do not push)
- YOU OWN: `src/game/art/floor.ts`, `src/game/art/walls.ts`, `src/game/art/decor.ts`,
  `src/game/art/fx.ts`, `src/game/art/menu.ts`, `src/game/art/projectiles.ts`,
  `public/favicon.png`
- READ-ONLY: `src/game/art.ts` (read the palette so you use valid chars — NEVER edit it),
  everything else.
- NEVER touch: `dist/`, `eval/`, sim/robot/eval tools.

## Contract with the other tracks (running in parallel)

- The **engine** track owns `src/game/art.ts` (palette, bake functions, floor overlay
  alpha). Use only chars already in its palette. Do not invent new chars; if you need
  one, note it in your final report.
- Merge order is engine → sprites → world. Your files are disjoint from theirs, so
  merges will be clean.

## Work (follow the guide's phases; commit after each phase)

### Phase 2 — de-grid the arena floor
- `floor.ts`: remove the 1px dark border on every tile (the 60×40 grid is the single
  ugliest thing in the arena). Replace with 3–4 subtle noise variants + edge-blend
  transitions so the floor reads as one continuous surface with texture, not tiles.
- Any bake-time tile variation MUST use a seeded PRNG (e.g. mulberry32, fixed seed) —
  never `Math.random`. Floor layout must be pixel-identical every boot.

### Phase 5 — FX, icons, walls, decor, favicon
- `fx.ts`: explosion polish per the guide (keep the strong 4-frame opening the audit
  praised; improve the tail/fade), punchier impact flashes, cleaner muzzle flashes.
- `menu.ts`: redraw the skill icons — each must be instantly distinguishable at small
  size with a distinct silhouette AND color. No more ambiguous icons.
- `walls.ts`: wall tops get a highlight edge; AO darkening at the wall base.
- `decor.ts`: decor pass per the guide — richer but restrained, same palette discipline.
- `projectiles.ts`: light polish only if the guide calls for it; otherwise leave alone.
- `public/favicon.png`: hand-pixel a 64×64 icon (robot head or arena emblem, readable
  at 16×16 tab size). Hint: no canvas in node — write a minimal PNG encoder using
  node's built-in `zlib` (deflate + CRC), or check for `sips`/`convert` on the system.
  Verify the output is a valid PNG that opens.

## How to "see" your art (self-review, every phase)

- Write a tiny node script that reads a `string[]` map + the palette from `art.ts`
  and prints it to the terminal at 4–8× using ANSI background-color blocks.
  For the floor: tile your variants into a 4×4 grid and eyeball at 1× — the grid
  lines must be GONE and the surface must read continuous.
- Checklist: no visible tile borders, noise subtle (not confetti), FX frames read
  clearly against the floor, icons distinguishable at 1×, walls have top highlight
  + base AO, favicon recognizable at 16px.
- Validation: `npx tsc --noEmit -p tsconfig.json` must pass.
  `npm run art:qa` may not exist until the engine track creates it — if present, run
  it; your files must pass.

## Commit + report

- Commit per phase: `pixelart(world): phase N - <what>`. Do NOT push.
- When done, print a FINAL REPORT: phases completed, files changed, commits (hashes),
  validation results, art decisions you made, and anything Stefan should know.
  Then stop and wait.
