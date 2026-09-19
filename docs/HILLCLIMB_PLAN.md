# Unified Build Plan: Hillclimb → Champions → Leaderboard → Showcase

Synthesis of 10 research reports (sessions under `subagent/01a0bbf*`). Read-only w.r.t. the repo; builder owns implementation.
Source reports: sensors, motors, adaptive, comms, harness, hillclimb, leaderboard, genome, fairness, showcase.

## 0. Ground facts (measured, not assumed)

- Sim: 60 Hz, `MAX_TICKS_TOTAL` = 11,400. `Match` is headless-safe (zero phaser/DOM imports in `src/sim` + `src/robots`), deterministic per seed (per-(robot,tick) mulberry32 streams). Same seed ⇒ bit-identical fingerprint.
- Speed: ~1.5 ms/match 1v1 (~690 matches/s/thread), ~5 ms 3v3. Full soak (336 1v1s + extras) runs in ~0.6–0.7 s. A full 130k-match tune ≈ 4 min single-threaded.
- Current `Intent`: `{throttle, turn, towerTurn, fire, charge}` (all required). Phase-10 Dash/EMP were **not present** at audit time; Phase 9 (`scout` field) was uncommitted; 8 robots, 13-skill catalog.
- `npm run test:sim` had **2 pre-existing failures** at audit: `zero 1v1 draws on blocks` (draws=4/168 — treat draws as first-class) and `compact 3v3 code stays short` (13-skill catalog overflowed the RA2 bit budget — 3v3 showcase codes may need RA1 fallback).
- Codec ceilings (hard): `SKILL_DEFS.length ≤ 15`, skill rank ≤ 3 encodable, `robotIndex < 32`. Appends only, never renumber.
- Team behavior today is zero: no bot reads `sense.allies` or `sense.shared`; only ghost reads `sense.scout`; nobody reads `self.health` except via charge logic.

## 1. Unified API decisions

### 1.1 `SenseState` additions (all additive, optional, fresh copies; `src/sim/types.ts`)

```ts
interface SenseState {
  tick; time; self: SenseSelfEx; foes; allies: SensedAlly[];
  scout; shared; walls; rand;
  events?: SenseEvent[];    // {tick, kind:'hit-by'|'kill'|'ally-down'|'foe-down'|
                            //  'sudden-death-pulse'|'wall-bump'|'ram', amount?, bearing?, fromId?}
                            // current tick only, cap ~8, sorted kind-then-id
  bullets?: SensedBullet[]; // {x,y,vx,vy,distance,bearing,closing,damage?}, sees-cone-gated,
                            // nearest-first, cap ~12
  tracks?: TrackedFoe[];    // {id,x,y,heading,speed,lastSeenTick,seenNow} engine-kept memory
  arena?: SenseArena;       // {id:'open'|'blocks', obstacles:{x,y,w,h}[], centerX, centerY} static, frozen
  zone?: SenseZone;         // {phase:'normal'|'shrinking', suddenDeathIn, circle:{x,y,r}, distToSafety, inside}
  grid?: SenseGrid;         // {w,h,cell, foes:number[], danger:number[]} 12x8 shared frozen, int decay
  match?: SenseMatch;       // {arena, modifiers, tickCap, killsYou, killsTeam, aliveFoes}
  inbox: InboxMessage[];    // radio (§1.3), cap COMMS_INBOX_MAX=4, sorted (sent,from)
}
interface SenseSelfEx extends SenseSelf {
  lastDamage: {tick, amount, bearing, fromId} | null;
  dashCd: number; empCd: number;   // ticks remaining, 0 = ready (Phase 10)
  blocked: {ahead: number};        // whisker raycast along heading, O(4 obstacles)
}
// SensedAlly extends SensedRobot with tower, cooldown, charge, charged, loadout (public).
```

Fidelity rules (fairness F4): full-fidelity foe data only from the sensor cone; `scout`/`shared`/blips stay position-only; never expose enemy cooldown/charge exactly; bullet sense is cone-gated + range-capped.

