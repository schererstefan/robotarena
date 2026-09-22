// Shared, identical performance constants for every robot.
// Fairness rule: robot code may read these but the engine is the only
// writer of state, and all intents are clamped to these limits.

import { createRng } from './rng';

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;
export const MAX_TICKS = TICK_HZ * 150; // 2.5 minutes, then sudden death
/** Sudden-death collapse: the safe circle shrinks from full cover to zero over this many ticks. */
export const SUDDEN_DEATH_TICKS = TICK_HZ * 30;
/** Sudden-death pulses come every this many ticks, staggered by robot id so two robots never pulse together. */
export const SUDDEN_DEATH_PERIOD = 6;
export const SUDDEN_DEATH_DAMAGE = 6;
/** Absolute tick cap (defensive only: the collapsed circle eliminates everyone first). */
export const MAX_TICKS_TOTAL = MAX_TICKS + SUDDEN_DEATH_TICKS + TICK_HZ * 10;

// Asteroid strikes (complexity/W1): seed-scheduled world hazard, ON by
// default (`noHazards` opts out). Each strike is a mirrored pair across the
// center column (x=480), targeted at one living robot's announce-time
// position plus its mirror — the spawn-column x=130/830 precedent. Strikes
// only run pre-sudden-death; the collapse owns the endgame.
// Balance (tuned against 1v1 medians ~390 ticks): the first pair lands ~5 s
// in, then one pair per ~12.5 s, so short duels usually see 0-1 pairs and
// long/team games see several. 25 damage (~2 bullets) punishes campers
// without deciding healthy duels; the visible fly-in (up to ~3 s) vs 70 px
// radius lets any moving robot escape the announced target in time.
/** First strike announcement tick. */
export const HAZ_FIRST_TICK = 300;
/** Ticks between strike announcements (one live asteroid at a time). */
export const HAZ_COOLDOWN_TICKS = 750;
/** @deprecated Fixed telegraph lead (pre-fly-in W1 model); kept for test imports only. */
export const HAZ_TELEGRAPH_TICKS = 90;
/** Asteroid fly-in speed: pixels per tick along spawn -> target. */
export const HAZ_FLY_SPEED = 7;
/** Off-screen spawn margin: asteroids enter from this far past each edge. */
export const HAZ_SPAWN_MARGIN = 200;
/** Impact-target margin from arena edges so blasts stay mostly in play. */
export const HAZ_TARGET_MARGIN = 80;
/** Conservative upper bound on flight ticks (bounds the pre-sudden-death window). */
export const HAZ_FLY_MAX_TICKS = 200;
/** Blast radius in arena units (center-distance, exact). */
export const HAZ_RADIUS = 70;
/** Flat damage inside the radius (no double-damage interaction). */
export const HAZ_DAMAGE = 25;
/** Scorch decal lifetime in ticks (visual fade window). */
export const HAZ_SCORCH_TICKS = 1200;
/** Dedicated-stream salt (arbitrary, distinct from SPAWN_SALT). */
export const HAZ_SALT = 0x8a2a2d;

/**
 * Exhibition modifiers: toggleable rules twists, barred from stats.
 * `mirror` is lineup-level (both teams run identical robots); the sim reads
 * it only as an exhibition marker.
 */
export interface MatchModifiers {
    doubleDamage?: boolean;
    hardcoreFog?: boolean;
    mirror?: boolean;
    /**
     * Opt-out of asteroid strikes (complexity/W1). Absent means ON: strikes
     * are the default conditions, so default matches stay ranked. Setting
     * this is a rules twist (exhibition). Zero-codec design: the flag rides
     * the existing modifiers channel (fingerprinted via the mods segment and
     * golden keys); RA1 encodes it as one letter, RA2-unsafe specs fall back
     * to RA1, so the RA2 bit layout is untouched.
     */
    noHazards?: boolean;
}

/** Strict sanitize: only literal `true` survives. Key order is fixed. */
export function sanitizeModifiers(raw: unknown): MatchModifiers {
    if (typeof raw !== 'object' || raw === null) return {};
    const r = raw as Record<string, unknown>;
    const clean: MatchModifiers = {};
    if (r['doubleDamage'] === true) clean.doubleDamage = true;
    if (r['hardcoreFog'] === true) clean.hardcoreFog = true;
    if (r['mirror'] === true) clean.mirror = true;
    if (r['noHazards'] === true) clean.noHazards = true;
    return clean;
}

/** True when any exhibition modifier is on (match is barred from stats). */
export function isExhibition(modifiers: MatchModifiers): boolean {
    return modifiers.doubleDamage === true || modifiers.hardcoreFog === true || modifiers.mirror === true || modifiers.noHazards === true;
}

/** Short HUD codes for the active modifiers, e.g. `['2X', 'FOG']`. */
export function modifierCodes(modifiers: MatchModifiers): string[] {
    const codes: string[] = [];
    if (modifiers.doubleDamage === true) codes.push('2X');
    if (modifiers.hardcoreFog === true) codes.push('FOG');
    if (modifiers.mirror === true) codes.push('MIR');
    if (modifiers.noHazards === true) codes.push('CLR');
    return codes;
}

