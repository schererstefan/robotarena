// Brawler: shrugs off hits with heavy plating and walks the gun into
// knife-fight range. Runs the adaptive brain (engage / retreat / kite /
// flank / focus / roam) with brawler execution on top: weave on approach,
// clinch drive-through, dash down the lane, EMP in the clinch. The
// pre-brain logic stays available as createLegacyWithParams for the
// regression gate and the frozen hillclimb champion.

import { ARENA_HEIGHT, ARENA_WIDTH, EMP_RADIUS } from '../sim/constants';
import { angleDiff, clamp } from '../sim/math';
import type { SkillLoadout } from '../sim/skills';
import type { Intent, RobotController, RobotMeta, SenseState } from '../sim/types';
import { BRAIN_PRESETS, createBrain, pickTarget, type BrainParams, type BrainTargetPolicy } from './brain';
import { aimed, aimTurret, createUtilityMemory, steerTo, throttleFor, utilityDrive, type UtilityMemory } from './common';
import { castFocusVote } from './comms';
import type { Genome } from './genome';

export const meta: RobotMeta = {
    id: 'brawler',
    name: 'Brawler',
    author: 'RobotArena',
    version: '2.0.0',
    description: 'Adaptive bruiser: brain modes with weave, clinch, dash, and EMP.',
};

export const loadout: SkillLoadout = { overdrive: 1, gyro: 1, trigger: 2, plating: 2 };

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
    /** Brain mode utilities (brain.* genome group); absent = preset defaults. */
    brain?: Partial<BrainParams>;
    /** Powerup/turret/hazard awareness. Absent = off (frozen checkpoints
     * and genome builds keep exact behavior); the active `create()` opts in. */
    utility?: boolean;
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
    // Shipped behavior includes utility sight (see hunter.ts).
    utility: true,
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
        utility: true,
        targetPolicy:
            typeof policy === 'string' && (TARGET_POLICIES as ReadonlyArray<string>).includes(policy)
                ? (policy as BrainTargetPolicy)
                : BRAWLER_DEFAULTS.targetPolicy,
        brain: {
            // Retuned (preset retreat 0.2 / kite 140 / flank 350): measured
            // sign-test optimum, see createWithParams.
            retreatHp: num('brain.retreatHp', 0.3),
            kiteRange: num('brain.kiteRange', 0),
            flankRange: num('brain.flankRange', 0),
            stayBonus: num('brain.stayBonus', 0.15),
            aggression: num('brain.aggression', 1.3),
            focusBonus: num('brain.focusBonus', 0.3),
            orbitDir: p['brain.orbitDir'] === -1 ? -1 : 1,
        },
    };
}

/** Pre-brain brawler, frozen: weave, clinch, dash, EMP, no other modes. */
export function createLegacyWithParams(overrides?: Partial<BrawlerParams>): RobotController {
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

/**
 * Brain brawler: the mode scorer drives and aims (with target lead the
 * legacy never had); brawler execution rides on top while fighting
 * (engage/focus/flank). Retreat stays pure brain — no weave or clinch
 * fighting the escape. Bank/close knobs come from the preset (brawler
 * has no such genome group); everything else passes through.
 *
 * Retuned off the preset on measured sign-test data (legacy is the
 * incumbent on identical CRN pools, 32 seeds each): the preset passes 1
 * of 3 seeds (60.0/57.5/59.0%) and surrenders the legacy hunter sweep.
 * Spacing off (kite 140 / flank 350 -> 0/0, turret-preset precedent):
 * a knife-fighter wins the clinch; backing off or orbiting donates
 * free trades. Bank discipline off (0.7 -> 1.0): brawler runs no
 * charger, so holding fire past 70% range waits on a bank that never
 * comes (+8pp alone). Retreat up (0.2 -> 0.3): a fighting retreat at
 * 30% beats standing ground to the death (+8pp). Final: 71-76% across
 * 5 seeds (3 search + 2 held-out). Explicit `brain` overrides still
 * win, so a future tune can move any of these.
 */
export function createWithParams(overrides?: Partial<BrawlerParams>): RobotController {
    const p: BrawlerParams = { ...BRAWLER_DEFAULTS, ...overrides };
    // Frozen PARAMS objects (pre-utility hillclimb champions) predate the
    // flag and must behave exactly as tuned: only callers that declare
    // `utility` opt in. DEFAULTS declare shipped behavior.
    if (overrides !== undefined && overrides !== null && !('utility' in overrides)) p.utility = false;
    const preset = BRAIN_PRESETS['brawler'] as BrainParams;
    const brain = createBrain({
        steerGain: p.steerGain,
        turretGain: p.turretGain,
        aimTol: p.aimTol,
        bankRangeFrac: 1,
        closeRangeFrac: preset.closeRangeFrac,
        closeThrottle: preset.closeThrottle,
        scanTurn: p.scanTurn,
        targetPolicy: p.targetPolicy,
        retreatHp: 0.3,
        kiteRange: 0,
        flankRange: 0,
        stayBonus: preset.stayBonus,
        aggression: preset.aggression,
        focusBonus: preset.focusBonus,
        orbitDir: preset.orbitDir,
        ...(p.brain ?? {}),
    });
    const util: UtilityMemory | null = p.utility === true ? createUtilityMemory() : null;

    function update(sense: SenseState): Intent {
        const self = sense.self;
        const out = brain.update(sense);
        const foe = pickTarget(sense.foes, p.targetPolicy);
        const intent: Intent = { ...out.intent };
        const fighting = out.mode === 'engage' || out.mode === 'focus' || out.mode === 'flank';
        if (foe !== undefined) {
            // Heavy weave while closing: a slow target that will not jink dies.
            if (fighting && foe.distance > p.weaveRange) {
                intent.turn = clamp((intent.turn ?? 0) + (Math.sin(sense.tick / p.weavePeriod) * p.weaveAmp), -1, 1);
            }
            // In the clinch, keep driving through the foe: ramming breaks aim.
            if (fighting && foe.distance < p.clinchRange) {
                intent.throttle = p.clinchThrottle;
            }
            // Dash down the lane to start the fight on our terms; EMP in the
            // clinch so the foe can't walk out of it (and to slow pursuers
            // while retreating).
            const goalAngle = Math.atan2(foe.y - self.y, foe.x - self.x);
            const facing = Math.abs(angleDiff(self.heading, goalAngle)) < p.faceTol;
            intent.dash = fighting && self.dashCd <= 0 && facing && foe.distance > p.dashMinRange && foe.distance < p.dashMaxRange;
            intent.emp = self.empCd <= 0 && foe.distance < EMP_RADIUS;
        } else {
            intent.dash = false;
            intent.emp = false;
        }
        intent.radio = out.targetId !== null ? castFocusVote(out.targetId) : null;
        return util !== null ? utilityDrive(sense, intent, util) : intent;
    }

    return { meta, loadout, update };
}

export function create(): RobotController {
    return createWithParams({ utility: true });
}
