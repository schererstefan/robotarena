# RobotArena Fidelity Build Plan (unified synthesis)

Synthesized from 10 fidelity-research briefs (session logs under `…/01a0bb82-…/subagent/`).
Source tags: `[sprites] [arena] [combat] [ui] [anim] [audio] [light] [pipe] [read] [ref]`.

## 0. Ground rules (apply to every phase)

- **Render-only. `src/sim/*` is untouched.** No engine/snapshot/getter changes of any kind, including
  "pure derivation" getters. All inference (speed, dashing, impacts, attribution) is render-side from
  existing snapshots + position deltas. Replay fingerprints must stay identical.
- **Procedural only.** Hand-authored string pixel-maps in `src/game/art/*.ts` count as code, not assets,
  and are allowed. No binary/network assets. **No new npm deps** (kills vitest-based testing; validation is
  runtime `?debugart` instead — see C11). Webfont deferred — see C10.
- **Reduced-motion + a11y on every item.** Follow the in-flight Phase-17 pattern: branch on the builder's
  motion flag (`if (!this.reducedMotion)` + instant/static fallback). Never color-only (pair with shape,
  text, or position). Flash caps: no full-screen flash >100 ms, no periodic strobing (see C13).
- **Builder coordination (Phases 16–19 in flight, same files).** Builder owns: atlas pipeline, `accessibility.ts`/
  `nav.ts` wiring, auto-quality, motion-flag API. Fidelity work: (a) lands no atlas code; new textures go
  through the builder's intake procedure (TBD — Appx A4); (b) does not change particle/bullet/dmg-number
  pool sizes without builder agreement (see C16); (c) rebases onto 17/18/19 before Phase 1.
- **Standard gate (every phase):** `npx tsc --noEmit` → `npm run test:sim` (must pass unchanged) →
  `npm run build-nolog` → browser smoke listed per phase. (Use `build-nolog`: plain `build` spawns a
  background `log.js` proc.)

## 1. Perf budgets (hard)

- Hot loop: zero new per-frame allocations; all additions O(N), N ≤ 8 robots (4v4 ceiling assumed; Appx A18).
- Particles: stay inside existing pools (128 spark / 40 bullet / 20→28 dmg text only with builder sign-off);
  no constant emitters except capped wreck-smoke (≤24 live smoke particles total, hard-stop 20 s after death).
- Graphics: all new transient shapes go into the existing single dynamic-Graphics redraw; minimap throttled
  to every 3rd tick. No per-particle / per-bullet filters, ever.
- Filters (Phase 6 only): ≤2 persistent fullscreen passes, WebGL-only with Canvas graceful-degrade
  (same information, less glow — C7/C8), all behind the Phase-19 auto-quality kill-switch.
- VRAM ≤ 4 MB total; `ensureArtTextures` bake ≤ 100 ms (console-measured); floor bake fixed per P0 (P7).
- Audio: keep `SHOOT_MIN_GAP`-style rate limits on every new voice; kill stinger ducks, never stacks; music
  scheduler checks `muted` and stops on scene shutdown.

## 2. Phases (quick wins first)

### Phase 0 — Foundations & free wins (~0.5 d) [pipe] [ui] [sprites]
Goal: faster boot, honest palette, locked quality floor.
- `art.ts`: P7 `bakeArenaFloor` → single `ImageData` + RGB LUT (~10–50× faster); purge dead bakes
  (`tile_floor`, `panel_tile`, `tower` dup-key; KEEP `tracer/ring_fx/treads_*/recoil_*` — claimed by Phases 1–3).
- Delete dead `PALETTE_ADDITIONS` in `art/fx.ts`, `art/floor.ts`; fix chassis header comment (`c`/`b` in use).
- New `art/validate.ts` + `?debugart` hook in `ensureArtTextures` (rectangular rows, known charset, declared
  dims); ~30-line 4x-grid preview overlay in `MenuScene` (hidden key). No vitest (C11).
