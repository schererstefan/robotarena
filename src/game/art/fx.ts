// FX sprite drafts: explosion sequence, shockwave ring, charge aura.
// Format matches src/game/art.ts: string pixel maps, '.' = transparent.
// Base palette chars: k d m l w r g y, plus o (fire mid-tone) and
// s (smoke gray), both in the base PALETTE.

type PixelMap = string[];

// Frame 1: white flash ball with amber rim + vertical spark tips.
export const BOOM_1: PixelMap = [
    '................',
    '................',
    '.......ww.......',
    '.......ww.......',
    '......wwww......',
    '.....ywwwwy.....',
    '.....ywwwwy.....',
    '....yywwwwyy....',
    '....yywwwwyy....',
    '.....ywwwwy.....',
    '.....ywwwwy.....',
    '......ywwy......',
    '.......yy.......',
    '.......yy.......',
    '................',
    '................',
];

// Frame 2: expanding fireball, white core -> amber -> orange -> red ragged edge.
export const BOOM_2: PixelMap = [
    '................',
    '.....r....r.....',
    '.....rr..rr.....',
    '......rrrr......',
    '....oryyyyro....',
    '...orywwwwyro...',
    '...rywwwwwwyr...',
    '..orywwwwwwyro..',
    '..orywwwwwwyro..',
    '...rywwwwwwyr...',
    '...orywwwwyro...',
    '....oryyyyro....',
    '......rrrr......',
    '.....rr..rr.....',
    '.....r....r.....',
    '................',
];

// Frame 3: hollow fading embers, broken orange/red ring, smoke wisps at corners.
export const BOOM_3: PixelMap = [
    '................',
    '...s........s...',
    '....s..rr..s....',
    '.....oorrro.....',
    '...sor....ros...',
    '..sor......ros..',
    '..ory......yro..',
    '..or........ro..',
    '..or........ro..',
    '..ory......yro..',
    '..sor......ros..',
    '...sor....ros...',
    '.....oorrro.....',
    '....s..rr..s....',
    '...s........s...',
    '................',
];

// Frame 4: dissipating smoke puff with last red/orange embers inside.
export const BOOM_4: PixelMap = [
    '................',
    '.....ss..ss.....',
    '...ssssssssss...',
    '..ssssssssssss..',
    '..ss.ss..ss.ss..',
    '.ss..s.o..s..ss.',
    '.ss.s.....r.s.s.',
    '.s..s......s..s.',
    '.s..s..rr..s..s.',
    '.ss.s..rr..s.ss.',
    '.ss..s....s..ss.',
    '..ss.ss..ss.ss..',
    '..ssssssssssss..',
    '...ssssssssss...',
    '.....ss..ss.....',
    '................',
];

// Shockwave: thin near-full-tile ring, white with amber edge.
export const RING_FX: PixelMap = [
    '.....yyyyyy.....',
    '...yywwwwwwyy...',
    '..yw........wy..',
    '..w..........w..',
    '.yw..........wy.',
    '.y............y.',
    '.w............w.',
    'yw............wy',
    'yw............wy',
    '.w............w.',
    '.y............y.',
    '.yw..........wy.',
    '..w..........w..',
    '..yw........wy..',
    '...yywwwwwwyy...',
    '.....yyyyyy.....',
];

// Charge aura: dashed white/amber crackle ring + inner sparks, reads over any team color.
export const CHARGE_AURA: PixelMap = [
    '................',
    '......w..w......',
    '....ww.yy.ww....',
    '...w........w...',
    '..wy........yw..',
    '..w....yy....w..',
    '.y............y.',
    '.w............w.',
    '.w............w.',
    '.y............y.',
    '..w....yy....w..',
    '..wy........yw..',
    '...w........w...',
    '....ww.yy.ww....',
    '......w..w......',
    '................',
];
