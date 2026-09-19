// Procedural pixel-art pipeline. Sprites live as string pixel maps in
// ./art/*.ts and bake into canvas textures at runtime: no binary assets,
// crisp pixels at any scale, contributors add art by editing text.
//
// House rules (from the art round): 1px `k` outlines on chassis/hubs, never
// on lenses or glow; light from top-left (`l`/`c` up-left, `d`/`s` low-right);
// only `w` tints to team/paint colors; lenses sit on `k`/`d`; ordered 2px
// dither only between adjacent ramp steps; glow cores are `w` with `c`/`y`
// mids and `o` outers; no purple family anywhere.

import { Scene } from 'phaser';
import { BIG_MUZZLE, RECOIL_A, RECOIL_B, SPAWN_A, SPAWN_B, TREADS_A, TREADS_B } from './art/anim';
import { CHASSIS_V2 } from './art/chassis';
import { DECOR_BARREL, DECOR_CRATE, DECOR_LAMP, DECOR_VENT } from './art/decor';
import { FLOOR_A, FLOOR_B, FLOOR_C, FLOOR_D } from './art/floor';
import { BOOM_1, BOOM_2, BOOM_3, BOOM_4, CHARGE_AURA, RING_FX } from './art/fx';
import { LOGO_BAR, PANEL_TILE, SKILL_ICONS } from './art/menu';
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

function bake(scene: Scene, key: string, map: PixelMap): void {
    if (scene.textures.exists(key)) return;
    const height = map.length;
    const width = map[0]?.length ?? 0;
    const texture = scene.textures.createCanvas(key, width, height);
    if (!texture) return;
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

/** Compose the full 960x640 arena floor once; render as a single image. */
function bakeArenaFloor(scene: Scene): void {
    if (scene.textures.exists('floor_big')) return;
    const texture = scene.textures.createCanvas('floor_big', 960, 640);
    if (!texture) return;
    const context = texture.getContext();
    for (let ty = 0; ty < 40; ty += 1) {
        for (let tx = 0; tx < 60; tx += 1) {
            const tile = floorTileAt(tx, ty);
            tile.forEach((row, y) => {
                for (let x = 0; x < row.length; x += 1) {
                    const color = PALETTE[row[x] as string];
                    if (color === undefined) continue;
                    context.fillStyle = color;
                    context.fillRect(tx * 16 + x, ty * 16 + y, 1, 1);
                }
            });
        }
    }
    texture.refresh();
}

/** Bake every procedural texture. Safe to call from any scene. */
export function ensureArtTextures(scene: Scene): void {
    for (const [id, map] of Object.entries(CHASSIS_V2)) bake(scene, `chassis_${id}`, map);
    for (const [id, map] of Object.entries(WRECKS)) bake(scene, `wreck_${id}`, map);
    for (const [id, map] of Object.entries(SKILL_ICONS)) bake(scene, `skill_${id}`, map as PixelMap);
    bake(scene, 'tower_light', TOWER_LIGHT);
    bake(scene, 'tower_heavy', TOWER_HEAVY);
    bake(scene, 'tower_twin', TOWER_TWIN);
    bake(scene, 'tower', TOWER_LIGHT);
    bake(scene, 'hub', HUB_V2);
    bake(scene, 'muzzle', MUZZLE_V2);
    bake(scene, 'muzzle_big', BIG_MUZZLE);
    bake(scene, 'bullet', BULLET_V2);
    bake(scene, 'bullet_hot', BULLET_CHARGED);
    bake(scene, 'spark', SPARK_V2);
    bake(scene, 'tracer', TRACER);
    bake(scene, 'tile_floor', FLOOR_A);
    bake(scene, 'tile_wall', WALL_V2);
    bake(scene, 'wall_corner', WALL_CORNER);
    bake(scene, 'wall_gate', WALL_GATE);
    bake(scene, 'boom_1', BOOM_1);
    bake(scene, 'boom_2', BOOM_2);
    bake(scene, 'boom_3', BOOM_3);
    bake(scene, 'boom_4', BOOM_4);
    bake(scene, 'ring_fx', RING_FX);
    bake(scene, 'charge_aura', CHARGE_AURA);
    bake(scene, 'panel_tile', PANEL_TILE);
    bake(scene, 'logo_bar', LOGO_BAR);
    bake(scene, 'decor_crate', DECOR_CRATE);
    bake(scene, 'decor_barrel', DECOR_BARREL);
    bake(scene, 'decor_lamp', DECOR_LAMP);
    bake(scene, 'decor_vent', DECOR_VENT);
    bake(scene, 'spawn_a', SPAWN_A);
    bake(scene, 'spawn_b', SPAWN_B);
    bake(scene, 'recoil_a', RECOIL_A);
    bake(scene, 'recoil_b', RECOIL_B);
    bake(scene, 'treads_a', TREADS_A);
    bake(scene, 'treads_b', TREADS_B);
    bakeArenaFloor(scene);
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
