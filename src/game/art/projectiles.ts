// Per-weapon projectile + muzzle-flash art. Pixel maps in the src/game/art.ts
// format: `.` = transparent; every other char must exist in PALETTE there.
// All sprites face EAST (+x, matching the chassis convention). Bullets are
// displayed unrotated, so every shot is vertically symmetric — no orientation
// lie at any travel angle; the silhouette + role-color body carries the
// weapon identity, the hot w/y core keeps it visible under dark tints.
//
// Team coding (shape/brightness redundant, never hue-only): each weapon ships
// TWO maps. Team 0 carries amber `y` tick pixels on the TOP edge; team 1
// carries white `w` tick pixels on the BOTTOM edge with an open vent. Both
// carry `t` pixels that bake to the team trim color (gold vs cyan). Either
// team reads with hue removed: tick position (top/bottom) + tick brightness
// (amber/white) + vent (closed/open) all survive deuteranopia/protanopia.
//
// Muzzles are team-neutral fire (w/y/o + role-color flecks); the flash lives
// 90 ms, so team identity stays on the firing robot's trim, not the flame.
//
// Palette chars used: . k d m l w y o r g b u v i n t (all base palette).
// No PALETTE additions needed.

type PixelMap = string[];

/** Weapon ids with finished shot/muzzle art (match CHASSIS_V2 keys + std). */
// Single-line array: tools/art-qa.mjs reads every standalone quoted token
// as a pixel-map row, so these ids must never sit one-per-line.
export const SHOT_WEAPONS = ['brawler', 'hunter', 'rusher', 'sniper', 'orbiter', 'ghost', 'wanderer', 'turret', 'std'] as const;

export type ShotWeapon = (typeof SHOT_WEAPONS)[number];

// --- Brawler (r red): heavy square slug ------------------------------------
// Team 0: amber crown ticks top, closed base. Team 1: white vent ticks
// bottom, open base.
export const SHOT_BRAWLER_0: PixelMap = [
    '..kyyk..',
    '.krrrrk.',
    'krrwwrrk',
    'krtwwtrk',
    '.krrrrk.',
    '..kkkk..',
];

export const SHOT_BRAWLER_1: PixelMap = [
    '..kkkk..',
    '.krrrrk.',
    'krrwwrrk',
    'krtwwtrk',
    '.krrrrk.',
    '..kwwk..',
];

// --- Hunter (b blue): needle dart -------------------------------------------
export const SHOT_HUNTER_0: PixelMap = [
    '...yy...',
    '..kbbk..',
    '.kbwwbk.',
    'kbtwwtbk',
    '.kbwwbk.',
    '...kk...',
];

export const SHOT_HUNTER_1: PixelMap = [
    '...ww...',
    '..kbbk..',
    '.kbwwbk.',
    'kbtwwtbk',
    '.kbwwbk.',
    '...kk...',
];

// --- Rusher (o orange): hammer-head wide bolt --------------------------------
export const SHOT_RUSHER_0: PixelMap = [
    '..kyyk..',
    '.kooook.',
    'koowwook',
    'kotwwtok',
    '.kooook.',
    '..kkkk..',
];

export const SHOT_RUSHER_1: PixelMap = [
    '..kkkk..',
    '.kooook.',
    'koowwook',
    'kotwwtok',
    '.kowwok.',
    '...ww...',
];

// --- Sniper (u green-teal): slim finned dart ---------------------------------
export const SHOT_SNIPER_0: PixelMap = [
    '...yy...',
    '..kuuk..',
    '.kuwwuk.',
    '.kutwtk.',
    '..kuuk..',
    '...kk...',
];

export const SHOT_SNIPER_1: PixelMap = [
    '...ww...',
    '..kuuk..',
    '.kuwwuk.',
    '.kutwtk.',
    '..kuuk..',
    '...kk...',
];

// --- Orbiter (v slate-blue): ringed orb ---------------------------------------
export const SHOT_ORBITER_0: PixelMap = [
    '...yy...',
    '..kvvk..',
    '.kvwwvk.',
    '.kvtvtk.',
    '..kvvk..',
    '...kk...',
];

export const SHOT_ORBITER_1: PixelMap = [
    '...kk...',
    '..kvvk..',
    '.kvwwvk.',
    '.kvtvtk.',
    '..kvvk..',
    '...ww...',
];

// --- Ghost (i pink): slim needle -----------------------------------------------
export const SHOT_GHOST_0: PixelMap = [
    '...yy...',
    '..kiik..',
    '..kiik..',
    '..ktik..',
    '..kiik..',
    '...kk...',
];

export const SHOT_GHOST_1: PixelMap = [
    '...ww...',
    '..kiik..',
    '..kiik..',
    '..ktik..',
    '..kiik..',
    '...kk...',
];

