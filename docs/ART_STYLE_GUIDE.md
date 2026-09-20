# RobotArena — Art Style Guide (pixel-art track contract)

Owner: engine track (`pixelart/engine`). Read this before touching any sprite.
Companion spec: `docs/PIXELART_BUILD_GUIDE.md`. QA harness: `tools/art-qa.mjs`
(`npm run art:qa`). Runtime validator: `?debugart` (see `src/game/art.ts`).

## 1. Palette (single source of truth: `PALETTE` in `src/game/art.ts`)

Every opaque pixel in every `string[]` map MUST be one of these chars.
No new char without a style-guide entry + `art.ts` palette entry.

| char | hex | role |
|---|---|---|
| `k` | `#0a0e14` | near-black outline / crack / bore (faint blue) |
| `d` | `#1f2e40` | cool slate-blue shadow |
| `m` | `#5d6a78` | mid gray body (ramp pivot, neutral) |
| `l` | `#aaa79e` | warm light gray top-left light catch |
| `w` | `#ece9e2` | neutral-warm steel/ivory hull (NEVER team-tinted; see §4) |
| `r` | `#ff5d5d` | red lens / ember / danger |
| `g` | `#7de08a` | green lens / accent |
| `y` | `#ffb340` | amber lens / fire / trim default |
| `o` | `#e06a2d` | orange fire mid-tone |
| `s` | `#36435a` | cool slate / smoke |
| `b` | `#3a7ca5` | blue lens |
| `c` | `#ffd28a` | cream scope glass / warm specular |
| `p` | `#111820` | floor base plate (cool) |
| `q` | `#1b2530` | floor inset line (cool) |
| `a` | `#8a6d1f` | dark amber (rare) |
| `h` | `#4d555f` | neutral dark gray / smoke alt (vent slats) |
| `t` | `#ffb340` | **team accent** (trim/lens ONLY, see §4). Base bake = amber (team-0 look for menu previews); team variants recolor per team (amber/cyan + CB pair). |

`.` = transparent (not a color, never budgeted).

Hue-shift rationale (Phase 3.1): shadows drift cool slate-blue, lights drift
warm ivory; `m` anchors the ramp neutral. Ramp lightness stays monotonic
(`k < p < q < d < s < h < m < l < w`); sprite-ramp steps (`d→s→h→m→l→w`)
hold ≥ 0.05 so shading survives in grayscale, while the floor darks
(`k/p/q`) cluster below 0.15 to stay quiet behind bright robots. `w`
reconciles the owner call ("neutral steel gray") with the guide
("warm ivory"): near-neutral with a faint warm kiss.

Team colors (amber `#ffb340` / cyan `#35d0ff`, colorblind `#e69f00` /
`#56b4e9`) live in `theme.ts` / `accessibility.ts`, not the palette.

## 2. Light: top-left, always

- Light comes from the **top-left**. `l`/`c` highlights sit on up/left edges,
  `d`/`s` shadow on down/right edges. Never pillow-shade (concentric bands
  ignoring the light).
- Contact shadows fall **bottom-right** of the caster (see §8).
- Metal specular: 1px warm (`c`/`y`) on top-left edges only.

## 3. Outlines: 1px full-black, no exceptions on hulls

- Chassis, hubs, towers: exactly **1px `k`** outer outline. Never 2px.
- No outline on lenses/glow cores. Never anti-alias the outer silhouette
  edge or against transparency. Sel-out (colored outline) is NOT used —
  full-black everywhere keeps one consistent style.
- Broken 1px outline runs read as jaggies: keep runs clean.

## 4. Team color: trim/lens accents ONLY

- ONLY `t` pixels take the team color (amber team 0, cyan team 1, + CB variants).
- `t` budget per chassis: small accents (lens, visor slit, trim stripe, pips).
  If `t` covers more than ~15% of filled pixels, it is hull paint, not trim — shrink it.
