// Procedural pixel-art pipeline. Sprites are authored as string pixel maps
// and baked into canvas textures at runtime: no binary assets, crisp pixels
// at any scale, and contributors can add art by editing text.

import { Scene } from 'phaser';

type PixelMap = string[];

const PALETTE: Record<string, string> = {
    k: '#0b0e12', // near-black outline
    d: '#2b3542', // dark panel
    m: '#5d6a78', // mid gray
    l: '#9aa7b4', // light gray
    w: '#ffffff', // white (tints cleanly to team/paint colors)
    r: '#ff5d5d', // red lens
    g: '#7de08a', // green lens
    y: '#ffd23f', // amber lens
};

// All chassis face EAST (+x), 16x16. Tints to team color at render time.
const CHASSIS: Record<string, PixelMap> = {
    rusher: [
        '................',
        '..kkkkkkkkkkkk..',
        '.kmmmmmmmmmmmkk.',
        '.kmkdkdkdkdkmmk.',
        '.kdkkkkkkkkkkddk',
        '.kdkwwwwwwwkdddk',
        '.kdkwmmmmmwkdddk',
        '.kdkwmlllmwkdddk',
        '.kdkwmlllmwkdddk',
        '.kdkwmmmmmwkdddk',
        '.kdkwwwwwwwkdddk',
        '.kdkkkkkkkkkkddk',
        '.kmkdkdkdkdkmmk.',
        '.kmmmmmmmmmmmkk.',
        '..kkkkkkkkkkkk..',
        '................',
    ],
    turret: [
        '................',
        '.kkkkkkkkkkkkkk.',
        'kddddddddddddddk',
        'kdkkkkkkkkkkkkdk',
        'kdkwwwwwwwwwwkdk',
        'kdkwmmmmmmmmwkdk',
        'kdkwmllllllmwkdk',
        'kdkwmlyyyylmwkdk',
        'kdkwmlyyyylmwkdk',
        'kdkwmllllllmwkdk',
        'kdkwmmmmmmmmwkdk',
        'kdkwwwwwwwwwwkdk',
        'kdkkkkkkkkkkkkdk',
        'kddddddddddddddk',
        '.kkkkkkkkkkkkkk.',
        '................',
    ],
    orbiter: [
        '................',
        '................',
        '....kkkkkkkk....',
        '..kkmmmmmmmmmkk.',
        '.kmmkkkkkkkkkmmk',
        '.kmkwwwwwwwkmmk.',
        '.kmkwmmmmmmwkmk.',
        'kmmkwmlllwmkwmmk',
        'kmmkwmlllwmkwmmk',
        '.kmkwmmmmmmwkmk.',
        '.kmkwwwwwwwkmmk.',
        '.kmmkkkkkkkkkmmk',
        '..kkmmmmmmmmmkk.',
        '....kkkkkkkk....',
        '................',
        '................',
    ],
    wanderer: [
        '................',
        '.....kkkkkk.....',
        '...kkmmmmmmkk...',
        '..kmmmllllmmmk..',
        '.kmmllwwwwllmmk.',
        '.kmmlwwwwwwlmmk.',
        'kmmldwmmmmwdlmmk',
        'kmmldwmrrmwdlmmk',
        'kmmldwmrrmwdlmmk',
        'kmmldwmmmmwdlmmk',
        '.kmmlwwwwwwlmmk.',
        '.kmmllwwwwllmmk.',
        '..kmmmllllmmmk..',
        '...kkmmmmmmkk...',
        '.....kkkkkk.....',
        '................',
    ],
    hunter: [
        '.......ww.......',
        '..kkkkkwkkkkk...',
        '.kmmmmmmmmmmkkk.',
        '.kmkdkdkdkdmkddk',
        '.kdkkkkkkkkkdddk',
        '.kdkwwwwwwwkdddk',
        '.kdkwmmmmmwkdddk',
        '.rdkwmyylmwkdddk',
        '.rdkwmyylmwkdddk',
        '.kdkwmmmmmwkdddk',
        '.kdkwwwwwwwkdddk',
        '.kdkkkkkkkkkdddk',
        '.kmkdkdkdkdmkddk',
        '.kmmmmmmmmmmkkk.',
        '..kkkkkkkkkkk...',
        '................',
    ],
};

// Tower: hub centered at (8,8), barrel pointing EAST. Tints to paint color.
const TOWER: PixelMap = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '......kkkkkkkkk.',
    '.....kwwwwwwwwk.',
    '.....kwwwwwwwwk.',
    '......kkkkkkkkk.',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
];

const HUB: PixelMap = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '......kkkk......',
    '.....kwwwwk.....',
    '.....kwkkwk.....',
    '.....kwkkwk.....',
    '.....kwwwwk.....',
    '......kkkk......',
    '................',
    '................',
    '................',
    '................',
    '................',
];

const BULLET: PixelMap = ['.ww.', 'wwww', 'wwww', '.ww.'];

const SPARK: PixelMap = ['ww', 'ww'];

const MUZZLE: PixelMap = [
    '...ww...',
    '...ww...',
    '.wwyyww.',
    'wwyyyyww',
    '.wwyyww.',
    '...ww...',
    '...ww...',
];

const TILE_FLOOR: PixelMap = [
    'dddddddddddddddd',
    'dlllllllllllllld',
    'dl............ld',
    'dl............ld',
    'dl..m......m..ld',
    'dl............ld',
    'dl............ld',
    'dl............ld',
    'dl............ld',
    'dl............ld',
    'dl............ld',
    'dl..m......m..ld',
    'dl............ld',
    'dl............ld',
    'dlllllllllllllld',
    'dddddddddddddddd',
];

const TILE_WALL: PixelMap = [
    'yyyyyyyyyyyyyyyy',
    'kyyyyyyyyyyyyyyk',
    'kmmmmmmmmmmmmmmk',
    'kmkdkdkdkdkdkdmk',
    'kmddddddddddddmk',
    'kmddkddddddkddmk',
    'kmddkddddddkddmk',
    'kmddddddddddddmk',
    'kmddkddddddkddmk',
    'kmddkddddddkddmk',
    'kmddddddddddddmk',
    'kmkdkdkdkdkdkdmk',
    'kmmmmmmmmmmmmmmk',
    'kddddddddddddddk',
    'kkkkkkkkkkkkkkkk',
    '................',
];

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

/** Bake every procedural texture. Safe to call from any scene. */
export function ensureArtTextures(scene: Scene): void {
    for (const [id, map] of Object.entries(CHASSIS)) bake(scene, `chassis_${id}`, map);
    bake(scene, 'tower', TOWER);
    bake(scene, 'hub', HUB);
    bake(scene, 'bullet', BULLET);
    bake(scene, 'spark', SPARK);
    bake(scene, 'muzzle', MUZZLE);
    bake(scene, 'tile_floor', TILE_FLOOR);
    bake(scene, 'tile_wall', TILE_WALL);
}

export function chassisKey(robotId: string): string {
    return `chassis_${robotId}`;
}