export const ARENA_WIDTH = 960;
export const ARENA_HEIGHT = 640;

/**
 * Arena layouts: `open` is empty, `blocks` adds mirrored center blocks, and
 * `ruins` / `foundry` / `crossfire` are seeded asymmetric terrain (barrier
 * counts, sizes, and positions vary per match with no mirroring; turret
 * pairs stay center-symmetric so neither side gains an edge — see
 * ARENA_TURRETS).
 */
export type ArenaId = 'open' | 'blocks' | 'ruins' | 'foundry' | 'crossfire';
export const ARENA_IDS: readonly ArenaId[] = ['open', 'blocks', 'ruins', 'foundry', 'crossfire'];

export interface ArenaObstacle {
    /** Top-left corner in arena coordinates. */
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * Obstacle rects per arena. `open` is empty; the `blocks` entry below is the
 * canonical fallback layout (mirrored through the arena center (480, 320) so
 * neither team gains cover or a shorter path, clear of the spawn zones at
 * x = 130±40 / 830±40). Live `blocks` matches use the seed-derived
 * `barriersForSeed(seed)` layout instead — see BARRIER_SALT.
 */
export const ARENA_OBSTACLES: Record<ArenaId, ArenaObstacle[]> = {
    open: [],
    blocks: [
        { x: 300, y: 130, w: 90, h: 90 },
        { x: 570, y: 130, w: 90, h: 90 },
        { x: 300, y: 420, w: 90, h: 90 },
        { x: 570, y: 420, w: 90, h: 90 },
    ],
    // Canonical fallbacks for the asymmetric arenas (cold path: used only
    // when seed sampling exhausts). Deliberately asymmetric, hand-verified
    // against the same legality guards as sampled layouts (midfield band,
    // 8px sizes, 56px+ pair gaps, 32px+ turret clearance) and against the
    // pad solver across hundreds of pad seeds. Each set carries an
    // off-distribution size no sampler draws (ruins 88, foundry 120/128,
    // crossfire 120 — the `blocks` 90px precedent), so tests can tell
    // sampled layouts from fallback deals exactly.
    ruins: [
        { x: 280, y: 120, w: 64, h: 64 },
        { x: 420, y: 100, w: 72, h: 56 },
        { x: 560, y: 224, w: 80, h: 64 },
        { x: 300, y: 360, w: 56, h: 88 },
        { x: 480, y: 440, w: 72, h: 72 },
    ],
    foundry: [
        { x: 272, y: 112, w: 120, h: 72 },
        { x: 520, y: 200, w: 128, h: 80 },
        { x: 336, y: 400, w: 112, h: 96 },
    ],
    crossfire: [
        { x: 296, y: 296, w: 56, h: 64 },
        { x: 360, y: 448, w: 104, h: 56 },
        { x: 456, y: 272, w: 64, h: 64 },
        { x: 544, y: 96, w: 120, h: 64 },
        { x: 576, y: 488, w: 96, h: 64 },
        { x: 624, y: 256, w: 72, h: 64 },
    ],
};

/**
 * Seed-derived barrier layout (complexity/barriers): the `blocks` arena no
 * longer uses one fixed setup — each match seed deals its own 4-segment
 * layout (2 drawn rects + their center mirrors). Symmetric through the
 * arena center (480, 320), so both teams face identical terrain; same seed
 * => identical layout, zero replay-codec bits (same approach as spawn
 * variation: a dedicated `seed ^ BARRIER_SALT` stream, brain RNG untouched).
 *
 * Playability guards (checked at generation, asserted in the soak):
 * - every rect stays inside the midfield band (x 248..712, y 88..552), so
 *   spawn columns (x 90..170 / 790..870) keep 60px+ clearance and the
 *   nearest wall is 88px away — nothing seals against an edge;
 * - every pair of the 4 final rects keeps a 56px+ edge gap (wider than one
 *   robot diameter), so no pocket can close and every gap stays passable;
 * - sizes are multiples of 8px in 56..104, far thicker than one bullet or
 *   dash step (~7px), so nothing tunnels.
 */
export const BARRIER_SALT = 0xb4a91e5;
/** Barrier rects per `blocks` match: 2 drawn + 2 center mirrors. */
export const BARRIER_COUNT = 4;
/** Minimum edge-to-edge gap between any two barrier rects. */
export const BARRIER_MIN_GAP = 56;

function mirrorBarrier(o: ArenaObstacle): ArenaObstacle {
    return { x: ARENA_WIDTH - o.x - o.w, y: ARENA_HEIGHT - o.y - o.h, w: o.w, h: o.h };
}

/** Edge-to-edge separation of two rects (0 when they touch/overlap). */
function barrierGap(a: ArenaObstacle, b: ArenaObstacle): number {
    const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
    const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
    if (dx <= 0 && dy <= 0) return 0;
    if (dx <= 0) return dy;
    if (dy <= 0) return dx;
    return Math.hypot(dx, dy);
}

function barriersFit(rects: ArenaObstacle[]): boolean {
    for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
            if (barrierGap(rects[i] as ArenaObstacle, rects[j] as ArenaObstacle) < BARRIER_MIN_GAP) return false;
        }
    }
    return true;
}

