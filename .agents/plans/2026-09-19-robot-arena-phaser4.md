## Goal

Build RobotArena: a browser-based 2D robot-battle game on Phaser 4 where all robots share one identical platform (same chassis speed/max speed, same sensor tower opportunity, same gun) and differ only in player-written strategy/AI code. Ship with 5 built-in robots, 1v1/2v2/3v3 team battles, a documented robot-code API for real code authoring ("brass tacks," not visual scripting), a contribution path so the community can submit robots, and hosting of the game on the user's Vercel with the code on GitHub.

## Success Criteria

- A playable web build: pick a mode (1v1, 2v2, 3v3), pick robots per slot, run a battle to a win/lose/draw result in the browser.
- All robots run through one engine path with identical stat constants; no robot gets special speed, sensor, or weapon behavior outside the shared API.
- A documented robot interface (sense input, action output, per-tick budget) plus a contribution guide, such that a new robot is one self-contained code unit a third party can author and submit.
- 5 distinct built-in robots that demonstrably play differently and can all complete matches without errors.
- Code lives in a GitHub repo; production and per-branch preview builds deploy through the user's Vercel.

## Context And Current Facts

- Workspace `/Users/stefan/dev/robotarena` is empty and is not a git repo yet (verified this run); this is a greenfield scaffold.
- Engine is user-mandated: Phaser 4. Grounded facts: the `phaser` npm package (4.2.1 at time of check) ships built-in TypeScript declarations, installs via `npm install phaser`, supports WebGL and Canvas rendering, and supports JavaScript or TypeScript development. The official site provides an interactive scaffolder (`npm create @phaserjs/game@latest`) with JS and TS templates.
- Hosting is user-mandated: the user's Vercel. Grounded fact: Vercel performs automatic deployments on every branch push and on merges to the production branch for connected GitHub projects, which gives per-branch previews plus a production build with no extra CI needed for launch.
- "Submit it to GitHub" and community robot submissions both point to GitHub as the collaboration hub; no backend, account system, or database exists or is assumed.

## Constraints And Non-goals

- Constraints: Phaser 4; identical robot performance (same speed/max speed, sensor opportunity, weapon); real-code robot authoring; GitHub for code/collaboration; Vercel for hosting; launch with 5 robots and 1v1/2v2/3v3 modes.
- Non-goals for launch: user accounts, matchmaking/ladders/leaderboards, server-authoritative multiplayer or anti-cheat, mobile-native builds, visual/block-based robot builder, in-browser code editor (file-based authoring first; editor is a follow-up), monetization.

## Key Decisions

1. **Client-side authoritative simulation, no backend for launch.** The whole battle (fixed-timestep ticks, movement, sensing, combat resolution) runs deterministically in the browser. Why: identical-performance fairness is enforced by one shared tick/API; zero server cost/ops; fits static hosting on Vercel. Rejected for launch: server-authoritative sim (needed later only for ranked/anti-cheat play).
2. **One RobotController interface; engine never exposes internals to robot code.** Each tick, a robot receives a read-only sense-state object (own pose/velocity/health/ammo-cooldown, sensed opponents/obstacles per sensor rules, game clock) and returns an intent (throttle/turn, tower rotation, fire). The engine clamps everything to the shared constants. Untrusted/community code goes through this adapter only, with a per-tick execution guard. Full hardening/stronger isolation is a post-launch follow-up, explicitly not blocking launch.
3. **Git-based robot submissions for launch.** A robot is one directory (`robots/<name>/` with code + `meta.json`: name, author, version). Community path = fork/PR against documented API + contribution checklist; maintainers merge and the robot ships in the next deploy. Why: auditable, no backend, matches "submit to GitHub." Rejected for launch: upload portal with database (ops cost, moderation surface).
4. **Team modes share one code path.** 1v1/2v2/3v3 are the same battle with a team-size parameter, mirrored spawns, and team win condition (eliminate the opposing team). Friendly fire: off at launch (simpler rules, no griefing); alternative (friendly fire on) deferred as a variant.
5. **Scaffold from the official Phaser CLI, TypeScript template.** Base the repo on `npm create @phaserjs/game@latest` output and keep whatever dev/build tooling the template ships, then add `sim/`, `robots/`, and app shell layers. Pin the `phaser` version in package metadata. Why: official template tracks Phaser 4 conventions; TS gets built-in engine declarations.
6. **Five behavioral archetypes for launch robots:** Rusher (close distance, aggressive), Turret (holds ground, precise tower), Orbiter (circle-strafe at mid range), Wanderer (unpredictable movement, opportunistic fire), Hunter (tracks nearest opponent, leads shots). Distinct enough to prove the API supports varied strategies.

## Recommended Approach

