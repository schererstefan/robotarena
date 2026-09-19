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

## Project layout

- `src/sim/` — engine-agnostic battle simulation (no Phaser imports): fixed-timestep
  ticks, base constants, skill loadouts (`skills.ts`), sensing, combat, win
  conditions. Runs headless.
- `src/robots/` — one file per robot plus `registry.ts`. Each robot exports its
  `meta`, a default `loadout`, and a `create()` factory returning a `RobotController`.
- `src/game/` — Phaser app shell: menu + loadout editor, pixel-art battle
  renderer (`art.ts` holds the procedural sprite maps), results, export.
- `tools/soak.ts` — headless checks: determinism, intent clamping, error isolation,
  and bot-vs-bot soak across all modes (`npm run test:sim`).
- `docs/ROBOT_API.md` — the robot authoring contract.
- `CONTRIBUTING.md` — how to submit your own robot.

## Scripts

| Command               | What it does                              |
| --------------------- | ----------------------------------------- |
| `npm run dev`         | Start the dev server (port 8080)          |
| `npm run build`       | Production build into `dist/`             |
| `npm run test:sim`    | Headless sim checks (no browser needed)   |
| `npm run *-nolog`     | Same as above without the log banner; Vercel uses `build-nolog` |

## Fairness model

Robots never touch engine state. Each tick they receive a read-only `SenseState`
and return an `Intent`; the engine clamps every input to the robot's effective
stats. Every slot gets the same skill budget (6 points) and the same catalog,
and loadouts are public — symmetric loadouts, so builds, not hidden stats, win.
Same tick, same API, same rules — only strategy and buildcraft differ.

## License

MIT (see `LICENSE`). Community-submitted robots are accepted under the same license.
