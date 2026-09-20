# Complexity Round 2 — Implementation Plan

Behavior-first slice (brain conversions, opponent model, squad activation) plus asteroid strikes as the first world feature. Each unit is independently committable and hillclimb-gated.

## Goal

Ship the round-2 behavior slice validated by the existing hillclimb gates, plus asteroid strikes as the first world-complexity feature:

- **B1**: convert brawler + rusher to the adaptive brain.
- **B2**: hunter opponent-model v1 (dodge memory + counter-lead).
- **B3**: squad activation over claim/slot radio (3v3 role behavior).
- **W1**: seed-derived asteroid strikes (telegraph, impact, scorch).

## Success Criteria

- **B1**: brawler + rusher run `createBrain` with their presets; legacy factories kept as regression opponents; rr board shows no Elo regression for either bot vs the c5487b0 baseline; CRN sign test passes vs legacy on the identical pool.
- **B2**: hunter-model beats baseline hunter head-to-head vs orbiter, rusher, and sniper (H2H deltas in `summary.json`); no regression vs the turret control; sign test passes.
- **B3**: a 3v3 role behavior (slot-spread + focus chaining over claim/slot) passes a sign test on a 3v3 pool (full-mode spot matrix, or a new CRN 3v3 arm if none fits); no 1v1 regression for converted bots.
- **W1**: strikes land with visible telegraph, dodgeable impact, and scorch; goldens regenerated; soak green; showcase resim green; markers render in BattleScene.
- **Docs**: `ROBOT_API.md` updated same-commit for every contract touch (new sense channel, newly used radio kinds, brain wiring).

## Context And Current Facts

- HEAD is `c5487b0` (tournament watch-out shipped, prod live). Board is fresh post-0531d75: hunter-hc2 1653.3, ghost 1513.2, turret-hc1 1386.5, sniper 1269.5, turret 1194.3 (17 entries, 1280 evals each).
- Round-1 research (12 tracks) produced a parked phase-1 slice (AMP skill, MatchJob-loadouts eval plumbing, static powerup pads). Designed only: no phase-1 commit exists in git history, so nothing from it is in the tree. This plan stays off its surfaces except at named coordination points.
- Round-2 research (10 tracks: asteroids, barriers-2, terrain, director, visibility, opponent-model, squad, risk, comms-2, personalities) ranked behavior-first. Verified code facts grounding this plan:
  - `src/robots/brain.ts`: 6-mode utility scorer (engage/retreat/kite/flank/focus/roam), safety-first `MODE_ORDER`, `stayBonus` hysteresis, `BRAIN_PRESETS` for all 8 base bots, only hunter converted (lines 63-68).
  - `src/robots/genome.ts`: `brain.*` group tunable (`retreatHp`, `kiteRange`, `flankRange`, `stayBonus`, `aggression`, `focusBonus`, `orbitDir`, lines 68-74); hunter wired via `createWithParams` (`hunter.ts:135-137`).
  - `tools/hillclimb/fitness.ts`: lexicographic win-rate-first, `F = damageDiff/200 + 0.2*survival − stall − passivity − errors`, sign test needs ≥60% of ≥24 non-tied CRN pairs.
  - Radio: 6 `COMMS_KINDS`, delay 6, inbox cap 4 (`constants.ts:96-99`); `claim`/`slot`/`ack`/`ping` kinds plus `resolveRoles`/`formationSlot` have zero callers outside `comms.ts` (verified by grep) — free protocol space.
  - Foe-signal contract: `SensedRobot` is kinematics + health only; allies additionally expose tower/cooldown/charge/loadout (`types.ts`). Foe loadouts are never exposed in-cone.
  - Engine: `stepBullets` (:472) → `suddenDeath` (:474) is the hazard insertion slot; event channel capped at 8 (`SENSE_EVENTS_MAX`); fingerprint is `arena|mods|winner@tick|snaps|bullets` (`runner.ts:40-46`) with no hazard/pickup segment.
  - Eval: `--mode smoke|rr|ladder|full`, `--update-golden`, `--emit-board PATH` verified in `tools/eval.ts`; per-pair H2H cells exist (`stats.ts:126-144`); goldens are advisory (mismatch warns, never fails, `stats.ts:162`).
  - Toolchain health on HEAD: `eval:smoke` runs 544 games in ~1.2s with 544/544 goldens matched (measured this session).
