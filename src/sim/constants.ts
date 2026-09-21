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

// Asteroid strikes (complexity/W1): seed-scheduled world hazard, ON by
// default (`noHazards` opts out). Each strike is a mirrored pair across the
// center column (x=480), targeted at one living robot's announce-time
// position plus its mirror — the spawn-column x=130/830 precedent. Strikes
// only run pre-sudden-death; the collapse owns the endgame.
// Balance (tuned against 1v1 medians ~390 ticks): the first pair lands ~5 s
// in, then one pair per ~12.5 s, so short duels usually see 0-1 pairs and
// long/team games see several. 25 damage (~2 bullets) punishes campers
// without deciding healthy duels; 1.5 s telegraph vs 70 px radius lets any
// moving robot escape (192 px reachable in the window from a standstill).
/** First strike announcement tick. */
export const HAZ_FIRST_TICK = 300;
/** Ticks between strike-pair announcements. */
export const HAZ_COOLDOWN_TICKS = 750;
/** Telegraph lead: ticks from announcement to impact. */
export const HAZ_TELEGRAPH_TICKS = 90;
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
 * All blocks sit clear of the spawn zones (x = 130±40 / 830±40): the nearest
 * block face is 116px from the zone edge, minus the robot radius.
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