// --- Wanderer (n bronze): chunky hex nut ----------------------------------------
export const SHOT_WANDERER_0: PixelMap = [
    '..kyyk..',
    '.knnnnk.',
    'knnwwnnk',
    'kntwwtnk',
    '.knnnnk.',
    '..kkkk..',
];

export const SHOT_WANDERER_1: PixelMap = [
    '..kkkk..',
    '.knnnnk.',
    'knnwwnnk',
    'kntwwtnk',
    '.knwwnk.',
    '...ww...',
];

// --- Turret (g green): bunker round ----------------------------------------------
export const SHOT_TURRET_0: PixelMap = [
    '..kyyk..',
    '..kggk..',
    '.kgwwgk.',
    '.kgtgtk.',
    '..kggk..',
    '...kk...',
];

export const SHOT_TURRET_1: PixelMap = [
    '...ww...',
    '..kggk..',
    '.kgwwgk.',
    '.kgtgtk.',
    '..kggk..',
    '...kk...',
];

// --- Generic fallback (m steel): unattributed bullets ------------------------------
// Same team-tick language; used when no fire event owns a bullet slot
// (map-turret shots, pool warmup). Replaces the old BULLET_V2 draft.
export const SHOT_STD_0: PixelMap = [
    '...yy...',
    '..kmmk..',
    '.kmwwmk.',
    '.kmtwtk.',
    '..kmmk..',
    '...kk...',
];

export const SHOT_STD_1: PixelMap = [
    '...ww...',
    '..kmmk..',
    '.kmwwmk.',
    '.kmtwtk.',
    '..kmmk..',
    '...kk...',
];

/** Registry record: `shot_<weapon>_<team>` (8x6 each). */
export const SHOT_MAPS: Record<string, PixelMap> = {
    brawler_0: SHOT_BRAWLER_0,
    brawler_1: SHOT_BRAWLER_1,
    hunter_0: SHOT_HUNTER_0,
    hunter_1: SHOT_HUNTER_1,
    rusher_0: SHOT_RUSHER_0,
    rusher_1: SHOT_RUSHER_1,
    sniper_0: SHOT_SNIPER_0,
    sniper_1: SHOT_SNIPER_1,
    orbiter_0: SHOT_ORBITER_0,
    orbiter_1: SHOT_ORBITER_1,
    ghost_0: SHOT_GHOST_0,
    ghost_1: SHOT_GHOST_1,
    wanderer_0: SHOT_WANDERER_0,
    wanderer_1: SHOT_WANDERER_1,
    turret_0: SHOT_TURRET_0,
    turret_1: SHOT_TURRET_1,
    std_0: SHOT_STD_0,
    std_1: SHOT_STD_1,
};
export function shotMap(weapon: string, team: 0 | 1): PixelMap {
    const w = (SHOT_WEAPONS as readonly string[]).includes(weapon) ? weapon : 'std';
    const t = team === 0 ? '_0' : '_1';
    switch (`${w}${t}`) {
        case 'brawler_0': return SHOT_BRAWLER_0;
        case 'brawler_1': return SHOT_BRAWLER_1;
        case 'hunter_0': return SHOT_HUNTER_0;
        case 'hunter_1': return SHOT_HUNTER_1;
        case 'rusher_0': return SHOT_RUSHER_0;
        case 'rusher_1': return SHOT_RUSHER_1;
        case 'sniper_0': return SHOT_SNIPER_0;
        case 'sniper_1': return SHOT_SNIPER_1;
        case 'orbiter_0': return SHOT_ORBITER_0;
        case 'orbiter_1': return SHOT_ORBITER_1;
        case 'ghost_0': return SHOT_GHOST_0;
        case 'ghost_1': return SHOT_GHOST_1;
        case 'wanderer_0': return SHOT_WANDERER_0;
        case 'wanderer_1': return SHOT_WANDERER_1;
        case 'turret_0': return SHOT_TURRET_0;
        case 'turret_1': return SHOT_TURRET_1;
        case 'std_0': return SHOT_STD_0;
        default: return SHOT_STD_1;
    }
}

// --- Per-weapon muzzle flashes (12x12, EAST, team-neutral fire) --------------------
// White core at the breech (west), amber mids, orange tips licking east.
// No `k` outlines (glow rule); 2-4 role-color flecks tie each flash to its
// weapon. Displayed 90 ms max via muzzleLife; charged shots scale up.

// Brawler: wide block core, square front.
export const MUZZLE_BRAWLER: PixelMap = [
    '............',
    '.....yy.....',
    '....ywwy....',
    '...rywwyr...',
    '..rwwwwww...',
    '.wwwwwwwwyyo',
    '.wwwwwwwwyyo',
    '..rwwwwww...',
    '...rywwyr...',
    '....ywwy....',
    '.....yy.....',
    '............',
];

