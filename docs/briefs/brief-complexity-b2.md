# Mission: RobotArena complexity round 2 — B2 (hunter opponent model v1)

You are an autonomous build agent working in `/Users/stefan/dev/robotarena` (HEAD `c5487b0`).
The owner (Stefan) said to drive `docs/COMPLEXITY_PLAN.md`. You own unit **B2** only.
You have full authority on implementation details within the plan's constraints.

## Read first

1. `docs/COMPLEXITY_PLAN.md` — the full spec. Follow it exactly unless this brief overrides.
   Your unit is **B2** under "Work Plan". Re-read "Constraints And Non-goals", "Key Decisions"
   (especially decision 4), and "Validation Plan" before touching code.

## Your branch and files (DO NOT touch anything else)

- Branch: `git checkout -b complexity/b2` (from HEAD `c5487b0`, do NOT push)
- YOU OWN: `src/robots/model.ts` (new), `src/robots/hunter.ts`,
  `src/robots/genome.ts` (ADDITIVE `model.*` group in `PARAM_RANGES` only — verify the
  schema accepts new groups first; do not alter existing ranges), plus golden files ONLY
  via the plan's `--update-golden` regen for your unit (commit them with your unit).
- NEVER touch: `src/robots/brawler.ts`, `src/robots/rusher.ts` (a parallel B1 session owns
  them), `src/game/**`, `src/sim/**` (no engine changes for B2), `src/robots/comms.ts`,
  `tools/eval*`, `tools/art-qa.mjs`, `docs/PIXELART*`, `docs/briefs/*`, public
  board/showcase/manifest files, `dist/`, `eval/`.

## Work — B2: hunter opponent-model v1

- New `src/robots/model.ts`: fixed-size per-foe memory ring — dodge-direction counts
  and a range histogram per foe. Small, fixed-size state (60Hz budget, review-only gate).
- Feed a counter-lead aim input into `hunter.ts` from the model. Reuse `common.ts`
  aim/steer helpers. Hunter stays the model lab: no other bot gets the model.
- **Zero engine touch**: tracks, bullets, and `lastDamage` suffice. No new sense fields,
  no `types.ts` changes, no codec/replay bits.
- **Foe-signal contract holds**: no foe cooldown/charge/loadout exposure. Counter-play
  may only infer from tells (damage taken, HP deltas, positioning).
- Add the additive `model.*` group to `genome.ts` `PARAM_RANGES` (verify schema accepts
  new groups first).

## Hard constraints (from the plan — violations fail the unit)

- Determinism: same seed + loadouts → identical fingerprint. No `Math.random`, no
  wall-clock in sim, brains, or model; per-tick state in `create()` closures;
  `sense.rand` only.
- Radio untouched. Codec untouched.

## Validation (in order; every step must pass before the next)

1. `npx tsc --noEmit -p tsconfig.json`
2. `npm run test:sim` (soak gate)
3. `npm run eval:smoke` (~1s sanity)
4. Ranked eval: `npm run eval:build && node /tmp/robotarena-eval.cjs --mode rr --jobs 8 --out eval/out-b2`
   (temp path only — never overwrite the public board)
5. Promotion gate: hunter-model beats baseline hunter head-to-head vs **orbiter, rusher,
   and sniper** — read the H2H deltas from the rr `summary.json` (`stats.ts` headToHead
   cells); **no regression vs the turret control**; CRN sign test ≥60% of ≥24 non-tied
   pairs (`fitness.ts` `signTest`) via the Stage-B harness (`tools/hillclimb/tune.ts`).
6. Regen goldens once for your unit (`--update-golden`) so the commit is self-consistent.

**On gate failure: retune or revert the unit — never promote red.** If you cannot get
green after genuine retune attempts, revert, leave the branch clean, and report exactly
what failed in your final report.

## Commit + report

- Commit: `complexity(b2): hunter opponent-model v1 (dodge memory + counter-lead)`
  (include golden regen). Do NOT push. Do NOT regen the public board, showcase, or
  verifier manifests — that needs Stefan's explicit ship approval.
- When done, print a FINAL REPORT: model design (state size, inputs), H2H deltas vs
  orbiter/rusher/sniper/turret-control, sign-test result, commit hash, and anything the
  B3/W1 units or Stefan should know. Then stop and wait.
