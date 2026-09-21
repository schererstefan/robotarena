// Rusher: charges the nearest visible foe, guns blazing. Runs the
// adaptive brain (engage / retreat / kite / flank / focus / roam) on its
// near-hunter aggressive preset; the pre-brain logic stays available as
// createLegacyWithParams for the regression gate and the frozen hillclimb
// champion.

import { ARENA_HEIGHT, ARENA_WIDTH, TOWER_RATE } from '../sim/constants';
import { clamp } from '../sim/math';
import type { SkillLoadout } from '../sim/skills';
import type { Intent, RobotController, RobotMeta, SenseState } from '../sim/types';
import { BRAIN_PRESETS, createBrain, pickTarget, type BrainParams, type BrainTargetPolicy } from './brain';
import { aimed, aimTurret, createUtilityMemory, steerTo, throttleFor, utilityDrive, type UtilityMemory } from './common';
import { castFocusVote } from './comms';
import type { Genome } from './genome';

export const meta: RobotMeta = {
    id: 'rusher',
    name: 'Rusher',
    author: 'RobotArena',
    version: '3.0.0',
    description: 'Adaptive rusher: charges, kites, flanks, and focuses with its team.',
};

export const loadout: SkillLoadout = { overdrive: 1, longscan: 1, trigger: 2, plating: 2 };

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
    /** Brain mode utilities (brain.* genome group); absent = preset defaults. */
    brain?: Partial<BrainParams>;
    /** Powerup/turret/hazard awareness. Absent = off (frozen checkpoints
     * and genome builds keep exact behavior); the active `create()` opts in. */
    utility?: boolean;
}

export const RUSHER_DEFAULTS: RusherParams = {
    steerGain: 2.5,
    turretGain: 3,
    aimTol: 0.11,
    weaveRange: 200,
    weaveAmp: 0.5,
    weavePeriod: 18,
    scanRate: 2.4,
    targetPolicy: 'first',
    // Shipped behavior includes utility sight (see hunter.ts).
    utility: true,
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
        utility: true,
        targetPolicy:
            typeof policy === 'string' && (TARGET_POLICIES as ReadonlyArray<string>).includes(policy)
                ? (policy as BrainTargetPolicy)
                : RUSHER_DEFAULTS.targetPolicy,
        brain: {
            retreatHp: num('brain.retreatHp', 0.15),
            kiteRange: num('brain.kiteRange', 120),
            flankRange: num('brain.flankRange', 350),
            stayBonus: num('brain.stayBonus', 0.15),
            aggression: num('brain.aggression', 1.4),
            focusBonus: num('brain.focusBonus', 0.3),
            orbitDir: p['brain.orbitDir'] === -1 ? -1 : 1,
        },
    };
}

/** Pre-brain rusher, frozen: charge the foe, weave while closing. */
export function createLegacyWithParams(overrides?: Partial<RusherParams>): RobotController {
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

/**
 * Brain rusher: the same execution, steered by the 6-mode scorer.
 * Bank/close knobs come from the preset (rusher has no such genome
 * group); scanRate maps onto the brain's scanTurn so the knob stays
 * live; everything else passes through.
 */
export function createWithParams(overrides?: Partial<RusherParams>): RobotController {
    const p: RusherParams = { ...RUSHER_DEFAULTS, ...overrides };
    // Frozen PARAMS objects (pre-utility hillclimb champions) predate the
    // flag and must behave exactly as tuned: only callers that declare
    // `utility` opt in. DEFAULTS declare shipped behavior.
    if (overrides !== undefined && overrides !== null && !('utility' in overrides)) p.utility = false;
    const preset = BRAIN_PRESETS['rusher'] as BrainParams;
    const brain = createBrain({
        steerGain: p.steerGain,
        turretGain: p.turretGain,
        aimTol: p.aimTol,
        bankRangeFrac: preset.bankRangeFrac,
        closeRangeFrac: preset.closeRangeFrac,
        closeThrottle: preset.closeThrottle,
        scanTurn: clamp(p.scanRate / TOWER_RATE, -1, 1),
        targetPolicy: p.targetPolicy,
        retreatHp: preset.retreatHp,
        kiteRange: preset.kiteRange,
        flankRange: preset.flankRange,
        stayBonus: preset.stayBonus,
        aggression: preset.aggression,
        focusBonus: preset.focusBonus,
        orbitDir: preset.orbitDir,
        ...(p.brain ?? {}),
    });

    const util: UtilityMemory | null = p.utility === true ? createUtilityMemory() : null;

    function update(sense: SenseState): Intent {
        const out = brain.update(sense);
        const sending: Intent = { ...out.intent, radio: out.targetId !== null ? castFocusVote(out.targetId) : null };
        return util !== null ? utilityDrive(sense, sending, util) : sending;
    }

    return { meta, loadout, update };
}

export function create(): RobotController {
    return createWithParams({ utility: true });
}
