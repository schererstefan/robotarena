// Projectile sprite drafts — pixel maps in the src/game/art.ts format.
// `.` = transparent; every other char must exist in PALETTE there
// (k, d, m, l, w, r, g, y). White/light pixels tint to team color at
// render; amber (y) stays hot so cores stay visible under dark tints.
// No PALETTE_ADDITIONS needed: this draft uses only base palette chars.

type PixelMap = string[];

// BULLET_V2 (4x4): tintable white body, hot amber 2x2 core,
// transparent corners. Brighter than the floor, no glow blob.
export const BULLET_V2: PixelMap = [
    '.ww.',
    'wyyw',
    'wyyw',
    '.ww.',
];

// BULLET_CHARGED (6x6): brighter than BULLET_V2 — 12 white ring pixels
// tint to team color around a hot amber 2x2 core; 8 amber edge pips
// (top/bottom pairs + side pairs) signal the charge level.
export const BULLET_CHARGED: PixelMap = [
    '..yy..',
    '.wwww.',
    'ywyywy',
    'ywyywy',
    '.wwww.',
    '..yy..',
];

// SPARK_V2 (2x2): white/amber diagonal fleck; reads as a spark at speed.
export const SPARK_V2: PixelMap = [
    'wy',
    'yw',
];

// TRACER (8x2): horizontal streak, head at +x (right, EAST convention
// matching the chassis art), tail fading m -> l -> w. Transparent caps
// both ends; one amber fleck keeps the head visible under dark tints.
export const TRACER: PixelMap = [
    '.mlwwyw.',
    '.mlwwyw.',
];
