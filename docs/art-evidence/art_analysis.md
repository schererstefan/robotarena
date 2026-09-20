# RobotArena — Pixel Art Analysis

**Repo:** https://github.com/schererstefan/robotarena (cloned 2026-09-20, read-only analysis)
**Method:** parsed all 72 procedural pixel maps in `src/game/art/`, measured dims / fill / palette
usage / hue distribution / outline pixels / dithering / symmetry per sprite, rendered every
sprite at 8×, rendered chassis in both team tints, and composited a mock 960×640 battle frame
at native 1× scale (figures in `./art_figs/`).

---

## 1. Tech stack

- **Engine:** Phaser 4 (`src/game/main.ts` — `pixelArt: true, roundPixels: true, antialias: false`,
  1024×768 canvas, `Scale.FIT`).
- **Art pipeline: 100% procedural string pixel maps.** No binary sprite assets anywhere in the repo
  (the only PNG is `public/favicon.png`). Sprites live as `string[]` maps in `src/game/art/*.ts`
  and are baked into Phaser canvas textures at boot by `ensureArtTextures()` in `src/game/art.ts`
  (guarded by `textures.exists`, one GPU texture per sprite key — ~70+ textures; an atlas was
  deliberately skipped).
- **Palette:** 16 named chars in `art.ts` (`k d m l w r g y o s b c p q a h`), baked per-pixel
  via `fillRect`. Team variants are baked 4× per chassis: `w` pixels are recolored to the team
  color (amber `#ffb340` / cyan `#35d0ff`; colorblind variants exist), everything else untouched.
- **Rendering:** chassis/tower/treads drawn at `setScale(2)` (32×32 px on screen), bullets 2×,
  booms 3×, skill icons 2–4× in menus. **Bodies, towers, treads, wrecks are rotated to arbitrary
  angles every frame** (`BattleScene.ts` ~L1780–L1840: `setRotation(s.heading)` / `setRotation(aim)`).
- **Floor:** a single pre-composed 960×640 image (`bakeArenaFloor`) from 60×40 16×16 tiles
  (mostly `FLOOR_A`) + a vector overlay pass (spawn pads, center emblem, rim hazard band,
  radial vignette, corner decor stamps).
- House rules documented at the top of `art.ts`: 1px `k` outlines on chassis/hubs, light from
  top-left, only `w` tints to team colors, ordered 2px dither only between adjacent ramp steps,
  **no purple family anywhere**.

---

## 2. Asset inventory

72 string pixel maps + 1 composited floor + 3 radial-gradient canvas textures (`scorch`,
`sd_ring`, `halo`) + 1 favicon PNG. Key: `path → sprite, size, colors used, notes`.

### Robot chassis — `src/game/art/chassis.ts` (8 × 16×16)

| Sprite (`CHASSIS_V2.<id>`) | Fill | Colors | Accent | Notes |
|---|---|---|---|---|
| rusher | 61% | 6 | `r` ×2 | Wedge, armored nose east; `w` dominant (72 px → all team-tinted) |
| turret | 82% | 6 | `y` ×12 amber viewport band | Tall slab, blockiest; `k` 60 px |
| orbiter | 42% | 6 | `g` ×2 | Needle-thin dart; lowest fill — most transparent pixels |
| wanderer | 56% | 5 | `g` ×4 goggles | Round bug, leg nubs; `k` dominant (44 px) |
| sniper | 70% | 6 | `c` ×4 scope glass | Long barrel nose to east edge |
| brawler | 76% | 6 | `r` ×4 visor | Wide bruiser slab |
| ghost | 57% | 5 | `b` ×4 blue lens | Arrowhead; palest edges (`l` 36 px) |
| hunter | 70% | 6 | `r` ×4 scope | Near-duplicate of sniper silhouette |

Every chassis: 5–6 colors, all on the neutral gray ramp (`k d m l w`) + one tiny 2–4 px lens
accent. Chassis face EAST; `damageStamp()` bakes a scorch variant (<35% HP texture swap).

### Towers / hubs / muzzle — `src/game/art/towers.ts` (16×16, muzzle 8×8)

- `TOWER_LIGHT`, `TOWER_HEAVY`, `TOWER_TWIN` — 16×16, 25–29% fill, 6 colors each
  (k,d,m,l,w + amber hub core). All three are a slim east barrel on an identical hub ring;
  differences are 1–2 px vent ports / over-under barrels.
