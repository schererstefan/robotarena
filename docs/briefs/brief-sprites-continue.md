# Mission: RobotArena pixel-art overhaul — SPRITES track (CONTINUATION)

You are an autonomous build agent. A previous session completed **Phase 1.2** (team
trim `w`→`t` on chassis) and committed it as `5517040` on branch `pixelart/sprites`,
then died on a model-stream timeout before the remaining phases. Your job: **verify
Phase 1.2 and complete Phases 3, 4, and 6**. Do not redo Phase 1.2 unless your
review finds a real defect in it.

## Read first (in this order)

1. `/Users/stefan/dev/robotarena/docs/briefs/brief-sprites.md` — the original brief.
   All owner decisions, file ownership, palette contract, and self-review rules there
   still apply unchanged.
2. `/Users/stefan/dev/robotarena/docs/PIXELART_BUILD_GUIDE.md` — the full spec.
3. `/Users/stefan/dev/robotarena/docs/art-evidence/art_analysis.md` — repo findings.

## Your workspace (IMPORTANT — read carefully)

- Work **only** inside this worktree: `/private/tmp/sprites-wt`, which has branch
  `pixelart/sprites` checked out (currently at `5517040` = Phase 1.2, on top of
  `c5487b0`). Commit here with `git commit`; the branch ref updates accordingly.
- **NEVER** `git checkout` branches, create branches, or commit in the main tree
  `/Users/stefan/dev/robotarena` — parallel sessions share it and branch-switching
  there has already caused commits to land on wrong branches twice. Your worktree
  is your isolation. Do not push.
- You own: `src/game/art/chassis.ts`, `src/game/art/towers.ts`,
  `src/game/art/wrecks.ts`, `src/game/art/anim.ts`. Nothing else. Never touch
  `src/game/art.ts` (read-only), `dist/`, `eval/`, sim/robot/eval tools.

## Palette

The engine track has landed its palette work on branch `pixelart/engine`
(`6f995cf`): the `t` team-trim char and the slate-blue shadow chars from the
guide's Phase-3.1 table are real. Merge order is engine → sprites → world, so any
char from the guide's Phase-3.1 palette table is safe to use in your maps now. To
see the exact hexes for your ANSI previewer:
`git show pixelart/engine:src/game/art.ts` (from your worktree; that branch is a
local ref). If you need a char that isn't in the table, do NOT invent it — note it
in your final report.

## Work

1. **Verify Phase 1.2**: `git show 5517040 --stat`; eyeball the chassis trim maps
   with your ANSI previewer (visor/cockpit stripe + 1–2 trim lines per robot, `t`
   accents small). Fix only genuine defects; note anything you changed.
2. **Phase 3** — shading/specular/AO on all chassis maps (warm off-white
   highlights, slate-blue shadows, specular dots on canopies/lenses, 1px AO where
   parts meet; keep 1px outlines, top-left light). Redesign `towers.ts` into THREE
   instantly-distinguishable silhouettes (e.g. light = slim mast + antenna,
   heavy = wide fortified block + thick barrel, twin = split dual barrels) on the
   same 16×16 canvas.
3. **Phase 4** — redraw `wrecks.ts`: 3 visually DISTINCT wreck variants (broken
   silhouettes, exposed internals, scattered panels). Must read as "dead robot".
4. **Phase 6** — `anim.ts`: tread rework (reads as moving), short death-sequence
   frame set per the guide, idle-bob frames if the guide specifies them. If idle
   bob needs scene-code support, implement the frames and note the hook needed
   (do NOT edit `BattleScene.ts` — engine track owns it).

Self-review every phase with the ANSI previewer at 4–8× plus the grayscale
luminance check, exactly as the original brief describes. `npx tsc --noEmit`
must pass in your worktree. The `art:qa` harness lives on the engine branch and
will run at merge time; keep your maps within the guide's charset/dimension
rules so it passes.

## Commit + report

- Commit per phase from the worktree: `pixelart(sprites): phase N - <what>`.
  Do NOT push.
- When done, print a FINAL REPORT: phases completed, files changed, commit hashes,
  validation results, art decisions you made (trim verification notes, tower
  designs, wreck concepts), any palette chars you wished existed, and anything
  Stefan should know. Then stop and wait.

## RESILIENCE NOTE (added ~10:14 Sep 20 — session died TWICE on "model stream idle timeout after 180000ms")

This track died twice mid-run with no commits. To make progress survivable:
- COMMIT AFTER EACH PHASE. One commit for phase 3, one for phase 4, one for phase 6. Never hold uncommitted work across long tool runs.
- Keep individual tool runs short; prefer many small steps over one long one.
- If you crash and get relaunched, `git log --oneline` first to see which phases are already committed, then continue from the first uncommitted phase.
