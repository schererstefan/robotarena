// Brawler: shrugs off hits with heavy plating and walks the gun into
// knife-fight range. No finesse, no retreat, all forward pressure.

import { ARENA_HEIGHT, ARENA_WIDTH, EMP_RADIUS } from '../sim/constants';
import { angleDiff } from '../sim/math';
import type { SkillLoadout } from '../sim/skills';
import type { Intent, RobotController, RobotMeta, SenseState } from '../sim/types';
import { pickTarget, type BrainTargetPolicy } from './brain';
import { aimed, aimTurret, steerTo, throttleFor } from './common';
import type { Genome } from './genome';

export const meta: RobotMeta = {
    id: 'brawler',
    name: 'Brawler',
    author: 'RobotArena',
    version: '1.0.0',
    description: 'Plated bruiser that walks its gun into knife-fight range. All pressure.',
};

export const loadout: SkillLoadout = { plating: 2, overdrive: 2, trigger: 2 };

/** Tunable knobs (genome §1.4 groups). Defaults = legacy behavior exactly. */
export interface BrawlerParams {
    steerGain: number;
    turretGain: number;
    aimTol: number;
    weaveRange: number;
    weaveAmp: number;
    weavePeriod: number;
    clinchRange: number;
    clinchThrottle: number;
    faceTol: number;
    dashMinRange: number;
    dashMaxRange: number;
    scanTurn: number;
    targetPolicy: BrainTargetPolicy;
}

export const BRAWLER_DEFAULTS: BrawlerParams = {
    steerGain: 2.5,
    turretGain: 3,
    aimTol: 0.07,
    weaveRange: 160,
    weaveAmp: 0.45,
    weavePeriod: 14,
    clinchRange: 120,
    clinchThrottle: 1,
    faceTol: 0.5,
    dashMinRange: 200,
    dashMaxRange: 520,
    scanTurn: 0.9,
    targetPolicy: 'first',
};

const TARGET_POLICIES: ReadonlyArray<BrainTargetPolicy> = ['first', 'nearest', 'weakest', 'strongest'];

/** Build brawler params from a validated genome (unknown keys fall to defaults). */
export function brawlerParamsFromGenome(genome: Genome): BrawlerParams {
    const p = genome.params;
    const num = (key: string, fallback: number): number => (typeof p[key] === 'number' ? (p[key] as number) : fallback);
    const policy = p['target.policy'];
    return {
        steerGain: num('steer.gain', BRAWLER_DEFAULTS.steerGain),
        turretGain: num('turret.gain', BRAWLER_DEFAULTS.turretGain),
        aimTol: num('fire.aimTol', BRAWLER_DEFAULTS.aimTol),
        weaveRange: num('engage.weaveRange', BRAWLER_DEFAULTS.weaveRange),
        weaveAmp: num('weave.amp', BRAWLER_DEFAULTS.weaveAmp),
        weavePeriod: num('weave.period', BRAWLER_DEFAULTS.weavePeriod),
        clinchRange: num('engage.clinchRange', BRAWLER_DEFAULTS.clinchRange),
        clinchThrottle: num('drive.clinchThrottle', BRAWLER_DEFAULTS.clinchThrottle),
        faceTol: num('drive.faceTol', BRAWLER_DEFAULTS.faceTol),
        dashMinRange: num('dash.minRange', BRAWLER_DEFAULTS.dashMinRange),
        dashMaxRange: num('dash.maxRange', BRAWLER_DEFAULTS.dashMaxRange),
        scanTurn: num('search.scanTurn', BRAWLER_DEFAULTS.scanTurn),
        targetPolicy:
            typeof policy === 'string' && (TARGET_POLICIES as ReadonlyArray<string>).includes(policy)
                ? (policy as BrainTargetPolicy)
                : BRAWLER_DEFAULTS.targetPolicy,
    };
}

export function createWithParams(overrides?: Partial<BrawlerParams>): RobotController {
    const p: BrawlerParams = { ...BRAWLER_DEFAULTS, ...overrides };
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
        // Heavy weave while closing: a slow target that will not jink dies.
        const closing = foe !== undefined && foe.distance > p.weaveRange;
        const goalAngle = closing ? baseAngle + Math.sin(sense.tick / p.weavePeriod) * p.weaveAmp : baseAngle;
        // In the clinch, keep driving through the foe: ramming breaks aim.
        const clinch = foe !== undefined && foe.distance < p.clinchRange;
        const fire =
            foe !== undefined &&
            foe.distance < self.stats.gunRange &&
            aimed(self.tower, foe.bearing, p.aimTol);
        // Dash down the lane to start the fight on our terms; EMP in the
        // clinch so the foe can't walk out of it.
        const facing = Math.abs(angleDiff(self.heading, goalAngle)) < p.faceTol;
        const dash =
            foe !== undefined && self.dashCd <= 0 && facing && foe.distance > p.dashMinRange && foe.distance < p.dashMaxRange;
        const emp = foe !== undefined && self.empCd <= 0 && foe.distance < EMP_RADIUS;
        return {
            throttle: clinch ? p.clinchThrottle : throttleFor(self.heading, goalAngle),
            turn: steerTo(self.heading, goalAngle, p.steerGain),
            towerTurn: foe ? aimTurret(self.tower, foe.bearing, p.turretGain) : p.scanTurn,
            fire,
            charge: false,
            dash,
            emp,
        };
    }

    return { meta, loadout, update };
}

export function create(): RobotController {
    return createWithParams();
}
