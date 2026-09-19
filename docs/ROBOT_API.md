# Robot API

This is the full contract for writing a RobotArena robot. If it isn't on this
page, your robot can't do it — that's the fairness guarantee.

## The one-file shape

A robot is a single TypeScript module in `src/robots/<id>.ts`:

```ts
import type { Intent, RobotController, RobotMeta, SenseState } from '../sim/types';

export const meta: RobotMeta = {
    id: 'mybot',          // lowercase, must match the filename
    name: 'MyBot',        // display name
    author: 'you',        // your name or handle
    version: '1.0.0',
    description: 'What it does, in one line.',
};

export function create(): RobotController {
    // Closed-over state is your memory. It persists across ticks.
    let lastSeenX = 480;
    let lastSeenY = 320;

    function update(sense: SenseState): Intent {
        // ... your strategy ...
        return { throttle: 1, turn: 0, towerTurn: 0.5, fire: false };
    }

    return { meta, update };
}
```

Then register it in `src/robots/registry.ts` (one import + one entry) and in
`src/robots/sources.ts` (one `?raw` import + one entry, for in-game export).

Angles are radians: `0` = east (+x), positive = clockwise (screen coordinates,
y grows downward). The sim ticks at 60 Hz.

## What you receive: `SenseState`

| Field          | Contents                                                                 |
| -------------- | ------------------------------------------------------------------------ |
| `tick`, `time` | Match tick and seconds elapsed.                                          |
| `self`         | Your `id`, `team`, `x`, `y`, `heading`, `tower`, `speed`, `health`, and gun `cooldown` (ticks until ready, `0` = ready). |
| `foes`         | Opponents **inside your sensor cone** this tick, nearest first: position, heading, speed, health, `distance`, absolute `bearing`. Empty when blind. |
| `allies`       | Teammates, always known (radio link), same fields as foes.               |
| `walls`        | Distance to each arena wall: `left`, `right`, `top`, `bottom`.           |
| `rand()`       | Deterministic random draw in `[0, 1)`. Use this for any randomness.      |

Sensor cone: 540 units range, ~63° wide, centered on your `tower` angle. You only
see foes your tower points at — scanning is part of the game.

## What you return: `Intent`

| Field       | Meaning                                                        |
| ----------- | -------------------------------------------------------------- |
| `throttle`  | `-1` (full reverse) to `1` (full speed). Clamped.              |
| `turn`      | `-1` (hard left) to `1` (hard right) chassis turn. Clamped.    |
| `towerTurn` | `-1` (counter-clockwise) to `1` (clockwise) tower spin. Clamped. |
| `fire`      | `true` to shoot. Only fires when `cooldown` is `0`.            |

Missing, `NaN`, or non-numeric fields are treated as `0`/`false`. Out-of-range
values are clamped. There is no way to exceed the shared platform.

## Shared platform (all robots, always)

From `src/sim/constants.ts`: top speed 150 u/s (reverse ×0.6), turn 2.7 rad/s,
tower 3.6 rad/s, gun range 470, 0.4 s cooldown, 12 damage, 100 health, no
friendly fire. Arena is 960×640 with mirrored spawns. Matches cap at 2.5 minutes,
then a draw.

## Rules for robot code

1. **Deterministic only.** No `Math.random`, `Date.now`, network, or storage.
   Use `sense.rand()`. Same seed + same robots must replay identically.
2. **Fast.** `update` runs 60×/second per robot. No heavy loops or allocations
   that grow over time.
3. **Self-contained.** Import only from `../sim/*` and `./common.ts` (optional
   steering helpers: `aimTurret`, `steerTo`, `throttleFor`, `aimed`). No Phaser,
   no DOM, no Node APIs.
4. **No throwing.** Exceptions are caught and your robot idles that tick — but a
   robot that throws constantly is just parked scrap. Guard your math.
5. **State in closures.** Module-level mutable state is shared across matches;
   keep per-match memory inside `create()`.

`onSpawn(sense)` is optional and runs once at spawn (good for picking anchors or
initial headings).

## Test your robot

```sh
npm run test:sim
```

Add your robot to the soak first (temporarily swap an id in `tools/soak.ts`, or
better: keep the committed soak on the launch five and run your own matchups in a
scratch script under `/tmp`). It must complete 1v1s without errors before it ships.
