# Robot Arena — Pixel Art Improvement: Research + Agent Build Guide

**Date:** 2026-09-20
**Repo:** https://github.com/schererstefan/robotarena
**Purpose:** (1) Distilled research on what actually improves pixel art in games. (2) Concrete, repo-grounded build instructions for an AI agent to execute the improvements. Work phases are ordered by visual leverage per hour of effort.

---

## Part 1 — Research: what actually improves pixel art (ranked by impact)

Drawn from a deep research pass (2026-09-20, ~45 sources: PixelJoint tutorials, Lospec, Aseprite docs, game-dev skill references). These are the proven, mechanical disciplines — not talent.

### 1. Palette is ~50% of the quality

- **Hue-shifted ramps.** The single highest-ROI color technique. A brightness-only ramp looks flat and muddy; a hue-shifted ramp drifts highlights toward warm yellow/orange and shadows toward cool blue/purple, with saturation peaking in the midtone. Under daylight this mirrors real light (warm sun on highlights, blue sky fill in shadows). Never use pure `#000000` for shadows or pure `#FFFFFF` for highlights.
- **Color budgets.** ≤6 colors on a 16px sprite, ≤10 on 32px, ≤16 on 64px (a color that can't own a ~4px cluster doesn't read at game distance). 32–64 colors for the whole game.
- **Perceptual lightness steps.** Step ramp lightness in OKLCH/Lab, not HSB brightness — adjacent ramp steps should differ by ≥ ~0.08 in OKLCH lightness or they blur together.
- **Share ramps across the game.** Small shared palettes force colors to reappear across assets, which is what makes a game look cohesive. Terrain drawn in different colors from the cast is how mixed-asset games betray themselves. Foreground saturated, background desaturated.
- **Curated starting palettes (Lospec):** Resurrect 64 (best all-rounder), Endesga 32/64, DawnBringer 32, SLSO8 (8-color), AAP-64.
- **Desaturation check.** Convert art to grayscale — if the shading doesn't read, the value separation is too weak, not the hue.

### 2. One fixed light direction + big pixel clusters

- **Pixel clusters** are the atomic unit. Keep clusters large; merge orphan/single pixels (they read as dirt at 2×+).
- **Kill pillow shading** (concentric dark bands that ignore the light source) and **banding** (pixel rows lining up so the grid shows: hugging outlines, fat-pixel rows, 45° alignment). Fix banding by offsetting rows 1px so edges never align.
- **Dithering:** ordered Bayer patterns only, on large gradient areas, between *adjacent* ramp colors. Never on faces, never on ≤16px sprites. If dithering covers half the sprite, add a real color instead.
- **Outlines:** exactly ONE style per project — full-black, colored (sel-out), or selective (dark on shadow edges, light on lit edges). Always 1px at low res, never 2px. Never AA the outer silhouette edge or against transparency.

### 3. Silhouette first

- **Black-fill test:** fill the sprite solid black — if you can't tell what it is, simplify the silhouette before touching shading. Readability beats detail; delete anything invisible at true game scale. Prefer 2px-minimum shapes.
- Design **at actual game scale**. Formula per sprite: dark rim + 3–5 shade body + exactly one bright accent.
- The subject should own the brightest/most-saturated values so the eye lands on it; keep a value gap between sprite and background.

### 4. Pixel-perfect rendering pipeline (already correct in this repo — don't regress)

