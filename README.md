# RobotArena

**Play it live: https://robotarena.vercel.app**

2D robot battles in the browser. Every robot runs on the **identical platform** — same
chassis speed, same sensor tower, same gun. The only thing that differs is the code:
you write the strategy, the arena settles the rest.

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
  ticks, identical stat constants, sensing, combat, win conditions. Runs headless.
- `src/robots/` — one file per robot plus `registry.ts`. Each robot exports its
  `meta` and a `create()` factory returning a `RobotController`.
- `src/game/` — Phaser app shell: menu, battle renderer, results, export.
- `tools/soak.ts` — headless checks: determinism, intent clamping, error isolation,
  and bot-vs-bot soak across all modes (`npm run test:sim`).
- `docs/ROBOT_API.md` — the robot authoring contract.
- `CONTRIBUTING.md` — how to submit your own robot.

## Scripts

| Command            | What it does                              |
| ------------------ | ----------------------------------------- |
| `npm run dev`      | Start the dev server (port 8080)          |
| `npm run build`    | Production build into `dist/`             |
| `npm run test:sim` | Headless sim checks (no browser needed)   |

## Fairness model

Robots never touch engine state. Each tick they receive a read-only `SenseState`
and return an `Intent`; the engine clamps every input to the shared constants in
`src/sim/constants.ts`. Same tick, same API, same physics — only strategy differs.

## License

MIT (see `LICENSE`). Community-submitted robots are accepted under the same license.
