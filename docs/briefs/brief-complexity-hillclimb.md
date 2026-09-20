# Mission: RobotArena complexity round 2 — hillclimb upgrades (H1/H2/H3)

You are an autonomous build agent working in `/Users/stefan/dev/robotarena` (HEAD `c5487b0`).
The owner (Stefan) reviewed the hillclimb system and approved implementing the
recommended improvements. You own the hillclimb upgrades only.

## Read first

1. `docs/COMPLEXITY_PLAN.md` — "Open Questions", "Validation Plan", and "Key Decisions"
   for context on what the hillclimb must support (B2 opponent model, B3 squads, W1 asteroids).
2. All of `tools/hillclimb/*.ts`, `src/robots/genome.ts`, `src/robots/brain.ts`.

## Your branch and files (DO NOT touch anything else)

- Branch: `git checkout -b complexity/hillclimb` (from HEAD `c5487b0`, do NOT push)
- YOU OWN: `tools/hillclimb/**` only.
- NEVER touch: `src/**`, `tools/eval*` (the shared eval runner), `tools/soak*`,
  `docs/PIXELART*`, `docs/briefs/*`, public board/showcase/manifest files, `dist/`, `eval/`.
- Parallel sessions own robot files and sim files — do not touch them.

## Work — three items, in this order, ONE COMMIT PER ITEM

### H1: 3v3 (team) evaluation arm — do this FIRST, commit separately

`tune.ts` currently hard-throws for `--teamSize != 1`. B3 (squad roles) cannot be
gated without this. Design (locked — do not redesign, just implement well):

- `evaluate.ts`: add `buildTeamPool({seeds, teamSize, opponents, offset?})` —
  seeds × opponents × both arenas × both sides, same CRN rotation scheme as
  `buildPool`. Each match: candidate team = `teamSize` slots all running the
  candidate genome (role differentiation comes from the bot's own radio/role logic,
  which is exactly what B3 tests); opponent team = `teamSize` copies of the opponent
  archetype's default `create()` with its default loadout.
- Team scoring: `matchScore` is already team-based — reuse. Add `teamTiebreak` in
  `fitness.ts`: team damage-diff normalized by `200 * teamSize`, plus surviving-bot
  fraction (replacing single survival), minus stall, minus mean passivity across the
  team's spies, minus max errors. Document the exact formula in a comment.
- `signTest`: unchanged — it already operates on aligned score arrays; feed it the
  per-match team scores.
- Thread team pools through `search.ts` (Stage B) and `halving.ts` (Stage A) when
  `teamSize > 1`. `mutateTeamGenome` exists but has NO driver — leave it unwired;
  team mode mutates the single shared genome (all slots share it).
- `tune.ts`: accept `--teamSize N` (N ≥ 1); keep 1v1 as the default path, byte-identical
  behavior when `--teamSize 1`.
- `manifest.ts` line ~97 hardcodes `teamSize: 1` in `validationCode` — generalize it.
- Commit: `complexity(hillclimb): 3v3 team evaluation arm`.

### H2: opponent-diverse validation

Held-out validation today holds out *seeds* against the *same opponent roster* —
an adaptive opponent model (B2) can memorize the roster and validate fine while
failing against novel foes. Fix:

- Deterministic opponent fold split in `tune.ts`: sort opponent ids, hold out every
  3rd archetype (document the rule) as the validation fold; train pool uses the train
  fold. Validation runs on held-out *opponents* × held-out *seeds*.
- Report both numbers in the restart log and manifest: `valid` (held-out seeds,
  train fold — as today) and `validOpp` (held-out opponents). Promotion requires
  both: `valid ≥ train − 5pp` AND `validOpp ≥ train − 10pp` (slacker bound: novel
  foes are harder; document it).
- The regression veto keeps its current form (vs default build, same pool).
- Commit: `complexity(hillclimb): opponent-fold validation`.

### H3: search-budget scaling with genome size

B1/B2 grow genomes from ~9–16 params to ~20+. 4 challengers × 25 gens gets thin
(last night's hunter tune: 80k matches in 213s, only 0–3 accepts per restart).

- In `tune.ts`, make the *defaults* genome-aware: let `n` = number of behavior params
  (excluding loadout). `challengers = clamp(round(4 * sqrt(n/12)), 4, 12)`,
  `generations = clamp(round(25 * sqrt(n/12)), 25, 60)`. Explicit CLI flags still
  override. Document the formula in `--help` and a comment. 12-param genomes keep
  today's exact defaults.
- Commit: `complexity(hillclimb): genome-aware search budget`.

## Out of scope

- Post-W1 champion re-validation (happens after W1 ships — do not do it now).
- Public board/showcase regen. Freezing any champions (`--no-freeze` for all test runs).

## Hard constraints

- Determinism: same `--seed` → identical champion genome hash, twice in a row.
  All randomness through the seeded stream; CRN pairing preserved in team mode.
- The 1v1 path must be behavior-identical when `--teamSize 1` (prove it, don't assert it).

## Validation (in order)

1. `npx tsc --noEmit -p tsconfig.json`
2. `npm run test:sim` and any hillclimb unit tests that exist (check package.json).
3. Tiny 1v1 `--no-freeze` tune (e.g. `--archetype hunter --stageA 16 --restarts 2 --generations 4 --challengers 2`) — proves the 1v1 path still works end-to-end.
4. Tiny 3v3 `--no-freeze` tune (`--teamSize 3`, same tiny budget) — proves the team path works.
5. Determinism: run (4) twice with the same `--seed`, `diff` the champion genome hashes.

## Commit + report

- Three separate commits, H1 first (a downstream B3 session will cherry-pick the H1
  commit, so keep it self-contained). Do NOT push.
- When done, print a FINAL REPORT: what changed per item, the teamTiebreak formula,
  the fold rule, the budget formula, validation results (1v1 run, 3v3 run, determinism
  check), commit hashes. Then stop and wait.
