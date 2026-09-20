// Procedural pixel-art pipeline. Sprites live as string pixel maps in
// ./art/*.ts and bake into canvas textures at runtime: no binary assets,
// crisp pixels at any scale, contributors add art by editing text.
//
// House rules (from the art round): 1px `k` outlines on chassis/hubs, never
// on lenses or glow; light from top-left (`l`/`c` up-left, `d`/`s` low-right);
// only `t` bakes to team colors (`w` stays neutral hull steel); lenses sit on
// `k`/`d`; ordered 2px dither only between adjacent ramp steps; glow cores
// are `w` with `c`/`y` mids and `o` outers; no purple family anywhere
// (cool slate-blue shadow ramps explicitly allowed).
//
// Texture-atlas audit (Phase 19): each key below is one canvas texture baked
// exactly once per game (guarded by `textures.exists`) and one GPU upload —
// merging ~50 tiny pixel sprites into a single atlas would add frame
// bookkeeping to every scene for negligible gain, so per-key textures stand.
// The expensive layer (arena floor) is pre-composed into ONE 960x640 image,
// and BattleScene pools all per-frame/per-event objects (bullets, particles,
// damage numbers, explosion flashes) instead of allocating mid-fight.

import { Scene } from 'phaser';
import { isColorblind, teamColorFor } from './accessibility';
import { BIG_MUZZLE, RECOIL_A, RECOIL_B, SPAWN_A, SPAWN_B, TREADS_A, TREADS_B } from './art/anim';
import { CHASSIS_V2 } from './art/chassis';
import { DECOR_BARREL, DECOR_CRATE, DECOR_LAMP, DECOR_LAMP_B, DECOR_VENT } from './art/decor';
import { FLOOR_A, FLOOR_B, FLOOR_C, FLOOR_D } from './art/floor';
import { BOOM_1, BOOM_2, BOOM_3, BOOM_4, CHARGE_AURA, RING_FX } from './art/fx';
import { LOGO_BAR, PANEL_TILE, SKILL_ICONS, UI_ICONS } from './art/menu';
import { validateArt } from './art/validate';
import { BULLET_CHARGED, BULLET_V2, SPARK_V2, TRACER } from './art/projectiles';
import { HUB_V2, MUZZLE_V2, TOWER_HEAVY, TOWER_LIGHT, TOWER_TWIN } from './art/towers';
import { OBSTACLE_TOP, WALL_CORNER, WALL_GATE, WALL_GATE_B, WALL_V2 } from './art/walls';
import { WRECKS } from './art/wrecks';

type PixelMap = string[];

const PALETTE: Record<string, string> = {
    k: '#0b0e12',
    d: '#232e3b',
    m: '#5d6a78',
    l: '#9aa7b4',
    w: '#e8edf2',
    r: '#ff5d5d',
    g: '#7de08a',
    y: '#ffb340',
    o: '#e06a2d',
    s: '#3a4656',
    b: '#3a7ca5',
    c: '#ffd28a',
    p: '#12171d',
    q: '#1b232d',
    a: '#8a6d1f',
    h: '#3d444c',
    t: '#ffb340',
};

/** Legal pixel-map chars: '.' (transparent) + every palette key. */
export const ART_CHARSET = `.${Object.keys(PALETTE).join('')}`;

export interface ArtEntry {
    key: string;
    map: PixelMap;
    /** Declared bake dims, locked by the ?debugart validator. */
    w: number;
    h: number;
}

/**
 * Every texture key baked by ensureArtTextures (minus floor_big, which is a
 * 960x640 composite). Single source of truth for baking + validation.
 */
