// Menu/UI pixel-art drafts: 13 skill icons (8x8), panel chrome tile (16x16),
// logo underline bar (32x8). Same string pixel-map format as src/game/art.ts.
// Palette chars: . = transparent, k d m l w r g y (no additions needed).

type PixelMap = string[];

// 8x8 skill icons, read at 16px (2x) in the loadout menu. Every icon has a
// distinct silhouette AND family accent color + k drop shadow, so no two
// confuse at a glance. Families: offense = amber y (trigger marksman
// deadeye charger), defense = blue b (plating nanorepair), mobility =
// green g (overdrive gyro servos slipstream), sensors = cream c (longscan
// wideband scout). White w = hot detail shared by all.
export const SKILL_ICONS: Record<string, PixelMap> = {
    // Double chevron >> in green/white with k shade (overdrive/boost).
    overdrive: [
        '........',
        '.w..w...',
        '.gw.gwk.',
        '..w..wk.',
        '.gw.gwk.',
        '.w..w...',
        '.k..k...',
        '........',
    ],
    // Gyro ring: green band, top-left arc light, center hub (gyro).
    gyro: [
        '..gggg..',
        '.gg..gg.',
        '.g....g.',
        '.w.gg.g.',
        '.w.gg.g.',
        '.wg...g.',
        '..gg.gg.',
        '...gggk.',
    ],
    // Four-tooth gear, white-lit crown, square hub hole (servos).
    servos: [
        '...gg...',
        '..gwwg..',
        '..gwwg..',
        'gwg..gwg',
        'gwg..gwg',
        '..gwwg..',
        '..gwwgk.',
        '...ggk..',
    ],
    // Dish pointing up: signal arcs rain onto a creamed bowl + mast (longscan).
    longscan: [
        '.c....c.',
        '..c..c..',
        '...cc...',
        '...ww...',
        'c..ww..c',
        '.c.ww.c.',
        '..cwwc..',
        '..cccck.',
    ],
    // Broadcast fan: emitter bar + two ) arcs opening right (wideband).
    wideband: [
        '......c.',
        '....c.cc',
        '..w..c.c',
        '..ww.c.c',
        '..ww.c.c',
        '..w..c.c',
        '....c.cc',
        '......ck',
    ],
    // Crosshair reticle: amber ring, white ticks, OPEN center (trigger).
    trigger: [
        '..yyyy..',
        '.y....y.',
        'y..ww..y',
        'y.w..w.y',
        'y.w..w.y',
        'y..ww..y',
        '.y....yk',
        '..yyyyk.',
    ],
    // Scope: amber ring, full white cross, filled amber bullseye (marksman).
    marksman: [
        '..yyyy..',
        '.y.ww.y.',
        'y..ww..y',
        '.wwyyww.',
        '.wwyyww.',
        'y..ww..y',
        '.y.ww.yk',
        '..yyyyk.',
    ],
    // Lightning bolt: white-hot core, amber body, notched shade (charger).
    charger: [
        '....yy..',
        '...ywy..',
        '...ywy..',
        '..ywwyk.',
        '..ywy...',
        '..ywy.k.',
        '..ywyk..',
        '..wyk...',
    ],
    // Shield: blue plate, white center ridge, tapered point (plating).
    plating: [
        '.bbbbbb.',
        'bwbbbbwb',
        'bwbwwbwb',
        'b.bwwb.b',
        '.b.ww.b.',
        '.b.ww.bk',
        '..bwwbk.',
        '...bbk..',
    ],
    // Repair cross: blue arms, glowing white core, k shade (nanorepair).
    nanorepair: [
        '........',
        '...bb...',
        '...ww...',
        '.bbwwbbk',
        '.bbwwbbk',
        '...wwk..',
        '...bbk..',
        '....kk..',
    ],
    // Triple speed lines, staggered, white heads, dark tail tips (slipstream).
    slipstream: [
        '........',
        '.wwgggk.',
        '........',
        '...wwggk',
        '........',
        '.wwgggk.',
        '........',
        '........',
    ],
    // Diamond reticle, white inner band, filled amber core (deadeye).
    deadeye: [
        '...yy...',
        '..ywwy..',
        '.ywyywy.',
        'ywyyyywy',
        'ywyyyywy',
        '.ywyywyk',
        '..ywwyk.',
        '...yyk..',
    ],
    // watchful eye: cream almond, white ball, k pupil (scout).
    scout: [
        '........',
        '........',
        '..cccc..',
        '.cwwwwc.',
        'cwwkkwwc',
        '.cwwwwck',
        '..cccck.',
        '........',
    ],
};

// 8x8 UI icons (Phase 5): always rendered paired with a text label,
// never alone. white detail on transparent, read at 1x next to 9-12px type.
export const UI_ICONS: Record<string, PixelMap> = {
    // Double speed chevron (dash cooldown dial).
    dash: [
        '........',
        '.w...w..',
        '.ww..ww.',
        '.www.www',
        '.ww..ww.',
        '.w...w..',
        '........',
        '........',
    ],
    // Starburst (EMP cooldown dial).
    emp: [
        '...w....',
        '.w.w.w..',
        '..www...',
        'wwwwwww.',
        '..www...',
        '.w.w.w..',
        '...w....',
        '........',
    ],
    // Cup with stem and base (MVP line).
    trophy: [
        'ww...ww.',
        'wwwwwww.',
        '.wwwww..',
        '..www...',
        '...w....',
        '...w....',
        '..www...',
        '........',
    ],
    // Skull with eye sockets (death markers, results rows).
    skull: [
        '..wwww..',
        '.wwwwww.',
        '.wkwwkw.',
        '.wwwwww.',
        '..wwww..',
        '..w..w..',
        '........',
        '........',
    ],
    // Overlapping copy rects (replay-code row).
    copy: [
        '..kkkk..',
        '..kwwk..',
        '..kwwkk.',
        '..kkkwk.',
        '...kwk..',
        '...kwk..',
        '...kkk..',
        '........',
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
