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

// Frame 3: dense broken ember ring — ragged r/o outer edge, o body, y
// inner heat flecks, hollow core, drifting s wisps + stray flung embers.
export const BOOM_3: PixelMap = [
    '........s.......',
    '.....s...s......',
    '.......oooo.....',
    '...s.oooooor.y..',
    '..roro....yoo...',
    '.sooo......yoo..',
    '..rr........ors.',
    '..oo........oo.s',
    's.oo........oo..',
    '.sro........or..',
    '...ry......ooos.',
    '....oy....oo....',
    '...ororooor.sr..',
    '.....oooooo.....',
    '......s...s.....',
    '.......s........',
];

// Frame 4: two-tone smoke puff (h lit crown top-left, s body) with
// dissipating holes, trailing base, last embers glowing low inside.
export const BOOM_4: PixelMap = [
    '................',
    '......shhs......',
    '......hshs......',
    '....hshhssss....',
    '....hhshhsss....',
    '...hshhshssss...',
    '...hhshhsssss...',
    '...sssshssssh...',
    '..shsssshssssh..',
    '...shossshsss...',
    '...sshosyshss...',
    '...ssshrsoshs...',
    '....ssshssss....',
    '.....ssshss.....',
    '................',
    '................',
];

// Shockwave: punchy 2px near-full-tile ring, white core, amber edge.
export const RING_FX: PixelMap = [
    '......yyyy......',
    '....yywwwwyy....',
    '...ywyy..yywy...',
    '..ywy......ywy..',
    '.ywy........ywy.',
    '.yy..........yy.',
    'ywy..........ywy',
    'yw............wy',
    'yw............wy',
    'ywy..........ywy',
    '.yy..........yy.',
    '.ywy........ywy.',
    '..ywy......ywy..',
    '...ywyy..yywy...',
    '....yywwwwyy....',
    '......yyyy......',
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