export function artRegistry(): ArtEntry[] {
    const entries: ArtEntry[] = [];
    for (const [id, map] of Object.entries(CHASSIS_V2)) entries.push({ key: `chassis_${id}`, map, w: 16, h: 16 });
    for (const [id, map] of Object.entries(WRECKS)) entries.push({ key: `wreck_${id}`, map, w: 16, h: 16 });
    for (const [id, map] of Object.entries(SKILL_ICONS)) entries.push({ key: `skill_${id}`, map: map as PixelMap, w: 8, h: 8 });
    for (const [id, map] of Object.entries(UI_ICONS)) entries.push({ key: `icon_${id}`, map: map as PixelMap, w: 8, h: 8 });
    // Reclaimed dead asset (Phase 5): corner chrome for makePanel.
    entries.push({ key: 'panel_tile', map: PANEL_TILE, w: 16, h: 16 });
    const fixed: Array<[string, PixelMap, number, number]> = [
        ['tower_light', TOWER_LIGHT, 16, 16],
        ['tower_heavy', TOWER_HEAVY, 16, 16],
        ['tower_twin', TOWER_TWIN, 16, 16],
        ['hub', HUB_V2, 16, 16],
        ['muzzle', MUZZLE_V2, 8, 8],
        ['muzzle_big', BIG_MUZZLE, 8, 8],
        ['bullet', BULLET_V2, 4, 4],
        ['bullet_hot', BULLET_CHARGED, 6, 6],
        ['spark', SPARK_V2, 2, 2],
        ['tracer', TRACER, 8, 2],
        ['tile_wall', WALL_V2, 16, 16],
        ['tile_wall_v', transposeMap(WALL_V2), 16, 16],
        ['wall_corner', WALL_CORNER, 16, 16],
        ['wall_gate', WALL_GATE, 16, 16],
        ['wall_gate_b', WALL_GATE_B, 16, 16],
        ['obstacle_top', OBSTACLE_TOP, 16, 16],
        ['boom_1', BOOM_1, 16, 16],
        ['boom_2', BOOM_2, 16, 16],
        ['boom_3', BOOM_3, 16, 16],
        ['boom_4', BOOM_4, 16, 16],
        ['ring_fx', RING_FX, 16, 16],
        ['charge_aura', CHARGE_AURA, 16, 16],
        ['logo_bar', LOGO_BAR, 32, 8],
        ['decor_crate', DECOR_CRATE, 16, 16],
        ['decor_barrel', DECOR_BARREL, 16, 16],
        ['decor_lamp', DECOR_LAMP, 16, 16],
        ['decor_lamp_b', DECOR_LAMP_B, 16, 16],
        ['decor_vent', DECOR_VENT, 16, 16],
        ['spawn_a', SPAWN_A, 16, 16],
        ['spawn_b', SPAWN_B, 16, 16],
        ['recoil_a', RECOIL_A, 16, 16],
        ['recoil_b', RECOIL_B, 16, 16],
        ['treads_a', TREADS_A, 16, 4],
        ['treads_b', TREADS_B, 16, 4],
    ];
    for (const [key, map, w, h] of fixed) entries.push({ key, map, w, h });
    return entries;
}

/** Transpose a square map: vertical walls get stripes running down, not across. */
function transposeMap(map: PixelMap): PixelMap {
    return map[0]!.split('').map((_, x) => map.map((row) => row[x] as string).join(''));
}

/** Base radius (px) of the sd_ring bake; runtime scale = circle.r / SD_RING_R. */
export const SD_RING_R = 128;

const TOWER_FOR_ROBOT: Record<string, string> = {
    rusher: 'tower_twin',
    hunter: 'tower_twin',
    turret: 'tower_heavy',
    orbiter: 'tower_light',
    wanderer: 'tower_light',
    sniper: 'tower_heavy',
    brawler: 'tower_twin',
    ghost: 'tower_light',
};

/** Keys baked this session (the TextureManager is game-global). */
const bakedKeys = new Set<string>();

/** How many procedural textures are baked (debug overlay + audit). */
export function bakedTextureCount(): number {
    return bakedKeys.size;
}

function bake(scene: Scene, key: string, map: PixelMap): void {
    bakeTinted(scene, key, map, EMPTY_RECOLOR);
}

const EMPTY_RECOLOR: Record<string, string> = {};

/**
 * Bake with per-char palette overrides. Team variants recolor ONLY `w`
 * pixels to the team color — lenses, shading, and outlines are untouched,
 * so identity survives dark tints and CB palettes.
 */
function bakeTinted(scene: Scene, key: string, map: PixelMap, recolor: Record<string, string>): void {
    if (scene.textures.exists(key)) {
        bakedKeys.add(key);
        return;
    }
    const height = map.length;
    const width = map[0]?.length ?? 0;
    const texture = scene.textures.createCanvas(key, width, height);
    if (!texture) return;
    bakedKeys.add(key);
    const context = texture.getContext();
    context.clearRect(0, 0, width, height);
    map.forEach((row, y) => {
        for (let x = 0; x < row.length; x += 1) {
            const ch = row[x] as string;
            const color = recolor[ch] ?? PALETTE[ch];
            if (color === undefined) continue;
            context.fillStyle = color;
            context.fillRect(x, y, 1, 1);
        }
    });
    texture.refresh();
}