- `theme.ts`: fix PS2P sizes to 8px multiples (title 40→32, banner 28→24, buttons off PS2P at 9/11px onto
  UI-mono stack), raise `faint #5d6a78` → `#7d8b9b` (≥4.5:1), centralize stray `#ffd23f`/`0x1d2530`/`#ffffff` (~20 spots).
- `ui.ts`: button press state (down-tint dip + 80 ms scale 0.96→1, gated) [ref-Q8].
- Gate + smoke: boot-to-menu time down; `?debugart` clean; small text legible; press states visible.

### Phase 1 — Combat punch (~2 d) [ref-T1] [combat] [read] [sprites]
Goal: every hit/kill lands. All in `BattleScene.ts` (+ `art.ts`/`customize.ts` for tint).
- Hitstop: gate `acc` stepping 2–5 frames on kill, 2 on charged hit; skip under reduced-motion [ref-Q1].
- Trauma shake: replace fixed `shake(180,0.006)` with accumulator, squared decay, scaled kill > charged > hit;
  kills only (+ charged), never per-hit [ref-Q4; kills `light-2` fixed flash+shake in favor of this carrier].
- `ring_fx` shockwave on kills + charged hits (scale-out + fade) [ref-Q3]; staged explosion: 60 ms white
  `boom_1` hold + camera `flash(≤90ms)` + expanding ring + 3–5 smoke embers, ~600 ms [combat-P1].
- Hurt-flash: 2-frame white tint blink on damaged chassis [ref-Q2].
- Damage numbers: tiers (12px white normal / 16px gold + scale-pop charged/killing / 12px red `−N` SD ticks /
  green `+N` regen ≤1/s/robot) [read-4 + ref-Q6]; banner scale 1.3→1.0 + per-event edge color [ref-Q7].
- Kill credit: `"VICTIM DESTROYED — KILLER (n KO)"` via existing `topDealer`; first-blood banner + sting [combat-P4].
- Team tint fix: `bakeTinted` — bake chassis variants recoloring only `w` pixels to `teamColor()` (CB-safe),
  drop whole-sprite `setTint`; default `Stripe`/`Ring` finish; constrain `skin.paint` away from enemy team color
  in `customize.ts` [sprites-8; C2]. Lenses/shading untouched.
- Treads: per-robot `treads_a/b` layer (depth 3.5), distance-keyed swap every 6 px from position deltas
  (not timer — C3) + speed-lean + 1 px bob [sprites-1 + anim-P1]; recoil: keep positional offset, exponential
  decay + 1-frame scale punch (no B-frame art — C4).
- Damage overlay: bake-time `bakeDamaged()` (cracks + scorch stamp, no 8× hand art), swap at hp < 35% [sprites-7].
- Bullet tracers: streaks for hot bullets drawn into existing `dyn` Graphics (not +40 sprites), oriented by
  position deltas; dim FOV cones during combat to pay for the added brightness (anti-clutter rule, C14) [combat-P2-render-side + ref-Q9].
- Gate + smoke: full 2v2 + max-size battle to completion; hitstop/shake/tiers visible; tints correct in both
  orientations + CB mode; reduced-motion = static equivalents; soak unchanged.

### Phase 2 — Audio floor (~1.5 d) [audio] [ref-Q5/M8]
Goal: battles stop sounding sparse. ~250–350 lines in `audio.ts` + ~30 lines call sites.
- A: voice buses (`sfx`/`ui`/`music`) + `DynamicsCompressor` on master; `tone()`/`noise()` take bus + pan.
- B+C: layered combat voices with ±8% pitch / ±20% gain jitter; `playShoot(charged)` (call site already
  branches on `charge > 0.4`); `playHit(damage)` 3 tiers (call site already computes dmg); explosion + crack
  + rumble tail; stereo `panFor(x)` + slight center attenuation.
- F: `playLose()`/`playDraw()`; branch at `showResults` (`YOU WIN/LOSE/DRAW`; non-pilot decisive/draw);
  stop battle loop before stinger. D-specials (render-side only): `playDash` (dashCd edge + delta spike),
  `playEmp` (empCd edge), `playSuddenDeath` (throttled ~1/s), countdown/start cues. No snapshot fields (C5).
- G: `playHover` (throttled) in `makeButton`, `playConfirm`, `playError`; KEEP global click fallback (C17).
- Gate + smoke: mute/unmute live; multi-kill doesn't clip; all voices fire incl. draw/lose; music scheduler
  silent when muted, stopped on scene exit.

### Phase 3 — Motion & staging (~2 d) [anim] [ref-M1/M2]
Goal: weight, ceremony, cinema. Render-only; acc-gating only, never `timeScale` for sim (C6).
- Turret spring: critically-damped lag/overshoot (k~180, d~22) + per-weapon kick (heavy 7px+hub dip,
  twin double-tap, light 4px); reduced-motion keeps direct set [anim-P2].
- Staged intro (merges anim-P3 + ref-M1): telegraph ring → drop (`Cubic.easeIn` + dust) → power-on
  (`Back.easeOut` + aura flash), 120 ms stagger; hold `acc` ≤1.2 s, skip on input, reduced-motion instant.
- Death-throes (capped per C13): ≤2 pre-flashes + 2 spark bursts + scale jitter over ≤450 ms, then `explode()`;
  wreck `Bounce.easeOut` settle + dust; capped smokers (see budgets); banner delayed to post-detonation [anim-P4].
- Kill-zoom + deciding-kill slow-mo: `zoomTo(1.06)` chained restore on kill; final kill 0.25× acc-rate ~600–900 ms
  + pre-fired `"TEAM X WINS"` banner, guarded by `resultsShown`; skipped under reduced-motion [anim-P6 + combat-P5 + ref-M2].
  Camera drift DROPPED (C12).
- Idle life: breathing `2±0.03`, charge pulse + full-charge muzzle pre-glow dot, lamp flicker; menu preview
  sway via tween (no new `MenuScene.update` — C-appendix A16 default) [anim-P5].
- `ui.transition()` helper (fade+rise 150 ms, no-op under reduced-motion) for Menu/Tournament overlays [anim].
- Gate + smoke: intro ≤1.2 s + skippable; throes never strobe; zoom restores to 1.0; results timing unchanged
  in reduced-motion; soak unchanged.

### Phase 4 — Arena & readability (~2.5 d) [arena] [read] [combat-P3]
Goal: the arena reads as a place; fights stay legible.
- Layered floors: vector overlay pass in `bakeArenaFloor` (center-ring emblem = SD target mark, spawn pads —
  verify coords first, Appx A3, stronger rim hazard; dot-vs-dash per-half cue, NO color tint) [arena-A].
- Baked vignette (radial canvas, depth 9.5) + 2 px inner border in `floor_big` [arena-B; C7].
- Decor: bake 4 corner decals INTO `floor_big` (fixes "driving over crate"); `DECOR_LAMP_B` + `WALL_GATE_B`
  flicker variants on 1 s timers; fix side-wall stripe direction (rotate tile for verticals) [arena-C + walls flaw].
- Obstacles: `OBSTACLE_TOP` tile (distinct from walls, no hazard stripes); per-block one-time 90×90 baked
  canvases (fixes 16px crop); drop shadows; impacts via RENDER-SIDE proximity tracking (no engine list — C5):
  gray/amber burst + quiet `playHit` + scorch-decal pool (cap ~24, oldest recycled, depth 1); range-expiry =
  100 ms shrink-out, no decal [arena-D1–D3 + combat-P3 + ref-M5].
- SD escalation: 10 s pre-warning banner + red timer; pre-baked `sd_ring` danger-fill sprite scaled per frame
  (readable off-screen); per-robot outside blink pip; amber→red→white ramp; minimap circle echo (fold in
  every-3rd-tick throttle); collapse sting already in Phase 2 [arena-E1–E5 + ref-M4]. Palette-shift deferred to Phase 6.
