# Contributing

## Submit your own robot

1. Fork the repo and create a branch.
2. Start from the in-game WORKSHOP template (menu: WORKSHOP, see
   `docs/WORKSHOP.md`: one-file robot shape, aim-and-chase stub, static checks
   as you type, downloadable `.ts`) and save it as `src/robots/<your-id>.ts`.
   Keep the id lowercase and matching the filename. Do not copy a shipped
   robot (e.g. `src/robots/rusher.ts`) and delete its internals: every shipped
   robot (all 8 base robots) runs its strategy through internal-only `./brain`
   + `./genome` (`rusher.ts` routes through `createBrain`/`BRAIN_PRESETS`), so
   stripping those imports leaves a husk, not a working robot. User robots may
   only import from `../sim/*`, `./common.ts`, and `./comms.ts`
   (see `docs/ROBOT_API.md` §Rules for robot code).
3. Write your strategy against `docs/ROBOT_API.md`. One file, deterministic, fast.
4. Register it in `src/robots/registry.ts` (one import + one entry) and
   `src/robots/sources.ts` (one `?raw` import + one entry). Append at the end:
   registry order is append-only (replay codes index into it), so never reorder
   or remove existing entries.
5. Run the checks CI gates on (same set as `.github/workflows/ci.yml`):
   ```sh
   npm ci
   npm audit --audit-level=high
   npx tsc --noEmit
   npm run build
   npm run test:bt
   npm run test:import
   npm run test:sim:fast
   npm run art:qa
   # Full soak baseline-diff (PR gate, `.github/workflows/ci.yml:63`):
   # same helper as `npm run test:sim:fast`, but with empty
   # SOAK_SECTIONS it runs the full soak (see header in
   # `tools/soak-fast.mjs:17-22`):
   npx esbuild tools/soak.ts --bundle --platform=node --format=esm --outfile=/tmp/robotarena-soak.mjs --log-level=warning
   SOAK_SECTIONS='' SOAK_EXPECTED_FILE=.github/nightly-expected-soak.txt node tools/soak-fast.mjs
   # Verify manifests baseline-diff (PR gate, `.github/workflows/ci.yml:77`):
   npm run verify:manifests 2>&1 | tee ci-manifests.log || true
   grep -E '^  MISMATCH ' ci-manifests.log | LC_ALL=C sort > ci-manifests-actual.txt || true
   grep -E '^  MISMATCH ' .github/nightly-expected-manifests.txt | LC_ALL=C sort > ci-manifests-expected.txt || true
   diff -u ci-manifests-expected.txt ci-manifests-actual.txt
   ```
   `npm run test:sim` IS a PR gate via baseline-diff (since PR #23):
   `.github/workflows/ci.yml:11-13` runs on every `pull_request` and the
   "Test (sim full soak baseline-diff)" step at `ci.yml:63` (implemented at
   `ci.yml:65-66`) is green only if the soak's sorted `  FAIL ` lines are
   unchanged vs `.github/nightly-expected-soak.txt` (`ci.yml:57-66`). Only
   the 4 baselined failures are tolerated; any new, fixed, or changed
   `  FAIL ` line blocks the PR. In particular, if you FIX one of the 4
   baselined failures you will FAIL the gate unless you update
   `.github/nightly-expected-soak.txt` in the same PR and explain it (that
   instruction is printed by `tools/soak-fast.mjs:166` and the CI gates).
   Its fast subset `npm run test:sim:fast` is likewise a PR gate
   (baseline-diff vs `.github/ci-expected-soak-fast.txt`).
   `npm run verify:manifests` is likewise a baseline-diff PR gate
   (`ci.yml:77`), not a plain pass/fail command: raw `npm run
   verify:manifests` exits 1 on a clean main checkout because main carries
   11 baselined mismatches (`tools/verify-manifest.ts:74-80` returns 1 on
   any mismatch; `.github/nightly-expected-manifests.txt` has 11
   `  MISMATCH ` lines). Use the baseline-diff comparison above (same as
   `ci.yml:79-82`): the `  MISMATCH ` sets must be unchanged.
6. Open a pull request. Include: robot name, what strategy it plays, and which
   built-in robot(s) you tested it against. A maintainer reviews the code, runs the
   soak, and merges — your robot ships in the next deploy.

By submitting, you agree your robot is accepted under the repo's MIT license.

## Robot review checklist (for authors and reviewers)

- [ ] Single file in `src/robots/`, id matches filename, meta filled in.
- [ ] Default `loadout` totals ≤ 6 points and suits the strategy.
- [ ] Reads ranges/cooldowns from `sense.self.stats`, never hardcoded constants.
- [ ] Registered in `registry.ts` and `sources.ts`.
- [ ] No `Math.random`/`Date`/network/storage/Phaser/DOM imports.
- [ ] No per-tick errors or exceptions in a 1v1 soak.
- [ ] Deterministic: same seed replays identically.
- [ ] Actually plays differently from the existing robots (no clones with tweaks).

## Engine changes

Changes to `src/sim/` affect every robot. They need a reason (fairness bug,
performance, new sensor/weapon semantics), must keep the sim deterministic and
headless-runnable, and must keep `test:sim` failures to the baselined set
(`npm run test:sim` is not green on main — it has 4 pre-existing baselined
failures, see the EXCLUDED note in `.github/workflows/ci.yml`). New sense/intent
fields must be documented in `docs/ROBOT_API.md` in the same PR.