/**
 * Deterministic damage stamp over a char-map copy: a scorch blotch plus
 * sparse crack seams on hull pixels only (w/l/m/t — scorch eats trim too).
 * Same dims, legal chars.
 */
export function damageStamp(map: PixelMap): PixelMap {
    return map.map((row, y) =>
        row
            .split('')
            .map((ch, x) => {
                if (ch !== 'w' && ch !== 'l' && ch !== 'm' && ch !== 't') return ch;
                if (x >= 4 && x <= 7 && y >= 9 && y <= 11) return ch === 'l' || ch === 'm' ? 'k' : 'd';
                if ((x * 7 + y * 11) % 17 === 0) return 'k';
                return ch;
            })
            .join(''),
    );
}

/** Direction-frame canvas size: fits a 16px sprite at 45° (16√2 ≈ 22.6). */
export const DIR8_SIZE = 24;

/**
 * Quantize a heading (radians, 0 = east, positive clockwise) to the
 * nearest of 8 baked direction frames (0..7 = 0°, 45°, …, 315°).
 */
export function dir8ForHeading(heading: number): number {
    const TAU = Math.PI * 2;
    const norm = ((heading % TAU) + TAU) % TAU;
    return Math.round(norm / (Math.PI / 4)) % 8;
}

/**
 * Nearest-neighbor rotation of a char map onto a DIR8_SIZE canvas.
 * Inverse-mapped (no holes); cardinals are pixel-exact. Diagonals get a
 * conservative orphan cleanup (fully-isolated ramp singles only; accent
 * chars are never touched). Deterministic: no RNG anywhere.
 */
function rotateMapDir8(map: PixelMap, dir: number): PixelMap {
    const sh = map.length;
    const sw = map[0]?.length ?? 0;
    const cx = sw / 2;
    const cy = sh / 2;
    const theta = (dir * Math.PI) / 4;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const out: string[] = [];
    for (let y = 0; y < DIR8_SIZE; y += 1) {
        let row = '';
        for (let x = 0; x < DIR8_SIZE; x += 1) {
            const vx = x + 0.5 - DIR8_SIZE / 2;
            const vy = y + 0.5 - DIR8_SIZE / 2;
            const sx = cx + cos * vx + sin * vy;
            const sy = cy - sin * vx + cos * vy;
            const ix = Math.floor(sx);
            const iy = Math.floor(sy);
            row += ix >= 0 && iy >= 0 && ix < sw && iy < sh ? (map[iy]?.[ix] ?? '.') : '.';
        }
        out.push(row);
    }
    if (dir % 2 === 1) killOrphans8(out);
    return out;
}

/** Ramp chars safe to de-dust: accents (lenses/trim/embers) are exempt. */
const DUSTABLE = new Set(['k', 'd', 'm', 'l', 'w', 's', 'h', 'p', 'q']);

/**
 * Remove fully-isolated single pixels (zero opaque 8-neighbors) left by
 * diagonal resampling. In-place on a '.'-padded char grid.
 */
function killOrphans8(grid: string[]): void {
    const h = grid.length;
    const w = grid[0]?.length ?? 0;
    const kill: Array<[number, number]> = [];
    for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
            const ch = grid[y]?.[x] ?? '.';
            if (ch === '.' || !DUSTABLE.has(ch)) continue;
            let neighbors = 0;
            for (let dy = -1; dy <= 1 && neighbors === 0; dy += 1) {
                for (let dx = -1; dx <= 1; dx += 1) {
                    if (dx === 0 && dy === 0) continue;
                    if ((grid[y + dy]?.[x + dx] ?? '.') !== '.') {
                        neighbors += 1;
                        break;
                    }
                }
            }
            if (neighbors === 0) kill.push([x, y]);
        }
    }
    for (const [x, y] of kill) grid[y] = `${grid[y]?.slice(0, x)}.${grid[y]?.slice(x + 1)}`;
}

/**
 * Bake 8 centered direction frames (`${base}_d0..d7`) from a char map with
 * per-char recolor. Skips keys the TextureManager already has.
 */