Build a static web app: Phaser 4 renders the arena, while a small engine-agnostic simulation core (fixed timestep, seeded RNG) owns rules and fairness; robot code plugs in only via the RobotController adapter. Ship in this order: scaffold + repo conventions first (so robot API shape is settled early), then sim core + API, then the 5 robots against that API (they are the API's first customers and balance test), then the menu/battle/results shell, then GitHub + Vercel wiring and launch checks. Keep rendering and simulation separated so headless soak tests (bot-vs-bot matches with no rendering) can validate balance and determinism quickly.

## Work Plan

- **Phase 0 — Prerequisites (needs user input, see Open Questions).** Create GitHub repo (name, public/private, owner account/org); connect it to the user's Vercel project; confirm robot language default (assumed TypeScript with plain-JS accepted) and repo license. No code until repo target exists.
- **Phase 1 — Scaffold and conventions.** Generate base from `npm create @phaserjs/game@latest` (TS template); pin `phaser` version; establish layout (`sim/`, `robots/`, app shell, docs/); write README, robot API doc stub, and `CONTRIBUTING.md` (robot directory contract + checklist). Dependency: Phase 0.
- **Phase 2 — Simulation core + robot API.** Fixed-timestep tick, seeded RNG, identical stat constants, movement/sensor/weapon resolution, win/draw conditions, team-size parameter, mirrored spawns, no friendly fire; RobotController sense/intent contract with clamping and per-tick guard. Dependency: Phase 1.
- **Phase 3 — Five launch robots + balance pass.** Implement Rusher, Turret, Orbiter, Wanderer, Hunter against the Phase 2 API; fix API gaps the robots expose; run headless bot-vs-bot soak across 1v1/2v2/3v3. Dependency: Phase 2.
- **Phase 4 — App shell.** Mode select (1v1/2v2/3v3), per-slot robot picker, battle view, results screen, robot export (download a robot directory as a file for sharing/PR). Dependency: Phase 3.
- **Phase 5 — Publish and launch.** Push to GitHub, verify Vercel production + PR preview builds, run the Validation Plan end to end, tag launch version. Dependency: Phase 4.
- No PR/commit slicing is prescribed (greenfield, single-author start); keep history reviewable with one commit per phase at minimum.

## Validation Plan

- **Phase 1:** fresh clone installs and `npm run dev` serves locally; production build command succeeds; README + CONTRIBUTING render correctly. Highest-risk step overall is Phase 2's determinism check below, not scaffolding.
- **Phase 2:** fixed-seed headless match produces identical results across repeated runs (determinism); intent-clamping checks confirm overspeed/over-range/tower/fire violations are impossible via the API; all three team sizes reach a result (win/draw) without engine errors.
- **Phase 3:** every pair of launch robots completes a 1v1 soak without exceptions; at least one full round-robin each of 2v2 and 3v3 completes; no single robot wins every matchup (basic balance smell test; exact tuning is post-launch).
- **Phase 4:** manual browser pass — start each mode, assign robots, watch a full battle, see a correct results screen; export a robot and re-import it as a new directory successfully.
- **Phase 5:** GitHub repo is the source of truth; a test branch push yields a Vercel preview deployment and a merge to the production branch updates production (per Vercel's automatic Git deployments); full playthrough on the production URL.

## Risks / Rollback

- **Phaser 4 API churn:** mitigate by pinning the `phaser` version and isolating engine calls behind the sim/render boundary; upgrading is a deliberate step, never incidental.
- **Scope creep into backend/ranked play:** explicitly out of launch scope; the deterministic-sim design keeps that door open without building it now.
- **Untrusted community code:** launch posture is adapter-only access plus per-tick guard and human PR review; stronger isolation is a documented follow-up, not a launch blocker.
- **Balance is unproven until robots exist:** Phase 3 soak is the forcing function; robots are data, so rebalancing is a content change, not architecture.
- **Rollback:** every deploy comes from Git, so rollback is revert/re-push of a prior commit and Vercel redeploys on the branch push; no database or migration state exists to unwind.

## Open Questions

1. GitHub: new repo name, owner (personal account or org), public or private, and who grants access for the initial push?
2. Vercel: which account/team hosts the project, and will you connect the repo yourself or should the agent do it (needs your login/access)?
3. Robot language default: TypeScript-first with plain JS accepted (assumption) — acceptable?
4. License for the repo and for community-submitted robots (assumption: same permissive license for both unless you say otherwise)?
5. Any art/direction preference for the arena and robots (programmer-art shapes for launch vs. a particular style), or is visual style at the implementer's discretion?

## Sources

- https://phaser.io/phaser4
- https://www.npmjs.com/package/phaser
- https://vercel.com/docs/git
