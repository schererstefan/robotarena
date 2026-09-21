# Robot API

This is the full contract for writing a RobotArena robot. If it isn't on this
page, your robot can't do it — that's the fairness guarantee.

## The one-file shape

A robot is a single TypeScript module in `src/robots/<id>.ts`:

```ts
import type { SkillLoadout } from '../sim/skills';
import type { Intent, RobotController, RobotMeta, SenseState } from '../sim/types';

export const meta: RobotMeta = {
    id: 'mybot',          // lowercase, must match the filename
    name: 'MyBot',        // display name
    author: 'you',        // your name or handle
    version: '1.0.0',
    description: 'What it does, in one line.',
};

// Default skill build (6 points max). Players may override it per slot.
export const loadout: SkillLoadout = { overdrive: 2, trigger: 2, plating: 2 };

export function create(): RobotController {
    // Closed-over state is your memory. It persists across ticks.
    let lastSeenX = 480;
    let lastSeenY = 320;

    function update(sense: SenseState): Intent {
        // ... your strategy ...
        return { throttle: 1, turn: 0, towerTurn: 0.5, fire: false, charge: false, dash: false, emp: false };
    }

    return { meta, loadout, update };
}
```

The controller contract is versioned: `ROBOT_API_VERSION` (currently `1`,
exported from `src/sim/types.ts`). Controllers may set the optional `api`
field to the version they target; it defaults to the current version and is
currently informational only — the engine never changes behavior on it.

Then register it in `src/robots/registry.ts` (one import + one entry) and in
`src/robots/sources.ts` (one `?raw` import + one entry, for in-game export).

Angles are radians: `0` = east (+x), positive = clockwise (screen coordinates,
y grows downward). The sim ticks at 60 Hz.

## What you receive: `SenseState`