/**
 * Deterministic barrier layout for a match seed. Always exactly
 * BARRIER_COUNT rects, sorted by (x, y) for canonical order. Falls back to
 * the canonical ARENA_OBSTACLES.blocks setup when rejection sampling
 * exhausts (still symmetric, still legal) — never random, never empty.
 */
export function barriersForSeed(seed: number): ArenaObstacle[] {
    const rng = createRng((seed ^ BARRIER_SALT) >>> 0);
    const sizes = [56, 64, 72, 80, 88, 96, 104];
    const drawOne = (): ArenaObstacle => {
        const w = sizes[Math.floor(rng() * sizes.length)] as number;
        const h = sizes[Math.floor(rng() * sizes.length)] as number;
        // Midfield band, multiples of 8px: x + w <= 712, y + h <= 552.
        const x = 248 + Math.floor(rng() * ((712 - w - 248) / 8 + 1)) * 8;
        const y = 88 + Math.floor(rng() * ((552 - h - 88) / 8 + 1)) * 8;
        return { x, y, w, h };
    };
    // Joint pair sampling: both rects plus both mirrors must fit together,
    // including each rect against its own mirror (center-hugging draws fail
    // fast and cost one attempt, they never poison the stream).
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const first = drawOne();
        const second = drawOne();
        const rects = [first, second, mirrorBarrier(first), mirrorBarrier(second)];
        if (barriersFit(rects)) return rects.sort((a, b) => a.x - b.x || a.y - b.y);
    }
    // Rejection exhausted (near-impossible on this band): the canonical
    // 90x90 fallback is symmetric and verified to fit — never random, never
    // empty. Tests accept its 90px size alongside drawn multiples of 8.
    return ARENA_OBSTACLES.blocks.map((o) => ({ ...o })).sort((a, b) => a.x - b.x || a.y - b.y);
}

/**
 * Asymmetric arenas (gameplay/arena-variety): `ruins`, `foundry`, and
 * `crossfire` deal fully asymmetric barrier layouts — no mirroring at all.
 * Counts and size profiles differ per arena (rubble / slabs / lanes), and
 * every rect is sampled independently, so same-arena layouts vary far more
 * than `blocks` permits. Fairness is kept by what does NOT vary: spawns
 * stay center-mirrored (engine), pads stay point-mirrored pairs (below),
 * and each arena's turret pair stays center-symmetric (ARENA_TURRETS).
 *
 * Determinism: each arena draws from its own dedicated stream
 * (`seed ^ ARENA_SALT`, brain RNG untouched), so same (arena, seed) =>
 * identical layout with zero replay-codec bits. No Math.random, no clock.
 *
 * Legality guards (same family as `blocks`, checked at generation):
 * - rects stay inside the midfield band (x 248..712, y 88..552), so spawn
 *   columns and walls keep their clearance and nothing seals an edge;
 * - every pair keeps a BARRIER_MIN_GAP edge gap, so no pocket can close;
 * - sizes are multiples of 8px, far thicker than a drive step;
 * - turret structures stay BARRIER_TURRET_CLEAR (edge-to-center) clear, so
 *   no turret is ever buried inside a rect.
 * Sampling exhausts to the canonical ARENA_OBSTACLES entry for that arena
 * (asymmetric, verified legal) — never random, never empty.
 */

/** Dedicated-stream salts for the asymmetric arenas (distinct from BARRIER_SALT et al). */
export const RUINS_SALT = 0x901e5;
export const FOUNDRY_SALT = 0xf0d905;
export const CROSSFIRE_SALT = 0xc205f1e;
/** Barrier counts per asymmetric arena (distinct across layouts). */
export const RUINS_BARRIER_COUNT = 5;
export const FOUNDRY_BARRIER_COUNT = 3;
export const CROSSFIRE_BARRIER_COUNT = 6;
/** Minimum edge-to-turret-center clearance for sampled asymmetric barriers. */
export const BARRIER_TURRET_CLEAR = 32;
/** Midfield sampling band shared by the asymmetric arenas (the `blocks` band). */
export const ASYMM_BAND = { x0: 248, x1: 712, y0: 88, y1: 552 };

/** Pixel turret spot for clearance checks (engine maps ARENA_TURRETS fractions here). */
export interface TurretSpot {
    x: number;
    y: number;
}

/** Edge-to-center distance from a rect to a turret spot (0 when covered). */
function barrierTurretDist(r: ArenaObstacle, t: TurretSpot): number {
    const cx = Math.max(r.x, Math.min(t.x, r.x + r.w));
    const cy = Math.max(r.y, Math.min(t.y, r.y + r.h));
    return Math.hypot(t.x - cx, t.y - cy);
}

