// Tower weaponry pixel-art drafts. All sprites face EAST (+x).
// Hub center: pixel (8,8) (0-indexed).
// Shading follows the chassis.ts language: 1px `k` outer outline, top-left
// light (`l` up/left, `d` low/right), 1px warm `c` specular on top-left
// edges, 1px `d` AO seams where barrel meets hub, `t` team trim accents
// only (lens/bead/slit, <15% of fill). Palette chars: . k d l w t c.

export type PixelMap = string[];

// LIGHT: slim recon mast. Tiny rounded hub, 1px-core needle barrel with
// open k bore, thin wire antenna (k shaft + t bead) on top. Narrowest
// silhouette of the three — reads as fast/fragile at game distance.
export const TOWER_LIGHT: PixelMap = [
    '................',
    '....k...........',
    '....k...........',
    '....k...........',
    '....t...........',
    '...kkkkk........',
    '...kcllwk.......',
    '...kllwwdkkkkkkk',
    '...kltwwwwwwwcck',
    '...kwwdddkkkkkkk',
    '...kwdddk.......',
    '....kkkk........',
    '................',
    '................',
    '................',
    '................',
];

// HEAVY: wide fortified block. Tall armored mantlet (7x10) with c
// specular + t visor slit, thick 3px-core cannon with d brake groove
// ring and tall 3px open bore. Biggest silhouette — reads as slow/tanky.
export const TOWER_HEAVY: PixelMap = [
    '................',
    '................',
    '................',
    '..kkkkkkk.......',
    '..kclllwk.......',
    '..klttwdk.......',
    '..klwwwwdkkkkkkk',
    '..klwdwwdwwwdwwk',
    '..kwwddwdwwwdwwk',
    '..kwdddddddddddk',
    '..kwdddddkkkkkkk',
    '..kdddddk.......',
    '..kkkkkkk.......',
    '................',
    '................',
    '................',
];

// TWIN: split dual barrels. Medium hub with t core pair, two slim 1px
// barrels (upper/lower) with open k bores and a transparent slot between
// them east of the hub. Fork silhouette — unmistakable vs light/heavy.
export const TOWER_TWIN: PixelMap = [
    '................',
    '................',
    '................',
    '................',
    '.......kkkkkkkkk',
    '...kkkkkwwwwwwwk',
    '...kclwwdkkkkkkk',
    '...klwwdk.......',
    '...klttdk.......',
    '...kwdddk.......',
    '...kwddddkkkkkkk',
    '...kkkkkwwwwwwwk',
    '.......kkkkkkkkk',
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