- `w` is neutral hull steel. Full-hull team flood is banned.
- Bullets/tracers/muzzle tint via code (`bulletColor()` / paint), not via `t`.

## 5. Banned list

- Pure `#000000` and pure `#ffffff` anywhere in `art.ts` hexes. Near-black
  is `k`, near-white is `w`.
- **Purple family**: any hex with HSL hue 245–330° at saturation > 20%.
  (`tools/art-qa.mjs` enforces this mechanically.)
- **Slate-blue exception (owner-approved):** cool blue-gray shadow ramps
  (hue ~205–225°, e.g. `d s h p q`) are REQUIRED, not banned. Blue lenses
  (`b`) and cyan team color are also fine. Only true purple is banned.

## 6. Color budgets (opaque colors per map, `.` excluded)

| sprite size (max dim) | budget |
|---|---|
| ≤ 16px | ≤ 6 colors |
| ≤ 32px | ≤ 10 colors |
| larger | ≤ 16 colors |

A color that cannot own a ~4px cluster does not read at game distance —
merge it. Whole-game palette: 17 chars + 2 team colors (shared ramps keep
the game cohesive; terrain uses the same ramp as the cast).

## 7. Rotation: 8 baked direction frames, zero runtime rotation

- Pixel sprites are NEVER `setRotation()`'d to arbitrary angles at runtime.
  `setRotation` on a pixel-art sprite is a style violation (jagged blobs).
- Instead: bake 8 direction frames at texture-bake time
  (`<key>_d0` … `<key>_d7` = 0°, 45°, …, 315°, clockwise, sprite-native
  east = d0) and select the nearest frame per heading. Cardinals are
  pixel-exact; diagonals are bake-time nearest-neighbor + orphan cleanup.
- Applies to: chassis (all team/damage variants), towers, treads, wrecks,
  muzzle flashes, charge aura. Unaffected: vector shapes (rectangles,
  graphics rings), smooth gradient blobs (`scorch`, `halo`, `sd_ring`,
  contact shadow), which have no pixel grid to shred.
- `hub` stays unrotated (symmetric ring, no frames needed).
- Menu preview tilt (`MenuScene` tower `-0.5` rad) is a known exception
  owned by a later pass — do not copy the pattern.

## 8. Floor, borders, shadows

- Floor tiles MUST share wrap edges (tile seamlessly). Interior per-tile
  borders stay soft or absent — the floor reads as texture, never grid.
- Gameplay overlay (spawn pads, center emblem, rim ticks) stays subtle so
  robots keep a clear value gap against the floor (grayscale check).
- Decor stamps live OUTSIDE the play area only.
- Contact shadow: dithered soft ellipse under every robot, low alpha,
  offset slightly bottom-right (top-left light). Pixel-styled dots —
  never a blur filter. Same technique family as `scorch`/`halo` (canvas
  overlay textures, exempt from char budgets).

## 9. Damage readability

- Two baked damage stages: stage 1 below 50% HP, stage 2 below 25% HP.
- Damage = scorch region (dark `d`/`k`) + crack seams (`k`) + ember dots
  (`y`/`o`) in stage 2. Scorch eats trim too (`t` → scorched, loses glow).
- Must read at 1× full-arena zoom, not just 8×.

## 10. Determinism

- Bake-time art MUST be pixel-identical every boot. Any bake-time
  noise/variation uses a seeded PRNG (mulberry32, fixed seed) — never
  `Math.random` in `src/game/art.ts` (the QA script greps for it).

## 11. QA checklist (every art change)

1. `npm run art:qa` — charset, banned hexes, rectangular maps, budgets.
2. Black-fill test: silhouette reads with all opaque pixels filled `k`.
3. Grayscale check: shading and robot-vs-floor value gap survive.
4. 8× zoom: 1px outlines intact, no orphan-pixel dirt, no banding.
5. All 8 direction frames crisp; team `t` accents small but visible.
6. No `setRotation` on pixel sprites; no `Math.random` in `art.ts`.