- Point/nearest filtering everywhere (never bilinear — the #1 pixel-art game mistake), integer scaling of a small base resolution, no fractional sprite scales, snap camera and sprites to the pixel grid.
- **No mixed texel densities** ("mixels"): every asset shares one pixel density.

### 5. Never rotate pixel sprites to arbitrary angles

- Per-frame arbitrary rotation re-samples the sprite and produces crawling, shimmering blobs. The standard solutions: **pre-baked direction frames** (8 or 16 headings, classic top-down approach) or rotation restricted to 90° steps. This is the single most common way good sprite work gets destroyed in motion.

### 6. Hide the tile grid

- Tiles must share edge pixels to tile, so repetition is broken with: **edge-variation tiles** (identical edges, varied interiors), decorative overlays at random offsets, multi-tile features (2×2+), and autotiling (blob/bitmask ~47 tiles, marching-squares 16, or dual-grid offset ~5 tiles).
- Depth: parallax layers (far 0.15× → near 1.0×) + atmospheric perspective (distant = less contrast, less saturation, hue shifted toward sky color). Background texel density must match sprite density.

### 7. Animation: timing beats frame count

- Typical pixel-art playback is **8–12 fps**, not 24/60.
- Frame budgets: idle 2–6, walk 6–8, light attack 4–6, heavy attack 6–10, hit react 2–4, death 4–8.
- Every action needs three beats: **anticipation → action → recovery**. Uniform per-frame timing is the most common defect — slow into anticipation, fast through the action, hold the impact frame 3–5× longer.
- Volume-preserving squash & stretch (redrawn, never scaled), 1–2 smear frames for fast swings, secondary motion (cloth, weapons) lagging 1 frame behind the body. Impact feel: hold contact frame + 1px whole-sprite shift + 1-frame palette flash. Gameplay must react on frame 1 — never gate input on anticipation.

### 8. Atmosphere, cheaply

- **Baked AO + rim light:** darker 1px contact shading where forms meet; lighter outline pixels on the light-facing silhouette edge (selective outlining). Instant depth, nearly free.
- **Dynamic 2D lighting:** hand-drawn height map → normal map (Laigter, free) → per-pixel shader lighting. Best for torches, magic, day/night. If it fights the painted shading, drop it and keep baked AO/rim.
- **Post stack:** subtle vignette + bloom on emissives + per-zone LUT color grade. For a competitive arena game, crisp integer scaling beats CRT/scanline filters (readability wins).
- **Particles:** one system, additive blending, textures drawn in the game palette. Effects need no outline. Per-zone ambient particles (embers, dust) sell the theme.

### 9. The classic-mistakes checklist

Bilinear blur · pillow shading · banding · orphan-pixel noise · inconsistent outlines (doubles, mixed styles) · too many colors / mud · jaggies · bad dithering (too much, random noise) · bad AA (on silhouette edge, against transparency) · mixels · eyeburn (oversaturation) · light drifting between frames · uniform frame timing · foot slide / pivot drift · overdetailing small sprites · sel-out used as bad AA.

---

## Part 2 — Repo briefing (what the build agent must know)

### Tech stack

- **Engine:** Phaser 4. `src/game/main.ts`: `pixelArt: true, roundPixels: true, antialias: false`, 1024×768 canvas, `Scale.FIT`. Render config is already correct — do not regress it.
- **Art pipeline: 100% procedural string pixel maps.** There are NO binary sprite assets (only `public/favicon.png`). All sprites are `string[]` maps in `src/game/art/*.ts`, baked into Phaser canvas textures at boot by `ensureArtTextures()` in `src/game/art.ts` (guarded by `textures.exists`, one GPU texture per sprite key).
- **Palette:** 16 named single chars mapped to hex in `art.ts`:

| char | hex | role |
|---|---|---|
| `k` | #0b0e12 | near-black outline |
| `d` | #232e3b | dark gray |
| `m` | #5d6a78 | mid gray |
| `l` | #9aa7b4 | light gray |
| `w` | #e8edf2 | near-white (currently also the team-tint channel) |
| `r` | #ff5d5d | red |
| `g` | #7de08a | green |
| `y` | #ffb340 | amber |
| `o` | #e06a2d | orange |
| `s` | #3a4656 | slate (rarely used) |
| `b` | #3a7ca5 | blue |
| `c` | #ffd28a | cream (rarely used) |
| `p` | #12171d | floor base |
| `q` | #1b232d | floor inset (near-invisible vs `p`) |
| `a` | #8a6d1f | dark amber (rarely used) |
| `h` | #3d444c | dark gray 2 (rarely used) |

- **Team variants:** `bakeTeamChassis()` recolors every `w` pixel to the team color — amber `#ffb340` / cyan `#35d0ff` (colorblind-safe variants also baked). Everything else untouched.
- **Rendering:** chassis/tower/treads at `setScale(2)` → 32×32px on screen, in a 960×640 arena. Bullets 2×, booms 3×, skill icons 2–4× in menus.
- **Rotation problem:** chassis, tower, treads, wrecks are `setRotation()`'d to **arbitrary headings every frame** (`src/game/scenes/BattleScene.ts` ~L1780–1840). Nearest-neighbor rotation of 16×16 sprites at 2× turns them into jagged blobs in motion — this undoes most sprite craft.
- **Floor:** one pre-composed 960×640 image (`bakeArenaFloor`) from 60×40 16×16 tiles (93% `FLOOR_A`) + vector overlay (spawn pads, center emblem, rim hazard band, radial vignette, corner decor).
- **House rules** (documented at top of `art.ts` — treat as the style contract; Phase 0 may propose amendments): 1px `k` outlines on chassis/hubs; light from **top-left**; only `w` tints to team colors; ordered 2px dither only between adjacent ramp steps; **no purple family anywhere**.
- **What's already good (don't break):** consistent 1px outlines; top-left light discipline; tight per-sprite color budgets (5–6 colors); the 4-frame explosion sequence (played at 60/160/260ms — already uses uneven timing); pixel-perfect render config; pooled particle system.