### 1.2 `Intent` additions (all optional-with-default; `sanitizeIntent` clamps every new field day one)

```ts
interface Intent {
  throttle?: number; turn?: number; towerTurn?: number; fire?: boolean; charge?: boolean; // now optional
  strafe?: number;                 // -1..1 lateral, STRAFE_FACTOR ~0.5 universal (sole balance risk)
  moveX?: number; moveY?: number; moveMode?: 0 | 1;  // 1 = assist via shared steer law, same caps
  aimMode?: 0 | 1 | 2; aimTarget?: number; aimLead?: boolean; // 0 manual, 1 track, 2 lead; legal-knowledge only
  fireMode?: 0 | 1;                // 0 single (current), 1 hold-to-fire (same cooldown gate)
  dash?: boolean; emp?: boolean;   // rising-edge, engine-owned tick cooldowns (480 / 720), skill-gated
  radio?: OutboxMessage | null;    // 1 msg/tick max (§1.3)
}
export const ROBOT_API_VERSION = 1; // robots may export api?: number (default 1)
```

Explicitly rejected: engine `burst`/charge-macros (new power, needs re-costing), `Intent.role` (hidden channel — roles go through radio, §1.3), `Intent.formation` (implement as `common.ts` helper; no engine authority needed).

Same-commit rule: any `Intent` change updates `pilot.ts`, `workshop.ts` template + checker (requires-subset, not requires-all-five), and `docs/ROBOT_API.md`.

### 1.3 Comms mailbox (`COMMS_DELAY = 6`, `COMMS_INBOX_MAX = 4`)

```ts
export type CommsKind = 'ping'|'contact'|'claim'|'slot'|'focus'|'ack';
export interface OutboxMessage { kind: CommsKind; x: number; y: number; foe: number; role: number; slot: number; bid: number; }
export interface InboxMessage extends OutboxMessage { from: number; sent: number; } // engine-stamped
```

Engine only routes (exact-delay delivery like `SENSOR_SHARE_DELAY`, team-scoped, dead senders neither send nor receive, foe-id liveness validated at send tick, unknown kind ⇒ dropped, copies-not-aliases). Resolution layer lives in `src/robots/comms.ts` as pure deterministic helpers: `resolveRoles` (sealed-bid auction, ties ⇒ lowest id), `formationSlot`, `castFocusVote`/`focusTarget` (lowest-id live sender wins). Receivers treat votes as steering hints; firing still requires own-cone confirmation.

### 1.4 Genome schema (unified v1 — merges genome + hillclimb + adaptive proposals)

```jsonc
{
  "genome_version": 1, "bot": "ghost",
  "params": {
    "steer.gain":  {"type":"float","min":1,"max":6,"default":2.5},
    "target.policy":{"type":"enum","values":["first","nearest","weakest","strongest"],"default":"first"},
    "orbit.dir":   {"type":"enum","values":[-1,1],"default":1},
    "loadout":     {"type":"loadout","budget":6,"default":{"overdrive":2,"gyro":2,"wideband":1,"scout":1}}
  }
}
```

Groups: `steer.* turret.* fire.* drive.* engage.* orbit.* weave.* anchor.* kite.* charge.* target.* lead.* stall.* search.* brain.* loadout`. Hillclimb's three chromosomes map onto this: behavior slice = `params` minus loadout; loadout chromosome = `loadout` (always through real `sanitizeLoadout`); team genome = `{team_genome_version:1, slots:[{bot, genome}], constraints:{max_copies_per_bot:2}}`. Adaptive `BrainParams` becomes the `brain.*` group for brain-converted bots (not a parallel format). Genome hash = **sha256** of canonical JSON (hex). Mutation ops: gaussian perturb (σ≈10% range) on floats/ints, resample enums, budget-preserving rank-swap on loadouts, slot-swap/copy on teams.

### 1.5 Harness CLI (`tools/eval/` + `tools/hillclimb/`, esbuild-bundle idiom like `test:sim`)