- `HUB_V2` — standalone hub ring, 20% fill.
- `MUZZLE_V2` 8×8 plus-star and `BIG_MUZZLE` 8×8 X-star (`anim.ts`) — 2-frame muzzle flicker,
  2 colors (w/y).

### Projectiles — `src/game/art/projectiles.ts`

- `BULLET_V2` 4×4 (2 colors: white body tinted to team, amber core) — 8 px on screen at 2×.
- `BULLET_CHARGED` 6×6 with 8 amber edge pips; `SPARK_V2` 2×2; `TRACER` 8×2 (w/l/m/y).

### Explosion / FX — `src/game/art/fx.ts` (all 16×16)

- `BOOM_1..4` — white flash → fireball (w/y/o/r) → hollow embers (r/o + smoke `s`) → smoke puff.
  Played at 60/160/260 ms, scale 3×. Best-crafted sequence in the repo.
- `RING_FX` — thin white/amber shockwave ring; `CHARGE_AURA` — dashed white/amber crackle ring
  (rotated slowly, ADD blend, scale 2.5×).

### Animation frames — `src/game/art/anim.ts`

- `TREADS_A/B` 16×4 — 2-frame tread roll (light marks shift 2 px), distance-keyed swap.
- `RECOIL_A/B` 16×16 — barrel extended vs. kicked 2 px (only 2 colors: k/w).
- `SPAWN_A/B` 16×16 — small→large ring pop.

### Tiles / walls / floor — `src/game/art/floor.ts`, `walls.ts` (16×16, 100% fill)