function bakeDir8(scene: Scene, base: string, map: PixelMap, recolor: Record<string, string>): void {
    for (let dir = 0; dir < 8; dir += 1) {
        bakeTinted(scene, `${base}_d${dir}`, rotateMapDir8(map, dir), recolor);
    }
}

function css(hex: number): string {
    return `#${hex.toString(16).padStart(6, '0')}`;
}

/** Team-tinted chassis key (palette baked in: CB toggles stay correct). */
export function chassisTeamKey(robotId: string, team: 0 | 1, damaged: boolean, dir: number): string {
    return `chassis_${robotId}_t${team}_${isColorblind() ? 'cb' : 'std'}${damaged ? '_dmg' : ''}_d${dir}`;
}

/** Bake per-team chassis variants (both palettes, clean + damaged, 8 dirs). */
function bakeTeamChassis(scene: Scene): void {
    for (const [id, map] of Object.entries(CHASSIS_V2)) {
        // Rotate once per chassis (clean + damaged), recolor per team.
        const cleanDirs: PixelMap[] = [];
        const dmgDirs: PixelMap[] = [];
        const dmg = damageStamp(map);
        for (let dir = 0; dir < 8; dir += 1) {
            cleanDirs.push(rotateMapDir8(map, dir));
            dmgDirs.push(rotateMapDir8(dmg, dir));
        }
        for (const team of [0, 1] as const) {
            for (const cb of [false, true]) {
                // Trim-only team tint: `t` takes the team color, `w` stays hull steel.
                const recolor = { t: css(teamColorFor(team, cb)) };
                const pal = cb ? 'cb' : 'std';
                for (let dir = 0; dir < 8; dir += 1) {
                    bakeTinted(scene, `chassis_${id}_t${team}_${pal}_d${dir}`, cleanDirs[dir] as PixelMap, recolor);
                    bakeTinted(scene, `chassis_${id}_t${team}_${pal}_dmg_d${dir}`, dmgDirs[dir] as PixelMap, recolor);
                }
            }
        }
    }
}

/** Bake 8 direction frames for every other runtime-rotated sprite. */
function bakeDir8Variants(scene: Scene): void {
    bakeDir8(scene, 'tower_light', TOWER_LIGHT, EMPTY_RECOLOR);
    bakeDir8(scene, 'tower_heavy', TOWER_HEAVY, EMPTY_RECOLOR);
    bakeDir8(scene, 'tower_twin', TOWER_TWIN, EMPTY_RECOLOR);
    bakeDir8(scene, 'treads_a', TREADS_A, EMPTY_RECOLOR);
    bakeDir8(scene, 'treads_b', TREADS_B, EMPTY_RECOLOR);
    for (const [id, map] of Object.entries(WRECKS)) bakeDir8(scene, `wreck_${id}`, map, EMPTY_RECOLOR);
    bakeDir8(scene, 'muzzle', MUZZLE_V2, EMPTY_RECOLOR);
    bakeDir8(scene, 'muzzle_big', BIG_MUZZLE, EMPTY_RECOLOR);
    bakeDir8(scene, 'charge_aura', CHARGE_AURA, EMPTY_RECOLOR);
}

/** Deterministic floor pattern: mostly plate, with vents, hazards, accents. */
function floorTileAt(tx: number, ty: number): PixelMap {
    if (tx % 9 === 4 && ty % 7 === 3) return FLOOR_B;
    const edge = tx < 2 || tx > 57 || ty < 2 || ty > 37;
    if (edge && (tx + ty) % 5 === 0) return FLOOR_C;
    if ((tx * 7 + ty * 13) % 29 === 0) return FLOOR_D;
    return FLOOR_A;
}

