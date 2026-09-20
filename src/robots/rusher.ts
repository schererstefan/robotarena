// Rusher: charges the nearest visible foe, guns blazing. When blind, it
// sweeps its tower while driving to the last known contact (or midfield).

import { ARENA_HEIGHT, ARENA_WIDTH } from '../sim/constants';
import { clamp } from '../sim/math';
import type { SkillLoadout } from '../sim/skills';
import type { Intent, RobotController, RobotMeta, SenseState } from '../sim/types';
import { pickTarget, type BrainTargetPolicy } from './brain';
import { aimed, aimTurret, steerTo, throttleFor } from './common';
import type { Genome } from './genome';

export const meta: RobotMeta = {
    id: 'rusher',
    name: 'Rusher',
    author: 'RobotArena',
    version: '2.0.0',
    description: 'Charges the nearest foe head-on. Simple, fast, and rude.',
};

export const loadout: SkillLoadout = { overdrive: 3, plating: 2, trigger: 1 };

/** Tunable knobs (genome §1.4 groups). Defaults = legacy behavior exactly. */
export interface RusherParams {
    steerGain: number;
    turretGain: number;
    aimTol: number;
    weaveRange: number;
    weaveAmp: number;
    weavePeriod: number;
    scanRate: number;
    targetPolicy: BrainTargetPolicy;
}

export const RUSHER_DEFAULTS: RusherParams = {
    steerGain: 2.5,
    turretGain: 3,
    aimTol: 0.07,
    weaveRange: 200,
    weaveAmp: 0.5,
    weavePeriod: 18,
    scanRate: 2.4,
    targetPolicy: 'first',
};

const TARGET_POLICIES: ReadonlyArray<BrainTargetPolicy> = ['first', 'nearest', 'weakest', 'strongest'];

/** Build rusher params from a validated genome (unknown keys fall to defaults). */
export function rusherParamsFromGenome(genome: Genome): RusherParams {
    const p = genome.params;
    const num = (key: string, fallback: number): number => (typeof p[key] === 'number' ? (p[key] as number) : fallback);
    const policy = p['target.policy'];
    return {
        steerGain: num('steer.gain', RUSHER_DEFAULTS.steerGain),
        turretGain: num('turret.gain', RUSHER_DEFAULTS.turretGain),
        aimTol: num('fire.aimTol', RUSHER_DEFAULTS.aimTol),
        weaveRange: num('engage.weaveRange', RUSHER_DEFAULTS.weaveRange),
        weaveAmp: num('weave.amp', RUSHER_DEFAULTS.weaveAmp),
        weavePeriod: num('weave.period', RUSHER_DEFAULTS.weavePeriod),
        scanRate: num('search.scanRate', RUSHER_DEFAULTS.scanRate),
        targetPolicy:
            typeof policy === 'string' && (TARGET_POLICIES as ReadonlyArray<string>).includes(policy)
                ? (policy as BrainTargetPolicy)
                : RUSHER_DEFAULTS.targetPolicy,
    };
}

export function createWithParams(overrides?: Partial<RusherParams>): RobotController {
    const p: RusherParams = { ...RUSHER_DEFAULTS, ...overrides };
    let lastX = ARENA_WIDTH / 2;
    let lastY = ARENA_HEIGHT / 2;

    function update(sense: SenseState): Intent {
        const self = sense.self;
        const foe = pickTarget(sense.foes, p.targetPolicy);
        if (foe) {
            lastX = foe.x;
            lastY = foe.y;
        }
        const goalX = foe ? foe.x : lastX;
        const goalY = foe ? foe.y : lastY;
        const baseAngle = Math.atan2(goalY - self.y, goalX - self.x);
        // Weave while closing so strafers and turrets can't lead us easily.
        const closing = foe !== undefined && foe.distance > p.weaveRange;
        const goalAngle = closing ? baseAngle + Math.sin(sense.tick / p.weavePeriod) * p.weaveAmp : baseAngle;
        const fire =
            foe !== undefined &&
            foe.distance < self.stats.gunRange &&
            aimed(self.tower, foe.bearing, p.aimTol);
        return {
            throttle: throttleFor(self.heading, goalAngle),
            turn: steerTo(self.heading, goalAngle, p.steerGain),
            towerTurn: foe ? aimTurret(self.tower, foe.bearing, p.turretGain) : clamp(p.scanRate / self.stats.towerRate, -1, 1),
            fire,
            charge: false,
        };
    }

    return { meta, loadout, update };
}

export function create(): RobotController {
    return createWithParams();
}