### Weakness → task map (ranked by screen-time × visibility)

| # | Weakness | Evidence | Build phase |
|---|---|---|---|
| 1 | Arbitrary-angle rotation shreds sprites | `BattleScene.ts` L1780–1840; `mock_zoom.png` | Phase 1 |
| 2 | Full-hull team tint flattens chassis (36–72px of `w` → flat amber/cyan) | `art.ts` `bakeTeamChassis()`; `montage_chassis_amber/cyan.png` | Phase 1 |
| 3 | Floor grid dominates: 1px `k` border per 16×16 tile = 60×40 grid lines; `q`-vs-`p` inset ~2% luminance (invisible) | `art/floor.ts` `FLOOR_A`; `mock_battle.png` | Phase 2 |
| 4 | Luminance-only shading — zero hue shifting; "muddy gray robot" look | `art/chassis.ts` (all 8 chassis) | Phase 3 |
| 5 | Tower light/heavy/twin indistinguishable at 32px (1–2px differences) | `art/towers.ts` | Phase 3 |
| 6 | Robots tiny (32px in 960px arena); detail sub-visible | `mock_battle.png` | Phase 6 (needs owner call) |
| 7 | No contact shadows — robots float (obstacles have shadow rects, robots don't) | `BattleScene.ts` L464 | Phase 4 |
| 8 | Damage stamp barely reads (4×3px blotch) | `art.ts` `damageStamp()` | Phase 4 |
| 9 | Wrecks are ~95% copy-paste; claimed "dark tint" not in code | `art/wrecks.ts`; `BattleScene.ts` L1428–1430 | Phase 4 |
| 10 | Skill icons flat white-only; plus/reticle and chevron families near-identical | `art/menu.ts` `SKILL_ICONS` | Phase 5 |
| 11 | Tread animation invisible (16×4 under body, 2px shift) | `art/anim.ts` `TREADS_A/B` | Phase 6 |
| 12 | Explosion tail weak (`BOOM_3` sparse ring, `BOOM_4` gray blob) | `art/fx.ts` | Phase 5 |
| 13 | Walls read flat (large unmodulated `d` body) | `art/walls.ts` `WALL_V2` | Phase 5 |
| 14 | Decor faint (0.55 alpha stamps, no lighting) | `art.ts` `floorOverlay()` | Phase 5 |
| 15 | Favicon is a different art style (teal/beige illustration vs gray+amber game) | `public/favicon.png` | Phase 5 |

Rendered evidence for all of the above (8× montages, native-scale mock battle frame, rotation comparison): `robotarena-art-evidence/art_figs/` next to this guide. Full written analysis: `robotarena-art-evidence/art_analysis.md`.

---

## Part 3 — Build plan

General rules for every phase: use the repo's build/test commands from `package.json`; boot the game and screenshot at native scale after each phase; keep all texture keys consumed by scenes stable (or update every reference); change no gameplay constants; every new palette char must be documented in the style guide.

### Phase 0 — Setup: style guide + visual QA tooling

1. **Write `art/STYLE_GUIDE.md`** in the repo: full palette table (char → hex → role), light direction (top-left), outline style (1px `k`, full-black), per-sprite color budgets (6/10/16 for 16/32/64px), animation frame budgets + fps, base resolution, texel density, bake/export rules, and the amended team-tint + hue-shift decisions from the owner (see Decisions).
2. **Build `scripts/art-qa.mjs`** (node, no deps beyond the repo): parse the `string[]` maps in `src/game/art/*.ts` and (a) verify every char used exists in the palette; (b) report per-sprite color counts vs budgets; (c) export black-fill contact sheets (silhouette test) and native-scale mockups as PNGs. Run it before and after every phase — it's the visual regression harness.
3. **Acceptance:** style guide committed; QA script runs clean on the current art (baseline).

### Phase 1 — Rotation + team tint (biggest single win)

**Task 1.1 — Replace arbitrary rotation with 8-direction baked frames.**
- In `art.ts`, after each chassis/tower/tread/wreck texture is baked, bake 8 rotated variants (0°, 45°, …, 315°) by rotating the canvas **at bake time**. Key pattern: e.g. `chassis_rusher_d0` … `chassis_rusher_d7`.
- In `BattleScene.ts`, replace `setRotation(heading)` on pixel sprites with nearest-direction frame selection (heading → 0–7 index). Keep the continuous heading for game logic; only the displayed frame is quantized. Remove `setRotation` from chassis/tower/treads/wrecks entirely.
- Cheaper fallback (only if 8-dir proves too invasive): quantize the displayed rotation to 45° steps. Note the trade-off: still rotates, still jags during turns — 8-dir is strongly preferred.
- **Acceptance:** no `setRotation` calls remain on pixel-art sprites in `BattleScene.ts`; robots stay crisp at all headings (verify at 8× zoom); turning looks like classic top-down direction snapping.

**Task 1.2 — Team identity via trim, not full-hull tint.**
- Add a palette char `t` = team accent, baked per team variant. In each `chassis.ts` map, convert lens/trim/stripe pixels from `w` to `t`; the hull stays `w` (white/gray).
- Update `bakeTeamChassis()`: map `t` → team color (amber/cyan + colorblind variants), `w` → white unchanged.
- **Acceptance:** chassis reads as a gray/white robot with amber/cyan accents; team identity survives at 32px; both teams + colorblind variants render correctly; silhouette unchanged.

### Phase 2 — De-grid the floor

- `art/floor.ts`: soften `FLOOR_A`'s per-tile `k` border — use `h` (#3d444c) or drop the border on interior tiles; fix the `q` inset (either widen its luminance gap vs `p` or remove it); add 2+ new variants (cracks, panel seams, wear) with identical wrap edges; add low-frequency value variation (seeded pattern, e.g. every 4th tile slightly lighter base).
- `art.ts` `floorOverlay()`: raise decor stamp alpha 0.55 → ~0.8; add a couple of inside-play-area-safe decor variants (placed where they never block gameplay).
- **Acceptance:** in the native-scale mock battle frame the floor reads as texture, not grid; robots have a clear value gap against the floor (grayscale check).

### Phase 3 — Hue-shifted shading + distinct towers

**Task 3.1 — Hue-shift the gray ramp.** (Owner decision: allow cool slate-blue shadows; keep the purple ban.)
- Adjust palette hexes in `art.ts` only — zero string-map edits: shift `d` toward cool slate blue, `l`/`w` toward warm ivory, keep `k` near-black with a faint blue tint. Keep shifts modest. Harmonize `p`/`q`/`s`/`h` with the new ramp.
- Verify every sprite, floor, wall, and both team tints at 8× and in grayscale.
- **Acceptance:** chassis no longer read as flat neutral gray; cyan team especially gains depth; value separation unchanged or better in grayscale.

**Task 3.2 — Specular + baked AO on chassis.**
- Add a 1px warm specular on top-left edges (reuse `c`/`y` or the warmed highlight); add darker contact pixels where the tower hub meets the hull (baked AO on the tower base ring in `towers.ts`).

**Task 3.3 — Redesign the three tower silhouettes** (`art/towers.ts`): LIGHT = short barrel + small muzzle brake; HEAVY = long thick barrel + large muzzle brake + side vents; TWIN = two clearly separated barrels. All differences must read at 32px on screen. Give `HUB_V2` more presence.
- **Acceptance:** black-fill test — the three towers are distinguishable by silhouette alone at 2×.

### Phase 4 — Grounding, damage, wrecks

- **Contact shadows:** add a `SHADOW_BLOB` radial-gradient canvas texture (same technique as the existing `scorch`/`halo` textures); render one under each robot at ~40% alpha, sized ~20×10 at 2×. Cheap, grounds the robots, adds depth.
- **Damage readability:** strengthen `damageStamp()` — larger scorch region, crack lines (`k` pixels), ember dots (`y`/`o`); two stages at <50% and <25% HP.
- **Wrecks:** redraw the sniper/hunter/brawler wreck maps so they're actually distinct; implement the dark tint the file header already claims (bake a dark variant or `setTint`).
- **Acceptance:** robots visibly sit on the floor; sub-50% HP robots are identifiable at full zoom; wrecks differ per archetype.

### Phase 5 — FX, icons, walls, decor, favicon

- **Explosions** (`art/fx.ts`): denser ember ring in `BOOM_3`; two-tone rising smoke (`h`/`s`) with a longer tail in `BOOM_4` (currently a flat gray blob against the dark floor).
- **Impacts:** bigger muzzle flash (extend `BIG_MUZZLE`); directional spark streaks (3px lines, team color + white core) instead of 2×2 flecks.
- **Skill icons** (`art/menu.ts` `SKILL_ICONS`): add 1px `k` outline/shadow + accent color per family (offense amber, defense cyan, utility green); redraw the plus/reticle trio (trigger/nanorepair/deadeye) and chevron pair (overdrive/dash) so no two share a silhouette.
- **Walls** (`art/walls.ts`): panel lines, vent slits, hazard-stripe rhythm on long runs; more corner variety.
- **Favicon:** redraw `public/favicon.png` 16×16 in the in-game style (gray chassis + amber lens on dark `p`).
- **Acceptance:** icons distinguishable at 2× in the loadout menu; favicon matches the game's look.

### Phase 6 — Animation timing, treads, scale (owner decision on scale)

- Keep the explosion's uneven timing pattern (60/160/260ms) as the template; apply uneven durations to the spawn ring and a new 3-frame death sequence (flash → collapse → ember fade) replacing the instant wreck swap.
- **Treads:** the 16×4 tread strip is invisible under the body — either enlarge the visible tread area in the chassis maps or replace with side skirt detail that reads in motion. Verify with the QA mockup.
- **Idle life:** 1–2px breathing bob (triangle wave, ~0.5s period) applied as a y-offset on chassis — safe alongside 8-direction frames.
- **Scale/camera (needs owner call):** options — (a) render robots at 3× (48px) with arena re-fit; (b) subtle camera zoom toward the action; (c) keep 2×. Recommended: (a) — most sprite detail is currently sub-visible at 32px.
- **Acceptance:** death/spawn sequences have anticipation/action/recovery beats; treads or their replacement read in motion; no foot-slide/pivot-drift artifacts in the QA GIFs.

### Phase 7 — Lock it in (recommended)

- Add the palette-compliance + color-budget checks and the contact-sheet generator to CI so art regressions are visible in PRs.
- Final pass: re-run the full QA suite, grayscale check every screen, black-fill test every sprite.

---

## Part 4 — Technique reference: pixel art in a string-map medium

The repo's art is text, not Aseprite files. Here's how the standard techniques translate:

- **Dithering in a string map:** a checkerboard of two adjacent ramp chars, e.g. alternating `d`/`m` rows. Per house rules: ordered 2px patterns only, between adjacent ramp steps.
- **Sel-out (colored outline):** replace `k` outline pixels on the top/left (light-facing) edges with `d` or `m`; keep `k` on bottom/right (shadow) edges. Apply as clean 1px runs — broken runs read as jaggies.
- **Cluster cleanup:** at 8× zoom, every isolated 1px of a color not touching the same color is suspect — merge it into a neighbor or delete it.
- **Hue shifting:** mostly a palette-hex change (Phase 3.1); for per-sprite control, swap individual pixels between adjacent ramp chars.
- **Bake-time rotation (Phase 1.1):** draw the string map to an offscreen canvas at 1×, then for each of 8 angles draw the canvas rotated into a new canvas and bake as a Phaser texture. Rotating once at bake keeps pixels clean; rotating every frame does not.
- **Black-fill test:** the QA script (Phase 0) fills every non-transparent pixel with `k` and exports the sheet — any unrecognizable sprite gets a silhouette redesign before shading work.

---

## Part 5 — Guardrails

1. **Read `art/STYLE_GUIDE.md` (Phase 0) before touching any sprite.** It is the contract.
2. **Don't change gameplay constants** — art phases must not alter balance, timings, hitboxes, or AI.
3. **Keep texture keys stable** (or update every reference in scenes). New keys must follow the existing naming pattern.
4. **Palette discipline:** every opaque pixel must come from the documented palette; no new char without a style-guide entry.
5. **Verify visually every phase:** native-scale screenshot + 8× zoom + grayscale check. The QA script is the minimum; human eyeball is the gate.
6. **One phase at a time.** Commit per phase. If a phase's acceptance criteria fail, fix before moving on.
7. **Performance:** 8-direction frames multiply texture count (~8× for rotated sprites) — confirm boot time and memory stay sane on the target device; fall back to 4 directions for wrecks/decor if needed.

---

## Decisions needed from the owner (Stefan)

1. **Hue-shift rule:** relax "no purple family" to allow cool slate-blue shadows (purple stays banned)? Recommended: yes.
2. **Rotation fix:** 8-direction baked frames (recommended) vs. cheaper 45°-snapped rotation?
3. **Team tint:** trim/lens-only accent (recommended) vs. keep full-hull tint?
4. **Robot scale:** 3× sprites (recommended), camera zoom toward action, or keep 2×?

## Key references

- PixelJoint pixel art tutorial (hue shifting, banding, pillow shading, dithering): https://pixeljoint.com/forum/printer_friendly_posts.asp?TID=11299
- Lospec palette database: https://lospec.com/palette-list (Resurrect 64, Endesga 32, SLSO8)
- Aseprite CLI docs (sheet packing, JSON export): https://aseprite.org/docs/cli
- Excalibur dual-tilemap autotiling guide (blob/marching-squares/Wang/dual-grid): https://github.com/excaliburjs/excalibur/blob/HEAD/site/blog/2025-08-24-dual-tilemap/dual%20tilemap%20autotiling.md
- Godot pixel-perfect camera skill (snap + shader compensation patterns): https://github.com/mjasnikovs/godot-pixel-perfect-camera/blob/HEAD/godot-pixel-camera/SKILL.md
- Sprite animation frame budgets + 12 principles for pixel art: https://github.com/prokstudio/skills/blob/HEAD/skills/game/2d/sprite-animation/SKILL.md
- Normal-map 2D lighting workflow (Laigter / SpriteIlluminator): https://github.com/igwtech/renpy-normalmap-lighting
- Full research report + notes: `../research_notes/pixel-art-game-improvement-20260920-1500/report.md`