/**
 * Sequential asymmetric placement: draws rects one at a time (each against
 * the band, the turret spots, and every already-placed rect), retrying a
 * stuck rect without discarding the good ones. Restarts the whole layout a
 * few times before dealing the canonical fallback. Pure function of
 * (seed, salt, count, drawDims, turrets, fallback).
 */
function placeAsymmetricBarriers(
    seed: number,
    salt: number,
    count: number,
    drawDims: (rng: () => number, index: number) => { w: number; h: number },
    turrets: TurretSpot[],
    fallback: ArenaObstacle[],
): ArenaObstacle[] {
    for (let restart = 0; restart < 12; restart += 1) {
        const rng = createRng((seed ^ salt ^ Math.imul(restart + 1, 0x9e3779b9)) >>> 0);
        const placed: ArenaObstacle[] = [];
        let stuck = false;
        for (let n = 0; n < count; n += 1) {
            let drew = false;
            for (let attempt = 0; attempt < 500; attempt += 1) {
                const { w, h } = drawDims(rng, n);
                const x = ASYMM_BAND.x0 + Math.floor(rng() * ((ASYMM_BAND.x1 - w - ASYMM_BAND.x0) / 8 + 1)) * 8;
                const y = ASYMM_BAND.y0 + Math.floor(rng() * ((ASYMM_BAND.y1 - h - ASYMM_BAND.y0) / 8 + 1)) * 8;
                const rect = { x, y, w, h };
                if (turrets.some((t) => barrierTurretDist(rect, t) < BARRIER_TURRET_CLEAR)) continue;
                if (placed.some((p) => barrierGap(rect, p) < BARRIER_MIN_GAP)) continue;
                placed.push(rect);
                drew = true;
                break;
            }
            if (!drew) {
                stuck = true;
                break;
            }
        }
        if (!stuck) return placed.sort((a, b) => a.x - b.x || a.y - b.y);
    }
    return fallback.map((o) => ({ ...o })).sort((a, b) => a.x - b.x || a.y - b.y);
}

function pickSize(rng: () => number, sizes: number[]): number {
    return sizes[Math.floor(rng() * sizes.length)] as number;
}

/**
 * Pad-aware barrier deal: samples a legal barrier set, then keeps it only
 * when the pad solver threads the remaining midfield (mirror-symmetric pad
 * pairs need mirror-symmetric free pockets, which big asymmetric slabs can
 * starve). Otherwise redraws with a new salt. After a few barren rounds it
 * deals the canonical fallback — hand-verified pad-feasible — so matches
 * always start valid: never random, never empty, never pad-starved.
 */
function dealPadAwareBarriers(
    seed: number,
    salt: number,
    count: number,
    drawDims: (rng: () => number, index: number) => { w: number; h: number },
    arena: ArenaId,
): ArenaObstacle[] {
    const turrets = turretSpotsForArena(arena);
    for (let round = 0; round < 8; round += 1) {
        const roundSalt = (salt ^ Math.imul(round + 1, 0x85ebca6b)) >>> 0;
        const rects = placeAsymmetricBarriers(seed, roundSalt, count, drawDims, turrets, ARENA_OBSTACLES[arena]);
        if (samplePadPairsCovering(seed, rects, turrets) !== null) return rects;
    }
    return ARENA_OBSTACLES[arena].map((o) => ({ ...o })).sort((a, b) => a.x - b.x || a.y - b.y);
}

/**
 * `ruins`: scattered asymmetric rubble — 5 small square-ish rects
 * (56..80px). Busy midfield, many small gaps.
 */
export function ruinsBarriersForSeed(seed: number): ArenaObstacle[] {
    const sizes = [56, 64, 72, 80];
    return dealPadAwareBarriers(
        seed >>> 0,
        RUINS_SALT,
        RUINS_BARRIER_COUNT,
        (rng) => ({ w: pickSize(rng, sizes), h: pickSize(rng, sizes) }),
        'ruins',
    );
}

/**
 * `foundry`: three large asymmetric slabs (88..112px). Few pieces, big
 * cover — long lanes around heavy blocks. Sized so powerup pads still
 * thread the midfield (larger slabs starve the pad solver — see
 * samplePadPairsCovering).
 */
export function foundryBarriersForSeed(seed: number): ArenaObstacle[] {
    const sizes = [88, 96, 104, 112];
    return dealPadAwareBarriers(
        seed >>> 0,
        FOUNDRY_SALT,
        FOUNDRY_BARRIER_COUNT,
        (rng) => ({ w: pickSize(rng, sizes), h: pickSize(rng, sizes) }),
        'foundry',
    );
}

/**
 * `crossfire`: six asymmetric pieces alternating long bars (96..112 x
 * 56..64, random orientation) with small squares (56..72). Lane carving:
 * bars channel movement while squares break sightlines. Bar length is
 * capped so powerup pads still thread the lanes (see
 * samplePadPairsCovering).
 */
