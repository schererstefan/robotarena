# Powerups & Map Turrets — Implementation Plan

Owner-approved scope addition (Sep 20, 2026): implement powerups (the parked
phase-1 "static powerup pads" slice was designed-only, zero code in tree) and
design + implement map turrets with a capture-to-activate mechanic.

Base: `complexity/merged-b1b2`. Two sequential units, P1 then T1, each
implement -> soak -> eval -> commit. **One combined golden regen at the end**
(per COMPLEXITY_PLAN Decision 7: "one combined fingerprint regen instead of three").

## Global constraints (from COMPLEXITY_PLAN)

- Determinism: same seed + loadouts -> identical fingerprint. No wall-clock /
  Math.random in sim; per-tick state in create() closures; `sense.rand` only.
- Foe-signal contract holds: no foe cooldown/charge/loadout exposure.
- Codec: zero new replay bits — pads and turrets are seed-derived, resim rebuilds them.
- Sense channel names: pads take **`pickups`** (reserved), asteroids later take `hazards`.
- Step-slot order: `stepPads()` runs right after `stepBullets()`, BEFORE the
  future W1 `stepHazards` slot (heal-vs-damage: hazards get the last word, so
  telegraphed threats stay threatening).
- Stacking rule: AMP x doubleDamage modifier does NOT stack — strongest multiplier wins.
- ROBOT_API.md updated same-commit for every contract touch.

## P1 — Powerup pads

**Layout:** 4 static pads, mirror-symmetric. Positions at fixed arena fractions
(0.22/0.78 x, 0.30/0.70 y), mirrored across center. Pad types assigned from seed
(cycle [amp, repair, overdrive] with seed offset) so layouts vary per match but
stay symmetric. Always on (map feature, not a modifier).

**Types:**

- AMP: 2x bullet damage for 360 ticks (6s)
- REPAIR: +60 HP instant (clamped to max)
- OVERDRIVE: +35% move speed for 360 ticks (6s)

**Mechanics:**

- Pickup radius 26px. First robot in tick order wins contested pickups.
- After pickup the pad goes dark for 900 ticks (15s), then reactivates.
- Effects are timed; death clears them (no drops — avoids edge cases).
- AMP does not stack with the doubleDamage match modifier (max wins).

**Sim touch points:**

- `types.ts`: `SensePad { x, y, kind: 'amp'|'repair'|'overdrive', active: boolean, respawnIn: number }`;
  `SenseState.pickups?: SensePad[]` (all pads reported — map knowledge is public).
- `types.ts`: add `'pickup'` to `SenseEventKind`; event carries `pad?: SensePad['kind']`.
- `engine.ts`: `stepPads()` after `stepBullets()`.
- `runner.ts` fingerprint: append pad pickup records (`tick:padIdx:robotId`).
- `constants.ts`: `PAD_*` tuning constants.

**Rendering (BattleScene):**

- Pad markers: diamond/ring per type (team-neutral colors), pulse when active,
  dim when on cooldown. Pixel-art consistent, reuse decor/FX style.
- Pickup flash ring on collect.
- (Phase 1b, optional) active-effect pips on robot plates.

**Brains:** unchanged in P1 — robots blunder into pads emergently. Brains learning
to seek pads is follow-up work, not this unit.

## T1 — Map turrets

**Layout:** 2 turrets, mirror-symmetric, center column: (0.50w, 0.30h) and
(0.50w, 0.70h). Hotly contested by design.

**State machine:** DISABLED -> ACTIVE(team). No neutral decay: once owned, a
turret stays owned until recaptured.

- **Capture:** single progress value p in [-1, +1] (+ = team 0, - = team 1).
  A robot within capture radius R=70 pushes p toward its team at 1/240 per tick
  (4s of uncontested presence). Both teams present = contested = frozen.
  No robot in radius for 300 ticks = p decays toward 0.
  |p| >= 1 -> ACTIVE, owner = sign(p). From ACTIVE, enemy presence pushes p
  back; reaching the opposite pole flips ownership (recapture).
- This implements the approved mechanic: **disabled to start; a robot that
  maintains control around the turret for ~4s activates it for its team.**

**Active behavior:**

- Targets nearest enemy robot within range 260.
- Fires every 45 ticks (0.75s). Bullet speed = robot bullet speed.
- **Damage (starting point, MUST be tuned by eval): 6** (robot BULLET_DAMAGE = 12).
- Turrets are indestructible — capture/recapture is the counterplay (v1).
- Turret shots are foe-team bullets for the enemy: dodgeable, emit `hit-by`
  with `fromId: -1` (documented; no foe-contract violation — no loadout data).

**Sim touch points:**

- `types.ts`: `SenseTurret { x, y, state: 'disabled'|'active', owner: -1|0|1, progress: number }`;
  `SenseState.turrets?: SenseTurret[]`.
- Events: `'turret-captured'` and `'turret-flipped'` kinds, `fromId` = turret index.
- `engine.ts`: `stepTurrets()` with `stepPads()` (same slot, pads first).
- Fingerprint: turret state transitions (`tick:turretIdx:owner`).
- `constants.ts`: `TURRET_*` tuning constants.

**Rendering (BattleScene):**

- Structure: base ring + tower reusing the TOWER_HEAVY art family, tinted
  neutral gray when disabled, team color when owned. Capture-progress arc
  around the base while |p| in (0,1). Muzzle flash on fire. Disabled = dim.

**Damage balance — method, not just numbers:**

1. Baseline: rr board, turrets on, starting numbers.
2. Measure: capture rate per match, winner-had-turret correlation, draw-rate
   delta vs baseline, camp metric (% ticks a robot spends inside R).
3. Targets: first-capturer win rate 55-62% (worth contesting, not auto-win);
   draw rate must NOT rise vs baseline; camping must not beat roaming.
4. Levers in order: damage (4-8), fire interval (35-60), range (220-300),
   capture time (180-300 ticks), capture radius (60-80).
5. If degenerate (draw spikes, stall, camp-dominant): retune before promoting.
   Never promote red.

## Validation (both units)

- `npx tsc --noEmit` after every phase.
- Soak: `npm run test:sim` + new determinism cases (pad pickup, capture race,
  recapture, effect expiry).
- `npm run eval:smoke` (~1s sanity).
- Golden regen ONCE after T1 (combined), commits stay self-consistent.
- Manual: watch 2+ BattleScene matches — pads render/pickup flash visible,
  turret capture arc + activation + firing visible.
- Ranked eval for the turret balance targets above.
- Docs: ROBOT_API.md senses table + events (same commit).

## Sequencing / merge notes

- B3 is in flight on `complexity/b3` (touches src/robots, comms.ts) — no file
  overlap expected with this branch (sim engine, types, constants, BattleScene).
- W1 (asteroids) lands after: it takes the `stepHazards` slot right after
  `stepPads`, uses the `hazards` sense channel, and joins the same fingerprint
  regen discipline.
- Public board/showcase/verifier regen still needs Stefan's explicit ship approval.

## Open questions (decided unless data says otherwise)

1. Pads always-on vs modifier-gated? -> Always-on (map feature). Revisit if
   W1's OQ1 forces a global hazard/feature toggle.
2. Should an ACTIVE turret decay to neutral when abandoned? -> No (v1).
   Recapture is the counterplay; decay adds fiddly timers for little depth.
