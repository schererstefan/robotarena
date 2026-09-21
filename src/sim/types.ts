// The RobotController contract: the ONLY surface robot code may use.
// Robots receive a SenseState each tick and return an Intent. They never
// touch engine internals, Phaser, or the DOM.

import type { ArenaId, ArenaObstacle, MatchModifiers } from './constants';
import type { Rand } from './rng';
import type { RobotStats, SkillLoadout } from './skills';

export interface RobotMeta {
    id: string;
    name: string;
    author: string;
    version: string;
    description: string;
}

export interface SenseSelf {
    id: number;
    team: 0 | 1;
    x: number;
    y: number;
    /** Chassis facing, radians. 0 = +x (east), positive = clockwise (screen coords). */
    heading: number;
    /** Tower facing, radians, absolute (same convention as heading). */
    tower: number;
    /** Current signed speed along heading (units/second). */
    speed: number;
    health: number;
    /** Ticks until the gun can fire again. 0 means ready. */
    cooldown: number;
    /** Effective stats after your skill loadout. Read-only. */
    stats: RobotStats;
    /** Banked charge 0..1 (requires the charger skill, else always 0). */
    charge: number;
    /** True when a full charge is banked. */
    charged: boolean;
    /** Ticks until dash is ready again. 0 means ready. */
    dashCd: number;
    /** Ticks until EMP is ready again. 0 means ready. */
    empCd: number;
    /** True while an enemy EMP slows your drive. */
    slowed: boolean;
    /** Your sanitized skill loadout for this match. */
    loadout: SkillLoadout;
    /** Most recent damage taken this match (null when never hit). */
    lastDamage: DamageSite | null;
    /** Whisker raycast along your chassis heading. */
    blocked: BlockedSense;
}

/** Where your last damage came from. */
export interface DamageSite {
    /** Tick the hit landed. */
    tick: number;
    /** Damage dealt. */
    amount: number;
    /** Absolute bearing from you to the shooter. */
    bearing: number;
    /** Shooter's robot id. */
    fromId: number;
}

/** Whisker range-finder: distance from your chassis edge to the nearest wall or block along your heading. */
export interface BlockedSense {
    ahead: number;
}

export interface SensedRobot {
    id: number;
    team: 0 | 1;
    x: number;
    y: number;
    heading: number;
    speed: number;
    health: number;
    distance: number;
    /** Absolute bearing from you to them, radians (same convention as heading). */
    bearing: number;
}

/** Teammate, always known over the radio link: full kinematics plus tower, gun, charge, and public loadout. */
export interface SensedAlly extends SensedRobot {
    /** Absolute tower facing, radians. */
    tower: number;
    /** Ticks until the ally's gun can fire again. */
    cooldown: number;
    /** Banked charge 0..1. */
    charge: number;
    /** True when the ally has a full charge banked. */
    charged: boolean;
    /** The ally's sanitized skill loadout (public). */
    loadout: SkillLoadout;
}

