# RobotArena Roadmap: 22 Improvement Phases

## Goal

Grow the shipped game (pixel-art battles + symmetric skill loadouts, live at
https://robotarena.vercel.app) through 22 independently shippable improvement
phases covering audio, readability, modes, content, platform reach, and
performance — without breaking determinism, the robot API contract, or the
existing verification gates.

## Success Criteria

- All 22 phases implemented on `main`, each in its own commit in roadmap order.
- After every phase: `tsc --noEmit` clean, `npm run build` succeeds,
  `npm run test:sim` passes, dev server serves the app (HTTP 200 on `/`).
- Sim changes stay deterministic (same seed + loadouts ⇒ identical fingerprint)
  and headless-testable; any robot-contract change ships with a
  `docs/ROBOT_API.md` update in the same commit.
- Final production deploy succeeds and serves the game.

## Context And Current Facts

- Repo: https://github.com/schererstefan/robotarena, branch `main`, deploys to
  Vercel on every push (`vercel.json`: `npm run build-nolog` → `dist/`).
- Sim: `src/sim/engine.ts` (60 Hz fixed tick, seeded RNG), `skills.ts` (9-skill
  catalog, 6-point budgets, charge mechanic), `types.ts` (SenseState/Intent).
- Robots: 5 built-ins in `src/robots/` with thematic loadouts; balance spread
  7/18/8/10/11 over 60 soak games.
- Shell: Phaser 4 pixel-art renderer (`src/game/art.ts` procedural textures),
  menu + loadout editor, results + export. No backend; static hosting only.
- Audio must respect the autoplay policy: a Web Audio context created outside
  a user gesture starts `suspended` and needs a user click to start [MDN].

## Constraints And Non-goals

- No backend, accounts, or databases in these 22 phases (localStorage only).
- No new npm dependencies without a stated reason; Phaser 4 + Vite stay pinned.
- No changes to the fairness premise: symmetric budgets, public loadouts.
- No silent scope creep per phase: each phase ships what its spec says.

## Key Decisions

1. **Commit-per-phase in roadmap order**, pushed once at the end (single final
   production deploy). Rollback of any phase = revert its commit.
2. **Subagent implementation in dependency waves** (shared checkout, sequential
   within a wave): Wave 1 (render/UI-only): 1, 2, 3, 17, 18, 20. Wave 2 (modes/
   data): 4, 5, 6, 14, 15, 16. Wave 3 (sim/gameplay): 7, 9, 10, 11, 12, 13, 21.
   Wave 4 (content/polish): 8, 19, 22. Each agent verifies its phases green.
3. **New robots and skills extend registries**, never special-case the engine:
   robots register in `registry.ts` + `sources.ts`; skills extend `SKILL_DEFS`
   with sanitize/compute STATS support.
4. **Phase 22 (strings) runs last** so the sweep covers every new UI string.

## Work Plan

### Phase 1 — Procedural sound engine
WebAudio bleeps (no assets): shoot, hit, explosion, UI click, win jingle.
Create/resume the AudioContext on first menu click (autoplay policy); mute
toggle in menu + `M` key. New `src/game/audio.ts`, wire into scenes.

### Phase 2 — Damage numbers + hit direction
Floating damage numerals on hits, brief edge indicator toward the last
attacker. Render-only, driven by snapshot diffs. BattleScene only.

### Phase 3 — Minimap
Live minimap in the HUD: dots per robot in team colors, hollow when dead.
Render-only. BattleScene only.

### Phase 4 — Replay codes
Encode seed + lineup ids + loadouts + game version into a shareable string;
menu "Watch replay" input restarts that exact match; pause + tick-step viewer.
New `src/sim/replay.ts`, MenuScene, BattleScene.

### Phase 5 — Tournament mode
Single-elim bracket (4/8 entries) of bot-vs-bot matches auto-run in the client
(headless Match, capped ticks/frame) with a bracket results screen. New scene.

### Phase 6 — Local match history + dashboard
localStorage match log (lineups, loadouts, winner, ticks) + menu stats panel
with per-robot win rates. New `src/game/history.ts`, MenuScene.

### Phase 7 — Arena obstacles + arena select
One obstacle layout (mirrored center blocks) with circle collision in the sim,
rendered walls, menu arena picker. Engine, constants, BattleScene, MenuScene.

### Phase 8 — Three new robots
Sniper (long-range camper), Brawler (plating brawler), Ghost (fast hit-and-run
scout), each with a thematic 6-pt loadout. `src/robots/*` + docs.

### Phase 9 — Skill catalog v2 (passives)
Four new skills: NanoRepair (+1.5 HP/s regen), Slipstream (+25% accel),
Deadeye (+10% bullet speed), Scout (position-only blips of out-of-cone foes at
2× range, no health). `skills.ts`, engine, soak, docs.

### Phase 10 — Active skills + HUD
Two actives via new `Intent` fields: Dash (burst move, 8 s cooldown), EMP
(brief enemy slow in radius, 12 s cooldown). HUD cooldown pips, AI hooks in 2
robots. Types, engine, BattleScene, robots, docs.

### Phase 11 — Team sensor sharing
Allies share foe sightings with a 30-tick delay as `shared: SensedRobot[]`
(position-only, no health). Engine, types, docs.

### Phase 12 — Sudden death
After the time cap, a shrinking safe circle damages outsiders instead of an
instant draw; draw only on simultaneous elimination. Engine, BattleScene
circle render, soak.

### Phase 13 — Pilot mode
Drive one robot with WASD + mouse-aim turret + Space fire/charge against AI,
through the same Intent pipeline (`PilotController`). BattleScene mode + docs.

### Phase 14 — Daily seed + local leaderboard
Daily seeded challenge (date-derived seed, fixed matchup) + best-result board
in localStorage. Depends on Phase 6 (`history.ts`). MenuScene.

### Phase 15 — In-browser robot workshop
Menu code editor (template + static sanity checks) producing a downloadable
robot file. No execution of user code in-app. New scene + docs.

### Phase 16 — Import robot (exhibition only)
Load a robot file/URL into an exhibition match via guarded dynamic import;
barred from tournaments/leaderboards with an on-screen banner. MenuScene,
BattleScene. Malicious files must not break the shell.

### Phase 17 — Accessibility
Colorblind-safe team palette toggle, reduced-motion mode (no shake/particles),
full keyboard menu navigation. Theme, scenes, CSS.

### Phase 18 — Touch + responsive
Touch-friendly menu controls, FIT-scaling audit, portrait letterbox layout.
Scenes, CSS.

### Phase 19 — Performance + auto-quality
Sprite texture atlas, pool audit, FPS meter behind a debug toggle,
auto-quality (particle counts by measured fps). `art.ts`, BattleScene.

### Phase 20 — Onboarding tutorial
Scripted spectated 1v1 with coach marks + guided loadout-editor tour.
Skippable, first-run flag. New overlay + MenuScene.

### Phase 21 — Exhibition modifiers
Toggleable rules: double damage, hardcore fog (halved sight), mirror mode
(same bot both sides). Barred from stats with a banner. Engine flags,
MenuScene, BattleScene.

### Phase 22 — Copy + strings pass
All user-facing strings into `src/game/strings.ts` with a tone/clarity review.
Grep audit proves no hardcoded UI strings remain. Runs last.

## Validation Plan

- Per phase: `tsc --noEmit`, `npm run build`, `npm run test:sim`, dev-server
  HTTP 200 on `/` and touched modules. Highest-risk checks: Phase 7 (soak on
  both arenas, spawns never inside blocks), Phase 10 (cooldown exactness +
  determinism), Phase 12 (zero 1v1 draws in round-robin).
- Sim/integration specifics: Phase 4 (same code ⇒ identical fingerprint),
  Phase 5 (8-bot tournament < 30 s), Phase 9 (no dominant build in soak),
  Phase 11 (deterministic shared sight), Phase 21 (each modifier flips a
  scripted matchup).
- Manual browser pass at the end: menu → loadout → battle → results → export
  on the production URL.

## Risks / Rollback

- Sim-scope creep breaking determinism: mitigated by per-phase soak gates.
- Phaser API misuse in new scenes: mitigated by reusing BattleScene/MenuScene
  patterns and the production build check.
- Rollback: revert the phase's commit; Vercel redeploys `main` on push.

## Open Questions

None — all product choices above use reversible defaults; balance tuning stays
a post-launch activity driven by Phase 6 telemetry.

## Sources

- https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices
