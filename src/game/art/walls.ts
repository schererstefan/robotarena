// Arena wall tile drafts, 16x16 each. Same string-pixel-map format as
// src/game/art.ts. Palette chars used: k, d, m, l, w, y (all in base PALETTE).
// No PALETTE_ADDITIONS needed.
// WALL_V2 tiles horizontally seamlessly (period-4 hazard stripes, k edges).
// Phase 5 wall language: bright `l` light-catch under the cap (wall-top
// highlight), recessed panel seams (m lip + k slot), twin vent slits with
// lit lips, shaded rivets, and AO darkening at the base (k/d ordered
// dither melting into a solid k foot). Corner + gate share the language.

type PixelMap = string[];

export const WALL_V2: PixelMap = [
    'kkkkkkkkkkkkkkkk',
    'yykkyykkyykkyykk',
    'ykkyykkyykkyykky',
    'kkyykkyykkyykkyy',
    'kkkkkkkkkkkkkkkk',
    'kllllllllllllllk',
    'kmddmkdddmkddddk',
    'kmwdmkdddmkddwdk',
    'kmddmkmmmmkmmmdk',
    'kmddmkkkkmkkkkdk',
    'kmddmkdddmkddddk',
    'kmwdmkdddmkddwdk',
    'kmdddddddddddddk',
    'kdkdkdkdkdkdkdkk',
    'kkkkkkkkkkkkkkkk',
    'kkkkkkkkkkkkkkkk',
];

// Top-left outer corner: hazard cap on top, riveted corner post with an
// amber band on the left; right side continues the WALL_V2 body pattern
// (same seams/vents/AO columns) so runs stay continuous.
export const WALL_CORNER: PixelMap = [
    'kkkkkkkkkkkkkkkk',
    'yykkyykkyykkyykk',
    'ykkyykkyykkyykky',
    'kkyykkyykkyykkyy',
    'kkkkkkkkkkkkkkkk',
    'klllkllllllllllk',
    'kmmdkkdddmkddddk',
    'kmwdkkdddmkddwdk',
    'kmmdkkmmmmkmmmdk',
    'kyyykkkkkmkkkkdk',
    'kmmdkkdddmkddddk',
    'kmwdkkdddmkddwdk',
    'kmmdkddddddddddk',
    'kdkdkdkdkdkdkdkk',
    'kkkkkkkkkkkkkkkk',
    'kkkkkkkkkkkkkkkk',
];

// Obstacle cap: reads as solid machinery, NOT a wall (no hazard stripes).
// Riveted 4-plate housing: shaded 2x2 corner rivets (l glint + w core + m
// mount), recessed cross seams (m lip + k slot), twin vent slits with lit
// lips, top-left light stiles (l) against a low-right s shade, and an
// ordered d/s dither melting into the solid s foot (d->s are adjacent ramp
// steps). Tiling repeats whole plates, so barrier faces read as paneling.
export const OBSTACLE_TOP: PixelMap = [
    'kkkkkkkkkkkkkkkk',
    'kllllllllllllssk',
    'kllwdddmkdddlwsk',
    'klwmdddmkdddwmsk',
    'klmmmddmkdddddsk',
    'klkkkddmkdddddsk',
    'kldddddmkdddddsk',
    'klmmmmmmmmmmmmmk',
    'kkkkkkkkkkkkkkkk',
    'kldddddmkddmmmsk',
    'kldddddmkddkkksk',
    'kllwdddmkdddlwsk',
    'klwmdddmkdddwmsk',
    'kddssddssddssddk',
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
    'kllllllllllllllk',
    'kmdkmmmmmmmmkdmk',
    'kmwkdmmddmmdkwmk',
    'kmdkdmmddmmdkdmk',
    'kmdkkkkkkkkkkdmk',
    'kmwkykkyykkykwmk',
    'kmdkkkkkkkkkkdmk',
    'kmdkdmmddmmdkdmk',
    'kdkdkdkdkdkdkdkk',
    'kkkkkkkkkkkkkkkk',
    'kkkkkkkkkkkkkkkk',
];

// Gate lit frame: the chevron band and door core glow (1 s flicker swap).
export const WALL_GATE_B: PixelMap = [
    'kkkkkkkkkkkkkkkk',
    'yykkyykkyykkyykk',
    'ykkyykkyykkyykky',
    'kkyykkyykkyykkyy',
    'kkkkkkkkkkkkkkkk',
    'kllllllllllllllk',
    'kmdkmmmmmmmmkdmk',
    'kmwkdmmddmmdkwmk',
    'kmdkdmmwwmmdkdmk',
    'kmdkkkkkkkkkkdmk',
    'kmwkwkwwwwkwkwmk',
    'kmdkkkkkkkkkkdmk',
    'kmdkdmmddmmdkdmk',
    'kdkdkdkdkdkdkdkk',
    'kkkkkkkkkkkkkkkk',
    'kkkkkkkkkkkkkkkk',
];