| Field          | Contents                                                                 |
| -------------- | ------------------------------------------------------------------------ |
| `tick`, `time` | Match tick and seconds elapsed.                                          |
| `self`         | Your `id`, `team`, `x`, `y`, `heading`, `tower`, `speed`, `health`, gun `cooldown` (ticks until ready, `0` = ready), plus `stats` (effective values after skills), `charge`/`charged` (banked charge), `dashCd`/`empCd` (active cooldowns, `0` = ready), `slowed` (enemy EMP on you), your `loadout`, `lastDamage` (`{tick, amount, bearing, fromId}` of your last hit, or `null`), and `blocked.ahead` (whisker distance to the nearest wall/block along your heading). |
| `foes`         | Opponents **inside your sensor cone** this tick, nearest first: position, heading, speed, health, `distance`, absolute `bearing`. Empty when blind. |
| `allies`       | Teammates, always known (radio link): foe fields plus `tower`, gun `cooldown`, `charge`/`charged`, and public `loadout`. |
| `scout`        | Out-of-cone foe blips from the scout skill (empty without it), nearest first: live `x`, `y`, `distance`, `bearing`, but `heading`, `speed`, `health` always `0`. Covers foes within 2× your sensor range; never duplicates `foes`. |
| `shared`       | Foe sightings shared by allies, delivered **30 ticks late**, nearest first. Position-only: `id`, `team`, `x`, `y`, `distance`, `bearing` are valid; `heading`, `speed`, `health` are always `0`. Never includes foes you see yourself, your own sightings echoed back, dead foes, or anything in 1v1 (no allies). |
| `walls`        | Distance to each arena wall: `left`, `right`, `top`, `bottom`.           |
| `rand()`       | Deterministic random draw in `[0, 1)`. Use this for any randomness.      |
| `events`       | What happened during the step just completed (empty at tick 0): `hit-by` (`fromId` is the shooter, `-1` = map turret), `kill`, `ally-down`, `foe-down`, `sudden-death-pulse`, `wall-bump`, `ram`, `pickup` (`pickup` carries `pad`: the pad kind collected), `turret-captured` / `turret-flipped` (`fromId` is the turret index, broadcast to every living robot), `blast` (asteroid hit: `amount`, no `fromId` — the world did it). Sorted kind-then-id, capped at 8. |
| `bullets`      | Incoming foe-team bullets inside your sensor cone, nearest first, capped at 12: `x`, `y`, `vx`, `vy`, `distance`, `bearing`, `closing` (positive = approaching), `damage`. |
| `tracks`       | Engine-kept memory: one entry per living foe ever in your cone (`id`, `x`, `y`, `heading`, `speed`, `lastSeenTick`, `seenNow`), refreshed on every sighting, sorted by id. |
| `arena`        | Layout: `id` (`open`/`blocks`), `obstacles` (`{x,y,w,h}` barrier rects, seed-derived on `blocks`), `centerX`, `centerY`. Symmetric public state. |
| `zone`         | Safe circle: `phase` (`normal`/`shrinking`), `suddenDeathIn` (ticks), `circle` (`{x,y,r}`), `distToSafety`, `inside`. |
| `grid`         | Your team's 12×8 heat-map (`cell` 80): `foes` (presence from cone sightings, decays 1/tick) and `danger` (recent damage) integer arrays. |
| `match`        | Match state: `arena`, `modifiers`, `tickCap`, `killsYou`, `killsTeam`, `aliveFoes`. |
| `pickups`      | All 4 powerup pads in fixed pad order (public map knowledge, same for every robot): `{x, y, kind, active, respawnIn}`. `kind` is `amp`, `repair`, or `overdrive`; `active` is false while the pad is dark; `respawnIn` counts down to reactivation (`0` when active). |
| `turrets`      | Both map turrets in fixed turret order (public map knowledge, same for every robot): `{x, y, state, owner, progress}`. `state` is `disabled` while neutral, `active` once owned; `owner` is the owning team (`-1` while neutral, persists until recaptured); `progress` is capture lean in `[-1, +1]` (`+` = team 0, `-` = team 1). |
| `hazards`      | Announced asteroid strikes (empty when none, or all match with `noHazards`): live telegraphs counting down plus the impact-tick frame (`ticksToImpact` 0), sorted by countdown then position — `x`, `y`, `ticksToImpact`, `radius` (70), `damage` (25). World-public: every living robot sees every strike. |
| `inbox`        | Teammates' radio from exactly 6 ticks ago, sorted (`sent`, `from`), capped at 4. Never your own echo, never from the dead, never cross-team. Empty in 1v1. |

Sensor cone: 540 units range, ~63° wide, centered on your `tower` angle. You only
see foes your tower points at — scanning is part of the game. In team games,
allies radio you their sightings 30 ticks late via `shared`: stale,
position-only blips (no health). Treat them as "was there half a second ago,"
not as targeting data. The scout skill adds a second channel, `scout`: live
position-only blips (no health) for foes anywhere within 2× your sensor range,
even behind you. Unlike `shared`, blips are current positions — swinging your
tower onto a blip bearing converts it into a full sighting.

The second sense group is event and memory channels. `events` tells you what
the last step did to you — being hit (`hit-by` carries `amount`/`bearing`/
`fromId`, and `self.lastDamage` keeps the latest one all match), scoring
(`kill`), deaths on either side (`ally-down`/`foe-down`), sudden-death ticks,
and collisions (`wall-bump`, `ram`), plus asteroid hits (`blast`: `amount`,
no `fromId`). `bullets` shows incoming rounds your
tower currently covers, with closing speed for dodging. `tracks` is the
engine's memory of every foe your cone has seen — stale positions stay
available after the foe leaves the cone, flagged with `seenNow: false`.
`arena` is the (symmetric, public) barrier map plus the
`blocked.ahead` whisker for steering; `zone` is the sudden-death circle with
your distance to safety; `grid` is your team's coarse 12×8 heat-map of foe
presence and recent damage; `match` carries kills and the living-foe count;
`hazards` lists announced asteroid strikes (90-tick telegraph, 70-radius
blast for 25 damage, mirrored across the center column) so you can dodge —
empty when none are announced or the match runs `noHazards`.
All of these channels are fresh copies every tick — mutate them freely,
nothing leaks back into the sim. They are typed optional (treat them as
possibly absent), but the engine always provides them.

