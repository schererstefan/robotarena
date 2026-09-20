// Arena-decor props: dressing for OUTSIDE the play area (never gameplay).
// 16x16 pixel maps using the palette chars from src/game/art.ts:
// .=transparent, k, d, m, l, w, y.
// Phase 5 pass: same quiet roles, better light discipline (lit lids and
// left edges, shaded right/base AO), mounting hardware, clearer fan.

type PixelMap = string[];

// CRATE: stenciled box — lit lid lip, corner bolts, shaded right edge.
export const DECOR_CRATE: PixelMap = [
    '................',
    '..kkkkkkkkkkkk..',
    '..kllllllllllk..',
    '..kwmmmmmmmmwk..',
    '..kdlkkkkkkddk..',
    '..kdlkddddkddk..',
    '..kdlklddlkddk..',
    '..kdlkdlldkddk..',
    '..kdlkdlldkddk..',
    '..kdlklddlkddk..',
    '..kdlkddddkddk..',
    '..kdlkkkkkkddk..',
    '..kdmmmmmmmmdk..',
    '..kddddddddddk..',
    '..kkkkkkkkkkkk..',
    '................',
];

// BARREL: lidded cylinder — lit lid + left sheen, hazard band, base rim.
export const DECOR_BARREL: PixelMap = [
    '................',
    '....kkkkkkkk....',
    '...kllllllllk...',
    '..klmddddddddk..',
    '..klmddddddddk..',
    '..klmddddddddk..',
    '..klmddddddddk..',
    '..kyykkyykkyyk..',
    '..kkyykkyykkyk..',
    '..klmddddddddk..',
    '..klmddddddddk..',
    '..klmddddddddk..',
    '..kkkkkkkkkkkk..',
    '...kkkkkkkkkk...',
    '................',
    '................',
];

// LAMP: hooded post — caged amber lens, shaded post, flared bolted base.
export const DECOR_LAMP: PixelMap = [
    '................',
    '......mmmm......',
    '.....kkkkkk.....',
    '.....kllllk.....',
    '.....kkyykk.....',
    '.....kllllk.....',
    '......kllk......',
    '......klmk......',
    '......klmk......',
    '......klmk......',
    '......klmk......',
    '......klmk......',
    '.....kklmkk.....',
    '....kkklmkkk....',
    '....kkkkkkkk....',
    '................',
];

// LAMP_B: lamp lit frame — hot lens, glow spilling past the cage + neck.
export const DECOR_LAMP_B: PixelMap = [
    '................',
    '......mmmm......',
    '.....kkkkkk.....',
    '.....kwwwwk.....',
    '....kwwwwwwk....',
    '.....kwwwwk.....',
    '......kwwk......',
    '......klmk......',
    '......klmk......',
    '......klmk......',
    '......klmk......',
    '......klmk......',
    '.....kklmkk.....',
    '....kkklmkkk....',
    '....kkkkkkkk....',
    '................',
];

// VENT: bolted wall grate — recessed ring, pale blades, hot hub.
export const DECOR_VENT: PixelMap = [
    '................',
    '................',
    '..kkkkkkkkkkkk..',
    '..kdwddddddwdk..',
    '..kddmmmmmmddk..',
    '..kdmmllllmmdk..',
    '..kdmllllllmdk..',
    '..kdmllwwllmdk..',
    '..kdmllwwllmdk..',
    '..kdmllllllmdk..',
    '..kdmmllllmmdk..',
    '..kddmmmmmmddk..',
    '..kdwddddddwdk..',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
];
