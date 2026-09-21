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

/**
 * Exhibition modifiers: toggleable rules twists, barred from stats.
 * `mirror` is lineup-level (both teams run identical robots); the sim reads
 * it only as an exhibition marker.
 */
export interface MatchModifiers {
    doubleDamage?: boolean;
    hardcoreFog?: boolean;
    mirror?: boolean;
}

/** Strict sanitize: only literal `true` survives. Key order is fixed. */
export function sanitizeModifiers(raw: unknown): MatchModifiers {
    if (typeof raw !== 'object' || raw === null) return {};
    const r = raw as Record<string, unknown>;
    const clean: MatchModifiers = {};
    if (r['doubleDamage'] === true) clean.doubleDamage = true;
    if (r['hardcoreFog'] === true) clean.hardcoreFog = true;
    if (r['mirror'] === true) clean.mirror = true;
    return clean;
}

/** True when any exhibition modifier is on (match is barred from stats). */
export function isExhibition(modifiers: MatchModifiers): boolean {
    return modifiers.doubleDamage === true || modifiers.hardcoreFog === true || modifiers.mirror === true;
}

/** Short HUD codes for the active modifiers, e.g. `['2X', 'FOG']`. */
export function modifierCodes(modifiers: MatchModifiers): string[] {
    const codes: string[] = [];
    if (modifiers.doubleDamage === true) codes.push('2X');
    if (modifiers.hardcoreFog === true) codes.push('FOG');
    if (modifiers.mirror === true) codes.push('MIR');
    return codes;
}

export const ARENA_WIDTH = 960;
export const ARENA_HEIGHT = 640;

/** Arena layouts: `open` is empty, `blocks` adds mirrored center blocks. */
export type ArenaId = 'open' | 'blocks';
export const ARENA_IDS: readonly ArenaId[] = ['open', 'blocks'];

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

// Powerup pads (P1): static map feature, always on. Positions are fixed
// arena fractions (mirror-symmetric); kinds cycle with a seed offset.
export const PAD_RADIUS = 26;
export const PAD_RESPAWN_TICKS = 900; // 15 s dark after a pickup
export const AMP_TICKS = 360; // 6 s of double bullet damage
export const OVERDRIVE_TICKS = 360; // 6 s of boosted move speed
export const REPAIR_HP = 60;
export const AMP_MULT = 2;
export const OVERDRIVE_MULT = 1.35;

// Map turrets (T1): static structures on the arena center column, always on.
// Two turrets at fixed arena fractions (0.50 x by 0.30/0.70 y), starting
// DISABLED (neutral). Presence captures: a robot inside TURRET_CAPTURE_RADIUS
// pushes progress toward its team at 1/TURRET_CAPTURE_TICKS per tick; both
// teams present freezes progress; TURRET_DECAY_TICKS with no robot in radius
// starts decay of uncaptured progress back toward neutral. Owned turrets
// never decay: recapture is the counterplay. Captured turrets fire at the
// nearest enemy in TURRET_RANGE every TURRET_FIRE_INTERVAL ticks.
export const TURRET_CAPTURE_RADIUS = 80;
export const TURRET_CAPTURE_TICKS = 180;
export const TURRET_DECAY_TICKS = 300;
export const TURRET_RANGE = 260;
export const TURRET_FIRE_INTERVAL = 45;
export const TURRET_DAMAGE = 6;