## Powerup pads

Four static pads sit at fixed arena fractions (0.22/0.78 × 0.30/0.70),
mirrored through the arena center so neither team gains an edge. Pad kinds
cycle `amp` → `repair` → `overdrive` with a per-match seed offset, so the
layout varies per match but replays exactly. Blunder into one (within 26
units) to collect it; the pad goes dark for 15 s, then reactivates.

- **AMP** (`amp`, gold diamond): 2× bullet damage for 6 s. Does not stack
  with the double-damage exhibition modifier — the strongest multiplier wins.
- **REPAIR** (`repair`, green cross): +60 HP instantly, clamped to max health.
- **OVERDRIVE** (`overdrive`, white rings): +35% move speed for 6 s.

You get a `pickup` event (with `pad`) on the collecting tick; timed effects
clear on death (no drops). The shipped brains seek pads opportunistically
(`src/robots/common.ts`: repair when hurt, amp/overdrive when blind, nearest
active pad with hysteresis — dark pads are never chased, and amp is skipped
under double-damage since bonuses never stack); your strategy to write is
when to overrule that: read `sense.pickups`, steer with `moveMode`, and
remember every robot sees the same pads.

## Map turrets

Two turret structures sit on the arena center column (0.50 × 0.30/0.70),
mirrored so neither team gains an edge. They are structures, not robots:
indestructible, with no cone, no loadout, and no foe-contract data. Both
start `disabled` (neutral) and are captured by presence:

- **Capture:** a robot within 100 units pushes progress toward its team;
  90 ticks of uninterrupted, uncontested presence captures the turret.
- **Contest:** robots from both teams inside the radius freeze progress
  (it neither advances nor resets).
- **Decay:** 300 ticks with no robot in radius starts decaying uncaptured
  progress back toward neutral. Owned turrets never decay.
- **Ownership persists** until the other team pushes progress all the way
  to its own pole (recapture takes 180 uninterrupted ticks from a held
  pole, since the edge must cross the full span).

A captured turret fires at its nearest living enemy within 260 units every
45 ticks: 6 damage per shot at robot bullet speed. Turret rounds are real
bullets — walls, blocks, range, and no-friendly-fire apply exactly as for
robot bullets, and they show up in `sense.bullets` like any incoming round.
A turret hit reports `hit-by` with `fromId: -1` (also in
`self.lastDamage.fromId`); turret kills credit no robot. First capture
broadcasts `turret-captured` to every living robot, ownership changes
broadcast `turret-flipped` (both carry the turret index in `fromId`).
Read `sense.turrets` and contest early: a captured turret keeps firing for
its owner even while you push the lean back, so recapture under fire is
costly.

## What you return: `Intent`

Every field is optional-with-default: return only what you need
(`{ fire: true }` is a complete Intent) and the engine fills the rest.

| Field       | Default | Meaning                                                        |
| ----------- | ------- | -------------------------------------------------------------- |
| `throttle`  | `0`     | `-1` (full reverse) to `1` (full speed). Clamped.              |
| `turn`      | `0`     | `-1` (hard left) to `1` (hard right) chassis turn. Clamped.    |
| `towerTurn` | `0`     | `-1` (counter-clockwise) to `1` (clockwise) tower spin. Clamped. |
| `fire`      | `false` | `true` to shoot. Only fires when `cooldown` is `0`.            |
| `charge`    | `false` | Hold to bank charge (charger skill only). Slows drive to 75%.  |
| `dash`      | `false` | `true` to dash (2.5× top speed, 12 ticks). 8 s cooldown.       |
| `emp`       | `false` | `true` to pulse EMP (foes in 220 u slowed to 45% for 3 s). 12 s cooldown. |
| `strafe`    | `0`     | `-1` (port) to `1` (starboard) lateral drive at 50% top speed. Clamped, normalized with `throttle`. |
| `moveX`/`moveY` | `0` | Drive-assist target (arena coords). Read only when `moveMode` is `1`. Clamped to the arena. |
| `moveMode`  | `0`     | `1` = engine drives to (`moveX`, `moveY`), overriding `throttle`/`turn`. |
| `aimMode`   | `0`     | `0` manual, `1` track `aimTarget`, `2` track with lead.        |
| `aimTarget` | `-1`    | Robot id the turret assist tracks (`-1` = none).               |
| `aimLead`   | `false` | `true` upgrades `aimMode` `1` to lead like `2`.                |
| `fireMode`  | `0`     | `1` = also auto-fire on a locked aim assist (same cooldown gate). |
| `radio`     | `null`  | One team message per tick (`{kind, x, y, foe, role, slot, bid}`), delivered 6 ticks late. |

