// The RobotController contract: the ONLY surface robot code may use.
// Robots receive a SenseState each tick and return an Intent. They never
// touch engine internals, Phaser, or the DOM.

import type { Rand } from './rng';

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
    walls: WallSense;
    /** Deterministic random draw in [0, 1). Use this, never Math.random. */
    rand: Rand;
}

export interface Intent {
    /** -1 (full reverse) .. 1 (full throttle). Clamped by the engine. */
    throttle: number;
    /** -1 (hard left) .. 1 (hard right) chassis turn. Clamped by the engine. */
    turn: number;
    /** -1 (counter-clockwise) .. 1 (clockwise) tower rotation. Clamped. */
    towerTurn: number;
    /** Attempt to fire. Only fires when cooldown is 0. */
    fire: boolean;
}

export const IDLE_INTENT: Intent = { throttle: 0, turn: 0, towerTurn: 0, fire: false };

export interface RobotController {
    meta: RobotMeta;
    /** Called once when the robot spawns. Optional. */
    onSpawn?: (sense: SenseState) => void;
    /** Called every tick for living robots. Must be fast and deterministic. */
    update: (sense: SenseState) => Intent;
}

export type RobotFactory = () => RobotController;