- Codec position: the bot slice adds zero replay bits; seed-derived asteroids add zero bits. This plan makes no RA2/RA1 layout change.

## Constraints And Non-goals

- Determinism: same seed + loadouts → identical fingerprint (soak gate). No wall-clock or `Math.random` in sim or brains; per-tick state in `create()` closures; `sense.rand` only.
- Foe-signal contract holds: no foe cooldown/charge/loadout exposure. Counter-play may only infer from tells (damage taken, HP deltas, positioning).
- Radio stays 1 msg/tick, delay-6, cap-4, team-scoped. Fingerprint excludes radio, so protocol activation is fingerprint-free.
- 60Hz update budget: no per-robot timing gate exists (review-only precedent). New brain/model state must be small and fixed-size; spot-measure `update()` cost on conversion.
- Codec freeze: no replay layout change in this plan.
- Non-goals: visibility/fog, barriers-2, terrain, director, modes, chassis, weight-level RL, Phase 10 backend, and the parked phase-1 slice (separate track).

## Key Decisions

1. **Behavior-first (B1→B2→B3), asteroids last (W1).** Bot-only work is zero-codec, needs no renderer, and is hillclimb-ready on day one. Rejected: world-first (slower validation, golden churn up front) and visibility-first (occlusion cascade plus an open owner decision).
2. **Convert brawler, then rusher; hunter stays the model lab.** Presets exist for all 8; brawler has no retreat at all (biggest gap) and rusher's preset is near-hunter aggressive. Rejected: all-8 conversion (unreviewable Elo attribution) and sniper/ghost first (custom logic worth preserving for later).
3. **Legacy factories stay as regression opponents.** The CRN sign test needs the incumbent on the identical pool; follows the hunter-hc1 frozen-on-legacy precedent (`brain.ts:66-67`). Rejected: delete-on-convert (destroys the comparison arm).
4. **Opponent-model v1 = dodge-direction memory + counter-lead aim input on hunter, no new sense fields.** Tracks, bullets, and `lastDamage` suffice; zero engine touch. Rejected: foe-cooldown exposure (violates contract) and cross-match learning (breaks the determinism story).
5. **Activate claim/slot for squad roles; reserve the bid float for the role auction; defer the personalities auction.** Resolves the bid-contention conflict the research critic found. Rejected: new message kinds (unneeded — four kinds sit unused) and personalities-first (needs auction design).
6. **Asteroids always-on + golden regen (pending OQ1).** The only coherent zero-codec option: a harness-only toggle is unreproducible in resim, and a real modifier bit needs the RA2 verdict first.
7. **Independent of parked phase-1.** No shared-surface edits: brain/genome/radio vs skills/eval/pads. Coordination points for when pads land: step()-slot order (pads vs hazards — heal-vs-damage decides survival), sense-channel naming, one combined fingerprint regen instead of three, and the AMP×charger×doubleDamage stacking rule.

## Recommended Approach

Four sequential units, each following implement → soak → scoped eval → sign-test gate → commit. B1/B2/B3 touch `src/robots`, `src/sim/skills.ts` (genome-adjacent only if ranges need widening), and docs; W1 touches sim, scenes, and goldens. Regenerate goldens once per unit so every commit is self-consistent. Regen the public board + showcase + verifier once at the end; use `--emit-board` to temp paths for intermediate inspection.

## Work Plan