Missing, `NaN`, or non-numeric fields are treated as `0`/`false`. Out-of-range
values are clamped, and unknown mode values fall back to manual (`0`). There
is no way to exceed your loadout's stats.

**Assists** (same caps as manual control, no hidden power):

- **Strafe** (`strafe: ±1`): lateral drive at 50% of top speed, applied
  instantly (no accel ramp). Forward + lateral are normalized together, so
  diagonals never exceed top speed — strafe trades forward pace for
  sidestep, it never adds pace.
- **Drive assist** (`moveMode: 1`, `moveX`/`moveY`): the engine steers to
  your target with the shared steer law (gain 2.5, back-up when the target
  is behind, hold within 24 units), overriding your `throttle`/`turn`.
  Your `strafe` still applies on top.
- **Turret assist** (`aimMode`, `aimTarget`): the engine swings your tower
  (same `towerRate` cap) at the target's best *legal* position: live cone
  sighting first, then scout blip, then stale shared sighting, then stale
  track. `aimMode: 2` (or `aimLead: true`) leads the shot, but only off a
  live cone sighting — stale data aims at position only. Dead, allied,
  or unknown ids fall back to your manual `towerTurn`.
- **Hold-to-fire** (`fireMode: 1`): the gun also fires on its own whenever
  an aim assist is locked and the tower bears (within 0.07 rad), even with
  `fire: false`. The cooldown gate is unchanged.
- **Radio** (`radio`): one `{kind, x, y, foe, role, slot, bid}` message per
  tick to your team, delivered 6 ticks late via `sense.inbox`. Kinds:
  `ping`, `contact`, `claim`, `slot`, `focus`, `ack`. Payloads:
  `focus{foe}` votes your target, `contact{x,y,foe}` shares a foe
  position, `claim{role,bid}` bids for a squad role (highest bid wins,
  ties to the lowest id), `slot{role,slot}` heartbeats a held formation
  slot; `ping`/`ack` are free-form. Unused fields are `0` (`foe: -1` =
  none). Unknown kinds are dropped, `foe` ids are liveness-checked at
  send, and dead robots neither send nor receive (in-flight mail from a
  robot that dies is dropped). Your own messages are never echoed back.

Application order each tick: brains → radio collect → dash/EMP → move
assist → drive normalize → turret assist → fire gate → bullets → pads →
map turrets (capture, then fire) → hazards → sudden death.

## Team radio: the `comms.ts` helpers

The engine only routes mail; decisions live in `src/robots/comms.ts`
(import it like `common.ts`). `castFocusVote`/`focusTarget` run focus
fire: vote your target each tick, and take the lowest-id live sender's
vote as your target override (firing still needs your own cone).
`castContact`/`latestContact` share foe positions for blind teammates to
chase. `resolveRoles` settles `claim{role,bid}` mail by sealed-bid
auction (highest bid wins, ties to the lowest id), and `formationSlot`
maps a slot index onto ring geometry around an anchor. Hunter votes
focus, ghost reports contact — read them before rolling your own.

`src/robots/roles.ts` builds squad roles on top: `castClaim` /
`castSlotHold` send sealed role bids and slot heartbeats,
`collectClaims` + `myRole` settle the auction from your inbox plus your
own bid, `latestSlotHold` reads mates' heartbeats, and
`createRoleTracker` runs the whole loop — claim, incumbency stickiness,
sparse heartbeats, re-resolve when the live set changes — with
`roleGoal` mapping a settled role onto a formation slot around the
target. The one radio slot per tick is shared with focus votes, so
claims go out only while unsettled and holds every 12 ticks; with no
allies the tracker idles (1v1 behavior unchanged). Hunter is the
reference implementation: role drive in the flank band, B2 aim intact.

