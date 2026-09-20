// Arena wall tile drafts, 16x16 each. Same string-pixel-map format as
// src/game/art.ts. Palette chars used: k, d, m, w, y (all in base PALETTE).
// No PALETTE_ADDITIONS needed.
// WALL_V2 tiles horizontally seamlessly (period-4 hazard stripes, k edges).

type PixelMap = string[];

export const WALL_V2: PixelMap = [
    'kkkkkkkkkkkkkkkk',
    'yykkyykkyykkyykk',
    'ykkyykkyykkyykky',
    'kkyykkyykkyykkyy',
    'kkkkkkkkkkkkkkkk',
    'kmmmmmmmmmmmmmmk',
    'kmddddddddddddmk',
    'kmwddddddddddwmk',
    'kmdkkdkkkkdkkdmk',
    'kmddddddddddddmk',
    'kmwddddddddddwmk',
    'kmddddddddddddmk',
    'kmdmmmmmmmmmmdmk',
    'kmmmmmmmmmmmmmmk',
    'kddddddddddddddk',
    'kkkkkkkkkkkkkkkk',
];

// Top-left outer corner: hazard cap on top, riveted corner post with an
// amber band on the left; right side continues the WALL_V2 body pattern.
export const WALL_CORNER: PixelMap = [
    'kkkkkkkkkkkkkkkk',
    'yykkyykkyykkyykk',
    'ykkyykkyykkyykky',
    'kkyykkyykkyykkyy',
    'kkkkkkkkkkkkkkkk',
    'kmmmkmmmmmmmmmmk',
    'kmdmkdddddddddmk',
    'kmwmkddddddddwmk',
    'kmdmkdkkkkdkkdmk',
    'kyyykdddddddddmk',
    'kmdmkddddddddwmk',
    'kmwmkdddddddddmk',
    'kmdmkmmmmmmmmdmk',
    'kmmmkmmmmmmmmmmk',
    'kdddkddddddddddk',
    'kkkkkkkkkkkkkkkk',
];

// Obstacle cap: reads as solid machinery, NOT a wall (no hazard stripes).
// Riveted plate with a top light-catch and a low-right shade step.
export const OBSTACLE_TOP: PixelMap = [
    'kkkkkkkkkkkkkkkk',
    'kllllllllllllllk',
    'klddddddddddddlk',
    'kldwddddddddwdlk',
    'klddddddddddddlk',
    'klddddddddddddlk',
    'klddddddddddddlk',
    'klddddddddddddlk',
    'klddddddddddddlk',
    'klddddddddddddlk',
    'klddddddddddddlk',
    'kldwddddddddwdlk',
    'klddddddddddddlk',
    'kddddddddddddddk',
    'kssssssssssssssk',
    'kkkkkkkkkkkkkkkk',
];

// Door-like accent segment: same hazard top and edges as WALL_V2 so it
// drops into a wall run; ribbed door with an amber chevron band.
export const WALL_GATE: PixelMap = [
    'kkkkkkkkkkkkkkkk',
    'yykkyykkyykkyykk',
    'ykkyykkyykkyykky',
    'kkyykkyykkyykkyy',
    'kkkkkkkkkkkkkkkk',
    'kmmmmmmmmmmmmmmk',
    'kmdkmmmmmmmmkdmk',
    'kmwkdmmddmmdkwmk',
    'kmdkdmmddmmdkdmk',
    'kmdkkkkkkkkkkdmk',
    'kmwkykkyykkykwmk',
    'kmdkkkkkkkkkkdmk',
    'kmdkdmmddmmdkdmk',
    'kmmmmmmmmmmmmmmk',
    'kddddddddddddddk',
    'kkkkkkkkkkkkkkkk',
];

// Gate lit frame: the chevron band and door core glow (1 s flicker swap).
export const WALL_GATE_B: PixelMap = [
    'kkkkkkkkkkkkkkkk',
    'yykkyykkyykkyykk',
    'ykkyykkyykkyykky',
    'kkyykkyykkyykkyy',
    'kkkkkkkkkkkkkkkk',
    'kmmmmmmmmmmmmmmk',
    'kmdkmmmmmmmmkdmk',
    'kmwkdmmddmmdkwmk',
    'kmdkdmmwwmmdkdmk',
    'kmdkkkkkkkkkkdmk',
    'kmwkwkwwwwkwkwmk',
    'kmdkkkkkkkkkkdmk',
    'kmdkdmmddmmdkdmk',
    'kmmmmmmmmmmmmmmk',
    'kddddddddddddddk',
    'kkkkkkkkkkkkkkkk',
];
