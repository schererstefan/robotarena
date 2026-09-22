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

// --- Seated impact effects (16px, shown ~2-3x against 64px hulls) -----------------
// Robot-hit flash, 2 frames: white-hot core -> hollow amber ring. Team
// coding is geometric: team 0 wears SOLID corner brackets, team 1 wears
// BROKEN mid-edge ticks, and `t` bakes to the team trim color. Either team
// reads with hue removed (bracket position/shape + white-core brightness).

// Team 0 frame A: solid core + solid corner brackets.
export const IMPACT_BOT0_A: PixelMap = [
    '................',
    '................',
    '..tt........tt..',
    '..tt..wwww..tt..',
    '......wwww......',
    '.....ywwwwy.....',
    '.....ywwwwy.....',
    '....yywwwwyy....',
    '....yywwwwyy....',
    '.....ywwwwy.....',
    '.....ywwwwy.....',
    '......wwww......',
    '..tt..wwww..tt..',
    '..tt........tt..',
    '................',
    '................',
];

// Team 0 frame B: hollow core, expanded ring, brackets hold.
export const IMPACT_BOT0_B: PixelMap = [
    '................',
    '..tt........tt..',
    '..tt...yy...tt..',
    '......yyyy......',
    '.....yooooy.....',
    '....yoo..ooy....',
    '....yo....oy....',
    '...yyo....oyy...',
    '...yyo....oyy...',
    '....yo....oy....',
    '....yoo..ooy....',
    '.....yooooy.....',
    '......yyyy......',
    '..tt...yy...tt..',
    '..tt........tt..',
    '................',
];

// Team 1 frame A: solid core + broken mid-edge ticks (never corners).
export const IMPACT_BOT1_A: PixelMap = [
    '................',
    '................',
    '......tttt......',
    '......wwww......',
    '......wwww......',
    '.tt..ywwwwy..tt.',
    '.tt..ywwwwy..tt.',
    '....yywwwwyy....',
    '....yywwwwyy....',
    '.tt..ywwwwy..tt.',
    '.tt..ywwwwy..tt.',
    '......wwww......',
    '......wwww......',
    '......tttt......',
    '................',
    '................',
];

// Team 1 frame B: hollow core, expanded ring, ticks hold.
export const IMPACT_BOT1_B: PixelMap = [
    '................',
    '......tttt......',
    '.......yy.......',
    '......yyyy......',
    '.....yooooy.....',
    '.tt.yoo..ooy.tt.',
    '.tt.yo....oy.tt.',
    '...yyo....oyy...',
    '...yyo....oyy...',
    '.tt.yo....oy.tt.',
    '.tt.yoo..ooy.tt.',
    '.....yooooy.....',
    '......yyyy......',
    '.......yy.......',
    '......tttt......',
    '................',
];

// Wall-hit flash, 2 frames, team-neutral: gray shard cross + amber sparks.
// Shown where a bullet dies near an obstacle.
export const IMPACT_WALL_A: PixelMap = [
    '................',
    '................',
    '.......ss.......',
    '.......ss.......',
    '...y...ss...y...',
    '....y..ss..y....',
    '.....yssssy.....',
    '......swws......',
    '...sssswwssss...',
    '......swws......',
    '.....yssssy.....',
    '....y..ss..y....',
    '...y...ss...y...',
    '.......ss.......',
    '.......ss.......',
    '................',
];

export const IMPACT_WALL_B: PixelMap = [
    '......s..s......',
    '.....ss..ss.....',
    '....y......y....',
    '....s..ss..s....',
    '...ss..ss..ss...',
    '..y....ss....y..',
    '..s...ssss...s..',
    '......s..s......',
    '......s..s......',
    '..s...ssss...s..',
    '..y....ss....y..',
    '...ss..ss..ss...',
    '....s..ss..s....',
    '....y......y....',
    '.....ss..ss.....',
    '......s..s......',
];

// Ground fizzle, 2 frames (12x12): kicked dust + dying sparks for
// range-expiry bullets. Small and quiet on purpose.
export const IMPACT_DIRT_A: PixelMap = [
    '............',
    '............',
    '............',
    '.....ss.....',
    '....ssss....',
    '..y.ssss.y..',
    '....ssss....',
    '...ss..ss...',
    '............',
    '............',
    '............',
    '............',
];

export const IMPACT_DIRT_B: PixelMap = [
    '............',
    '............',
    '............',
    '............',
    '....s..s....',
    '...ss..ss...',
    '..s..yy..s..',
    '...ss..ss...',
    '....s..s....',
    '............',
    '............',
    '............',
];

// --- Spawn materialize (24x24, floor-anchored) --------------------------------------
// Robot spawn-in: dust ring spreads on the floor while a light column rises
// into the dropping chassis. Team-neutral white/gray so the chassis trim
// carries team; the pad's triangle/square cue (floor overlay) stays primary.
// Frame A: dust ring forms. Frame B: column rises, ring widens. Frame C:
// arrival flash (hot disc + halo), held through power-on.
export const SPAWN_1: PixelMap = [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '..........wwww..........',
    '.........wwssww.........',
    '........wssssssw........',
    '.......ws......sw.......',
    '......ws........sw......',
    '......s..........s......',
    '........................',
    '........................',
];

export const SPAWN_2: PixelMap = [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '..........ww............',
    '..........ww............',
    '.........wwww...........',
    '..........ww............',
    '..........ww............',
    '.........wwww...........',
    '..........ww............',
    '..........ww............',
    '.........wwww...........',
    '........wwssww..........',
    '.......wwssssww.........',
    '......wwssssssww........',
    '.....wss......ssw.......',
    '....ss..........ss......',
    '....s............s......',
    '........................',
    '........................',
    '........................',
];

export const SPAWN_3: PixelMap = [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '..........yy............',
    '.........ywwy...........',
    '........ywwwwy..........',
    '.......ywwwwwwy.........',
    '.......ywwwwwwy.........',
    '......yywwwwwwyy........',
    '......ywwwwwwwwy........',
    '......ywwwwwwwwy........',
    '.......ywwwwwwy.........',
    '.......ywwwwwwy.........',
    '........ywwwwy..........',
    '......wwywwwwyww........',
    '.....wssywwwwyssw.......',
    '....ss..ywwwwy..ss......',
    '....s....ywwy....s......',
    '..........yy............',
    '........................',
    '........................',
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