```
npm run eval:smoke   # all-pairs x2 seeds 1v1 open — PR gate, <5s, fails on errors/draw-spike
npm run eval:rr      # round-robin x50 seeds x both arenas (~5.6k matches, ~10s)
npm run eval:ladder  # Swiss ladder, 6 rounds
npm run eval:full    # rr x200 + 2v2/3v3 spot matrix — nightly, workers on
npm run tune -- --archetype hunter --teamSize 1   # hillclimb optimizer
tools/eval.ts --mode rr --seeds 50 --arena both --jobs 8 --bots hunter,orbiter --vs all --out eval/out-<date>/
```

Results: `results.jsonl` (one row/match: winner, ticks, suddenDeath, draw, damage, shots, kills, survivalTicks, errors; exhibition-tagged rows excluded from Elo) + `summary.json` (per-bot rollup, Elo start **1000** K=32 in deterministic job order, H2H matrix, per-arena splits, `meta` block with schedule/seeds/versions). Reducer sorts by jobIndex so `--jobs 1` ≡ `--jobs 10` byte-identical. Fingerprint sampled (every Nth + all draws) vs checked-in golden (per-platform advisory). In-thread default; `worker_threads` pull-queue pool only behind `--jobs N`. Exit codes: 0 pass, 1 on `errors>0`, 2 on balance-smell regression.

### 1.6 Hillclimb loop (two-stage, CRN-paired)

- Fitness (lexicographic): primary = win rate (draw 0.5; `MAX_TICKS_TOTAL`-timeout loss = full loss); tiebreak `F = damageDiff_norm + 0.2*survivalBonus − stall − passivity − errors(−1 floor)`.
- Stage A: Successive Halving over loadout×composition at default params (N=256 × 4 seeds × 2 opp, keep 1/4, double seeds) → 8–16 survivors.
- Stage B: random-restart hillclimb (R=8, G≤25, 4 challengers/gen); accept iff challenger beats incumbent on the **identical seed×matchup pool** (CRN) + sign test (≥60% of ≥24 non-tied pairs); re-evaluate incumbent each gen.
- Anti-overfit: 32 TRAIN_SEEDS / 16 disjoint VALID_SEEDS rotated per gen; rotating opponents, both arenas, both sides (mirror swap); leave-one-bot-out + top-3-champion gauntlet; promote only if validWin ≥ trainWin − 5pp; Hamming-1 loadout diversity guard; regression veto (must not lose H2H vs default build, p<0.05).
- Budgets: train pool 128 matches (~0.2 s); lineage ~16k matches (~25 s); full run ~130k matches (~4 min single-threaded). Defaults: `evalsPerCandidate=128/512`, `generations≤25`, `restarts=8`.
- Manifest per run: `tools/hillclimb/runs/<ts>-<archetype>.json` (runId, gitSha, gameVersion, full config, seeds, history, champion genome+hash+wins) + `encodeReplay` code per champion validation match.
- Champion freeze: codegen `src/robots/<id>.ts` (params as named constants + `// tuned: run <runId>` comment, optimized loadout, bumped version, `author:"RobotArena (hillclimb)"`), append-only registry+sources, `ROBOT_API.md` table, showcase entry in `tools/hillclimb/champions/<id>.json`; gate on tsc + build + test:sim + live regression veto.

### 1.7 Leaderboard architecture (Phase A now; Phase B pending §4 decision)

```ts
interface LeaderboardEntry { botId; baseRobotId; genomeHash; elo; wins; losses; draws; evals;
  showcaseCode: string; gameVersion: string; updatedAt: string; }
```

Phase A (no backend): `public/leaderboard.json` + `src/game/onlineBoard.ts` (`fetchOnlineBoard()` with timeout → localStorage fallback) + MenuScene ONLINE tab reusing stats rows + watch-per-code. Local runner emits manifests; `tools/verify-manifest.ts` re-sims; maintainer commits. Phase B (if approved): `api/leaderboard.ts` (GET, KV ZSET `lb:{season}:board`, 60 s SWR) + `api/submit.ts` (POST: canonical-protocol validate → headless re-sim → ZADD); KV layout `lb:{season}:bot:{hash}`, `lb:{season}:ip:{hash}` throttle (5 submits/day); trust root = server re-sim, HMAC only for runner identity; season = game version.

