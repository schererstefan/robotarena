// Shared, identical performance constants for every robot.
// Fairness rule: robot code may read these but the engine is the only
// writer of state, and all intents are clamped to these limits.

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
 * Obstacle rects per arena. The blocks layout mirrors every rect through the
 * arena center (480, 320) so neither team gains cover or a shorter path.
 * All blocks sit clear of the spawn columns (x = 130 / 830).
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

export const ROBOT_RADIUS = 14;
export const START_HEALTH = 100;

// Chassis base values (same for all robots; skills modify per loadout).
export const MAX_SPEED = 150; // units per second at full throttle
export const REVERSE_FACTOR = 0.6; // reverse is slower than forward
export const ACCEL = 340; // units per second^2 toward target speed
export const TURN_RATE = 2.7; // radians per second at full turn input

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