export interface WallSense {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

/** Per-tick event kinds. `fromId` names the other robot involved, when any. */
export type SenseEventKind =
    | 'hit-by'
    | 'kill'
    | 'ally-down'
    | 'foe-down'
    | 'sudden-death-pulse'
    | 'wall-bump'
    | 'ram'
    | 'pickup';

export interface SenseEvent {
    /** Tick the event happened (the step just completed). */
    tick: number;
    kind: SenseEventKind;
    /** Damage, for `hit-by` and `sudden-death-pulse`. */
    amount?: number;
    /** Absolute bearing from you to the shooter, for `hit-by`. */
    bearing?: number;
    /** Other robot: shooter (`hit-by`), victim (`kill`, `*-down`), bumper (`ram`). */
    fromId?: number;
    /** Pad kind collected, for `pickup`. */
    pad?: SensePadKind;
}

/** Powerup pad kind: `amp` (2x bullet damage), `repair` (+HP), `overdrive` (+move speed). */
export type SensePadKind = 'amp' | 'repair' | 'overdrive';

/** One static powerup pad: public map knowledge, reported to every robot. */
export interface SensePad {
    x: number;
    y: number;
    kind: SensePadKind;
    /** False while the pad is dark (cooldown after a pickup). */
    active: boolean;
    /** Ticks until reactivation (0 when active). */
    respawnIn: number;
}

/** An incoming (foe-team) bullet inside your sensor cone. */
export interface SensedBullet {
    x: number;
    y: number;
    vx: number;
    vy: number;
    distance: number;
    /** Absolute bearing from you to the bullet. */
    bearing: number;
    /** Closing speed in units/s (positive = approaching you). */
    closing: number;
    /** Damage this bullet will deal on a hit. */
    damage: number;
}

/** Engine-kept memory of one foe: refreshed on every cone sighting, stale otherwise. */
export interface TrackedFoe {
    id: number;
    x: number;
    y: number;
    heading: number;
    speed: number;
    /** Last tick this foe was inside your sensor cone. */
    lastSeenTick: number;
    /** True when this foe is also in `foes` right now. */
    seenNow: boolean;
}

/** Static arena layout (symmetric public state, same for both teams). */
export interface SenseArena {
    id: ArenaId;
    obstacles: ArenaObstacle[];
    centerX: number;
    centerY: number;
}

/** Sudden-death safe circle. */
export interface SenseZone {
    /** `normal` before the time cap, `shrinking` after. */
    phase: 'normal' | 'shrinking';
    /** Ticks until sudden death starts (0 once shrinking). */
    suddenDeathIn: number;
    circle: { x: number; y: number; r: number };
    /** Distance to safety (0 when inside). */
    distToSafety: number;
    /** True when strictly inside the safe circle. */
    inside: boolean;
}

/** Coarse team heat-map: 12x8 cells over the 960x640 arena (cell 80). Integer values, decayed each tick. */
export interface SenseGrid {
    w: number;
    h: number;
    cell: number;
    /** Per-cell foe presence stamped by your team's cone sightings. */
    foes: number[];
    /** Per-cell recent damage (bullet hits + sudden-death pulses). */
    danger: number[];
}

/** Match-level state. */
export interface SenseMatch {
    arena: ArenaId;
    modifiers: MatchModifiers;
    /** Absolute tick cap (defensive; the collapsed circle ends games first). */
    tickCap: number;
    /** Your kills this match. */
    killsYou: number;
    /** Your team's kills this match. */
    killsTeam: number;
    /** Living foes. */
    aliveFoes: number;
}

export interface SenseState {
    tick: number;
    /** Match time in seconds. */
    time: number;
    self: SenseSelf;
    /** Opponents inside your sensor cone this tick. Empty when none seen. */
    foes: SensedRobot[];
    /** Teammates are always known (radio link), with tower, gun, charge, and loadout. */
    allies: SensedAlly[];
    /**
     * Out-of-cone foe blips from the scout skill (empty without it).
     * Position-only: `id`, `team`, `x`, `y`, `distance`, and `bearing` are
     * valid, but `heading`, `speed`, and `health` are always 0. Covers foes
     * within 2x your sensor range that your tower cone does not currently
     * see (never duplicates `foes`). Sorted nearest first.
     */
    scout: SensedRobot[];
    /**
     * Foe sightings shared by allies, delivered 30 ticks late. Position-only:
     * `id`, `team`, `x`, `y`, `distance`, and `bearing` are valid, but
     * `heading`, `speed`, and `health` are always 0 (never shared). Sorted
     * nearest first. Never includes foes you currently see yourself, your
     * own sightings echoed back, dead foes, or (in 1v1, with no allies)
     * anything at all.
     */
    shared: SensedRobot[];
    walls: WallSense;
    /** Deterministic random draw in [0, 1). Use this, never Math.random. */
    rand: Rand;
    /**
     * What happened to you during the step just completed (empty at tick 0).
     * Current tick only, sorted kind-then-id, capped at 8. Optional: the
     * engine always provides it, but treat it as possibly absent.
     */
    events?: SenseEvent[];
    /**
     * Incoming foe-team bullets inside your sensor cone (range + tower FOV
     * gated), nearest first, capped at 12. Optional, engine-provided.
     */
    bullets?: SensedBullet[];
    /**
     * Engine-kept memory of foes you have seen: one entry per living foe
     * ever inside your cone, refreshed on every sighting. Sorted by id.
     * Optional, engine-provided.
     */
    tracks?: TrackedFoe[];
    /** Static arena layout (symmetric public state). Optional, engine-provided. */
    arena?: SenseArena;
    /** Sudden-death safe circle. Optional, engine-provided. */
    zone?: SenseZone;
    /** Your team's coarse heat-map (fresh copy each tick). Optional, engine-provided. */
    grid?: SenseGrid;
    /** Match-level state. Optional, engine-provided. */
    match?: SenseMatch;
    /**
     * All powerup pads in fixed pad order (public map knowledge, same for
     * every robot). Optional, engine-provided.
     */
    pickups?: SensePad[];
    /**
     * Teammates' radio messages from exactly COMMS_DELAY ticks ago, sorted
     * (sent, from), capped at COMMS_INBOX_MAX. Never your own echo, never
     * from the dead, never cross-team. Empty in 1v1.
     */
    inbox: InboxMessage[];
}

/** Robot/controller contract version. Robots may export `api?: number` (default 1). */
export const ROBOT_API_VERSION = 1;

export interface Intent {
    /** -1 (full reverse) .. 1 (full throttle). Clamped by the engine. Optional, defaults to 0. */
    throttle?: number;
    /** -1 (hard left) .. 1 (hard right) chassis turn. Clamped by the engine. Optional, defaults to 0. */
    turn?: number;
    /** -1 (counter-clockwise) .. 1 (clockwise) tower rotation. Clamped. Optional, defaults to 0. */
    towerTurn?: number;
    /** Attempt to fire. Only fires when cooldown is 0. Optional, defaults to false. */
    fire?: boolean;
    /**
     * Hold to bank charge (requires the charger skill). Charging slows drive
     * to 75% and decays when released. Firing consumes banked charge for
     * bonus damage: damage x (1 + charge x (mult - 1)).
     * Optional, defaults to false.
     */
    charge?: boolean;
    /**
     * Trigger the dash burst (2.5x top speed for 12 ticks). Only fires when
     * `dashCd` is 0; triggering starts the 8 s cooldown. Optional.
     */
    dash?: boolean;
    /**
     * Trigger the EMP pulse (foes within 220 units drive at 45% speed for
     * 3 s). Only fires when `empCd` is 0; triggering starts the 12 s
     * cooldown, even when no foe is in radius. Optional.
     */
    emp?: boolean;
    /**
     * Lateral drive: -1 (port) .. 1 (starboard) at STRAFE_FACTOR of top
     * speed. Normalized with throttle so combined drive never exceeds top
     * speed. Clamped by the engine. Optional, defaults to 0.
     */
    strafe?: number;
    /**
     * Drive-assist target in arena coordinates. Read only when
     * `moveMode` is 1. Clamped to the arena by the engine. Optional.
     */
    moveX?: number;
    moveY?: number;
    /**
     * 1 = the engine drives toward (`moveX`, `moveY`) via the shared steer
     * law (same gains and caps as manual drive), overriding `throttle` and
     * `turn`; 0 = manual. Anything else reads as 0. Optional, defaults to 0.
     */
    moveMode?: 0 | 1;
    /**
     * 0 = manual tower (`towerTurn`); 1 = track `aimTarget`'s best legal
     * position; 2 = track with lead (live cone sightings only, else falls
     * back to 1). Dead/ally/unknown ids fall back to manual. Optional.
     */
    aimMode?: 0 | 1 | 2;
    /** Robot id the turret assist tracks. Defaults to -1 (none). */
    aimTarget?: number;
    /**
     * True upgrades `aimMode` 1 to lead like 2 (no effect otherwise).
     * Optional, defaults to false.
     */
    aimLead?: boolean;
    /**
     * 0 = fire only when `fire` is true (current); 1 = hold-to-fire: also
     * fires whenever an aim assist is locked and the tower bears, even with
     * `fire` false. Same cooldown gate either way. Optional, defaults to 0.
     */
    fireMode?: 0 | 1;
    /**
     * One team radio message this tick (delivered 6 ticks late via the
     * Phase 6 router). Unknown kinds are dropped by sanitize. Optional,
     * defaults to null.
     */
    radio?: OutboxMessage | null;
}

/** Team radio message kinds. */
export type CommsKind = 'ping' | 'contact' | 'claim' | 'slot' | 'focus' | 'ack';

export const COMMS_KINDS: readonly CommsKind[] = ['ping', 'contact', 'claim', 'slot', 'focus', 'ack'];

/** One radio message a robot may send per tick (team-scoped, delayed). */
export interface OutboxMessage {
    kind: CommsKind;
    x: number;
    y: number;
    /** Foe id the message is about (-1 = none). Liveness validated at send. */
    foe: number;
    role: number;
    slot: number;
    bid: number;
}

/** A delivered radio message: outbox content plus engine stamps. */
export interface InboxMessage extends OutboxMessage {
    /** Sender's robot id. */
    from: number;
    /** Tick the message was sent. */
    sent: number;
}

export const IDLE_INTENT: Required<Intent> = {
    throttle: 0, turn: 0, towerTurn: 0, fire: false, charge: false, dash: false, emp: false,
    strafe: 0, moveX: 0, moveY: 0, moveMode: 0, aimMode: 0, aimTarget: -1, aimLead: false, fireMode: 0,
    radio: null,
};

export interface RobotController {
    meta: RobotMeta;
    /** Contract version this controller targets. Defaults to ROBOT_API_VERSION. */
    api?: number;
    /** Default skill loadout suggestion. Sanitized and budget-capped. */
    loadout?: SkillLoadout;
    /** Called once when the robot spawns. Optional. */
    onSpawn?: (sense: SenseState) => void;
    /** Called every tick for living robots. Must be fast and deterministic. */
    update: (sense: SenseState) => Intent;
}

export type RobotFactory = () => RobotController;
