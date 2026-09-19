// Animation-frame pixel-art drafts: tread roll, tower recoil, spawn pop, muzzle variant.
// Same string pixel-map format as src/game/art.ts. Palette chars:
// '.' = transparent, k d m l w r g y (no additions needed).

type PixelMap = string[];

// Tread strips, 16x4. Alternate A/B for rolling: light marks shift 2px.
export const TREADS_A: PixelMap = [
    'kkkkkkkkkkkkkkkk',
    'kllddllddllddllk',
    'kllddllddllddllk',
    'kkkkkkkkkkkkkkkk',
];

export const TREADS_B: PixelMap = [
    'kkkkkkkkkkkkkkkk',
    'kddllddllddllddk',
    'kddllddllddllddk',
    'kkkkkkkkkkkkkkkk',
];

// Tower frames, 16x16, barrel pointing EAST. Hub (axle k) centered at
// (8,8) in both. RECOIL_A: barrel extended, muzzle face at x14.
// RECOIL_B: barrel kicked 2px west, muzzle face at x12.
export const RECOIL_A: PixelMap = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '......kkkkk.....',
    '......kwwwkkkkk.',
    '......kwkwkwwwk.',
    '......kwwwkkkkk.',
    '......kkkkk.....',
    '................',
    '................',
    '................',
    '................',
    '................',
];

export const RECOIL_B: PixelMap = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '......kkkkk.....',
    '......kwwwkkk...',
    '......kwkwkwk...',
    '......kwwwkkk...',
    '......kkkkk.....',
    '................',
    '................',
    '................',
    '................',
    '................',
];

// Spawn rings, 16x16. SPAWN_A: small ring (8x8 outer, 4x4 hollow).
// SPAWN_B: large ring (14x14 outer, 10x10 hollow). A -> B reads as pop.
export const SPAWN_A: PixelMap = [
    '................',
    '................',
    '................',
    '................',
    '......kkkk......',
    '.....kwwwwk.....',
    '....kw....wk....',
    '....kw....wk....',
    '....kw....wk....',
    '....kw....wk....',
    '.....kwwwwk.....',
    '......kkkk......',
    '................',
    '................',
    '................',
    '................',
];

export const SPAWN_B: PixelMap = [
    '................',
    '.....kkkkkk.....',
    '...kkwwwwwwkk...',
    '..kw........wk..',
    '..kw........wk..',
    '.kw..........wk.',
    '.kw..........wk.',
    '.kw..........wk.',
    '.kw..........wk.',
    '.kw..........wk.',
    '.kw..........wk.',
    '..kw........wk..',
    '..kw........wk..',
    '...kkwwwwwwkk...',
    '.....kkkkkk.....',
    '................',
];

// Alternate muzzle flash, 8x8. Diagonal (X) starburst with amber core:
// alternate with the plus-shaped MUZZLE in art.ts for flicker.
export const BIG_MUZZLE: PixelMap = [
    'ww....ww',
    'www..www',
    '.wwyyww.',
    '..yyyy..',
    '..yyyy..',
    '.wwyyww.',
    'www..www',
    'ww....ww',
];