## Skills: symmetric loadouts

Every slot gets the same budget (**6 points**) and the same catalog. Fairness is
symmetric: anyone can run any legal build, and loadouts are public (shown as
codes like `OVR2 TRG2 PLT2` on the results screen). Never hardcode the base
constants — read your effective values from `sense.self.stats` instead.

| Skill (code)   | Max | Effect per rank                                              |
| -------------- | --- | ------------------------------------------------------------ |
| Overdrive (OVR)| 3   | +8% top speed                                                |
| Gyro (GYR)     | 3   | +12% turn rate                                               |
| Servos (SRV)   | 3   | +12% tower speed                                             |
| Longscan (SCN) | 3   | +15% sensor range                                            |
| Wideband (WND) | 2   | +0.25 rad sensor cone                                        |
| Trigger (TRG)  | 3   | −3 ticks gun cooldown                                        |
| Marksman (MRK) | 2   | +12% gun range                                               |
| Charger (CHG)  | 2   | Unlock charge banking; rank 2 banks faster (20 vs 30 ticks)  |
| Plating (PLT)  | 2   | +15 max health                                               |
| NanoRepair (NRP)| 2  | +1.5 HP/s health regen                                       |
| Slipstream (SLP)| 2  | +25% acceleration                                            |
| Deadeye (DDY)  | 3   | +10% bullet speed                                            |
| Scout (SCT)    | 1   | Out-of-cone foe blips at 2× sensor range (no health)         |

**Charge mechanic:** with the charger skill, holding `charge` while the gun is
ready banks up to a full charge. Holding `charge` slows drive to 75% whenever
held (even while cooling down, when nothing banks). Firing consumes the bank
for `damage × (1 + charge × (mult − 1))` with mult 2. The bank decays over ~4 s
when not banking. Without the skill, `charge` does nothing.

**Edges worth knowing:** cooldown bottoms out at 8 ticks regardless of Trigger
stacking; towers pre-aim at the nearest foe on spawn; bullets spawn 18 units
ahead of center and that head start counts against range; each robot gets an
independent random stream per tick, so your `rand()` draws never shift another
robot's; match seeds are coerced with `>>> 0` (fractional/negative/NaN seeds
alias — use positive integers). NanoRepair regen caps at max health and ticks
every tick, even during sudden death; Slipstream only changes how fast you
reach top speed, not the top speed itself; Deadeye's faster bullets still die
at the same gun range; Scout blips never include foes your cone already sees.

**Validation:** ranks clamp to max, unknown ids drop, and over-budget loadouts
shed ranks from the end of the catalog until legal. Same loadout + same seed
replays identically.

## Active skills: dash and EMP

Every robot has both actives from the spawn tick — they cost no skill points
and need no unlock. Each is gated by its own long cooldown, shown under every
chassis in battle as `D`/`E` pips (filled = ready).

- **Dash** (`dash: true`, 8 s cooldown): 2.5× top speed for 12 ticks (0.2 s),
  starting the same tick. It multiplies your throttle, so dash with drive
  held — toward a foe to engage or away to escape; dashing while parked
  does nothing. Read `sense.self.dashCd` (`0` = ready).
- **EMP** (`emp: true`, 12 s cooldown): every foe within 220 units drives at
  45% top speed for 3 s, starting the same tick. Allies (and you) are immune.
  The cooldown starts even when no foe is in radius, so check the range first.
  Read `sense.self.empCd`; `sense.self.slowed` tells you when an enemy pulse
  has you.

Both trigger only when their cooldown is `0`; holding them `true` re-fires
the moment they come ready, so pulse them. Like every Intent field, a missing
`dash`/`emp` reads as `false`, so old robots compile and run unchanged.

## Shared base platform (before skills)

