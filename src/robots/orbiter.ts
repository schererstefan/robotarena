// Orbiter: keeps its distance and circle-strafes around its target,
// holding a mid-range orbit where its gun still reaches.

import { ARENA_HEIGHT, ARENA_WIDTH } from '../sim/constants';
import { angleDiff, TAU } from '../sim/math';
import type { SkillLoadout } from '../sim/skills';
import type { Intent, RobotController, RobotMeta, SensedRobot, SenseState } from '../sim/types';
import { aimed, aimTurret, createUtilityMemory, steerTo, utilityDrive, type UtilityMemory } from './common';
import type { Genome } from './genome';

export const meta: RobotMeta = {
    id: 'orbiter',
    name: 'Orbiter',
    author: 'RobotArena',
    version: '2.0.0',
    description: 'Circle-strafes at mid range. Hard to hit, always annoying.',
};

export const loadout: SkillLoadout = { overdrive: 2, servos: 1, trigger: 2, plating: 1 };

export type TargetPolicy = 'first' | 'nearest' | 'weakest' | 'strongest';

/** Tunable knobs (genome §1.4 groups). Defaults = legacy behavior exactly. */
export interface OrbiterParams {
    orbitRange: number;
    orbitDir: 1 | -1;
    orbitBand: number;
    alignTol: number;
    orbitThrottle: number;
    turnThrottle: number;
    steerGain: number;
    turretGain: number;
    aimTol: number;
    scanTurn: number;
    targetPolicy: TargetPolicy;
    /** Powerup/turret/hazard awareness. Absent = off (frozen checkpoints
     * and genome builds keep exact behavior); the active `create()` opts in. */
    utility?: boolean;
}

export const ORBITER_DEFAULTS: OrbiterParams = {
    orbitRange: 330,
    orbitDir: 1,
    orbitBand: 60,
    alignTol: 1.2,
    orbitThrottle: 0.9,
    turnThrottle: 0.3,
    steerGain: 2.5,
    turretGain: 4,
    aimTol: 0.07,
    scanTurn: 0.8,
    targetPolicy: 'first',
    // Shipped behavior includes utility sight (see hunter.ts).
    utility: true,
};

const TARGET_POLICIES: ReadonlyArray<TargetPolicy> = ['first', 'nearest', 'weakest', 'strongest'];

/** Build orbiter params from a validated genome (unknown keys fall to defaults). */
export function orbiterParamsFromGenome(genome: Genome): OrbiterParams {
    const p = genome.params;
    const num = (key: string, fallback: number): number => (typeof p[key] === 'number' ? (p[key] as number) : fallback);
    const policy = p['target.policy'];
    return {
        orbitRange: num('orbit.range', ORBITER_DEFAULTS.orbitRange),
        orbitDir: p['orbit.dir'] === -1 ? -1 : 1,
        orbitBand: num('orbit.band', ORBITER_DEFAULTS.orbitBand),
        alignTol: num('drive.alignTol', ORBITER_DEFAULTS.alignTol),
        orbitThrottle: num('drive.orbitThrottle', ORBITER_DEFAULTS.orbitThrottle),
        turnThrottle: num('drive.turnThrottle', ORBITER_DEFAULTS.turnThrottle),
        steerGain: num('steer.gain', ORBITER_DEFAULTS.steerGain),
        turretGain: num('turret.gain', ORBITER_DEFAULTS.turretGain),
        aimTol: num('fire.aimTol', ORBITER_DEFAULTS.aimTol),
        scanTurn: num('search.scanTurn', ORBITER_DEFAULTS.scanTurn),
        targetPolicy:
            typeof policy === 'string' && (TARGET_POLICIES as ReadonlyArray<string>).includes(policy)
                ? (policy as TargetPolicy)
                : ORBITER_DEFAULTS.targetPolicy,
        utility: true,
    };
}

function pickTarget(foes: SensedRobot[], policy: TargetPolicy): SensedRobot | undefined {
    if (policy === 'first') return foes[0];
    let best: SensedRobot | undefined;
    for (const candidate of foes) {
        if (!best) {
            best = candidate;
            continue;
        }
        if (policy === 'nearest' && candidate.distance < best.distance) best = candidate;
        else if (policy === 'weakest' && candidate.health < best.health) best = candidate;
        else if (policy === 'strongest' && candidate.health > best.health) best = candidate;
    }
    return best;
}

export function createWithParams(overrides?: Partial<OrbiterParams>): RobotController {
    const p: OrbiterParams = { ...ORBITER_DEFAULTS, ...overrides };
    // Frozen PARAMS objects (pre-utility hillclimb champions) predate the
    // flag and must behave exactly as tuned: only callers that declare
    // `utility` opt in. DEFAULTS declare shipped behavior.
    if (overrides !== undefined && overrides !== null && !('utility' in overrides)) p.utility = false;
    const util: UtilityMemory | null = p.utility === true ? createUtilityMemory() : null;
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
        const toGoal = Math.atan2(goalY - self.y, goalX - self.x);
        const gap = foe ? foe.distance - p.orbitRange : 0;

        // Drive tangentially (orbit) plus a radial correction toward orbitRange.
        const tangent = toGoal + (p.orbitDir * Math.PI) / 2;
        let drive = tangent;
        if (gap < -p.orbitBand) drive = toGoal + Math.PI; // too close: back away
        else if (gap > p.orbitBand) drive = toGoal; // too far: close in
        drive = ((drive % TAU) + TAU) % TAU;

        const turn = steerTo(self.heading, drive, p.steerGain);
        const facing = Math.abs(angleDiff(self.heading, drive)) < p.alignTol;
        const throttle = facing ? p.orbitThrottle : p.turnThrottle;
        const towerTurn = foe ? aimTurret(self.tower, foe.bearing, p.turretGain) : p.scanTurn;
        const fire = foe !== undefined && foe.distance < self.stats.gunRange && aimed(self.tower, foe.bearing, p.aimTol);
        const sending = { throttle, turn, towerTurn, fire, charge: false };
        return util !== null ? utilityDrive(sense, sending, util) : sending;
    }

    return { meta, loadout, update };
}

export function create(): RobotController {
    return createWithParams({ utility: true });
}