- Readability set: HP staging (25-HP chunks, white ghost lag bar, low-HP pulse + `!`, divider ticks) [read-1];
  victim-centered threat arcs w/ white "contested" fallback, rim chevrons pilot-only [read-2]; minimap 96×64 +
  facing ticks + bullet dots + SD ring + charged ■ + dead ✕ + EMP ring [read-3]; charge cast-bar + EMP ring on
  empCd edge + slowed ❄/desat (only if `slowed` already snapshotted, else defer — Appx A8) [read-5]; death
  skull-markers (5 s) + ▼ focus-fire (≥2 cones on one foe) [read-6]. Dead names stop persisting (fix L791).
- Gate + smoke: full collapse to r=0 legible; decals recycle; plates/arcs/minimap correct in max-size furball;
  CB mode re-verified (HP bands now shape-redundant).

### Phase 5 — UI payoff (~2 d) [ui] [ref-M3/M7]
Goal: hierarchy, drama, first impression. Zero new art (reuse `floor_big` + chassis textures).
- Button/panel tiers: `primary`/`default`/`danger`/`ghost` + disabled fills; panel header bar + top highlight;
  `panel_tile` as corner rivets (claims another dead asset); FocusNav registration + shared gold focus ring [ui-B].
- HUD: cooldown pips → radial sweep + seconds <3 s, ready pop (keep `D`/`E` letters) [ui-C]; ghost bar already
  in Phase 4 (no duplicate).
- Results drama: dim → title slam → rows cascade (60 ms) → MVP line (`computeMvp` from kills/damage) →
  replay code + buttons; ≤1.2 s, click-skippable, instant under reduced-motion [ui-D + ref-M3].
- Menu hero: drifting floor tileSprite + 2 circling chassis silhouettes behind scrim (frozen under
  reduced-motion); staggered title pop (one-shot); single centered `primary` START; toolbar regroup + DAILY
  gold dot [ui-E + ref-M7].
- Icons: dash/emp/trophy/skull/copy 8×8 maps in `art/menu.ts`, always paired with text [ui-F].
- Team plates: bottom-strip plates flanking minimap (callsign, mini-HP, `D 3s E ●`, loadout code, team totals,
  struck-through dead), 4 Hz refresh; coordinate bottom-strip layout with builder first (Appx A19) [read-7].
- Gate + smoke: results sequence skippable + instant in reduced-motion; plates accurate; menu frozen-decoration
  check; keyboard focus order sane.

