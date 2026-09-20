// Arena-decor props: dressing for OUTSIDE the play area (never gameplay).
// 16x16 pixel maps using the palette chars from src/game/art.ts:
// .=transparent, k, d, m, l, w, r, g, y.

type PixelMap = string[];

// CRATE: stenciled box (X stencil mark), dark industrial.
export const DECOR_CRATE: PixelMap = [
    '................',
    '..kkkkkkkkkkkk..',
    '..kddddddddddk..',
    '..kdmmmmmmmmdk..',
    '..kdmkkkkkkmdk..',
    '..kdmkddddkmdk..',
    '..kdmklddlkmdk..',
    '..kdmkdlldkmdk..',
    '..kdmkdlldkmdk..',
    '..kdmklddlkmdk..',
    '..kdmkddddkmdk..',
    '..kdmkkkkkkmdk..',
    '..kdmmmmmmmmdk..',
    '..kddddddddddk..',
    '..kkkkkkkkkkkk..',
    '................',
];

// BARREL: hazard banded cylinder, muted yellow/black band.
export const DECOR_BARREL: PixelMap = [
    '................',
    '....kkkkkkkk....',
    '...kddddddddk...',
    '..kddddddddddk..',
    '..kdlmdddddddk..',
    '..kdlmdddddddk..',
    '..kdlmdddddddk..',
    '..kyykkyykkyyk..',
    '..kkyykkyykkyk..',
    '..kdlmdddddddk..',
    '..kdlmdddddddk..',
    '..kdlmdddddddk..',
    '..kddddddddddk..',
    '..kkkkkkkkkkkk..',
    '...kkkkkkkkkk...',
    '................',
];

// LAMP: small glowing post, restrained (2px amber lens, no halo).
export const DECOR_LAMP: PixelMap = [
    '................',
    '................',
    '......kkkk......',
    '......kllk......',
    '......kyyk......',
    '......kllk......',
    '.......kk.......',
    '.......mm.......',
    '.......mm.......',
    '.......mm.......',
    '.......mm.......',
    '.......mm.......',
    '......kmmk......',
    '.....kkmmkk.....',
    '....kkkkkkkk....',
    '................',
];

// LAMP_B: lamp lit frame — hot lens plus a wider spill row (1 s flicker).
export const DECOR_LAMP_B: PixelMap = [
    '................',
    '................',
    '......kkkk......',
    '......kwwk......',
    '.....kwwwwk.....',
    '......kwwk......',
    '.......kk.......',
    '.......mm.......',
    '.......mm.......',
    '.......mm.......',
    '.......mm.......',
    '.......mm.......',
    '......kmmk......',
    '.....kkmmkk.....',
    '....kkkkkkkk....',
    '................',
];

// VENT: wall grate with fan hint (arc blades + hub behind slats).
export const DECOR_VENT: PixelMap = [
    '................',
    '................',
    '..kkkkkkkkkkkk..',
    '..kddddddddddk..',
    '..kdmmmmmmmmdk..',
    '..kdkkllllkkdk..',
    '..kdmmllllmmdk..',
    '..kdkllddllkdk..',
    '..kdkllddllkdk..',
    '..kdmmllllmmdk..',
    '..kdkkllllkkdk..',
    '..kdmmmmmmmmdk..',
    '..kddddddddddk..',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
];
