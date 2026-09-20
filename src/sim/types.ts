// The RobotController contract: the ONLY surface robot code may use.
// Robots receive a SenseState each tick and return an Intent. They never
// touch engine internals, Phaser, or the DOM.

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

export interface WallSense {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

export interface SenseState {
    tick: number;
    /** Match time in seconds. */
    time: number;
    self: SenseSelf;
    /** Opponents inside your sensor cone this tick. Empty when none seen. */
    foes: SensedRobot[];
    /** Teammates are always known (radio link). */
    allies: SensedRobot[];
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
}

export const IDLE_INTENT: Required<Intent> = { throttle: 0, turn: 0, towerTurn: 0, fire: false, charge: false, dash: false, emp: false };

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