function hexToRgb(hex: string): [number, number, number] {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/**
 * Compose the full 960x640 arena floor once; render as a single image.
 * Single ImageData blit: each floor tile pre-expands to RGBA once via an
 * RGB LUT, then rows memcpy into place (~10-50x faster than per-pixel
 * fillRect; 614k fillStyle swaps was the boot bottleneck).
 */
function bakeArenaFloor(scene: Scene): void {
    if (scene.textures.exists('floor_big')) {
        bakedKeys.add('floor_big');
        return;
    }
    const texture = scene.textures.createCanvas('floor_big', 960, 640);
    if (!texture) return;
    bakedKeys.add('floor_big');
    const lut = new Map<string, [number, number, number]>();
    for (const [ch, hex] of Object.entries(PALETTE)) lut.set(ch, hexToRgb(hex));
    const tileCache = new Map<PixelMap, Uint8ClampedArray>();
    const expand = (tile: PixelMap): Uint8ClampedArray => {
        const hit = tileCache.get(tile);
        if (hit) return hit;
        const rgba = new Uint8ClampedArray(16 * 16 * 4);
        tile.forEach((row, y) => {
            for (let x = 0; x < 16; x += 1) {
                const rgb = lut.get(row[x] as string);
                const o = (y * 16 + x) * 4;
                if (rgb === undefined) continue; // transparent holds zeros
                rgba[o] = rgb[0];
                rgba[o + 1] = rgb[1];
                rgba[o + 2] = rgb[2];
                rgba[o + 3] = 255;
            }
        });
        tileCache.set(tile, rgba);
        return rgba;
    };
    const context = texture.getContext();
    const image = context.createImageData(960, 640);
    for (let ty = 0; ty < 40; ty += 1) {
        for (let tx = 0; tx < 60; tx += 1) {
            const tile = expand(floorTileAt(tx, ty));
            for (let y = 0; y < 16; y += 1) {
                image.data.set(tile.subarray(y * 64, y * 64 + 64), ((ty * 16 + y) * 960 + tx * 16) * 4);
            }
        }
    }
    context.putImageData(image, 0, 0);
    floorOverlay(context, lut);
    texture.refresh();
}

/**
 * Vector overlay pass on the baked floor (zero runtime cost): center-ring
 * emblem (the SD target mark), spawn pads at the verified spawn columns
 * (x = 130 / 830, engine spawnFor; y union for team sizes 1–3), a stronger
 * rim-hazard band, a dot-vs-dash per-half cue (NO color tint), the baked
 * corner decals, a radial vignette, and a 2 px inner border.
 */
function floorOverlay(context: CanvasRenderingContext2D, lut: Map<string, [number, number, number]>): void {
    // Spawn pads: shape-coded (triangle = team 0, square = team 1), no tint.
    context.lineWidth = 2;
    context.strokeStyle = 'rgba(232,237,242,0.35)';
    for (const x of [130, 830]) {
        for (const y of [170, 245, 320, 395, 470]) {
            context.strokeRect(x - 22, y - 22, 44, 44);
            context.beginPath();
            if (x < 480) {
                context.moveTo(x, y - 30);
                context.lineTo(x - 6, y - 20);
                context.lineTo(x + 6, y - 20);
                context.closePath();
            } else {
                context.rect(x - 5, y - 30, 10, 10);
            }
            context.stroke();
        }
    }
    // Center-ring emblem = the SD collapse target.
    context.strokeStyle = 'rgba(232,237,242,0.28)';
    context.lineWidth = 3;
    context.beginPath();
    context.arc(480, 320, 60, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = 'rgba(232,237,242,0.2)';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(480, 320, 44, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(480 - 72, 320);
    context.lineTo(480 + 72, 320);
    context.moveTo(480, 320 - 72);
    context.lineTo(480, 320 + 72);
    context.stroke();
    context.fillStyle = 'rgba(232,237,242,0.35)';
    context.beginPath();
    context.arc(480, 320, 4, 0, Math.PI * 2);
    context.fill();
    // Dot-vs-dash per-half cue along the center line (shape, not color).
    context.fillStyle = 'rgba(232,237,242,0.25)';
    for (let y = 20; y < 640; y += 40) {
        context.beginPath();
        context.arc(470, y, 2.5, 0, Math.PI * 2);
        context.fill();
        context.fillRect(486, y - 1.5, 9, 3);
    }
    // Stronger rim-hazard band: diagonal ticks just inside every edge.
    context.strokeStyle = 'rgba(255,179,64,0.28)';
    context.lineWidth = 3;
    for (let x = 12; x < 960; x += 24) {
        for (const y of [10, 630]) {
            context.beginPath();
            context.moveTo(x, y - 5);
            context.lineTo(x + 9, y + 5);
            context.stroke();
        }
    }
    for (let y = 12; y < 640; y += 24) {
        for (const x of [10, 950]) {
            context.beginPath();
            context.moveTo(x - 5, y);
            context.lineTo(x + 5, y + 9);
            context.stroke();
        }
    }
    // Baked radial vignette (static corners; Phase 6 owns the red pulse).
    const grad = context.createRadialGradient(480, 320, 280, 480, 320, 620);
    grad.addColorStop(0, 'rgba(6,8,11,0)');
    grad.addColorStop(1, 'rgba(6,8,11,0.45)');
    context.fillStyle = grad;
    context.fillRect(0, 0, 960, 640);
    // Corner decals baked in (16×16 at the legacy sprite footprints).
    stampMap(context, lut, DECOR_CRATE, 36, 36);
    stampMap(context, lut, DECOR_BARREL, 908, 36);
    stampMap(context, lut, DECOR_VENT, 36, 588);
    stampMap(context, lut, DECOR_LAMP, 908, 588);
    // 2 px inner border.
    context.strokeStyle = '#3a4656';
    context.lineWidth = 2;
    context.strokeRect(1, 1, 958, 638);
}

/** Stamp a pixel map into a floor-bake context at 1:1 (alpha 0.55). */
function stampMap(
    context: CanvasRenderingContext2D,
    lut: Map<string, [number, number, number]>,
    map: PixelMap,
    ox: number,
    oy: number,
): void {
    context.save();
    context.globalAlpha = 0.55;
    map.forEach((row, y) => {
        for (let x = 0; x < row.length; x += 1) {
            const rgb = lut.get(row[x] as string);
            if (rgb === undefined) continue;
            context.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
            context.fillRect(ox + x, oy + y, 1, 1);
        }
    });
    context.restore();
}

/** Soft black scorch blob for the impact-decal pool (32×32, white-tintable). */
function bakeScorch(scene: Scene): void {
    if (scene.textures.exists('scorch')) {
        bakedKeys.add('scorch');
        return;
    }
    const texture = scene.textures.createCanvas('scorch', 32, 32);
    if (!texture) return;
    bakedKeys.add('scorch');
    const context = texture.getContext();
    const grad = context.createRadialGradient(16, 16, 2, 16, 16, 15);
    grad.addColorStop(0, 'rgba(10,8,6,0.9)');
    grad.addColorStop(0.55, 'rgba(20,14,10,0.65)');
    grad.addColorStop(1, 'rgba(20,14,10,0)');
    context.fillStyle = grad;
    context.fillRect(0, 0, 32, 32);
    // Fixed cinder speckles (deterministic bake, no RNG).
    context.fillStyle = 'rgba(5,4,3,0.8)';
    for (const [x, y] of [[9, 12], [22, 10], [12, 22], [21, 21], [16, 8]] as const) {
        context.fillRect(x, y, 2, 2);
    }
    texture.refresh();
}

/**
 * SD danger-fill ring (256×256, white so the scene tints the amber→red→
 * white ramp). Soft band peaking near the rim, transparent center.
 */
function bakeSdRing(scene: Scene): void {
    if (scene.textures.exists('sd_ring')) {
        bakedKeys.add('sd_ring');
        return;
    }
    const texture = scene.textures.createCanvas('sd_ring', 256, 256);
    if (!texture) return;
    bakedKeys.add('sd_ring');
    const context = texture.getContext();
    const grad = context.createRadialGradient(128, 128, 96, 128, 128, 128);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.28)');
    grad.addColorStop(0.85, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = grad;
    context.fillRect(0, 0, 256, 256);
    texture.refresh();
}

/** Muzzle halo: warm radial sprite for the pooled ADD-blend halos (16×16). */
function bakeHalo(scene: Scene): void {
    if (scene.textures.exists('halo')) {
        bakedKeys.add('halo');
        return;
    }
    const texture = scene.textures.createCanvas('halo', 16, 16);
    if (!texture) return;
    bakedKeys.add('halo');
    const context = texture.getContext();
    const grad = context.createRadialGradient(8, 8, 1, 8, 8, 8);
    grad.addColorStop(0, 'rgba(255,242,204,1)');
    grad.addColorStop(0.4, 'rgba(255,210,138,0.6)');
    grad.addColorStop(1, 'rgba(255,210,138,0)');
    context.fillStyle = grad;
    context.fillRect(0, 0, 16, 16);
    texture.refresh();
}

/** Per-block one-time bake key (all blocks layout rects are 90×90). */
export function blockKey(w: number, h: number): string {
    return `block_${w}x${h}`;
}

/**
 * Bake one obstacle-block canvas at exact pixel dims: OBSTACLE_TOP tiles
 * wrapped wall-to-wall (fixes the 16 px crop), a dark edge frame, and a top
 * light-catch. Baked once per dims, reused by every block that size.
 */
export function ensureBlockTexture(scene: Scene, w: number, h: number): void {
    const key = blockKey(w, h);
    if (scene.textures.exists(key)) {
        bakedKeys.add(key);
        return;
    }
    const texture = scene.textures.createCanvas(key, w, h);
    if (!texture) return;
    bakedKeys.add(key);
    const context = texture.getContext();
    OBSTACLE_TOP.forEach((row, ty) => {
        for (let x = 0; x < row.length; x += 1) {
            const color = PALETTE[row[x] as string];
            if (color === undefined) continue;
            context.fillStyle = color;
            for (let oy = ty; oy < h; oy += 16) {
                for (let ox = x; ox < w; ox += 16) {
                    context.fillRect(ox, oy, 1, 1);
                }
            }
        }
    });
    context.strokeStyle = '#0b0e12';
    context.lineWidth = 3;
    context.strokeRect(1, 1, w - 2, h - 2);
    context.strokeStyle = 'rgba(232,237,242,0.5)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(3, 3);
    context.lineTo(w - 3, 3);
    context.stroke();
    texture.refresh();
}

function debugArtRequested(): boolean {
    try {
        return typeof window !== 'undefined' && window.location.search.includes('debugart');
    } catch {
        return false;
    }
}

function nowMs(): number {
    try {
        return typeof performance !== 'undefined' ? performance.now() : Date.now();
    } catch {
        return Date.now();
    }
}

/** Bake every procedural texture. Safe to call from any scene. */
export function ensureArtTextures(scene: Scene): void {
    const t0 = nowMs();
    // Purged dead keys (Phase 0): tile_floor, panel_tile, tower dup-key.
    // tracer/ring_fx/treads_*/recoil_* stay: claimed by fidelity Phases 1-3.
    for (const { key, map } of artRegistry()) bake(scene, key, map);
    bakeTeamChassis(scene);
    bakeDir8Variants(scene);
    bakeArenaFloor(scene);
    bakeScorch(scene);
    bakeSdRing(scene);
    bakeHalo(scene);
    if (debugArtRequested()) {
        const ms = (nowMs() - t0).toFixed(1);
        const issues = validateArt();
        if (issues.length === 0) {
            console.info(`[debugart] clean: ${artRegistry().length} maps + floor_big in ${ms}ms`);
        } else {
            for (const issue of issues) console.warn(`[debugart] ${issue.key}: ${issue.detail}`);
        }
    }
}

export function chassisKey(robotId: string): string {
    return `chassis_${robotId}`;
}

export function wreckKey(robotId: string): string {
    return `wreck_${robotId}`;
}

export function towerKey(robotId: string): string {
    return TOWER_FOR_ROBOT[robotId] ?? 'tower_light';
}

/** Nearest-direction tower key for a robot (8 baked frames, no rotation). */
export function towerDirKey(robotId: string, dir: number): string {
    return `${towerKey(robotId)}_d${dir}`;
}

/** Nearest-direction tread key (roll frame A/B × 8 headings). */
export function treadsDirKey(flipped: boolean, dir: number): string {
    return `treads_${flipped ? 'b' : 'a'}_d${dir}`;
}

/** Nearest-direction wreck key. */
export function wreckDirKey(robotId: string, dir: number): string {
    return `wreck_${robotId}_d${dir}`;
}

/** Nearest-direction muzzle key (standard or big charged variant). */
export function muzzleDirKey(big: boolean, dir: number): string {
    return `${big ? 'muzzle_big' : 'muzzle'}_d${dir}`;
}

/** Nearest-direction charge-aura key. */
export function auraDirKey(dir: number): string {
    return `charge_aura_d${dir}`;
}

export function skillIconKey(skillId: string): string {
    return `skill_${skillId}`;
}

/** 8×8 UI icon key (dash/emp/trophy/skull/copy), always paired with text. */
export function uiIconKey(iconId: string): string {
    return `icon_${iconId}`;
}
