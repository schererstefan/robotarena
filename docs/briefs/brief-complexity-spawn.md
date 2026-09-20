# Brief — RobotArena spawn variation (`complexity/spawn`)

Stefan's request: robots must not start at the exact same spots every battle —
identical geometry means identical behavior scripts, and it inflates/deflates
measured performance. This is a sim change, Elo-gated like all complexity work.

## Current state (verified against c5487b0)

`Match.spawnFor` in `src/sim/engine.ts` is fully fixed:
- team 0 at x=130, team 1 at x=ARENA_WIDTH-130
- y = center ± index spread (150px), clamped
- headings fixed: 0 / PI

Every battle with the same lineup is geometrically identical.

## Task

Vary spawn locations per battle, drawn from the match seed.

### Requirements

1. **Seeded only.** Derive spawn offsets from the match seed via a dedicated
   RNG stream, e.g. `createRng((seed ^ 0x5PAWN) >>> 0)` (pick a real salt
   constant). NEVER `Math.random`. Do NOT draw from the shared brain RNG
   stream — engine.ts notes "fixed robot order keeps the shared RNG stream
   deterministic", so keep that stream's draw order untouched.
2. **Mirror symmetry (fairness).** Whatever offset team 0 gets, team 1 gets
   the exact mirror. Neither side may have a geometric advantage. (Randomizing
   which team starts left is unnecessary given mirroring — skip it.)
3. **Constrained placement.** Vary y along the spawn column and add small x
   jitter inside the spawn zone, plus heading jitter. Keep spawns clear of
   obstacle blocks (`src/sim/constants.ts` documents the spawn columns at
   x=130/830 — update that comment), clear of walls, clamped to the arena,
   with minimum teammate separation. No spawning facing into a wall.
4. **Presentation follows automatically.** BattleScene's staged intro
   (telegraph ring → drop) reads spawn positions from sim state — verify the
   rings appear at the new positions; no art changes needed.
5. **Replay safety.** Replays carry their seed; spawns derive from it
   deterministically, so old replay codes stay loadable and new ones stay
   reproducible.

### Evaluation (this is the point of the track)

- Re-run the full Elo baseline on the merged base WITH spawn variation.
- Report per-robot Elo deltas vs the fixed-spawn baseline. Expect movement —
  Stefan explicitly noted spawn geometry influences measured performance.
  Movement is information, not failure; but document it.
- The new numbers become the **no-regression floor for B3**.
- Regenerate INTERNAL goldens (they encode outcomes). Do NOT touch the
  public board, showcase, or verifier manifests — those need Stefan's
  explicit ship approval.

### Gates (same as B1/B2)

- `npx tsc --noEmit` clean, `test:sim` green.
- No Elo regression vs the fixed-spawn merged base beyond the noise
  threshold; CRN sign test where applicable; soak green.
- One commit on branch `complexity/spawn`, based on `complexity/merged-b1b2`
  (including the H1 cherry-pick).

## Deliverable

FINAL REPORT with: the spawn distribution (ranges), the fairness argument
(mirror proof), per-robot Elo deltas old→new, golden regen summary, and the
new baseline table B3 must not regress against.
