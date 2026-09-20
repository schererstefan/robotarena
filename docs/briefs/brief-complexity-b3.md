# Brief — RobotArena complexity B3: squad roles (`complexity/b3`)

## Goal

Squad coordination via explicit roles. This is the B3 unit of COMPLEXITY_PLAN.md,
unblocked by H1 (3v3 evaluation arm — cherry-pick `59cfb03` onto your base
first; verify the 3v3 arm runs before tuning).

## Base

Branch `complexity/b3` from `complexity/merged-b1b2` (which includes B1+B2 and
the H1 cherry-pick) **plus** the `complexity/spawn` merge — spawn variation
landed first, so your no-regression floor is the spawn-varied Elo baseline in
the spawn session's FINAL REPORT, not the old fixed-spawn numbers.

## Scope

1. **Claim/slot communication helpers.** Shared, well-documented helpers for
   robots to claim and hold tactical slots/roles over the radio channel.
   Additive new module(s); do not refactor existing radio code.
2. **Role behavior.** Behavior-layer support for roles using `resolveRoles` /
   `formationSlot` — robots take and keep formation slots, re-resolve on
   teammate death.
3. **Hunter trio conversion.** Convert the hunter's 3-pack to the role system
   as the reference implementation (hunter already has the B2 opponent model;
   keep it intact).
4. **Radio documentation.** Update the radio protocol docs to describe
   claim/slot messages.

## Out of scope

W1 (asteroid strikes) — do NOT start it. Public board / showcase / verifier
manifest regeneration — needs Stefan's explicit ship approval, never do it
unasked.

## Gates (hillclimb rules)

- No Elo regression vs the spawn-varied baseline, CRN sign test >= 60% of
  >= 24 pairs, never promote red.
- Gate using `--teamSize 3` (the H1 arm) — roles must prove out in 3v3, plus
  a 1v1 sanity check for no regression.
- `npx tsc --noEmit` clean, `test:sim` green, soak green.
- One commit per logical unit; FINAL REPORT with 3v3 Elo deltas and the
  role-coordination evidence (slot adherence stats).

## Forbidden

Do not touch art, replay codec, or fingerprint surfaces. Do not push.
