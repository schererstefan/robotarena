// Hunter: pursues the nearest foe and leads its shots, aiming where the
// target will be when the bullet arrives. The thinking player's bot.

import { ARENA_HEIGHT, ARENA_WIDTH } from '../sim/constants';
import type { SkillLoadout } from '../sim/skills';
import type { Intent, RobotController, RobotMeta, SensedRobot, SenseState } from '../sim/types';
import { aimed, aimTurret, leadAngle, manageCharge, steerTo, throttleFor } from './common';
import { castFocusVote, focusTarget } from './comms';
import type { Genome } from './genome';

export const meta: RobotMeta = {
    id: 'hunter',
    name: 'Hunter',
    author: 'RobotArena',
    version: '2.0.0',
    description: 'Pursues relentlessly and leads its shots. The thinking player bot.',
};

export const loadout: SkillLoadout = { charger: 2, marksman: 1, trigger: 2, plating: 1 };

export type TargetPolicy = 'first' | 'nearest' | 'weakest' | 'strongest';

/** Tunable knobs (genome §1.4 groups). Defaults = legacy behavior exactly. */
export interface HunterParams {
    steerGain: number;
    turretGain: number;
    aimTol: number;
    bankRangeFrac: number;
    closeRangeFrac: number;
    closeThrottle: number;
    scanTurn: number;
    targetPolicy: TargetPolicy;
}

export const HUNTER_DEFAULTS: HunterParams = {
    steerGain: 2.5,
    turretGain: 3,
    aimTol: 0.05,
    bankRangeFrac: 0.7,
    closeRangeFrac: 0.55,
    closeThrottle: 0.35,
    scanTurn: 0.9,
    targetPolicy: 'weakest',
};

const TARGET_POLICIES: ReadonlyArray<TargetPolicy> = ['first', 'nearest', 'weakest', 'strongest'];

/** Build hunter params from a validated genome (unknown keys fall to defaults). */
export function hunterParamsFromGenome(genome: Genome): HunterParams {
    const p = genome.params;
    const num = (key: string, fallback: number): number => (typeof p[key] === 'number' ? (p[key] as number) : fallback);
    const policy = p['target.policy'];
    return {
        steerGain: num('steer.gain', HUNTER_DEFAULTS.steerGain),
        turretGain: num('turret.gain', HUNTER_DEFAULTS.turretGain),
        aimTol: num('fire.aimTol', HUNTER_DEFAULTS.aimTol),
        bankRangeFrac: num('fire.bankRangeFrac', HUNTER_DEFAULTS.bankRangeFrac),
        closeRangeFrac: num('engage.closeRangeFrac', HUNTER_DEFAULTS.closeRangeFrac),
        closeThrottle: num('drive.closeThrottle', HUNTER_DEFAULTS.closeThrottle),
        scanTurn: num('search.scanTurn', HUNTER_DEFAULTS.scanTurn),
        targetPolicy:
            typeof policy === 'string' && (TARGET_POLICIES as ReadonlyArray<string>).includes(policy)
                ? (policy as TargetPolicy)
                : HUNTER_DEFAULTS.targetPolicy,
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

export function createWithParams(overrides?: Partial<HunterParams>): RobotController {
    const p: HunterParams = { ...HUNTER_DEFAULTS, ...overrides };
    // Prefer the weakest visible foe; fall back to midfield when blind.
    let lastX = ARENA_WIDTH / 2;
    let lastY = ARENA_HEIGHT / 2;

    function update(sense: SenseState): Intent {
        const self = sense.self;
        let foe = pickTarget(sense.foes, p.targetPolicy);
        // Team focus: a live teammate's vote overrides the policy — but only
        // onto a foe in our own cone. Votes steer, they never fire the gun.
        if (sense.inbox.length > 0 && sense.foes.length > 0) {
            const liveSenders = new Set(sense.allies.map((a) => a.id));
            liveSenders.add(self.id);
            const voted = focusTarget(sense.inbox, liveSenders, new Set(sense.foes.map((f) => f.id)));
            const votedFoe = voted !== null ? sense.foes.find((f) => f.id === voted) : undefined;
            if (votedFoe) foe = votedFoe;
        }
        if (foe) {
            lastX = foe.x;
            lastY = foe.y;
        }
        const goalX = foe ? foe.x : lastX;
        const goalY = foe ? foe.y : lastY;
        const goal = Math.atan2(goalY - self.y, goalX - self.x);

        let towerTurn = p.scanTurn; // scan while blind
        let fire = false;
        if (foe) {
            const shot = leadAngle(self.x, self.y, self.stats.bulletSpeed, foe);
            towerTurn = aimTurret(self.tower, shot, p.turretGain);
            // At long range, bank first and shoot charged; in close, snap-fire.
            const wantBank = foe.distance > self.stats.gunRange * p.bankRangeFrac && !self.charged;
            fire = foe.distance < self.stats.gunRange && aimed(self.tower, shot, p.aimTol) && !wantBank;
        }
        // Ease off the throttle in gun range so we don't ram past our target.
        const inRange = foe !== undefined && foe.distance < self.stats.gunRange * p.closeRangeFrac;
        // Bank charge while tracking (but never while closing at full speed).
        const tracking = foe !== undefined && foe.distance < self.stats.gunRange;
        const charge = tracking && !fire ? manageCharge(self.charged, fire) : false;
        return {
            throttle: inRange ? p.closeThrottle : throttleFor(self.heading, goal),
            turn: steerTo(self.heading, goal, p.steerGain),
            towerTurn,
            fire,
            charge,
            radio: foe ? castFocusVote(foe.id) : null,
        };
    }

    return { meta, loadout, update };
}

export function create(): RobotController {
    return createWithParams();
}
