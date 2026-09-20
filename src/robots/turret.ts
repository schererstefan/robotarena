// Turret: drives to a defensive anchor near its spawn, parks, and spins
// its tower for full-circle awareness. Leads its shots like a Hunter.

import { ARENA_HEIGHT, ARENA_WIDTH } from '../sim/constants';
import { dist } from '../sim/math';
import type { SkillLoadout } from '../sim/skills';
import type { Intent, RobotController, RobotMeta, SenseState } from '../sim/types';
import { pickTarget, type BrainTargetPolicy } from './brain';
import { aimed, aimTurret, leadAngle, steerTo } from './common';
import type { Genome } from './genome';

export const meta: RobotMeta = {
    id: 'turret',
    name: 'Turret',
    author: 'RobotArena',
    version: '2.0.0',
    description: 'Parks on defense with a spinning tower. Do not walk into its lane.',
};

export const loadout: SkillLoadout = { marksman: 1, trigger: 2, longscan: 2, servos: 1 };

/** Tunable knobs (genome §1.4 groups). Defaults = legacy behavior exactly. */
export interface TurretParams {
    anchorXNear: number;
    anchorXFar: number;
    anchorYNear: number;
    anchorYFar: number;
    anchorSettle: number;
    anchorLeave: number;
    anchorThrottle: number;
    driveGain: number;
    parkGain: number;
    scanTurn: number;
    aimTol: number;
    turretGain: number;
    targetPolicy: BrainTargetPolicy;
}

export const TURRET_DEFAULTS: TurretParams = {
    anchorXNear: 0.32,
    anchorXFar: 0.68,
    anchorYNear: 0.3,
    anchorYFar: 0.7,
    anchorSettle: 24,
    anchorLeave: 60,
    anchorThrottle: 0.8,
    driveGain: 2.5,
    parkGain: 1.5,
    scanTurn: 0.85,
    aimTol: 0.05,
    turretGain: 3,
    targetPolicy: 'first',
};

const TARGET_POLICIES: ReadonlyArray<BrainTargetPolicy> = ['first', 'nearest', 'weakest', 'strongest'];

/** Build turret params from a validated genome (unknown keys fall to defaults). */
export function turretParamsFromGenome(genome: Genome): TurretParams {
    const p = genome.params;
    const num = (key: string, fallback: number): number => (typeof p[key] === 'number' ? (p[key] as number) : fallback);
    const policy = p['target.policy'];
    return {
        anchorXNear: num('anchor.xNear', TURRET_DEFAULTS.anchorXNear),
        anchorXFar: num('anchor.xFar', TURRET_DEFAULTS.anchorXFar),
        anchorYNear: num('anchor.yNear', TURRET_DEFAULTS.anchorYNear),
        anchorYFar: num('anchor.yFar', TURRET_DEFAULTS.anchorYFar),
        anchorSettle: num('anchor.settle', TURRET_DEFAULTS.anchorSettle),
        anchorLeave: num('anchor.leave', TURRET_DEFAULTS.anchorLeave),
        anchorThrottle: num('drive.anchorThrottle', TURRET_DEFAULTS.anchorThrottle),
        driveGain: num('steer.driveGain', TURRET_DEFAULTS.driveGain),
        parkGain: num('steer.parkGain', TURRET_DEFAULTS.parkGain),
        scanTurn: num('search.scanTurn', TURRET_DEFAULTS.scanTurn),
        aimTol: num('fire.aimTol', TURRET_DEFAULTS.aimTol),
        turretGain: num('turret.gain', TURRET_DEFAULTS.turretGain),
        targetPolicy:
            typeof policy === 'string' && (TARGET_POLICIES as ReadonlyArray<string>).includes(policy)
                ? (policy as BrainTargetPolicy)
                : TURRET_DEFAULTS.targetPolicy,
    };
}

export function createWithParams(overrides?: Partial<TurretParams>): RobotController {
    const p: TurretParams = { ...TURRET_DEFAULTS, ...overrides };
    let anchorX = 0;
    let anchorY = 0;
    let anchored = false;

    function onSpawn(sense: SenseState): void {
        anchorX = sense.self.team === 0 ? ARENA_WIDTH * p.anchorXNear : ARENA_WIDTH * p.anchorXFar;
        anchorY = sense.self.y < ARENA_HEIGHT / 2 ? ARENA_HEIGHT * p.anchorYNear : ARENA_HEIGHT * p.anchorYFar;
    }

    function update(sense: SenseState): Intent {
        const self = sense.self;
        const foe = pickTarget(sense.foes, p.targetPolicy);
        const anchorDist = dist(self.x, self.y, anchorX, anchorY);
        if (anchorDist < p.anchorSettle) anchored = true;
        else if (anchorDist > p.anchorLeave) anchored = false; // shoved off: re-drive in

        let throttle = 0;
        let turn = 0;
        if (!anchored) {
            const goal = Math.atan2(anchorY - self.y, anchorX - self.x);
            throttle = p.anchorThrottle;
            turn = steerTo(self.heading, goal, p.driveGain);
        } else {
            // Face midfield while parked so the chassis is ready to reposition.
            const mid = Math.atan2(ARENA_HEIGHT / 2 - self.y, ARENA_WIDTH / 2 - self.x);
            turn = steerTo(self.heading, mid, p.parkGain);
        }

        let towerTurn = p.scanTurn; // continuous spin: full-circle awareness
        let fire = false;
        if (foe) {
            const shot = leadAngle(self.x, self.y, self.stats.bulletSpeed, foe);
            towerTurn = aimTurret(self.tower, shot, p.turretGain);
            fire = foe.distance < self.stats.gunRange && aimed(self.tower, shot, p.aimTol);
        }
        return { throttle, turn, towerTurn, fire, charge: false };
    }

    return { meta, loadout, onSpawn, update };
}

export function create(): RobotController {
    return createWithParams();
}