From `src/sim/constants.ts`: top speed 150 u/s (reverse ×0.6), turn 2.7 rad/s,
tower 3.6 rad/s, gun range 470, 0.4 s cooldown, 12 damage, 100 health, no
friendly fire. Arena is 960×640 with mirrored spawns. The BLOCKS layout adds
four barrier segments, dealt from the match seed (2 drawn rects + their
center mirrors, so both teams face identical terrain; same seed + loadouts
⇒ identical layout, and replay codes are unchanged — the layout is derived,
not stored). Robots collide with barriers (stop/slide push-out, no
tunneling: segments are far thicker than one drive step) and bullets die on
impact. Barriers are public: `sense.arena.obstacles` lists the rects,
`self.blocked.ahead` measures to the nearest wall *or barrier* along your
heading, and `common.ts` `rayClearance(x, y, angle, obstacles)` tests a
firing lane against them. No new sense fields or events were added —
`walls` still measures the outer walls only. Barriers stay in the midfield
band with 56px+ gaps between every pair, so every gap fits a robot and no
pocket ever seals; sudden death still breaks any stall. Matches run
2.5 minutes, then sudden death:
a safe circle centered on the arena shrinks from full cover to zero over
30 seconds, pulsing 6 damage every 6 ticks to robots outside it (staggered
per robot, so both sides never pulse together). Simultaneous elimination
draws — stalling the clock no longer saves you (past the tick cap the
engine falls back to total health, then damage dealt, with an exact tie
staying a draw).

**Exhibition modifiers** (menu MODS panel; barred from stats, tagged in the
HUD): double damage (every shot ×2, all bullets render hot), hardcore fog
(your `sense.self.stats.sensorRange` halves while the scan cone keeps full
width — read stats, never hardcode 540), mirror mode (both teams run identical robots and builds),
clear skies (`noHazards`: no asteroid strikes — strikes are on by default).
Modded matches replay exactly via the same replay codes.

## Rules for robot code

1. **Deterministic only.** No `Math.random`, `Date.now`, network, or storage.
   Use `sense.rand()`. Same seed + same robots must replay identically.
2. **Fast.** `update` runs 60×/second per robot. No heavy loops or allocations
   that grow over time.
3. **Self-contained.** Import only from `../sim/*`, `./common.ts` (optional
   steering helpers: `aimTurret`, `steerTo`, `throttleFor`, `aimed`,
   `leadAngle`/`leadShot`, `dodgeVector`, `rayClearance`, `toGrid`,
   `manageCharge`, `createStallTracker`), `./comms.ts` (team radio:
   `castFocusVote`, `focusTarget`, `castContact`, `latestContact`,
   `resolveRoles`, `formationSlot`). No Phaser, no DOM,
   no Node APIs. (`./roles.ts` squad-role helpers are shipped-robot
   internals — user robots cannot import them; the workshop rejects
   anything outside `../sim/*`, `./common.ts`, and `./comms.ts`.)
   Two refinements: (a) robots loaded through the in-game importer
   (Menu → IMPORT, exhibition only) must be **single-file plain JavaScript**
   — value imports cannot be resolved from a blob module, so inline any
   helpers you need, and strip type annotations (the importer runs the file
   untranspiled; the workshop `.ts` download is for pull-request
   submission);
   (b) `./brain.ts`, `./genome.ts`, and sibling-robot imports
   (`./hunter`, …) are internal-only: shipped robots are multi-file, user
   robots stay within `../sim/*` + `./common.ts` + `./comms.ts`.
4. **No throwing.** Exceptions are caught and your robot idles that tick — but a
   robot that throws constantly is just parked scrap. Guard your math.
5. **State in closures.** Module-level mutable state is shared across matches;
   keep per-match memory inside `create()`.

`onSpawn(sense)` is optional and runs once at spawn (good for picking anchors or
initial headings).

## Adaptive brain