// Hunter: forked twin jets (upper/lower prongs, transparent slot between).
export const MUZZLE_HUNTER: PixelMap = [
    '............',
    '..yy...yy...',
    '..ywwb.yww..',
    '...ywwbyw...',
    '....ywbw....',
    '.wwwwwwwwyyo',
    '.wwwwwwwwyyo',
    '....ywbw....',
    '...ywwbyw...',
    '..ywwb.yww..',
    '..yy...yy...',
    '............',
];

// Rusher: tall hammer-slam burst, heavy top/bottom caps.
export const MUZZLE_RUSHER: PixelMap = [
    '....yyyy....',
    '...yooooy...',
    '...owwwwo...',
    '....ywwy....',
    '..oowwwy....',
    '.wwwwwwwwoyo',
    '.wwwwwwwwoyo',
    '..oowwwy....',
    '....ywwy....',
    '...owwwwo...',
    '...yooooy...',
    '....yyyy....',
];

// Sniper: long thin lance reaching far east.
export const MUZZLE_SNIPER: PixelMap = [
    '............',
    '............',
    '.....yy.....',
    '....ywwy....',
    '....yuwwyo..',
    '.wwwwwwwwyyo',
    '.wwwwwwwwyyo',
    '....yuwwyo..',
    '....ywwy....',
    '.....yy.....',
    '............',
    '............',
];

// Orbiter: ring burst, hollow core.
export const MUZZLE_ORBITER: PixelMap = [
    '............',
    '....yyyy....',
    '...yvvvvy...',
    '..yvv..vvy..',
    '..yvw..vvyo.',
    '..yvw..wvyo.',
    '..yvw..wvyo.',
    '..yvw..vvyo.',
    '..yvv..vvy..',
    '...yvvvvy...',
    '....yyyy....',
    '............',
];

// Ghost: slim X spark, narrow waist.
export const MUZZLE_GHOST: PixelMap = [
    '............',
    '.yy......yy.',
    '..yww..yww..',
    '...ywwiyw...',
    '....ywiw....',
    '.iwwwwwwwyyo',
    '.iwwwwwwwyyo',
    '....ywiw....',
    '...ywwiyw...',
    '..yww..yww..',
    '.yy......yy.',
    '............',
];

// Wanderer: chunky hex burst, notched corners.
export const MUZZLE_WANDERER: PixelMap = [
    '............',
    '....yyyy....',
    '...ynwwny...',
    '...nwwwwn...',
    '..ynwwwwny..',
    '.wwwwwwwwwyo',
    '.wwwwwwwwwyo',
    '..ynwwwwny..',
    '...nwwwwn...',
    '...ynwwny...',
    '....yyyy....',
    '............',
];

// Turret: fortified block flash, heaviest silhouette.
export const MUZZLE_TURRET: PixelMap = [
    '............',
    '...yyyyyy...',
    '...ygwwgy...',
    '..ygwwwwgy..',
    '..ygwwwwgy..',
    '.wwwwwwwwwyo',
    '.wwwwwwwwwyo',
    '..ygwwwwgy..',
    '..ygwwwwgy..',
    '...ygwwgy...',
    '...yyyyyy...',
    '............',
];

/** Registry record: `muzzle_<weapon>` (12x12 each, dir8-baked). */
export const MUZZLE_MAPS: Record<string, PixelMap> = {
    brawler: MUZZLE_BRAWLER,
    hunter: MUZZLE_HUNTER,
    rusher: MUZZLE_RUSHER,
    sniper: MUZZLE_SNIPER,
    orbiter: MUZZLE_ORBITER,
    ghost: MUZZLE_GHOST,
    wanderer: MUZZLE_WANDERER,
    turret: MUZZLE_TURRET,
};
export function muzzleMap(weapon: string): PixelMap {
    switch (weapon) {
        case 'brawler': return MUZZLE_BRAWLER;
        case 'hunter': return MUZZLE_HUNTER;
        case 'rusher': return MUZZLE_RUSHER;
        case 'sniper': return MUZZLE_SNIPER;
        case 'orbiter': return MUZZLE_ORBITER;
        case 'ghost': return MUZZLE_GHOST;
        case 'wanderer': return MUZZLE_WANDERER;
        case 'turret': return MUZZLE_TURRET;
        default: return MUZZLE_BRAWLER;
    }
}

// SPARK_V2 (2x2): white/amber diagonal fleck, the shared particle dot for
// bursts, exhaust and ember drift. Still consumed by the BattleScene
// particle pool (`spark` key).
export const SPARK_V2: PixelMap = [
    'wy',
    'yw',
];