- `FLOOR_A/B/C/D` — dark plate (`p` #12171d fill, `k` border, `q` inset line); B = vent slats,
  C = amber hazard corner, D = rivets. Distribution: ~93% A, vents at (tx%9==4, ty%7==3),
  edge hazards, D every 29th tile.
- `WALL_V2` — hazard-stripe cap + riveted `d` body; `WALL_CORNER`, `WALL_GATE` (+ lit frame
  `WALL_GATE_B` flicker), `OBSTACLE_TOP` (riveted plate, `s` bottom edge) tiled inside 90×90 blocks.

### Decor — `src/game/art/decor.ts` (16×16)

`DECOR_CRATE`, `DECOR_BARREL`, `DECOR_VENT`, `DECOR_LAMP` (+ lit `DECOR_LAMP_B`) — stamped into
the floor composite at 0.55 alpha, outside the play area only.

### Wrecks — `src/game/art/wrecks.ts` (8 × 16×16)

Per-archetype destroyed chassis. `sniper`/`hunter`/`brawler` wrecks are ~95% identical
copy-pastes (sniper vs hunter differ by ~4 pixels). Amber ember `y` dots. Rendered at 2×,
alpha 0.95, random rotation — **not** dark-tinted in code despite the file comment claiming so.

### UI / menu — `src/game/art/menu.ts`

- `SKILL_ICONS` — 13 skill icons, 8×8, **white-only** (single color `w`), displayed at 2×.
- `UI_ICONS` — dash, emp, trophy, skull, copy — 8×8 white (+k on skull/copy).
- `PANEL_TILE` 16×16 pixel-chrome frame; `LOGO_BAR` 32×8 amber underline.

### Favicon — `public/favicon.png`

16×16 PNG, 12 distinct colors — a **different art style** (detailed teal/beige/red robot
illustration) from the in-game procedural gray+amber style.

---

## 3. Art fundamentals assessment

| Fundamental | Verdict |
|---|---|
| **Palette quality** | Disciplined but monochrome. The k→d→m→l→w ramp has good value separation (lum 0.04 → 0.93, roughly even steps) and outlines pop, but **zero hue shifting**: shadows are never cool-blue, highlights never warm — shading is pure luminance, which reads flat/"muddy gray". 5 of 16 palette chars (`s`,`h`,`p`,`q`,`a`) are near-unused. |
| **Shading technique** | Simple 2–3 step cell shading following the top-left-light rule. No dithering used anywhere (measured dither pairs = 0–2 per sprite — fine, matches house rule). No specular highlights on metal, no ambient occlusion under parts. |
| **Outlines** | Consistent 1 px `k` outlines on every chassis/hub/tower (36–50 edge-adjacent k pixels each). Strongest part of the art. |
| **Silhouette readability** | Good at rest orientation: wedge / slab / needle / round-bug / arrowhead are distinguishable at 8×. **Destroyed in motion** — see §4.1. At full-arena zoom (32 px robots on 960 px arena) silhouettes are marginal regardless. |
| **Tiles** | Floor tiles wrap cleanly (verified wrap comments + measured). But the per-tile `k` border turns the whole arena into a 60×40 grid — visually the loudest element on screen. Wall `WALL_V2` transposes for vertical runs; stripes stay consistent. |
| **Animation** | Minimal: 2-frame swaps only (treads, recoil, spawn ring, muzzle flicker, gate/lamp flicker). No per-character animation — chassis are static images rotated by heading. Tread roll is nearly invisible under the body at 2×. |
| **Backgrounds / depth** | No parallax (single static floor image + vector overlay). Radial vignette + rim hazard band add some framing. Decor stamps are faint (0.55 alpha) and outside play. No drop shadows under robots — they float. Obstacles get a 45% black rect shadow; robots get none. |
| **Lighting** | Sprite-internal top-left convention is followed. Scene lighting = none beyond the baked vignette and ADD-blend glows (halo, charge aura, muzzle). |
| **Particles** | Pooled system (bullets, sparks, rings, booms, scorch decals, damage numbers, banner). Explosion 4-frame sequence is good; impact sparks are 2×2 flecks. Serviceable, not juicy. |
| **UI icons** | Legible at 2× but flat white glyphs with no shading/accent; three plus/reticle icons (trigger, nanorepair, deadeye) and two chevron icons (overdrive, dash) risk confusion. |

---

## 4. Top visual weaknesses (with file-path evidence)

1. **Arbitrary-angle rotation shreds the pixel art.** `src/game/scenes/BattleScene.ts` L1780–L1840:
   chassis, tower, treads, wrecks (L1429) are `setRotation()`'d to any heading each frame.
   Nearest-neighbor rotation of 16×16 sprites at 2× produces crawling, jagged blobs in motion
   (visible in `mock_zoom.png`: the 20°-rotated brawler is an amber smear). This single issue
   undoes most sprite-level craft.
2. **Team tint flattens chassis into monochrome shells.** `src/game/art.ts` `bakeTeamChassis()`:
   every `w` pixel → team color. `w` is 36–72 px per chassis (e.g. `chassis.ts` rusher: 72/156
   filled px = 46%) — the whole outer hull becomes flat amber/cyan; only the gray interior
   detail survives. Team identity could be carried by trim/lens/stripe instead of the hull.
3. **No hue shifting — shading is luminance-only.** All 8 chassis in `src/game/art/chassis.ts`
   use only neutral grays (k,d,m,l,w) + a 2–4 px lens accent. Shadows never go blue, highlights
   never go warm. Result: the "muddy gray robot" look, especially on the cyan team.
4. **Floor grid dominates the frame.** `src/game/art/floor.ts` `FLOOR_A`: a 1 px `k` border on
   every 16×16 tile → 60×40 grid lines across the entire 960×640 arena (`mock_battle.png`).
   The robots (32 px) compete with the loudest background element. Also the `q` (#1b232d)
   inset line vs `p` (#12171d) base is ~2% luminance apart — effectively invisible, wasted detail.
5. **Robots are tiny at full-arena view.** 16×16 art at 2× = 32 px in a 960-px-wide arena
   (~3% of screen width). Silhouette work only pays off if sprites are bigger or the camera
   zooms; currently fine detail (rivets, lens pixels, barrel vents) is sub-visible in motion.
6. **Tower variants are indistinguishable.** `src/game/art/towers.ts`: LIGHT/HEAVY/TWIN share
   the same hub + slim barrel; distinguishing features are 1–2 px (vent ports, twin barrels)
   and vanish at 32 px on screen. Weapon identity — a core fantasy of a robot battler — doesn't read.
7. **Wrecks are copy-paste duplicates.** `src/game/art/wrecks.ts`: sniper/hunter/brawler wrecks
   share ~95% identical maps (sniper vs hunter differ by ~4 px). Also the "rendered dark-tinted"
   claim in the file header is not true in code (`BattleScene.ts` L1428–1430: no tint, alpha 0.95).
8. **Skill icons: flat white, some near-identical.** `src/game/art/menu.ts` `SKILL_ICONS`:
   all 13 are single-color `w`. `trigger` / `nanorepair` / `deadeye` are all plus/reticle
   variants; `overdrive` ≈ `dash` chevrons. No accent color, no shading.
9. **No contact shadows under robots.** Robots float on the floor; only obstacles get a shadow
   rect (`BattleScene.ts` L464). A soft blob shadow would ground them and add depth cheaply.
10. **Tread animation is invisible.** `src/game/art/anim.ts` `TREADS_A/B` (16×4 at 2×) sits
    mostly hidden under the 16×16 chassis; the 2 px mark shift is sub-perceptual at game speed.
11. **Favicon style mismatch.** `public/favicon.png` (16×16, 12 colors, teal/beige/red
    illustration style) looks like a different game's art next to the gray+amber procedural style.
12. **Damage state barely reads.** `src/game/art.ts` `damageStamp()`: scorch blotch is a 4×3 px
    region (8×6 screen px at 2×) swapping w→d — nearly invisible below-35%-HP cue at full zoom.
13. **Walls read flat.** `src/game/art/walls.ts` `WALL_V2`: large unmodulated `d` body with two
    `w` rivet dots; hazard stripes only on the top 4 rows. Long wall runs look empty.
14. **Decor is wallpaper.** `src/game/art.ts` `floorOverlay()` stamps `DECOR_CRATE/BARREL/VENT/LAMP`
    at 0.55 alpha into the floor composite — faint, static, no lighting interaction.
15. **Explosion tail is weak.** `src/game/art/fx.ts`: `BOOM_1` (flash) and `BOOM_2` (fireball) are
    strong, but `BOOM_3` is a sparse ring and `BOOM_4` a flat gray `s` puff that reads as a gray
    blob against the dark floor.

---

## 5. Highest-leverage improvement targets

Ranked by screen-time × visibility:

1. **Chassis rotation + team tint** (seen 100% of battle time). Fix rotation (pre-rendered
   8/16-direction frames, or at least snap rotation to 45° steps with eased turning) and move
   team identity from full-hull tint to trim/lens/stripe accents. Biggest single visual win.
2. **Arena floor** (100% of pixels, 100% of time). De-grid: drop or soften the per-tile `k`
   border, widen tile variety, add subtle large-scale value variation so 32 px robots pop.
3. **Towers** (always visible on every robot). Make light/heavy/twin silhouettes distinct at
   32 px — thicker barrels, bigger muzzle brakes, visible twin barrels.
4. **Robot scale / camera** (composition). Either 3× sprites or a subtle camera zoom toward
   action; the current 32 px robots waste all sprite detail.
5. **Contact shadows + damage readability** (cheap, high payoff). Blob shadows under robots;
   stronger damage stamp (cracks, missing chunks, ember glow).
6. **FX juice** (explosions are already the best art; extend the lead). Beef up `BOOM_3/4`,
   bigger muzzle flashes, impact sparks with directional streaks.
7. **Skill/UI icons** (menu + loadout screens). Add accent color + 1 px shading; disambiguate
   the plus/reticle and chevron families.
8. **Wrecks, walls, decor, favicon** (seen briefly or peripherally). De-duplicate wreck maps;
   add wall body detail; restyle favicon to match the in-game look.

---

## Appendix: quantitative per-sprite stats

Full table in `./art_figs/art_stats.json` (72 sprites: dims, fill %, distinct colors, per-color pixel
counts, hue families, outline `k` edge/inner counts, dither-pair counts, mirror symmetry).
Rendered figures in `./art_figs/`:

- `montage_chassis_std/amber/cyan.png` — all 8 chassis (note how much of each becomes team color)
- `montage_towers/fx/walls/floor/decor/wrecks/projectiles/anim/menu.png` — per-group sheets
- `mock_battle.png` / `mock_zoom.png` — native-scale battle mockup showing the floor grid,
  rotation artifacts, and robot scale issues
- `rotate_CHASSIS_V2.png` — 0°/23°/45° nearest-neighbor rotation comparison
- `favicon_big.png` — favicon at 16× for style comparison

**Palette reference** (`src/game/art.ts`): `k`#0b0e12 `d`#232e3b `m`#5d6a78 `l`#9aa7b4 `w`#e8edf2
`r`#ff5d5d `g`#7de08a `y`#ffb340 `o`#e06a2d `s`#3a4656 `b`#3a7ca5 `c`#ffd28a `p`#12171d `q`#1b232d
`a`#8a6d1f `h`#3d444c — teams: amber #ffb340 / cyan #35d0ff (colorblind-safe variants baked too).
