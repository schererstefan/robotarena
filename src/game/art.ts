// Procedural pixel-art pipeline. Sprites live as string pixel maps in
// ./art/*.ts and bake into canvas textures at runtime: no binary assets,
// crisp pixels at any scale, contributors add art by editing text.
//
// House rules (from the art round): 1px `k` outlines on chassis/hubs, never
// on lenses or glow; light from top-left (`l`/`c` up-left, `d`/`s` low-right);
// only `w` tints to team/paint colors; lenses sit on `k`/`d`; ordered 2px
// dither only between adjacent ramp steps; glow cores are `w` with `c`/`y`
// mids and `o` outers; no purple family anywhere.
//
// Texture-atlas audit (Phase 19): each key below is one canvas texture baked
// exactly once per game (guarded by `textures.exists`) and one GPU upload —
// merging ~50 tiny pixel sprites into a single atlas would add frame
// bookkeeping to every scene for negligible gain, so per-key textures stand.
// The expensive layer (arena floor) is pre-composed into ONE 960x640 image,
// and BattleScene pools all per-frame/per-event objects (bullets, particles,
// damage numbers, explosion flashes) instead of allocating mid-fight.

import { Scene } from 'phaser';
import { BIG_MUZZLE, RECOIL_A, RECOIL_B, SPAWN_A, SPAWN_B, TREADS_A, TREADS_B } from './art/anim';
import { CHASSIS_V2 } from './art/chassis';
import { DECOR_BARREL, DECOR_CRATE, DECOR_LAMP, DECOR_VENT } from './art/decor';
import { FLOOR_A, FLOOR_B, FLOOR_C, FLOOR_D } from './art/floor';
import { BOOM_1, BOOM_2, BOOM_3, BOOM_4, CHARGE_AURA, RING_FX } from './art/fx';
import { LOGO_BAR, SKILL_ICONS } from './art/menu';
import { validateArt } from './art/validate';
import { BULLET_CHARGED, BULLET_V2, SPARK_V2, TRACER } from './art/projectiles';
import { HUB_V2, MUZZLE_V2, TOWER_HEAVY, TOWER_LIGHT, TOWER_TWIN } from './art/towers';
import { WALL_CORNER, WALL_GATE, WALL_V2 } from './art/walls';
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
        ['wall_corner', WALL_CORNER, 16, 16],
        ['wall_gate', WALL_GATE, 16, 16],
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
            const color = PALETTE[row[x] as string];
            if (color === undefined) continue;
            context.fillStyle = color;
            context.fillRect(x, y, 1, 1);
        }
    });
    texture.refresh();
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
    bakeArenaFloor(scene);
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

export function skillIconKey(skillId: string): string {
    return `skill_${skillId}`;
}
