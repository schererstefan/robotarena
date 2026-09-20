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
| `events`       | What happened during the step just completed (empty at tick 0): `hit-by`, `kill`, `ally-down`, `foe-down`, `sudden-death-pulse`, `wall-bump`, `ram`. Sorted kind-then-id, capped at 8. |
| `bullets`      | Incoming foe-team bullets inside your sensor cone, nearest first, capped at 12: `x`, `y`, `vx`, `vy`, `distance`, `bearing`, `closing` (positive = approaching), `damage`. |
| `tracks`       | Engine-kept memory: one entry per living foe ever in your cone (`id`, `x`, `y`, `heading`, `speed`, `lastSeenTick`, `seenNow`), refreshed on every sighting, sorted by id. |
| `arena`        | Static layout: `id` (`open`/`blocks`), `obstacles` (`{x,y,w,h}`), `centerX`, `centerY`. Symmetric public state. |
| `zone`         | Safe circle: `phase` (`normal`/`shrinking`), `suddenDeathIn` (ticks), `circle` (`{x,y,r}`), `distToSafety`, `inside`. |
| `grid`         | Your team's 12×8 heat-map (`cell` 80): `foes` (presence from cone sightings, decays 1/tick) and `danger` (recent damage) integer arrays. |
| `match`        | Match state: `arena`, `modifiers`, `tickCap`, `killsYou`, `killsTeam`, `aliveFoes`. |

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
and collisions (`wall-bump`, `ram`). `bullets` shows incoming rounds your
tower currently covers, with closing speed for dodging. `tracks` is the
engine's memory of every foe your cone has seen — stale positions stay
available after the foe leaves the cone, flagged with `seenNow: false`.
`arena` is the static (symmetric, public) obstacle map plus the
`blocked.ahead` whisker for steering; `zone` is the sudden-death circle with
your distance to safety; `grid` is your team's coarse 12×8 heat-map of foe
presence and recent damage; `match` carries kills and the living-foe count.
All seven are fresh copies every tick — mutate them freely, nothing leaks
back into the sim. They are typed optional (treat them as possibly absent),
but the engine always provides them.

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

Missing, `NaN`, or non-numeric fields are treated as `0`/`false`. Out-of-range
values are clamped. There is no way to exceed your loadout's stats.

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
four center blocks (mirrored through the arena center); robots and bullets
collide with them, but your sensors don't report them — walls sense still
measures the outer walls only. Matches run 2.5 minutes, then sudden death:
a safe circle centered on the arena shrinks from full cover to zero over
30 seconds, pulsing 6 damage every 6 ticks to robots outside it (staggered
per robot, so both sides never pulse together). Only simultaneous
elimination draws — stalling the clock no longer saves you.

**Exhibition modifiers** (menu MODS panel; barred from stats, tagged in the
HUD): double damage (every shot ×2, all bullets render hot), hardcore fog
(your `sense.self.stats.sensorRange` and scan cone halve — read stats, never
hardcode 540), mirror mode (both teams run identical robots and builds).
Modded matches replay exactly via the same replay codes.

## Rules for robot code

1. **Deterministic only.** No `Math.random`, `Date.now`, network, or storage.
   Use `sense.rand()`. Same seed + same robots must replay identically.
2. **Fast.** `update` runs 60×/second per robot. No heavy loops or allocations
   that grow over time.
3. **Self-contained.** Import only from `../sim/*` and `./common.ts` (optional
   steering helpers: `aimTurret`, `steerTo`, `throttleFor`, `aimed`,
   `leadAngle`/`leadShot`, `dodgeVector`, `rayClearance`, `toGrid`,
   `manageCharge`, `createStallTracker`). No Phaser, no DOM, no Node APIs.
4. **No throwing.** Exceptions are caught and your robot idles that tick — but a
   robot that throws constantly is just parked scrap. Guard your math.
5. **State in closures.** Module-level mutable state is shared across matches;
   keep per-match memory inside `create()`.

`onSpawn(sense)` is optional and runs once at spawn (good for picking anchors or
initial headings).

## Built-in robots

Eight base bots ship in `src/robots/` (registry order is append-only: replay codes
index into it). Study them before writing your own.

| Bot | Style | Default build |
| --- | ----- | ------------- |
| Rusher | Charges the nearest foe head-on, weaving while it closes. | `OVR3 TRG1 PLT2` |
| Turret | Parks on a defensive anchor, spins its tower, leads shots. | `SRV1 SCN2 TRG2 MRK1` |
| Orbiter | Circle-strafes at mid range. | `OVR2 GYR2 TRG1 PLT1` |
| Wanderer | Roams random waypoints, snaps shots at whatever it sees. | `OVR2 SCN2 WND2` |
| Hunter | Pursues the weakest foe and leads its shots; banks charge at range. | `TRG2 MRK1 CHG2 PLT1` |
| Sniper | Camps a deep backfield anchor; charged long-range shots, retreats when rushed. | `SCN2 MRK2 CHG1 DDY1` |
| Brawler | Plated bruiser; walks the gun into the clinch and rams through. | `OVR2 TRG2 PLT2` |
| Ghost | Hit-and-run scout: strikes on a ready gun, breaks away on cooldown. | `OVR2 GYR2 WND1 SCT1` |
| Hunter HC1 | Hillclimb champion bred from hunter (run 20260920-002309). | `TRG2 CHG1 PLT2 NRP1` |

## Test your robot

```sh
npm run test:sim
```

Add your robot to the soak first (temporarily swap an id in `tools/soak.ts`, or
better: keep the committed soak on the launch five and run your own matchups in a
scratch script under `/tmp`). It must complete 1v1s without errors before it ships.