### 1.8 Showcase UX (S0–S5; static-manifest driven, zero dead UI when absent)

`public/data/showcase.json` (season, version, per-champion `{botId, author, seedLoadout, champLoadout, stats{before,after}, featuredReplays[{label,code,outcome}], board}`) → `src/game/showcase.ts` loader/validator (no Phaser imports) → new `ShowcaseScene` (gallery + before/after compare overlay + online-board tab, TournamentScene pattern, registered in `main.ts`); Menu SHOWCASE button (hidden if no manifest) + marquee ticker; `BattleRequest.showcase?` (+ optional `reel:{codes,index}`) with HUD tag, results NEXT/EXIT reel buttons, 4 s skippable auto-advance, `NOT RECORDED` caption, history exclusion exactly like replay/pilot. VS-SEED = explicit two-loadout request (no new modifier). Soak gate: every featured code must decode + re-sim to claimed outcome.

## 2. Ordered build phases

**Phase 0 — Contract hardening + baseline (0.5–1 d).**
Files: `src/sim/types.ts` (ROBOT_API_VERSION, Intent optional), `src/sim/engine.ts` (id-tiebreak on foes/scout/shared sorts; `Match.runToEnd(maxGuard)` helper), `tools/soak.ts` (assert `SKILL_DEFS.length ≤ 15`, maxRank ≤ 3; perf gate: per-robot mean update <0.1 ms, fail on single-tick spike), `src/game/workshop.ts` (checker → known-fields/subset). Re-baseline the 2 failing soak checks against the just-landed phases 8–10 (bot count dynamic everywhere, no hardcoded pair counts).
Gate: tsc ✓, test:sim ✓ (new baselines recorded), build ✓. No behavior change.

**Phase 1 — Eval harness (1.5–2 d).**
New: `tools/eval.ts` (~120), `tools/eval/schedule.ts` (roundRobin/ladder/pool + `(base + i*0x9e3779b9)>>>0` seeds) (~150), `tools/eval/runner.ts` (wrap runMatch, single snapshot read at end) (~100), `tools/eval/worker.ts` + `pool.ts` (~150), `tools/eval/stats.ts` (JSONL, rollup, Elo, H2H, smell checks) (~200), `tools/eval/report.ts` (summary.json + table + delta) (~120); `package.json` scripts `eval:smoke/rr/ladder/full`; checked-in golden fingerprints + CI wiring. No sim changes.
Gate: tsc ✓, `eval:smoke` <5 s ✓, `--jobs 1` vs `--jobs 8` byte-identical summary ✓, test:sim ✓, build ✓.

**Phase 2 — Genome schema + first parameterized factories (2–3 d).**
New: `src/robots/genome.ts` (schema types, `PARAM_RANGES`, clamp/validate, canonical-stringify + sha256 hash). Refactor hunter (+1 more, e.g. orbiter) magic numbers → params with defaults = current behavior; loadout genome path through `sanitizeLoadout`. Param groups per §1.4; `leadAngle` dedup into `common.ts` here.
Gate: tsc ✓, test:sim ✓ (defaults reproduce old fingerprints exactly), build ✓; new unit-ish checks: default-params ≡ legacy behavior.

**Phase 3 — Hillclimb MVP, end-to-end on current I/O (2–3 d).**
New: `tools/hillclimb/` (genome defs, mutation ops, CRN eval loop, Successive Halving, sign-test promotion), fitness spy wrapper, manifest writer, champion codegen. Scope: hunter + loadout-only Stage A first. New script `npm run tune`.
Gate: tsc ✓, a full hunter tune completes (~4 min budget) ✓, manifest + replay codes verify ✓, codegen'd bot passes test:sim round-robin ✓, build ✓.