### Phase 6 — Lighting & music (~2 d) [light] [audio-E] [ref-B1/B3/B4]
Goal: cinematic layer. All WebGL-guarded + auto-quality-gated; Canvas degrades gracefully (C7/C8).
- Muzzle halo: pooled radial-gradient ADD-blend sprite, 90 ms alongside `muzzleLife` (no shader) [light-1].
- Low-HP danger vignette: persistent camera Vignette lerped by HP (pilot's robot in pilot mode), static snap
  under reduced-motion [light-4]. Coexists with baked Phase-4 vignette (different jobs: static corners vs red pulse).
- Arena grading: persistent camera ColorMatrix (warm `open` / cool `blocks`), SD cross-tween saturating up [light-7].
- Charged aura: ADD blend + small per-object Glow on ≤6 auras; menu title Glow + START Shine sweep (4 s,
  static-only under reduced-motion); team rim-Glow REJECTED (C2) [light-5/6/8-partial].
- Transient Bloom on `explode()` ONLY (~200 ms, tween-decayed, leak-free destroy) [light-3].
- Music: `startBattleLoop(intensity)` lookahead scheduler (kick/hat/tom, density from alive-ratio + damage-rate)
  + `startMenuAmbience` pad; music bus, −6 dB duck on explosions; scene shutdown stops [audio-E + ref-B1].
- Gate + smoke: WebGL + forced-Canvas both correct; Bloom never lingers (destroy verified); fps stable in
  max-size battle with all filters on; auto-quality disables filters under load.

### Phase 7 — Deferred / big swings (opt-in, after 0–6)
- 32×32 chassis/tower/hub redraw on the layered format (same 32 px footprint @ scale 1 — C1); sniper/hunter
  split + `TOWER_LONG`; tower-per-robot expansion; relight rim/AO pass [sprites-4/5/6/9 + pipe-P4].
- Layered bake P1 / palette-swap P2 follow-ups only if Phase-1 tint fix proves insufficient.
- Arena themes (`cross`/`pillars` + lazy `floor_big_<arena>`, 2.4 MB each) + per-layout soak; needs replay
  compat policy (Appx A5) [arena-F].
- Kill-cam final-KO zoom, announcer/kill-feed system, webfont (needs approval, C10), full color script [ref-B2/B5/B4].
- Effort: redraw ~3–5 d artist time; themes ~2–3 d; each swing needs its own soak + builder sign-off.

## 3. Wow-per-cost master ranking

| Rank | Item | Phase | Why |
|---|---|---|---|
| 1 | Hitstop (acc-gate) | 1 | ~20 lines; highest feel-per-line in the canon |
| 2 | Trauma shake | 1 | ~30 lines; transforms every existing effect |
| 3 | `ring_fx` shockwaves (dead asset) | 1 | Free art, instant impact hierarchy |
| 4 | Damage-number tiers + punch | 1 | Pure readability + juice, pooled |
| 5 | Bake-time team tint variants | 1 | Fixes correctness + CB + identity at once |
| 6 | Hurt-flash | 1 | 2-frame blink, very cheap, very juicy |
| 7 | Staged explosion (flash/ring/smoke) | 1 | The money shot, all-transient cost |
| 8 | Treads + lean/bob (dead asset) | 1 | Locomotion feel from zero art |
| 9 | Layered/varied combat audio + limiter | 2 | Ends sparse battles; foundation for all later audio |
| 10 | Kill credit + first blood | 1 | String formatting + existing data |
| 11 | Banner punch | 1 | One tween |
| 12 | Tracers (dyn Graphics) + cone-dim | 1 | Charged shots unmistakable; pays for itself |
| 13 | Turret spring + per-weapon recoil | 3 | Weight for ~12 flops/robot/frame |
| 14 | Staged intro (≤1.2 s, skippable) | 3 | Reframes first 10 seconds |
| 15 | Death-throes (capped) + wreck settle | 3 | Staging without strobe risk |
| 16 | Baked vignette + floor emblem/pads | 4 | Zero-runtime-cost place-ness |
| 17 | SD escalation (fill sprite + warning) | 4 | Currently unreadable off-screen; pure render |
| 18 | HP staging + threat arcs + minimap | 4 | Core spectator legibility |
| 19 | Obstacle materiality + render-side impacts + decals | 4 | Closes "bullets vanish silently" |
| 20 | Win/lose/draw stingers + UI sounds | 2 | Silent lose/draw fixed for ~45 lines |
| 21 | Results drama + MVP | 5 | Emotional payoff of every match |
| 22 | Button/panel tiers + press states | 0/5 | Hierarchy everywhere |
| 23 | Menu hero (zero new art) | 5 | First impression |
| 24 | Muzzle halo + danger vignette + grading | 6 | Cinematic layer, gated |
| 25 | Battle-drum loop + ambience + ducking | 6 | Most code, needs tuning by ear — last |
| 26 | Transient Bloom | 6 | Heaviest item; gated, skippable if fps says no |
| 27 | Team plates | 5 | Layout churn — after builder settles strip |
| 28 | 32px redraw / themes / kill-cam / announcer | 7 | Art time + policy gates |

## 4. Contradictions resolved

- **C1 redraw size (sprites-4: 24@1.5 vs pipe-P4: 32@1).** → 32@1 if ever (same 32 px footprint, no
  `ROBOT_RADIUS`/sim risk); 24@1.5's 36 px footprint rejected under sim-untouched. Both deferred to Phase 7.
- **C2 team-tint mechanism (sprites-8a bakeTinted vs pipe-P1 layered vs pipe-P2 palette-swap vs light-8 rim-Glow).**
  → Bake-time team variants now (2 colors, simplest, CB-safe); layered P1 only if paint-mud persists; rim-Glow filter rejected (cost for subtle-at-32px gain).
- **C3 tread timing (sprites-1 timer vs anim-P1 distance).** → Distance-keyed swap every 6 px (correct under
  pause/slow-mo/variable speed); timer rejected.
- **C4 recoil frames (B-frame art vs offset+punch).** → Offset (exponential) + spring + scale punch now;
  per-tower B-frames deferred; generic RECOIL_A/B stay unused or purged in Phase 0.
- **C5 all engine touches rejected.** Arena-D4 impact list, combat-P2 `kind`/`vx,vy`, combat-P6 `slowed`,
  read-5b `dashing`, audio-D snapshot reliance → render-side inference specified instead: impacts via proximity
  tracking [combat-P3]; bullet kind via owner-archetype lookup from existing snaps, orientation via deltas;
  dash via dashCd-edge + delta spike; slowed used only if already snapshotted, else deferred. "Additive
  getter, zero determinism risk" is still a sim touch — out of scope by constraint.
- **C6 slow-mo mechanism (combat-P5 `timeScale` vs ref acc-gating).** → Acc-gating for sim (replay-safe:
  tick content unchanged, only ticks-per-frame varies); `timeScale` never drives sim (it can't — stepping is
  manual); intro/spawn holds are acc-holds ≤1.2 s, skippable.
- **C7 vignette (arena-B baked vs light-4 filter).** → Baked static vignette now (Canvas-safe, zero risk);
  camera-filter vignette only as the red low-HP pulse in Phase 6. No duplicate static vignettes.
- **C8 Bloom (light-3) vs perf/crispness.** → Transient (~200 ms), WebGL-only, auto-quality-gated, last;
  never permanent; Canvas gets boom frames only.
- **C9 atlas (pipe-P3) vs builder Phase-19.** → Builder owns; this plan contains no atlas code; new textures
  route through builder intake.
- **C10 webfont (ui-A) vs no-new-assets.** → Deferred pending approval; ship size-multiple + contrast + stack
  fixes now (most of the win, zero risk).
- **C11 art tests (pipe-P5 vitest) vs no-new-deps.** → `?debugart` runtime validator + preview only; vitest
  is not installed and cannot be added.
- **C12 camera drift (anim-P6) vs fixed full-arena readability.** → Dropped; trauma + kill-zoom + flash only.
- **C13 throes strobe (anim-P4 12 Hz) vs photosensitivity.** → Capped: ≤2 pre-flashes, no periodic strobe;
  reduced-motion skips entirely.
- **C14 new glow/tracers vs cone/trail noise (ref anti-goal, read clutter).** → Anti-clutter rule: landing
  tracers/glow dims FOV cones in combat; no net brightness growth without a compensating dim.
- **C15 spawn sim-hold acceptability (anim-UQ, ref "no aim pause").** → Resolved as ≤1.2 s acc-hold + skip-on-input,
  replay-safe, reduced-motion instant. (Design sign-off still welcome — Appx A15.)
- **C16 pool-size bumps (combat +16, read 20→28) vs Phase-19 ownership.** → No pool-size changes without
  builder agreement; new emitters borrow/recycle within existing pools.
- **C17 global click blip (audio-UQ).** → Keep (small diff); add hover/confirm/error on top.
- **C18 menu art (ui-E reuse vs new maps).** → Reuse `floor_big` + chassis textures; no new menu art.
- **C19 SD palette-shift (ref-B4/light-7 now vs later).** → Danger-fill sprite + warning now (Phase 4);
  grading/color-script in Phase 6 behind filter gates.

## Appendix — Unresolved items with provenance (disposition: OPEN or RESOLVED→section)

- A1 [sprites] Builder 16–19 touching art.ts/BattleScene tinting? → OPEN: rebase onto builder tip before Phase 1.
- A2 [sprites] On-screen robot size ceiling before ROBOT_RADIUS retune? → OPEN: caps any Phase-7 redraw (C1).
- A3 [arena] Exact spawn coords (x≈130/830 from comment — verify in engine spawn block before baking pads). → OPEN, blocks Phase-4 pads.
- A4 [arena] Phase-19 atlas texture-intake procedure. → OPEN, blocks landing any new texture.
- A5 [arena] Replay compat policy for arena ids 2/3 (old-build behavior). → OPEN, blocks Phase-7 themes.
- A6 [arena] Phase-17 motion-flag API shape. → OPEN: adopt builder's API; plan assumes `this.reducedMotion`-equivalent.
- A7 [combat] Is Phase-19 auto-quality allowed to scale decal/smoke pools, or exempt as static? → OPEN (Phase 4/6).
- A8 [combat] Does RobotSnapshot expose `slowed`? → OPEN, verified read-only before Phase 4 (if absent: defer slowed tint, keep EMP ring).
- A9 [combat] Should deciding slow-mo also apply to SD multi-death ticks? → OPEN (design; default: yes if it ends the match).
- A10 [ui] Will builder wire accessibility.ts/nav.ts into scenes, or should fidelity? → OPEN: coordinate, don't duplicate.
- A11 [ui] Second Google Font acceptable? → RESOLVED: deferred (C10); needs explicit approval to revive.
- A12 [ui] Min viewport for menu-hero regroup (FIT/portrait unverified). → OPEN: verify in Phase-5 smoke.
- A13 [anim] Will Phase-19 change particle/texture APIs (wait with P1/P4)? → OPEN: check builder API before Phase 1/3.
- A14 [audio:complete=false] Phases 16–19 touching audio.ts/diffSnapshots? → OPEN: check before Phase 2.
- A15 [anim] Is ~1 s spawn sim-hold acceptable to design? → RESOLVED as acc-hold+skip (C15); sign-off welcome.
- A16 [anim] MenuScene sway via new update() vs tween? → RESOLVED: tween (no new loop) unless builder prefers otherwise.
- A17 [light:complete=false] Builder 16–19 changing BattleScene effects?; min-spec GPU for Bloom gate? → OPEN (both; second needs Phase-19 fps data).
- A18 [pipe] Max teamSize (assumed ≤4 from replay bits; budgets use 8-robot ceiling). → OPEN: confirm from menu selector.
- A19 [read:complete=false] Builder touching bottom-strip layout? → OPEN: coordinate before Phase-5 plates.
- A20 [read] `dashing` field doc note? → RESOLVED: moot (C5, no engine change).
- A21 [ref] Phase-19 auto-quality landed?; TournamentScene/WorkshopScene/pilot.ts/accessibility.ts unaudited;
  staging judged from code only (no screenshots). → OPEN: confirm 19 status; unaudited scenes out of scope for Phases 0–6.
- A22 [arena-D4/audio-D engine asks] Engine impact list / dash-emp snapshot visibility. → RESOLVED: rejected under
  render-only rule (C5); render-side inference specified.
- A23 [light] Canvas fallback pixel-identical vs degraded? → RESOLVED: degrade gracefully, same information (C7/C8).

*Total effort (rough, solo, sequential): Phases 0–2 ≈ 4 d; Phase 3 ≈ 2 d; Phase 4 ≈ 2.5 d; Phase 5 ≈ 2 d;
Phase 6 ≈ 2 d; ≈ 12–13 d + builder coordination. Phase 7 separately scoped.*
