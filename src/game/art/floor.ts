// Seamless-tiling 16x16 arena floor tiles. Dark control-room metal, quiet
// behind bright robots. Every tile wraps: left column == right column and
// top row == bottom row, so the pattern continues across tile boundaries.
// Base palette chars (see src/game/art.ts): . k d m l w r g y.

type PixelMap = string[];

// p/q/h/a live in the base PALETTE (plate, edge, slat, amber).

// A: plain plate with inset 1px seam + faint top highlight.
export const FLOOR_A: PixelMap = [
    'pppppppppppppppp',
    'pkkkkkkkkkkkkkkp',
    'pkqqqqqqqqqqqqkp',
    'pkppppppppppppkp',
    'pkppppppppppppkp',
    'pkppppppppppppkp',
    'pkppppppppppppkp',
    'pkppppppppppppkp',
    'pkppppppppppppkp',
    'pkppppppppppppkp',
    'pkppppppppppppkp',
    'pkppppppppppppkp',
    'pkppppppppppppkp',
    'pkppppppppppppkp',
    'pkkkkkkkkkkkkkkp',
    'pppppppppppppppp',
];

// B: vent grate — framed slats over dark gaps.
export const FLOOR_B: PixelMap = [
    'pppppppppppppppp',
    'pkkkkkkkkkkkkkkp',
    'pkqqqqqqqqqqqqkp',
    'pkkkkkkkkkkkkkkp',
    'pkkhhhhhhhhhhkkp',
    'pkkkkkkkkkkkkkkp',
    'pkkhhhhhhhhhhkkp',
    'pkkkkkkkkkkkkkkp',
    'pkkhhhhhhhhhhkkp',
    'pkkkkkkkkkkkkkkp',
    'pkkhhhhhhhhhhkkp',
    'pkkkkkkkkkkkkkkp',
    'pkkkkkkkkkkkkkkp',
    'pkppppppppppppkp',
    'pkkkkkkkkkkkkkkp',
    'pppppppppppppppp',
];

// C: hazard corner stripe — dim amber diagonals, bottom-right inset.
export const FLOOR_C: PixelMap = [
    'pppppppppppppppp',
    'pkkkkkkkkkkkkkkp',
    'pkqqqqqqqqqqqqkp',
    'pkppppppppppppkp',
    'pkppppppppppppkp',
    'pkppppppppppppkp',
    'pkppppppppppppkp',
    'pkppppppppppppkp',
    'pkpppppppkkkkkkp',
    'pkppppppkkkaakkp',
    'pkppppppkkaakkkp',
    'pkppppppkaakkakp',
    'pkppppppkakkaakp',
    'pkppppppkkkaakkp',
    'pkkkkkkkkkkkkkkp',
    'pppppppppppppppp',
];

// D: riveted panel — four rivets with drop shadow.
export const FLOOR_D: PixelMap = [
    'pppppppppppppppp',
    'pkkkkkkkkkkkkkkp',
    'pkqqqqqqqqqqqqkp',
    'pkpmppppppppmpkp',
    'pkpkppppppppkpkp',
    'pkppppppppppppkp',
    'pkppppppppppppkp',
    'pkppppppppppppkp',
    'pkppppppppppppkp',
    'pkppppppppppppkp',
    'pkppppppppppppkp',
    'pkppppppppppppkp',
    'pkpmppppppppmpkp',
    'pkpkppppppppkpkp',
    'pkkkkkkkkkkkkkkp',
    'pppppppppppppppp',
];