**Phase 4 — Sense expansion, slices A→B→C (4–5 d, parallelizable with Phase 5).**
A (0.5 d): `lastDamage`, `zone`, static `arena`, `match`, `SensedAlly` extension. B (1–1.5 d): per-tick event buffer + damage-site hooks, `sees`-gated `bullets`. C (1–1.5 d): `tracks` last-seen store, global per-tick `grid`. D (1 d): `common.ts` helpers (`leadShot`, `dodgeVector`, `toGrid`…) + 2 bots using new senses. Each slice: types + engine + docs + soak asserts (fingerprint over new fields, tamper/copy tests).
Gate per slice: tsc ✓, test:sim ✓ (determinism + new-channel checks), build ✓.

**Phase 5 — Intent expansion + Dash/EMP (3–4 d + 1–2 d gates; coordinate with concurrent builder — adopt landed phase-10 shapes if present, else implement §1.2).**
Files: `types.ts`, `engine.ts` (sanitize + application order), `constants.ts`, `skills.ts` (dash/emp defs — catalog then exactly 15/15: §3 note), `pilot.ts`, `workshop.ts`, `ROBOT_API.md`; exact-cooldown tests + determinism soak + full 60-game balance soak (strafe lands behind small `STRAFE_FACTOR` first).
Gate: tsc ✓, test:sim ✓ (incl. balance spread, no sweep), build ✓.

**Phase 6 — Comms (4–5 d).**
Files: `constants.ts` (COMMS_DELAY/INBOX_MAX), `types.ts`, `engine.ts` (sanitize radio, `PendingRadio[]`, `inboxFor`), new `src/robots/comms.ts` helpers, 2 bots wired (hunter `focus`, ghost `contact`), `ROBOT_API.md`, soak `sharing`-mirror block (nothing before tick 6, exact-delay match, team isolation, cap/priority, garbage clamping, dead-sender drop, auction convergence).
Gate: tsc ✓, test:sim ✓, build ✓; balance check that focus-fire doesn't dominate 3v3.

**Phase 7 — Adaptive brain rollout (3–4 d; optional track, feeds `brain.*` genome group).**
New: `src/robots/brain.ts` (6-mode utility scorer + hysteresis, `pickTarget`, `safeCircleFor`, `PARAM_RANGES`, presets per robot). Convert hunter first, then 7 presets (personalities kept as mode flavors). Tests: mode transitions, hysteresis, zone override, determinism.
Gate: tsc ✓, test:sim ✓ (no 1v1 regression vs pre-brain bots), build ✓.

**Phase 8 — Full tune + champion freeze (1–2 d + compute).**
Run the §1.6 loop per archetype (1v1 first; 2v2/3v3 team search only after 1v1 proven — quadratic space), freeze champions via codegen flow, record showcase codes.
Gate: tsc ✓, test:sim ✓ (new bots in round-robin; watch no-sweep + draws checks), build ✓, regression veto re-run live ✓.

**Phase 9 — Leaderboard Phase A + Showcase (5–7 d combined; slices: watch-flow first, compare/board second).**
New: `public/leaderboard.json`, `public/data/showcase.json` + emitter in eval tooling, `src/game/onlineBoard.ts`, `src/game/showcase.ts`, `src/game/scenes/ShowcaseScene.ts`; edits: `MenuScene.ts` (SHOWCASE + ONLINE tab), `BattleScene.ts` (flag/HUD/reel/exclusion), `main.ts` (scene registration), `tools/verify-manifest.ts`, soak manifest+replay gates. Manual browser pass.
Gate: tsc ✓, test:sim ✓ (manifest schema + featured-replay determinism), build ✓, browser smoke ✓.

**Phase 10 — Leaderboard Phase B (2–3 d, only if §4 approved).**
New: `api/leaderboard.ts`, `api/submit.ts` (esbuild-bundled sim for re-sim), Vercel KV wiring, throttle, deploy. Client prefers API, falls back to bundled JSON.
Gate: tsc ✓, test:sim ✓, build ✓, staging submit→board round-trip ✓.