export function crossfireBarriersForSeed(seed: number): ArenaObstacle[] {
    const longs = [96, 104, 112];
    const shorts = [56, 64];
    const squares = [56, 64, 72];
    return dealPadAwareBarriers(
        seed >>> 0,
        CROSSFIRE_SALT,
        CROSSFIRE_BARRIER_COUNT,
        (rng, index) => {
            if (index % 2 === 0) {
                const long = pickSize(rng, longs);
                const short = pickSize(rng, shorts);
                return rng() < 0.5 ? { w: long, h: short } : { w: short, h: long };
            }
            return { w: pickSize(rng, squares), h: pickSize(rng, squares) };
        },
        'crossfire',
    );
}

/** Barrier layout for an arena + seed: `open` is empty, `blocks` keeps its untouched generator. */
export function barriersForArena(arena: ArenaId, seed: number): ArenaObstacle[] {
    if (arena === 'blocks') return barriersForSeed(seed);
    if (arena === 'ruins') return ruinsBarriersForSeed(seed);
    if (arena === 'foundry') return foundryBarriersForSeed(seed);
    if (arena === 'crossfire') return crossfireBarriersForSeed(seed);
    return [];
}

/**
 * Map-turret structures per arena (fractional arena coords; the engine
 * scales to pixels). `open`/`blocks` keep the classic center-column pair
 * (0.50 x 0.30/0.70 y) exactly. Each asymmetric arena moves the pair while
 * keeping it point-symmetric through the arena center (480, 320) — both
 * teams contest identical turrets, so terrain variety never becomes a side
 * edge. Positions are constant per arena (not seed-derived), so replays
 * rebuild them with no codec change.
 */
export interface ArenaTurretSpot {
    fx: number;
    fy: number;
}
export const ARENA_TURRETS: Record<ArenaId, [ArenaTurretSpot, ArenaTurretSpot]> = {
    open: [
        { fx: 0.5, fy: 0.3 },
        { fx: 0.5, fy: 0.7 },
    ],
    blocks: [
        { fx: 0.5, fy: 0.3 },
        { fx: 0.5, fy: 0.7 },
    ],
    // Midline pair: both turrets sit on the center lane, one per half.
    ruins: [
        { fx: 0.35, fy: 0.5 },
        { fx: 0.65, fy: 0.5 },
    ],
    // Wide pair: turrets pull toward the top/bottom edges, opening the mid.
    foundry: [
        { fx: 0.5, fy: 0.22 },
        { fx: 0.5, fy: 0.78 },
    ],
    // Diagonal pair: turrets watch opposite corners across the bar lanes.
    crossfire: [
        { fx: 0.32, fy: 0.32 },
        { fx: 0.68, fy: 0.68 },
    ],
};

/** Pixel turret spots for an arena (fresh array each call; engine + pads + tests). */
export function turretSpotsForArena(arena: ArenaId): TurretSpot[] {
    const spots = ARENA_TURRETS[arena] ?? ARENA_TURRETS.open;
    return spots.map((s) => ({ x: s.fx * ARENA_WIDTH, y: s.fy * ARENA_HEIGHT }));
}

export const ROBOT_RADIUS = 14;
export const START_HEALTH = 100;

// Seeded spawn variation (complexity/spawn): base columns plus bounded
// offsets drawn from a dedicated RNG stream (seed ^ SPAWN_SALT). Team 1
// mirrors team 0 through the arena center, so all clearances transfer.
export const SPAWN_X = 130;
export const SPAWN_X_JITTER = 40;
export const SPAWN_Y_SHIFT = 80;
export const SPAWN_Y_JITTER = 40;
export const SPAWN_HEADING_JITTER = 0.3;
/** Dedicated-stream salt: "SPAWN" leet (5=S, 1~I, A=A, 9~P, E=E, 5=S). */
export const SPAWN_SALT = 0x51a9e5;
/** Minimum teammate separation, enforced by construction (see engine). */
export const SPAWN_MIN_GAP = ROBOT_RADIUS * 2 + 8;

// Chassis base values (same for all robots; skills modify per loadout).
export const MAX_SPEED = 150; // units per second at full throttle
export const REVERSE_FACTOR = 0.6; // reverse is slower than forward
export const ACCEL = 340; // units per second^2 toward target speed
export const TURN_RATE = 2.7; // radians per second at full turn input

// Lateral drive: strafe ±1 maps to this fraction of top speed (universal).
export const STRAFE_FACTOR = 0.5;

// Team radio: exact-delay delivery like sensor sharing, but fast (tactical,
// not strategic). Inbox is capped; overflow keeps earliest-sent, lowest-id.
export const COMMS_DELAY = 6;
export const COMMS_INBOX_MAX = 4;
/** Short alias for the inbox cap. */
export const INBOX_MAX = COMMS_INBOX_MAX;

