# RobotArena

**Play it live: https://robotarena.vercel.app**

2D pixel-art robot battles in the browser. Every slot gets the **same skill budget**
and the same catalog — drafts, builds, and code are what differ. You write the
strategy, pick the loadout, and the arena settles the rest.

Built with [Phaser 4](https://phaser.io/phaser4). No backend: battles run as a
deterministic fixed-tick simulation entirely in the browser.

## Play

```sh
npm install
npm run dev
```

Open http://localhost:8080 (Space pauses, 1x/2x/4x changes sim speed). Pick 1v1, 2v2,
or 3v3, assign a robot to each slot, dress it up (callsign, paint, finish, motion
trails — all cosmetic, zero effect on performance), start the battle. Click a results
row to download that robot's source.

**Pilot mode:** hit PILOT 1V1 to drive slot 0's robot yourself against the slot 1
AI — WASD/arrows to drive, Q/E to strafe, mouse to aim the turret, Space to fire
(tap for a snap shot, hold to bank charge on charger builds, release for the charged shot), P to pause.
Your input flows through the same Intent pipeline as AI controllers, so the piloted
robot gets no special physics. Pilot matches stay out of the match history so
human games can't skew per-robot win rates.

Also from the menu: TOURNEY (bracket), SHOWCASE (champion gallery), LEAGUE
(Season 1 standings, fighter cards, and replay watching), WORKSHOP
(robot editor), DAILY (daily challenge), and WATCH REPLAY (replay a match from
its replay code).

**Not yet on main:** the RL Champion — an exported PPO policy bot
(`src/robots/rl-champion.ts`) — exists only on the `rl-bot-in-app` branch
and is not part of main.

## Project layout

- `src/sim/` — engine-agnostic battle simulation (no Phaser imports): fixed-timestep
  ticks, base constants, skill loadouts (`skills.ts`), sensing, combat, win
  conditions. Runs headless.
- `src/robots/` — one file per robot plus `registry.ts`. Each robot exports its
  `meta`, a default `loadout`, and a `create()` factory returning a `RobotController`.
- `src/robots/bt/` — the behavior-tree substrate and the MAP-Elites genomes
  the League fighters run.
- `src/game/` — Phaser app shell: menu + loadout editor, pixel-art battle
  renderer (`art.ts` holds the procedural sprite maps), results, export.
- `tools/soak.ts` — headless checks: determinism, intent clamping, error isolation,
  and bot-vs-bot soak across all modes (`npm run test:sim`).
- `docs/ROBOT_API.md` — the robot authoring contract.
- `CONTRIBUTING.md` — how to submit your own robot.

## Scripts

| Command                    | What it does |
| -------------------------- | ------------ |
| `npm run dev`              | Start the dev server (port 8080) |
| `npm run build`            | Production build into `dist/` |
| `npm run test:sim`         | Headless sim checks: determinism, intent clamping, error isolation, bot-vs-bot soak across 1v1/2v2/3v3 (`tools/soak.ts`) |
| `npm run eval:build`       | Bundle the eval harness (`tools/eval.ts`) |
| `npm run eval:smoke`       | Eval harness, smoke mode |
| `npm run eval:rr`          | Eval harness, round-robin mode |
| `npm run eval:ladder`      | Eval harness, ladder mode |
| `npm run eval:full`        | Eval harness, full mode |
| `npm run tune:build`       | Bundle the hillclimb tuner (`tools/hillclimb/tune.ts`) |
| `npm run tune`             | Run the hillclimb tuner |
| `npm run emit:showcase`    | Emit the public showcase gallery manifest from the frozen champion records (`tools/eval/showcase.ts`) |
| `npm run verify:manifests` | Re-sim every replay code carried by the public manifests and verify claimed outcomes (`tools/verify-manifest.ts`) |
| `npm run art:qa`           | Static checks over the procedural pixel art: palette membership, banned hexes, rectangular maps, per-sprite color budgets (`tools/art-qa.mjs`) |
| `npm run test:bt`          | Behavior-tree substrate tests: interpreter robustness, genome round-trips, champion pinning, determinism (`tools/test-bt.ts`) |

## Fairness model

Robots never touch engine state. Each tick they receive a read-only `SenseState`
and return an `Intent`; the engine clamps every input to the robot's effective
stats. Every slot gets the same skill budget (6 points) and the same catalog,
and loadouts are public — symmetric loadouts, so builds, not hidden stats, win.
Same tick, same API, same rules — only strategy and buildcraft differ.

## License

MIT (see `LICENSE`). Community-submitted robots are accepted under the same license.
