// Tower weaponry pixel-art drafts. All sprites face EAST (+x).
// Hub center: pixel (8,8) (0-indexed). White/light areas tint to the
// player's paint color at render time. Palette chars: . k d m l w r g y.

export type PixelMap = string[];

// Slim 2px barrel: white body, light collar ring, dark tip + open bore.
export const TOWER_LIGHT: PixelMap = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '......kkkkk.....',
    '.....kdwwwdkkkkk',
    '....kwmdddmwwldd',
    '....kwmlylmwwldd',
    '....kwmdddmkkkkk',
    '.....kdwwwdk....',
    '......kkkkk.....',
    '................',
    '................',
    '................',
    '................',
];

// Fat 3px cannon: dark groove ring, steel muzzle brake with side
// vent ports (k), tall 3px open bore at the east edge.
export const TOWER_HEAVY: PixelMap = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '......kkkkk.....',
    '.....kdwwwdkkkkk',
    '....kwmdddmwdmkd',
    '....kwmlylmwdmmd',
    '....kwmdddmwdmkd',
    '.....kdwwwdkkkkk',
    '......kkkkk.....',
    '................',
    '................',
    '................',
    '................',
];

// Twin over/under 1px barrels at rows 6/10, symmetric about row 8.
// Amber hub core stays visible between the barrels.
export const TOWER_TWIN: PixelMap = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '......kkkkkkkkkk',
    '.....kdwwwdwwldd',
    '....kwmdddmkkkkk',
    '....kwmlylmwk...',
    '....kwmdddmkkkkk',
    '.....kdwwwdwwldd',
    '......kkkkkkkkkk',
    '................',
    '................',
    '................',
    '................',
];

// Standalone hub ring: white band with dark bolts, steel inner,
// dark vent grooves, amber pivot core at (8,8).
export const HUB_V2: PixelMap = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '......kkkkk.....',
    '.....kdwwwdk....',
    '....kwmdddmwk...',
    '....kwmlylmwk...',
    '....kwmdddmwk...',
    '.....kdwwwdk....',
    '......kkkkk.....',
    '................',
    '................',
    '................',
    '................',
];

// 8x8 pointed star: white hot core/beams, yellow tips + diagonal sparks.
export const MUZZLE_V2: PixelMap = [
    '...yy...',
    '.y.ww.y.',
    '..ywwy..',
    'yywwwwyy',
    'yywwwwyy',
    '..ywwy..',
    '.y.ww.y.',
    '...yy...',
];