- **B1 — Brain conversions (brawler, rusher).** Wire `createBrain` + `BRAIN_PRESETS` + `createWithParams` passthrough in `src/robots/brawler.ts` and `src/robots/rusher.ts`; keep the legacy `create()` path untouched. Only widen `genome.ts` `PARAM_RANGES` if a preset value falls outside a range (verify first). Spot-measure `update()` cost vs legacy. Docs: none (presets are data, no contract change).
- **B2 — Hunter opponent-model v1.** New `src/robots/model.ts`: fixed-size per-foe memory ring (dodge-direction counts, range histogram) feeding a counter-lead aim input in `hunter.ts`; reuse `common.ts` aim/steer helpers. Add an additive `model.*` group to `genome.ts` `PARAM_RANGES` (verify the schema accepts new groups first). Duel targets orbiter/rusher/sniper; turret is the control. No engine or `types.ts` changes.
- **B3 — Squad activation.** Add missing `cast`/`parse` helpers in `comms.ts` for claim/slot (verify absence first — kinds exist, helpers may not). Implement one role behavior: slot-spread positioning + focus chaining, first caller of `resolveRoles`/`formationSlot`. Convert a hunter trio for 3v3. Update the radio section of `ROBOT_API.md`. If the CRN pool has no 3v3 arm, add one in `evaluate.ts` as part of this unit; otherwise use the full-mode spot matrix.
- **W1 — Asteroid strikes.** `constants.ts`: pre-SD schedule window, telegraph ticks, radius, damage, cooldown, mirrored targeting (spawn columns x=130/830 precedent). `engine.ts`: `stepHazards` between `stepBullets` and `suddenDeath`. `types.ts`: `'blast'` `SenseEventKind` + one optional hazards sense channel (name it `hazards`; pads take `pickups` later). Fingerprint segment in `runner.ts` plus the soak mirror, then `--update-golden` regen. BattleScene telegraph markers (reuse the `syncSdRing` pattern) + scorch recycling. `ROBOT_API.md` senses-table update. Blocked on OQ1.
- **SHIP — Final validation + report.** Board regen to temp path, `emit:showcase`, `verify:manifests`; public files only on explicit ship approval.

## Validation Plan

- Typecheck after every unit: `npx tsc --noEmit -p tsconfig.json`.
- Soak gate per unit: `npm run test:sim` (determinism/clamp/isolation; W1 adds hazard cases before regen).
- First signal: `npm run eval:smoke` (~1s, 544 games on HEAD).
- Ranked eval: `npm run eval:build && node /tmp/robotarena-eval.cjs --mode rr --jobs 8 --out eval/out-<unit>` (pool Elo + H2H; B2 reads the orbiter/rusher/sniper/turret cells).
- 3v3 eval (B3): same with `--mode full` (long pole; always `--jobs 8`).
- Promotion gate per conversion/model: CRN sign test ≥60% of ≥24 non-tied pairs (`fitness.ts` `signTest`) via the Stage-B search harness (`tools/hillclimb/tune.ts`); on failure, retune or revert the unit — never promote red.
- Final: board to temp path via `--emit-board`, `npm run emit:showcase`, `npm run verify:manifests`.
- Manual (W1 only): watch 2+ asteroid matches in BattleScene — telegraph visible, impact dodgeable, markers and scorch render. Speed 4x exists if matches run long.

## Risks / Rollback

- **Elo regression per unit** → revert that unit's commit. Units stay independently committable and legacy opponents make A/B exact.
- **Golden churn**: behavior changes alter end-state fingerprints too, so regen goldens once per unit (mismatches are advisory-only, but keep each commit self-consistent).
- **60Hz budget**: no gate exists; mitigation is fixed-size state, review, and spot measurement in B1/B2. A real perf gate is separate work (OQ4).
- **H2H is 1v1-only**: B3 judges by rollups + a 3v3 pool, not H2H cells.
- **Scope bleed into parked phase-1 surfaces**: forbidden without a sequencing note; coordination points are listed in Decision 7.
- **W1 balance shock**: always-on hazards shift every matchup; the rr board after W1 is a new baseline, not comparable to the old one. If the shift is degenerate (draw spikes, stall), retune constants before promoting.

## Open Questions

1. **Asteroids always-on vs modifier-gated?** Recommendation: always-on + golden regen. Blocks W1 only. The gated alternative needs the RA2 verdict first (no free modifier bit).
2. **Scout-pierces-blocks vs full occlusion?** Needed before any visibility work; not blocking this slice. No recommendation yet — needs balance data that only an eval run can produce.
3. **RA2 layout verdict (spare bits vs version bump)?** Needed before barriers-2, toggles, and mode encoding; not blocking this slice.
4. **60Hz perf gate vs review-only?** Recommendation: review-only for this slice (established precedent); a timing gate is separate, welcome work.

Resolved during research (not questions): per-opponent H2H breakdowns exist (`stats.ts` `headToHead`), so B2 validation is unblocked; `--update-golden` and `--emit-board` flags verified; radio protocol has four unused kinds, so B3 needs no new kinds.