// Sensor tower base values (same for all robots; skills modify per loadout).
export const TOWER_RATE = 3.6; // radians per second at full tower input
export const SENSOR_RANGE = 540;
export const SENSOR_FOV = 1.1; // full cone width in radians (~63 deg)
/** Team sensor sharing delay: ally sightings arrive this many ticks late. */
export const SENSOR_SHARE_DELAY = 30;

// Sense channels (hillclimb Phase 4): caps and heat-map geometry.
export const SENSE_EVENTS_MAX = 8;
export const SENSE_BULLETS_MAX = 12;
export const SENSE_GRID_W = 12;
export const SENSE_GRID_H = 8;
export const SENSE_GRID_CELL = 80; // 12x80 = 960, 8x80 = 640
/** Foe-presence value stamped on a sighted cell (decays 1/tick). */
export const SENSE_GRID_STAMP = 5;

// Gun base values (same for all robots; skills modify per loadout).
export const GUN_RANGE = 470;
export const GUN_COOLDOWN_TICKS = 24; // 0.4s between shots
export const BULLET_SPEED = 430;
export const BULLET_DAMAGE = 12;
export const BULLET_RADIUS = 3;

// Active skills: universal (no skill points), gated by long cooldowns.
// Dash is a burst of top speed; EMP slows nearby foes' drives.
export const DASH_COOLDOWN_TICKS = TICK_HZ * 8;
export const DASH_DURATION_TICKS = 12;
export const DASH_SPEED_MULT = 2.5;
export const EMP_COOLDOWN_TICKS = TICK_HZ * 12;
export const EMP_RADIUS = 220;
export const EMP_SLOW_TICKS = TICK_HZ * 3;
export const EMP_SLOW_MULT = 0.45;

// Powerup pads (P1): static map feature, always on. Positions are
// seed-randomized per match (mirror-symmetric); kinds cycle with a seed
// offset.
export const PAD_RADIUS = 26;
export const PAD_RESPAWN_TICKS = 900; // 15 s dark after a pickup
export const AMP_TICKS = 360; // 6 s of double bullet damage
export const OVERDRIVE_TICKS = 360; // 6 s of boosted move speed
export const REPAIR_HP = 60;
export const AMP_MULT = 2;
export const OVERDRIVE_MULT = 1.35;

/**
 * Randomized pad placement (tuning/random-pads): each match seed deals its
 * own 4-pad layout (2 drawn spots + their center mirrors), so pads are
 * contested instead of memorized. Same seed => identical layout, zero
 * replay-codec bits (dedicated `seed ^ PAD_SALT` stream, brain RNG
 * untouched) — the barrier/spawn precedent.
 *
 * Fairness rules (checked at generation, asserted in the soak):
 * - point-mirrored through the arena center (480, 320): each drawn spot's
 *   mirror shares its kind, so 1v1 matchups stay fair by construction;
 * - drawn from the central contest band (x 304..656, y 112..528, 8px
 *   lattice): >= PAD_MIN_SPAWN_DIST from every possible spawn point
 *   (spawn columns x 90..170 / 790..870 hold for every lineup size, so the
 *   band's x edge alone guarantees it), and never in a corner or edge
 *   dead strip — pads sit where fights already happen, near the turret
 *   column, instead of beside a spawn;
 * - every pair of the 4 final pads keeps a PAD_MIN_GAP center gap: no
 *   stacking, and near-center draws fail fast because each spot is checked
 *   against its own mirror; spots are placed sequentially (draw, mirror,
 *   gap-check against placed) so crowded `blocks` layouts still fit;
 * - pad circles stay clear of obstacles (PAD_OBSTACLE_CLEAR) and off the
 *   turret structures (PAD_MIN_TURRET_DIST), so every pad is reachable;
 * - kinds keep the fixed-layout scheme (mirror pairs share a kind, cycling
 *   amp/repair/overdrive with a seed offset): 2+2 split, same per-kind
 *   counts as the old fixed layout.
 */
/** Dedicated-stream salt for pad placement (distinct from SPAWN/BARRIER/HAZ salts). */
export const PAD_SALT = 0x9ad9ad;
/** Pads per match: 2 drawn spots + 2 center mirrors. */
export const PAD_COUNT = 4;
/** Minimum center-to-center distance between any two pads. */
export const PAD_MIN_GAP = 150;
/** Minimum distance from any pad to any possible spawn point (guaranteed by the contest band). */
export const PAD_MIN_SPAWN_DIST = 130;
/** Pad-center clearance from obstacle rects (edge to pad center). */
export const PAD_OBSTACLE_CLEAR = PAD_RADIUS + 10;
/** Minimum pad-center distance from either turret structure. */
export const PAD_MIN_TURRET_DIST = 60;
/** Contest band for drawn pad spots (8px lattice, mirror-closed: 960-304=656, 640-112=528). */
export const PAD_BAND = { x0: 304, x1: 656, y0: 112, y1: 528 };

/** One drawn pad spot: lattice position plus its mirror-pair id (the engine maps pairs to kinds). */
export interface PadSpot {
    x: number;
    y: number;
    pair: 0 | 1;
}

