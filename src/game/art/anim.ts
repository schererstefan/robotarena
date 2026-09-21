// Animation-frame pixel-art drafts: tread roll, tower recoil, spawn pop, muzzle variant,
// death sequence (flash -> collapse -> ember fade).
// Same string pixel-map format as src/game/art.ts. Palette chars:
// '.' = transparent, k d m l w y o s (all in the base PALETTE).
//
// Treads (16x4, TREADS_A/B/C): 3-frame roll cycle. Lug period is 3px so each
// frame shifts the pattern exactly 1px east: A -> B -> C reads as continuous
// rolling, and plain A/B alternation still strobes as motion. Lugs catch the
// top-left light (`l` up, `m` down in shadow `d` grooves); one bright `w`
// drive tooth per row jumps 1px per frame (row 1: x4 -> x5 -> x6, row 2:
// x10 -> x11 -> x12) so direction reads even at 1x. Colors per map: k d l m w.
// TREADS_C is registered + dir8-baked (art.ts) and consumed by the
// BattleScene A -> B -> C cycle on TREAD_SWAP_PX.
// Reduced-motion keeps frame A static.
//
// Death sequence (16x16, DEATH_1/2/3): flash -> collapse -> ember fade, played
// at the death position/heading, then the wreck swaps in. Suggested uneven
// timing per the build guide: 60ms flash / 160ms collapse / 260ms ember fade
// (same anticipation -> action -> recovery beats as the boom template).
// DEATH_1: white/amber detonation flash (anticipation). DEATH_2: slumped dark
// hull mound with snapped barrel stub, top-left `l` remnant, `y` embers
// starting in the cracks (action). DEATH_3: mostly transparent debris line +
// rising `s` smoke wisps + fading `y`/`o` embers (recovery into the wreck).
// HOOK (engine track): register death_1/2/3 in artRegistry (art.ts); in
// BattleScene explode(), show the 3 frames with the timing above before the
// wreck swap (throes pre-flashes stay as-is).
//
// Idle bob: the guide specifies NO baked frames — bob is a runtime y-offset
// (1-2px triangle wave, ~0.5s period) on the chassis, safe alongside direction
// frames. BattleScene already applies an equivalent (sinusoidal oy bob + scale
// breathing in the per-frame update); if the strict triangle ~0.5s wave is
// wanted, swap the sin bob term for a triangle in that block. Nothing to bake.

type PixelMap = string[];

// Tread strips, 16x4. Cycle A -> B -> C for rolling: lugs + drive tooth shift 1px east per frame.
export const TREADS_A: PixelMap = [
    'kkkkkkkkkkkkkkkk',
    'klldlwdlldlldllk',
    'kmmdmmdmmdmwdmmk',
    'kkkkkkkkkkkkkkkk',
];

export const TREADS_B: PixelMap = [
    'kkkkkkkkkkkkkkkk',
    'kdlldlwdlldlldlk',
    'kdmmdmmdmmdmwdmk',
    'kkkkkkkkkkkkkkkk',
];

export const TREADS_C: PixelMap = [
    'kkkkkkkkkkkkkkkk',
    'kldlldlwdlldlldk',
    'kmdmmdmmdmmdmwdk',
    'kkkkkkkkkkkkkkkk',
];

// Death frame 1: detonation flash (anticipation, ~60ms). White core, amber mids.
export const DEATH_1: PixelMap = [
    '................',
    '.......yy.......',
    '.......yy.......',
    '......yyyy......',
    '.....ywwwwy.....',
    '....ywwwwwwy....',
    '....ywwwwwwy....',
    '...oywwwwwwyo...',
    '...oywwwwwwyo...',
    '....ywwwwwwy....',
    '....ywwwwwwy....',
    '.....ywwwwy.....',
    '......yyyy......',
    '.......yy.......',
    '.......yy.......',
    '................',
];

// Death frame 2: collapse (action, ~160ms). Slumped dark mound, snapped barrel
// stub east, top-left highlight remnant, embers starting in the cracks.
export const DEATH_2: PixelMap = [
    '................',
    '................',
    '................',
    '.....kkkk.......',
    '....kllllk......',
    '....klmmkky.....',
    '..k.kmmmmdk.....',
    '.kmmkddddddkkkk.',
    '.kmmdddddddddky.',
    '..kddddddkkkk...',
    '...kddkyddk.....',
    '....kkkkkkk.....',
    '..k....k....k...',
    '................',
    '................',
    '................',
];

// Death frame 3: ember fade (recovery, ~260ms). Debris line, rising smoke, fading embers.
export const DEATH_3: PixelMap = [
    '................',
    '...s........s...',
    '....s......s....',
    '.....s....s.....',
    '..........s.....',
    '................',
    '................',
    '.....y......o...',
    '........y.......',
    '...kddk....k....',
    '..kddddk..oyo...',
    '..kddkkyk.......',
    '.....k...k......',
    '................',
    '................',
    '................',
];

// Tower frames, 16x16, barrel pointing EAST. Hub (axle k) centered at
// (8,8) in both. RECOIL_A: barrel extended, muzzle face at x14.
// RECOIL_B: barrel kicked 2px west, muzzle face at x12.
export const RECOIL_A: PixelMap = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '......kkkkk.....',
    '......kwwwkkkkk.',
    '......kwkwkwwwk.',
    '......kwwwkkkkk.',
    '......kkkkk.....',
    '................',
    '................',
    '................',
    '................',
    '................',
];

export const RECOIL_B: PixelMap = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '......kkkkk.....',
    '......kwwwkkk...',
    '......kwkwkwk...',
    '......kwwwkkk...',
    '......kkkkk.....',
    '................',
    '................',
    '................',
    '................',
    '................',
];

// Spawn rings, 16x16. SPAWN_A: small ring (8x8 outer, 4x4 hollow).
// SPAWN_B: large ring (14x14 outer, 10x10 hollow). A -> B reads as pop.
export const SPAWN_A: PixelMap = [
    '................',
    '................',
    '................',
    '................',
    '......kkkk......',
    '.....kwwwwk.....',
    '....kw....wk....',
    '....kw....wk....',
    '....kw....wk....',
    '....kw....wk....',
    '.....kwwwwk.....',
    '......kkkk......',
    '................',
    '................',
    '................',
    '................',
];

export const SPAWN_B: PixelMap = [
    '................',
    '.....kkkkkk.....',
    '...kkwwwwwwkk...',
    '..kw........wk..',
    '..kw........wk..',
    '.kw..........wk.',
    '.kw..........wk.',
    '.kw..........wk.',
    '.kw..........wk.',
    '.kw..........wk.',
    '.kw..........wk.',
    '..kw........wk..',
    '..kw........wk..',
    '...kkwwwwwwkk...',
    '.....kkkkkk.....',
    '................',
];

// Alternate muzzle flash, 8x8. Diagonal (X) starburst with amber core:
// alternate with the plus-shaped MUZZLE in art.ts for flicker.
export const BIG_MUZZLE: PixelMap = [
    'ww....ww',
    'www..www',
    '.wwyyww.',
    '..yyyy..',
    '..yyyy..',
    '.wwyyww.',
    'www..www',
    'ww....ww',
];
