// Wanderer: drifts between random waypoints and shoots at anything its
// sweeping tower happens to catch. Unpredictable by design.

import { ARENA_HEIGHT, ARENA_WIDTH, ROBOT_RADIUS } from '../sim/constants';
import { dist } from '../sim/math';
import type { SkillLoadout } from '../sim/skills';
import type { Intent, RobotController, RobotMeta, SenseState } from '../sim/types';
import { pickTarget, type BrainTargetPolicy } from './brain';
import { aimed, aimTurret, steerTo, throttleFor } from './common';
import type { Genome } from './genome';

export const meta: RobotMeta = {
    id: 'wanderer',
    name: 'Wanderer',
    author: 'RobotArena',
    version: '2.0.0',
    description: 'Roams on random waypoints and snaps shots at whatever it sees.',
};

export const loadout: SkillLoadout = { longscan: 2, wideband: 2, overdrive: 2 };

/** Tunable knobs (genome §1.4 groups). Defaults = legacy behavior exactly. */
export interface WandererParams {
    steerGain: number;
    turretGain: number;
    aimTol: number;
    waypointMargin: number;
    waypointArrive: number;
    wallDist: number;
    wallRetick: number;
    engageThrottle: number;
    scanTurn: number;
    targetPolicy: BrainTargetPolicy;
}

export const WANDERER_DEFAULTS: WandererParams = {
    steerGain: 2.5,
    turretGain: 3,
    aimTol: 0.07,
    waypointMargin: 60,
    waypointArrive: 50,
    wallDist: 70,
    wallRetick: 30,
    engageThrottle: 0.5,
    scanTurn: 1,
    targetPolicy: 'first',
};

const TARGET_POLICIES: ReadonlyArray<BrainTargetPolicy> = ['first', 'nearest', 'weakest', 'strongest'];

/** Build wanderer params from a validated genome (unknown keys fall to defaults). */
export function wandererParamsFromGenome(genome: Genome): WandererParams {
    const p = genome.params;
    const num = (key: string, fallback: number): number => (typeof p[key] === 'number' ? (p[key] as number) : fallback);
    const policy = p['target.policy'];
    return {
        steerGain: num('steer.gain', WANDERER_DEFAULTS.steerGain),
        turretGain: num('turret.gain', WANDERER_DEFAULTS.turretGain),
        aimTol: num('fire.aimTol', WANDERER_DEFAULTS.aimTol),
        waypointMargin: num('search.margin', WANDERER_DEFAULTS.waypointMargin),
        waypointArrive: num('search.arrive', WANDERER_DEFAULTS.waypointArrive),
        wallDist: num('search.wallDist', WANDERER_DEFAULTS.wallDist),
        wallRetick: num('search.wallRetick', WANDERER_DEFAULTS.wallRetick),
        engageThrottle: num('drive.engageThrottle', WANDERER_DEFAULTS.engageThrottle),
        scanTurn: num('search.scanTurn', WANDERER_DEFAULTS.scanTurn),
        targetPolicy:
            typeof policy === 'string' && (TARGET_POLICIES as ReadonlyArray<string>).includes(policy)
                ? (policy as BrainTargetPolicy)
                : WANDERER_DEFAULTS.targetPolicy,
    };
}

export function createWithParams(overrides?: Partial<WandererParams>): RobotController {
    const p: WandererParams = { ...WANDERER_DEFAULTS, ...overrides };
    let wx = ARENA_WIDTH / 2;
    let wy = ARENA_HEIGHT / 2;
    let picked = false;

    function pickWaypoint(sense: SenseState): void {
        const margin = ROBOT_RADIUS + p.waypointMargin;
        wx = margin + sense.rand() * (ARENA_WIDTH - margin * 2);
        wy = margin + sense.rand() * (ARENA_HEIGHT - margin * 2);
        picked = true;
    }

    function update(sense: SenseState): Intent {
        const self = sense.self;
        if (!picked) pickWaypoint(sense);
        if (dist(self.x, self.y, wx, wy) < p.waypointArrive) pickWaypoint(sense);
        // Near a wall and heading into it: pick somewhere else.
        const nearWall =
            self.x < p.wallDist || self.x > ARENA_WIDTH - p.wallDist || self.y < p.wallDist || self.y > ARENA_HEIGHT - p.wallDist;
        if (nearWall && sense.tick % p.wallRetick === 0) pickWaypoint(sense);

        const foe = pickTarget(sense.foes, p.targetPolicy);
        const goal = Math.atan2(wy - self.y, wx - self.x);
        const towerTurn = foe ? aimTurret(self.tower, foe.bearing, p.turretGain) : p.scanTurn; // full sweep
        const fire = foe !== undefined && foe.distance < self.stats.gunRange && aimed(self.tower, foe.bearing, p.aimTol);
        return {
            throttle: foe ? p.engageThrottle : throttleFor(self.heading, goal),
            turn: steerTo(self.heading, goal, p.steerGain),
            towerTurn,
            fire,
            charge: false,
        };
    }

    return { meta, loadout, update };
}

export function create(): RobotController {
    return createWithParams();
}
