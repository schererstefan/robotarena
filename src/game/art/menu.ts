// Menu/UI pixel-art drafts: 9 skill icons (8x8), panel chrome tile (16x16),
// logo underline bar (32x8). Same string pixel-map format as src/game/art.ts.
// Palette chars: . = transparent, k d m l w r g y (no additions needed).

type PixelMap = string[];

// 8x8 skill icons. White detail on transparent; read at 16px (2x) display.
export const SKILL_ICONS: Record<string, PixelMap> = {
    // Double chevron >> (overdrive/boost).
    overdrive: [
        '........',
        '..w..w..',
        '.ww..ww.',
        '..wwww..',
        '..wwww..',
        '.ww..ww.',
        '..w..w..',
        '........',
    ],
    // Two wedge-head arcs chasing a circle (gyro).
    gyro: [
        '..wwww..',
        '.w....w.',
        '.....www',
        '......w.',
        '.w......',
        'www.....',
        '.w....w.',
        '..wwww..',
    ],
    // Four-tooth gear with square hub hole (servos).
    servos: [
        '...ww...',
        '..wwww..',
        '.wwwwww.',
        'www..www',
        'www..www',
        '.wwwwww.',
        '..wwww..',
        '...ww...',
    ],
    // Dish pointing up: bowl, feed mast + dot, signal arcs, base (longscan).
    longscan: [
        '.w....w.',
        '...ww...',
        '...ww...',
        'w......w',
        '.w....w.',
        '..w..w..',
        '...ww...',
        '..wwww..',
    ],
    // Broadcast fan: emitter dot under two concentric arcs (wideband).
    wideband: [
        '..wwww..',
        '.w....w.',
        'w......w',
        'w..ww..w',
        '..w..w..',
        '.w....w.',
        '...ww...',
        '...ww...',
    ],
    // Bold plus reticle with gaps (trigger crosshair).
    trigger: [
        '...ww...',
        '...ww...',
        '........',
        'ww.ww.ww',
        'ww.ww.ww',
        '........',
        '...ww...',
        '...ww...',
    ],
    // Ring scope with full crosshair + filled center (marksman).
    marksman: [
        '..wwww..',
        '.w....w.',
        'w..ww..w',
        'w.wwww.w',
        'w.wwww.w',
        'w..ww..w',
        '.w....w.',
        '..wwww..',
    ],
    // Zigzag lightning bolt with tapered tip (charger).
    charger: [
        '.....ww.',
        '....ww..',
        '...ww...',
        '..wwww..',
        '....ww..',
        '...ww...',
        '..ww....',
        '..w.....',
    ],
    // Shield outline with center ridge tapering to a point (plating).
    plating: [
        '.wwwwww.',
        'ww....ww',
        'w..ww..w',
        'w..ww..w',
        '.w.ww.w.',
        '.w.ww.w.',
        '..wwww..',
        '...ww...',
    ],
};

// 16x16 pixel-chrome frame tile: dark fill, light top-left bevel,
// dark bottom-right bevel, single rivet near the top-left corner.
export const PANEL_TILE: PixelMap = [
    'llllllllllllllll',
    'lmddddddddddddmk',
    'ldwlddddddddddmk',
    'ldlkddddddddddmk',
    'ldddddddddddddmk',
    'ldddddddddddddmk',
    'ldddddddddddddmk',
    'ldddddddddddddmk',
    'ldddddddddddddmk',
    'ldddddddddddddmk',
    'ldddddddddddddmk',
    'ldddddddddddddmk',
    'ldddddddddddddmk',
    'ldddddddddddddmk',
    'lmmmmmmmmmmmmmmk',
    'lkkkkkkkkkkkkkkk',
];

// 32x8 logo bar: amber underline with 2px end caps.
export const LOGO_BAR: PixelMap = [
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    'yy............................yy',
    'yy............................yy',
    'yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy',
];