Hunter runs `src/robots/brain.ts`: a 6-mode utility scorer. Every tick each
mode bids from the current sense — `engage` (close and finish, stronger
against weak or distant foes), `retreat` (low health or forced out of the
safe circle), `kite` (crowded: back off to standoff range), `flank`
(mid-range tangent approach), `focus` (a live teammate's vote for a foe in
your cone), `roam` (blind: sweep last-known positions). The incumbent keeps
a `stayBonus`, so ties hold and the brain doesn't flicker between modes;
challenger ties break toward safety (`retreat` first, `roam` last). The
sudden-death circle overrides everything: caught outside while shrinking,
the brain retreats to safety no matter the bids. Firing always needs your
own cone — votes and tracks steer, they never shoot.

Personalities are presets (`BRAIN_PRESETS`), not forks: rusher is
bloodthirsty, sniper kites long, brawler barely retreats. Hunter, rusher,
and brawler run the full brain by default; ghost, sniper, turret, and
wanderer reuse its shared target pick (`pickTarget` with the same four
policies) inside their own logic; the orbiter preset is defined and
validated, ready to wire. Brain knobs are the `brain.*` genome group
(`retreatHp`, `kiteRange`, `flankRange`, `stayBonus`, `aggression`,
`focusBonus`, `orbitDir`) and tune like any other param.

## Built-in robots

Eight base bots ship in `src/robots/` (registry order is append-only: replay codes
index into it). Study them before writing your own.

| Bot | Style | Default build |
| --- | ----- | ------------- |
| Rusher | Charges the nearest foe head-on, weaving while it closes. | `OVR1 SCN1 TRG2 PLT2` |
| Turret | Parks on a defensive anchor, spins its tower, leads shots. | `SRV1 SCN2 TRG2 MRK1` |
| Orbiter | Circle-strafes at mid range. | `OVR2 SRV1 TRG2 PLT1` |
| Wanderer | Roams random waypoints, snaps shots at whatever it sees. | `OVR2 SCN1 WND1 TRG1 PLT1` |
| Hunter | Adaptive brain: pursues, kites, flanks, retreats, and focuses with its team. | `OVR2 TRG2 PLT2` |
| Sniper | Camps a deep backfield anchor; charged long-range shots, retreats when rushed. | `SCN2 TRG1 MRK1 CHG1 DDY1` |
| Brawler | Plated bruiser; walks the gun into the clinch and rams through. | `OVR1 GYR1 TRG2 PLT2` |
| Ghost | Hit-and-run scout: strikes on a ready gun, breaks away on cooldown. | `OVR1 GYR2 WND1 PLT1 SCT1` |
| Hunter HC1 | Hillclimb champion bred from hunter (run 20260920-002309). | `TRG2 CHG1 PLT2 NRP1` |
| Rusher HC1 | Hillclimb champion bred from rusher (run 20260920-010027). | `SCN2 TRG1 PLT2 NRP1` |
| Orbiter HC1 | Hillclimb champion bred from orbiter (run 20260920-010338). | `TRG2 CHG1 PLT2 NRP1` |
| Turret HC1 | Hillclimb champion bred from turret (run 20260920-010715). | `TRG2 CHG1 PLT2 NRP1` |
| Wanderer HC1 | Hillclimb champion bred from wanderer (run 20260920-011225). | `TRG3 PLT1 SLP1 SCT1` |
| Sniper HC1 | Hillclimb champion bred from sniper (run 20260920-011554). | `SCN2 CHG2 PLT1 NRP1` |
| Brawler HC1 | Hillclimb champion bred from brawler (run 20260920-012043). | `TRG3 PLT1 SLP1 SCT1` |
| Ghost HC1 | Hillclimb champion bred from ghost (run 20260920-012240). | `OVR1 TRG2 MRK2 SCT1` |
| Hunter HC2 | Hillclimb champion bred from hunter (run 20260920-012539). | `TRG2 CHG1 PLT2 NRP1` |

## Test your robot

```sh
npm run test:sim
```

Add your robot to the soak first (temporarily swap an id in `tools/soak.ts`, or
better: keep the committed soak on the launch five and run your own matchups in a
scratch script under `/tmp`). It must complete 1v1s without errors before it ships.
