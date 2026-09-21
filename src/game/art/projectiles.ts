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

// BULLET_CHARGED (6x6): brighter than BULLET_V2 — 8 white ring pixels
// tint to team color around a hot amber spine (full-height 2-wide core
// plus top/bottom pairs + side pips); the unbroken vertical amber bar
// reads as "charged" at speed where edge pips alone blur.
export const BULLET_CHARGED: PixelMap = [
    '..yy..',
    '.wyyw.',
    'ywyywy',
    'ywyywy',
    '.wyyw.',
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
