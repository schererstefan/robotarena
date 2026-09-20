# Mission: RobotArena complexity round 2 — B1 (brain conversions)

You are an autonomous build agent working in `/Users/stefan/dev/robotarena` (HEAD `c5487b0`).
The owner (Stefan) said to drive `docs/COMPLEXITY_PLAN.md`. You own unit **B1** only.
You have full authority on implementation details within the plan's constraints.

## Read first

1. `docs/COMPLEXITY_PLAN.md` — the full spec. Follow it exactly unless this brief overrides.
   Your unit is **B1** under "Work Plan". Re-read "Constraints And Non-goals", "Key Decisions",
   and "Validation Plan" before touching code.

## Your branch and files (DO NOT touch anything else)

- Branch: `git checkout -b complexity/b1` (from HEAD `c5487b0`, do NOT push)
- YOU OWN: `src/robots/brawler.ts`, `src/robots/rusher.ts`, plus golden files ONLY via
  the plan's `--update-golden` regen for your unit (commit them with your unit).
- READ-ONLY: `src/robots/genome.ts` — if a `BRAIN_PRESETS` value falls outside
  `PARAM_RANGES`, do NOT widen it yourself; use the nearest in-range value OR report
  it as a blocker in your final report (a parallel session owns genome.ts edits).
- NEVER touch: `src/game/**`, `src/sim/**`, `tools/eval*`, `tools/art-qa.mjs`,
  `docs/PIXELART*`, `docs/briefs/*`, public board/showcase/manifest files, `dist/`, `eval/`.
- A parallel session (B2) is converting hunter + adding `model.*` to genome.ts —
  do not touch `hunter.ts`, `model.ts`, or `comms.ts`.

## Work — B1: convert brawler + rusher to the adaptive brain

- Wire `createBrain` + `BRAIN_PRESETS` + `createWithParams` passthrough in
  `src/robots/brawler.ts` and `src/robots/rusher.ts`, following the hunter precedent
  (`brain.ts:63-68`, `hunter.ts:135-137`). Brawler has no retreat at all (biggest gap);
  rusher's preset is near-hunter aggressive — read the presets and keep each bot's
  character.
- Keep the legacy `create()` path in both files byte-identical — they are your
  regression opponents for the sign test. Do NOT touch `brawler-hc1.ts` / `rusher-hc1.ts`.
- Spot-measure `update()` cost vs legacy (the plan requires it; review-only gate).

## Hard constraints (from the plan — violations fail the unit)

- Determinism: same seed + loadouts → identical fingerprint. No `Math.random`, no
  wall-clock in sim or brains; per-tick state in `create()` closures; `sense.rand` only.
- Foe-signal contract holds: kinematics + health only for foes.
- Radio untouched. Codec untouched (zero replay bits for this unit).
- 60Hz budget: new brain state small and fixed-size.

## Validation (in order; every step must pass before the next)

1. `npx tsc --noEmit -p tsconfig.json`
2. `npm run test:sim` (soak gate — determinism/clamp/isolation)
3. `npm run eval:smoke` (~1s sanity)
4. Ranked eval: `npm run eval:build && node /tmp/robotarena-eval.cjs --mode rr --jobs 8 --out eval/out-b1`
   (temp path only — never overwrite the public board)
5. Promotion gate per bot: CRN sign test ≥60% of ≥24 non-tied pairs (`fitness.ts`
   `signTest`) vs the legacy factory on the identical pool, via the Stage-B search
   harness (`tools/hillclimb/tune.ts`). No Elo regression vs the `c5487b0` baseline
   for either bot (rr board H2H cells).
6. Regen goldens once for your unit (`--update-golden`) so the commit is self-consistent.
   Goldens are advisory-only, but keep the commit clean.

**On gate failure: retune or revert the unit — never promote red.** If you cannot get a
unit green after genuine retune attempts, revert your working changes, leave the branch
at a clean reverted state, and report exactly what failed in your final report.

## Commit + report

- Commit: `complexity(b1): convert brawler + rusher to adaptive brain` (include the
  golden regen in the same commit). Do NOT push. Do NOT regen the public board,
  showcase, or verifier manifests — that needs Stefan's explicit ship approval.
- When done, print a FINAL REPORT: what changed per bot, eval numbers (rr Elo deltas,
  H2H cells vs legacy, sign-test result), `update()` cost vs legacy, commit hash,
  and anything the B3/W1 units or Stefan should know. Then stop and wait.