Critical path: 0 → 1 → 2 → 3 → 8 → 9 (≈ 12–17 d + tune compute). I/O expansion (4/5/6) and brain (7) run parallel to 3 and feed 8; re-run 8 after any I/O change (optimizer feels a new landscape).

## 3. Contradictions resolved (explicit)

| # | Conflict | Resolution |
|---|---|---|
| C1 | Comms delay: comms report says 6 ticks; fairness A3 says mirror `shared` with ≥30t | **Adopt 6 ticks.** Fairness's ≥30t assumed an unvalidated channel; comms's design adds foe-liveness validation at send, position-only content, inbox cap, and the own-cone-to-fire rule, which address the wallhack concern without full staleness. Backstop: if 3v3 soak shows focus-fire dominance, bump `COMMS_DELAY` toward 30 (one constant + soak re-run). |
| C2 | Obstacle sense: sensors propose full static obstacle map; fairness A2 says whisker/range-limited or skill-cost | **Adopt static `arena` map + `blocked.ahead` whisker.** Obstacles are symmetric public state (same for both teams, reveal no foe info), so F4 channel-parity (which governs *foe* fidelity) doesn't apply; pre-aim risk is contained by position-only blips + own-cone-to-fire. Revisit only on soak evidence. |
| C3 | Genome format: three proposals (hillclimb chromosomes vs genome flat-dict vs adaptive BrainParams) | **Unified §1.4:** genome report's flat-dict JSON is the container; hillclimb's chromosomes are slices of it; adaptive's BrainParams is the `brain.*` group. One schema, one hash (sha256), one mutation library. |
| C4 | `Intent.role` (motors: reject) vs role claims in radio (comms: `claim{role,bid}`) | **Compatible — no `Intent.role`.** Roles exist only as delayed radio payload resolved by library helpers, per motors's sanction. Same for formation (helper-only, both agree). |
| C5 | Elo seed: harness 1000 vs leaderboard 1200 (both K=32) | **1000 everywhere.** Leaderboard Phase A adopts the harness convention; one-line change in board seeder. |
| C6 | Genome hash: hillclimb sha1 vs leaderboard sha256 | **sha256 hex everywhere** (dedup key + manifest). |
| C7 | Tool layout: `tools/eval/*` vs `tools/hillclimb.ts` vs `tools/hillclimb/` | **`tools/eval/`** (eval harness) + **`tools/hillclimb/`** (optimizer) + **`tools/verify-manifest.ts`** (shared verifier for leaderboard submits and showcase gates). |
| C8 | Intent optional vs required (fairness lists as unresolved) | **Optional-with-default.** Motors and fairness's own migration plan agree; fairness's question is answered by its own §3 step 2. Migrate in Phase 0 with workshop checker update. |
| C9 | Per-tick wall-clock budget (fairness unresolved: enforcible?) | **Tests + review only** (soak perf gate from Phase 0), no in-engine timeouts — wall-clock in-engine would break determinism D1. |
| C10 | "Online board": leaderboard Phase A static vs showcase static-vs-backend question | Same question — see §4. Both reports independently converge on static-first. |
| C11 | Aim assist (motors engine `aimMode`) vs sensors `common.ts` helpers | **Both, layered:** engine assist (capped at `towerRate`, legal-knowledge-only, unverified ids fall back to manual) + `common.ts` math helpers. No conflict — helpers don't need engine authority. |

Two hard ceilings the builder must respect: (i) dash/emp skills fill the catalog to exactly 15/15 — any further skill requires `REPLAY_FORMAT_COMPACT = 3` + dual decoder; (ii) `test:sim` baselines must be re-taken after phases 8–10 settle (bot count dynamic, draws first-class).

## 4. Open question — the ONE backend decision

**Static JSON vs Vercel KV/serverless for the online leaderboard?**

