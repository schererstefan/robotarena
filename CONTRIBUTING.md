# Contributing

## Submit your own robot

1. Fork the repo and create a branch.
2. Copy an existing robot (e.g. `src/robots/rusher.ts`) to `src/robots/<your-id>.ts`.
   Keep the id lowercase and matching the filename.
3. Write your strategy against `docs/ROBOT_API.md`. One file, deterministic, fast.
4. Register it in `src/robots/registry.ts` and `src/robots/sources.ts`.
5. Run the checks:
   ```sh
   npm run test:sim
   npm run build
   ```
6. Open a pull request. Include: robot name, what strategy it plays, and which
   launch robot you tested it against. A maintainer reviews the code, runs the
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
- [ ] Actually plays differently from the existing five (no clones with tweaks).

## Engine changes

Changes to `src/sim/` affect every robot. They need a reason (fairness bug,
performance, new sensor/weapon semantics), must keep the sim deterministic and
headless-runnable, and must keep `npm run test:sim` green. New sense/intent
fields must be documented in `docs/ROBOT_API.md` in the same PR.