function mirrorPadSpot(x: number, y: number): { x: number; y: number } {
    return { x: ARENA_WIDTH - x, y: ARENA_HEIGHT - y };
}

/** Point-to-rect distance (same clamp rule as the engine's collideObstacles). */
function padRectDist(x: number, y: number, o: ArenaObstacle): number {
    const cx = Math.max(o.x, Math.min(x, o.x + o.w));
    const cy = Math.max(o.y, Math.min(y, o.y + o.h));
    return Math.hypot(x - cx, y - cy);
}

/** Static per-spot checks: clear of the given turret structures and obstacles. */
function padSpotStaticOk(x: number, y: number, obstacles: ArenaObstacle[], turrets: TurretSpot[]): boolean {
    for (const t of turrets) {
        if (Math.hypot(x - t.x, y - t.y) < PAD_MIN_TURRET_DIST) return false;
    }
    for (const o of obstacles) {
        if (padRectDist(x, y, o) < PAD_OBSTACLE_CLEAR) return false;
    }
    return true;
}

/** Legacy fixed pad fractions (cold backstop: symmetric, same pair scheme — never random, never empty). */
function legacyPadFallback(): PadSpot[] {
    const fx = [0.22, 0.78, 0.22, 0.78];
    const fy = [0.3, 0.3, 0.7, 0.7];
    const pairOf: Array<0 | 1> = [0, 1, 1, 0];
    return fx
        .map((x, i) => ({
            x: (x as number) * ARENA_WIDTH,
            y: (fy[i] as number) * ARENA_HEIGHT,
            pair: pairOf[i] as 0 | 1,
        }))
        .sort((p, q) => p.x - q.x || p.y - q.y);
}

/** One drawn candidate plus its center mirror, both statically legal and gap-clear of `placed`. */
function tryPadPair(
    c: { x: number; y: number },
    obstacles: ArenaObstacle[],
    turrets: TurretSpot[],
    placed: PadSpot[],
): PadSpot[] | null {
    const m = mirrorPadSpot(c.x, c.y);
    if (Math.hypot(c.x - m.x, c.y - m.y) < PAD_MIN_GAP) return null;
    if (!padSpotStaticOk(c.x, c.y, obstacles, turrets) || !padSpotStaticOk(m.x, m.y, obstacles, turrets)) return null;
    const pair = (placed.length === 0 ? 0 : 1) as 0 | 1;
    for (const s of placed) {
        if (Math.hypot(c.x - s.x, c.y - s.y) < PAD_MIN_GAP) return null;
        if (Math.hypot(m.x - s.x, m.y - s.y) < PAD_MIN_GAP) return null;
    }
    return [
        { ...c, pair },
        { ...m, pair },
    ];
}

/**
 * Covering pair solver for crowded asymmetric terrain. Sequential draws
 * let a stuck first pick poison the whole layout: big slabs plus turret
 * discs leave few pockets, so the second pair threads almost nowhere after
 * an easy first pick. Instead this enumerates the 8px contest lattice in a
 * seeded shuffle order, keeps the statically legal mirror-pairs (self-gap
 * plus turret/barrier clearance), and returns the first pair-1 candidate
 * that leaves room for a pair 2 — backtracking over pair-1 picks instead
 * of gambling on one. Complete over the lattice: a fitting configuration
 * is found whenever one exists (the pair-1 scan is capped high enough that
 * only provably cramped seeds fall through). Returns null when nothing
 * fits, so the caller deals the legacy fallback. Pure function of
 * (seed, obstacles, turrets).
 */
function samplePadPairsCovering(seed: number, obstacles: ArenaObstacle[], turrets: TurretSpot[]): PadSpot[] | null {
    const rng = createRng((seed ^ PAD_SALT) >>> 0);
    const nx = (PAD_BAND.x1 - PAD_BAND.x0) / 8 + 1;
    const ny = (PAD_BAND.y1 - PAD_BAND.y0) / 8 + 1;
    const cells: Array<{ x: number; y: number }> = [];
    for (let ix = 0; ix < nx; ix += 1) {
        for (let iy = 0; iy < ny; iy += 1) {
            cells.push({ x: PAD_BAND.x0 + ix * 8, y: PAD_BAND.y0 + iy * 8 });
        }
    }
    for (let i = cells.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = cells[i] as { x: number; y: number };
        cells[i] = cells[j] as { x: number; y: number };
        cells[j] = tmp;
    }
    const legal: Array<{ c: { x: number; y: number }; m: { x: number; y: number } }> = [];
    for (const c of cells) {
        const m = mirrorPadSpot(c.x, c.y);
        if (Math.hypot(c.x - m.x, c.y - m.y) < PAD_MIN_GAP) continue;
        if (!padSpotStaticOk(c.x, c.y, obstacles, turrets) || !padSpotStaticOk(m.x, m.y, obstacles, turrets)) continue;
        legal.push({ c, m });
    }
    const crossOk = (
        a: { c: { x: number; y: number }; m: { x: number; y: number } },
        b: { c: { x: number; y: number }; m: { x: number; y: number } },
    ): boolean =>
        Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y) >= PAD_MIN_GAP &&
        Math.hypot(a.c.x - b.m.x, a.c.y - b.m.y) >= PAD_MIN_GAP &&
        Math.hypot(a.m.x - b.c.x, a.m.y - b.c.y) >= PAD_MIN_GAP &&
        Math.hypot(a.m.x - b.m.x, a.m.y - b.m.y) >= PAD_MIN_GAP;
    const cap = Math.min(legal.length, 600);
    for (let i = 0; i < cap; i += 1) {
        const first = legal[i] as { c: { x: number; y: number }; m: { x: number; y: number } };
        for (let j = 0; j < legal.length; j += 1) {
            if (j === i) continue;
            const second = legal[j] as { c: { x: number; y: number }; m: { x: number; y: number } };
            if (!crossOk(first, second)) continue;
            return [
                { ...first.c, pair: 0 as const },
                { ...first.m, pair: 0 as const },
                { ...second.c, pair: 1 as const },
                { ...second.m, pair: 1 as const },
            ].sort((p, q) => p.x - q.x || p.y - q.y);
        }
    }
    return null;
}