- *Static-first (recommended):* ship Phase A (`public/leaderboard.json` + `verify-manifest.ts` + maintainer commits) on day one — $0, roadmap-compliant ("no backend" constraint ends with the 22 phases but static hosting is the current posture), reviewable, rollback-by-revert. Proves the board UI, schema, and showcase flow before any infra.
- *KV/serverless later:* add Phase B (`api/submit` with server-side re-sim as trust root + `api/leaderboard` on Vercel KV) only when live submissions are wanted. ~2–3 d + Upstash free-tier→~$0–10/mo. Postgres rejected as overkill (<1k entries); Blob/Edge Config rejected as wrong tools.
- Both leaderboard and showcase reports independently recommend this sequence. **Recommendation: approve static-first now; defer the KV decision until Phase 9 ships and submission volume justifies it.**

## 5. Effort rollup

| Phase | Days |
|---|---|
| 0 hardening | 0.5–1 |
| 1 harness | 1.5–2 |
| 2 genome + 2 factories | 2–3 |
| 3 hillclimb MVP | 2–3 |
| 4 sense A–D | 4–5 |
| 5 intent + actives + gates | 4–6 |
| 6 comms | 4–5 |
| 7 brain | 3–4 |
| 8 full tune + freeze | 1–2 + compute |
| 9 board-A + showcase | 5–7 |
| 10 board-B (if approved) | 2–3 |
| **Total serial** | **~30–41 d**; critical path (0→1→2→3→8→9) **~12–17 d**, rest parallelizable |

## Appendix — unresolved items with provenance

- [leaderboard] Genome representation for hillclimbed bots (param vector? full source? base+loadout?) — **resolved by §1.4** (param-vector genome + loadout + base id), kept here for audit.
- [leaderboard] Open vs trusted-runner-only submissions (drives HMAC/rate-limit needs) — open; Phase A sidesteps (maintainer commits), Phase B needs the call.
- [leaderboard] Vercel plan limits (Hobby 10 s function timeout vs manifest size) — open; cap manifest matches so re-sim fits 10 s, or require Pro 60 s for Phase B.
- [leaderboard] Phases 8–10 landing may change SKILL_DEFS/registry and invalidate board versioning — mitigated by Phase 0 re-baseline + season-per-game-version.
- [genome] `foes[]` ordering semantics (is `foes[0]` nearest?) — **resolved**: sensors report confirms nearest-first; fairness adds id-tiebreak (Phase 0).
- [genome] Team size / match format for team-genome slot count — resolved: slots = teamSize 1–3 (replay caps teamSize ≤ 3).
- [genome] Whether hillclimb scope includes loadouts or params-only — **resolved**: includes loadouts (§1.4, §1.6 Stage A).
- [fairness] Exact new I/O fields planned (Dash/EMP only, or broader sensor/comms set)? — **resolved**: broader set per §1.1–§1.3.
- [fairness] Intent optional vs required? — **resolved**: optional (C8).
- [fairness] Per-tick wall-clock budget enforcible under static-hosting constraint? — **resolved**: tests+review only (C9).
- [showcase] Do eval/hillclimb JSON outputs already exist, or is the manifest schema from scratch? — from scratch per §1.5–§1.6 + §1.8 manifest shapes.
- [showcase] "Online board" = shipped static JSON or real backend? — see §4 (static-first recommended).
- [showcase] VS-SEED: new BattleRequest fields vs exhibition modifier? — **resolved**: explicit two-loadout `BattleRequest` extension, no new modifier (§1.8).
- [showcase] Featured-replay version-gating when registry/SKILL_DEFS append? — open; standing rule is append-only keeps codes decodable; Phase 9 adds pinned-code golden fingerprints per format (fairness §3 step 5) to catch semantic drift.
- [showcase] Is skills.ts/registry.ts (8 robots, 13 skills) stable to design against given concurrent phases 8–10? — mitigated by Phase 0 re-baseline; treat counts as dynamic.
- [harness] (implicit) Cross-CPU float behavior not guaranteed — goldens are per-platform advisory, documented, not hard gates. Preserved as standing caveat.
- [hillclimb] 3v3 compact-code overflow (13-skill catalog) may force RA1 fallback for 3v3 showcase codes until fixed — preserved; Phase 9 emitter must handle both formats.
