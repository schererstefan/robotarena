// Seamless-tiling 16x16 arena floor tiles. Dark control-room metal, quiet
// behind bright robots. De-gridded (Phase 2): NO per-tile borders — every
// tile keeps an all-`p` outer ring (row 0/15, col 0/15) so any tile blends
// into any neighbor and the floor reads as one continuous surface.
// A/E/F/G are subtle grain/wear variants meant to be mixed at bake time
// (seeded PRNG only — layout must be pixel-identical every boot); B/C/D are
// sparse feature tiles (vent / hazard / rivets) placed by floorTileAt.
// Base palette chars (see src/game/art.ts): . k d m l w r g y o s b c p q a h.

type PixelMap = string[];

// A: plain plate — sparse grain, the quiet default (~majority of tiles).
// Calm-floor discipline (art/varied-backgrounds): grain speckles stay on the
// dark neutral ramp (q/d) — no warm dots, so the amber channel belongs only
// to gameplay (pads, projectiles, HUD).
export const FLOOR_A: PixelMap = [
    'pppppppppppppppp',
    'ppppppqppppppppp',
    'ppqqppppppppppqp',
    'pppppdpppppqpppp',
    'pppppppppppppppp',
    'ppppqpppppdppppp',
    'ppppppppqppppppp',
    'pppppppppppppqpp',
    'pqppppppppqppppp',
    'pppppqppppqppppp',
    'pppppppppqpppdpp',
    'pppdpppppppppppp',
    'ppppppppqpppqppp',
    'pppppppqpppppppp',
    'ppqppppppppppppp',
    'pppppppppppppppp',
];

// E: grain variant — different speckle rhythm, soft q clusters.
export const FLOOR_E: PixelMap = [
    'pppppppppppppppp',
    'pppqpppppppppppp',
    'pppppppppqppdppp',
    'pppppqqppppppppp',
    'pppppppppppppqpp',
    'pqppppppdppppppp',
    'pppppppppppppppp',
    'ppqppppppppqpppp',
    'ppppqpppqqpppppp',
    'ppppppppppppppqp',
    'pppppppqpppppppp',
    'ppqppppppspppppp',
    'ppppdpqppppppppp',
    'pdpppppppppppppp',
    'ppppppppppppqppp',
    'pppppppppppppppp',
];

// F: wear variant — scuff scratch + rust mote.
export const FLOOR_F: PixelMap = [
    'pppppppppppppppp',
    'pppppppppppppppp',
    'pppppqppppqppppp',
    'pppppppppqppqppp',
    'ppppdpsppppppppp',
    'ppppppphpppdpppp',
    'ppqpppqpsppppppp',
    'pppppapppqpppppp',
    'ppppppppppppppqp',
    'ppppqpppppppdppp',
    'pqpppppppppppppp',
    'ppppppqppppppqpp',
    'pppppppppppqpppp',
    'pppqpppdpppppppp',
    'pppppppppppppppp',
    'pppppppppppppppp',
];

// G: plate corner — partial interior seam + rivets (never touches edges).
export const FLOOR_G: PixelMap = [
    'pppppppppppppppp',
    'pppppppppppppppp',
    'ppppppppqppppppp',
    'ppppppppppppqppp',
    'ppphkqqqqqhppppp',
    'pppqppppppkppppp',
    'pppqpppppppppppp',
    'pqpqppppppppdppp',
    'pppqppdppppppppp',
    'pppqpppppppppppp',
    'pppqpppppppppqpp',
    'ppphpppppppppppp',
    'pppkppqppppppppp',
    'pppppppppqpppppp',
    'pppppppppppppppp',
    'pppppppppppppppp',
];

// B: vent grate — floating slot field with a soft lip, no frame.
export const FLOOR_B: PixelMap = [
    'pppppppppppppppp',
    'ppppppppppppppqp',
    'pqpppppppppppppp',
    'pppqqqqqqqqqqppp',
    'pppqmhhhhhhhqppp',
    'pppqkkkkkkkkqpdp',
    'pppqmhhhhhhhqppp',
    'pppqkkkkkkkkqppp',
    'pppqmhhhhhhhqppp',
    'pppqkkkkkkkkqppp',
    'pdpqmhhhhhhhqppp',
    'pppqkkkkkkkkqppp',
    'pppqqqqqqqqqqppp',
    'ppqppppppppppppp',
    'pppppppppppppqpp',
    'pppppppppppppppp',
];

// C: hazard corner — dim amber diagonals + plate bracket, bottom-right.
export const FLOOR_C: PixelMap = [
    'pppppppppppppppp',
    'pppppppppppppppp',
    'ppppppppppppdppp',
    'pppppppppppppppp',
    'pppdpppppppppppp',
    'pppppppppppppppp',
    'ppppppqppppppqpp',
    'pppppppppppppppp',
    'ppppppppqqqqqqpp',
    'ppppppppqapaappp',
    'pppppqppqpapaapp',
    'ppppppppqapapapp',
    'ppqpppppqaapappp',
    'ppppppppqpaapapp',
    'pppppppppppppppp',
    'pppppppppppppppp',
];

// D: riveted panel — four shaded rivets, no frame.
export const FLOOR_D: PixelMap = [
    'pppppppppppppppp',
    'pppppppppppppppp',
    'ppppppqppppppppp',
    'ppphdpppppphdppp',
    'pppdkppppppdkppp',
    'ppppppppppqppppp',
    'pppppppppppppppp',
    'ppqppppppppppppp',
    'pppppppppppppqpp',
    'pppppqpppppppppp',
    'pppppppppdpppppp',
    'ppphdpppppphdppp',
    'pppdkppppppdkppp',
    'ppppppppqppppppp',
    'pppppppppppppppp',
    'pppppppppppppppp',
];