/**
 * Deterministic pad spots for a match seed: 2 drawn lattice cells in the
 * contest band plus their center mirrors, sorted by (x, y) for canonical
 * order. Takes the live obstacle list (`blocks` barriers, empty on `open`)
 * so pads never land inside terrain. With explicit live turret spots (the
 * asymmetric arenas, which move turrets) pads additionally stay off those
 * structures via a covering lattice solver, so cramped terrain threads
 * instead of dealing the legacy fallback (whose x = 211 spots sit outside
 * the contest band). With turrets omitted the legacy sequential sampler
 * runs verbatim —
 * `open`/`blocks` layouts come out byte-for-byte identical, fallback seeds
 * included. Rejection exhausts to the legacy fixed fractions (still
 * symmetric, same kind scheme) — never random, never empty.
 */
export function padSpotsForSeed(seed: number, obstacles: ArenaObstacle[] = [], turrets?: TurretSpot[]): PadSpot[] {
    if (turrets !== undefined) {
        return samplePadPairsCovering(seed, obstacles, turrets) ?? legacyPadFallback();
    }
    const classic: TurretSpot[] = [
        { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT * 0.3 },
        { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT * 0.7 },
    ];
    const rng = createRng((seed ^ PAD_SALT) >>> 0);
    const nx = (PAD_BAND.x1 - PAD_BAND.x0) / 8 + 1;
    const ny = (PAD_BAND.y1 - PAD_BAND.y0) / 8 + 1;
    const draw = (): { x: number; y: number } => ({
        x: PAD_BAND.x0 + Math.floor(rng() * nx) * 8,
        y: PAD_BAND.y0 + Math.floor(rng() * ny) * 8,
    });
    // Sequential placement: each drawn spot plus its mirror must clear the
    // static checks and keep PAD_MIN_GAP from every already-placed spot
    // (including each spot against its own mirror, so center-hugging draws
    // fail fast and never poison the stream). Sequential retries beat joint
    // pair sampling on crowded `blocks` layouts, where two simultaneous
    // fits are rare but one-at-a-time fits are plentiful.
    const placed: PadSpot[] = [];
    for (let attempt = 0; attempt < 1000 && placed.length < PAD_COUNT; attempt += 1) {
        const c = draw();
        const fit = tryPadPair(c, obstacles, classic, placed);
        if (!fit) continue;
        placed.push(...fit);
    }
    if (placed.length === PAD_COUNT) {
        return placed.sort((p, q) => p.x - q.x || p.y - q.y);
    }
    // Rejection exhausted: the legacy fixed fractions are symmetric and
    // carry the same pair scheme — never random, never empty. Tests sweep
    // thousands of seeds to prove this path stays all but cold.
    return legacyPadFallback();
}

// Map turrets (T1): static structures on the arena center column, always on.
// Two turrets at fixed arena fractions (0.50 x by 0.30/0.70 y), starting
// DISABLED (neutral). Presence captures: a robot inside TURRET_CAPTURE_RADIUS
// pushes progress toward its team at 1/TURRET_CAPTURE_TICKS per tick; both
// teams present freezes progress; TURRET_DECAY_TICKS with no robot in radius
// starts decay of uncaptured progress back toward neutral. Owned turrets
// never decay: recapture is the counterplay. Captured turrets fire at the
// nearest enemy in TURRET_RANGE every TURRET_FIRE_INTERVAL ticks.
export const TURRET_CAPTURE_RADIUS = 100;
export const TURRET_CAPTURE_TICKS = 90;
export const TURRET_DECAY_TICKS = 300;
export const TURRET_RANGE = 260;
export const TURRET_FIRE_INTERVAL = 45;
export const TURRET_DAMAGE = 6;
