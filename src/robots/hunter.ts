// Hunter: pursues its target and leads its shots, aiming where the target
// will be when the bullet arrives. Runs the adaptive brain (engage /
// retreat / kite / flank / focus / roam); the pre-brain logic stays
// available as createLegacyWithParams for the regression gate and the
// frozen hillclimb champion.

import { ARENA_HEIGHT, ARENA_WIDTH } from '../sim/constants';
import { clamp } from '../sim/math';
import type { SkillLoadout } from '../sim/skills';
import type { Intent, RobotController, RobotMeta, SenseState } from '../sim/types';
import { createBrain, pickTarget, type BrainParams } from './brain';
import { aimed, aimTurret, leadAngle, manageCharge, rayClearance, steerTo, throttleFor } from './common';
import { castFocusVote, focusTarget } from './comms';
import { createRoleTracker, roleGoal } from './roles';
import type { Genome } from './genome';
import { createOpponentModel, MODEL_DEFAULTS, type ModelParams } from './model';

export const meta: RobotMeta = {
    id: 'hunter',
    name: 'Hunter',
    author: 'RobotArena',
    version: '3.0.0',
    description: 'Adaptive hunter: pursues, kites, flanks, and focuses with its team.',
};

export const loadout: SkillLoadout = { overdrive: 2, trigger: 2, plating: 2 };

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
    /** Brain mode utilities (brain.* genome group); absent = preset defaults. */
    brain?: Partial<BrainParams>;
    /** Opponent-model counter-lead (model.* genome group); absent = model defaults. */
    model?: Partial<ModelParams>;
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
    model: { ...MODEL_DEFAULTS },
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
        brain: {
            retreatHp: num('brain.retreatHp', 0.3),
            kiteRange: num('brain.kiteRange', 200),
            flankRange: num('brain.flankRange', 350),
            stayBonus: num('brain.stayBonus', 0.15),
            aggression: num('brain.aggression', 1),
            focusBonus: num('brain.focusBonus', 0.3),
            orbitDir: p['brain.orbitDir'] === -1 ? -1 : 1,
        },
        model: {
            leadScale: num('model.leadScale', MODEL_DEFAULTS.leadScale),
            counterGain: num('model.counterGain', MODEL_DEFAULTS.counterGain),
            minConf: num('model.minConf', MODEL_DEFAULTS.minConf),
            aimTolBoost: num('model.aimTolBoost', MODEL_DEFAULTS.aimTolBoost),
        },
    };
}

/** Pre-brain hunter, frozen: pursue + focus votes, no other modes. */
export function createLegacyWithParams(overrides?: Partial<HunterParams>): RobotController {
    const p: HunterParams = { ...HUNTER_DEFAULTS, ...overrides };
    let lastX = ARENA_WIDTH / 2;
    let lastY = ARENA_HEIGHT / 2;

    function update(sense: SenseState): Intent {
        const self = sense.self;
        let foe = pickTarget(sense.foes, p.targetPolicy);
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

/** Brain hunter: the same execution, steered by the 6-mode scorer. */
export function createWithParams(overrides?: Partial<HunterParams>): RobotController {
    const p: HunterParams = { ...HUNTER_DEFAULTS, ...overrides };
    const brain = createBrain({
        steerGain: p.steerGain,
        turretGain: p.turretGain,
        aimTol: p.aimTol,
        bankRangeFrac: p.bankRangeFrac,
        closeRangeFrac: p.closeRangeFrac,
        closeThrottle: p.closeThrottle,
        scanTurn: p.scanTurn,
        targetPolicy: p.targetPolicy,
        ...(p.brain ?? {}),
    });
    const model = createOpponentModel(p.model ?? {});
    const roles = createRoleTracker();

    function update(sense: SenseState): Intent {
        model.update(sense);
        const out = brain.update(sense);
        const intent = { ...out.intent };
        // Counter-lead: when the brain holds fire on a visible target, loose
        // the model's solution instead. Never overrides a brain shot.
        // Long-range fire waits only for a productive bank (charger skill)
        // or a fast close (a better shot is moments away): without either,
        // the bank-wait never resolves and only donates damage.
        if (!intent.fire && out.targetId !== null) {
            const self = sense.self;
            const target = sense.foes.find((f) => f.id === out.targetId);
            if (target !== undefined && target.distance < self.stats.gunRange) {
                const shot = model.aimAt(target, self.x, self.y, self.stats.bulletSpeed);
                const tol = model.releaseTol(target, p.aimTol);
                intent.towerTurn = aimTurret(self.tower, shot, p.turretGain);
                const bankHold =
                    target.distance > self.stats.gunRange * p.bankRangeFrac &&
                    !self.charged &&
                    (model.shouldBank(self) || model.closingFast(target.id));
                if (aimed(self.tower, shot, tol) && !bankHold) {
                    intent.fire = true;
                    intent.charge = false;
                }
            }
        } else if (out.targetId === null) {
            // Blind tower discipline (never fires blind): re-acquire onto a
            // fresh sighting instead of scanning empty air, and hold forward
            // until first contact (foes spawn ahead; sweeping away donates
            // the whole approach). Past tick 300 with no contact, fall back
            // to the brain's scan so corner campers are still found.
            const self = sense.self;
            const mem = model.lastSeen();
            if (mem !== null && sense.tick - mem.tick < 90) {
                intent.towerTurn = aimTurret(self.tower, Math.atan2(mem.y - self.y, mem.x - self.x), p.turretGain);
            } else if (!model.hasSeen() && sense.tick < 300) {
                intent.towerTurn = 0;
            }
        }
        // Flank campers: a head-on chase at a parked gun is predictable, so
        // spiral in (tangent + radial) instead of running straight at them.
        // Drive only — the tower/fire solution above stands. Never overrides
        // a defensive mode, a close brawl, or the finish on a weak foe.
        // Both bows are raycast and the clear runway wins (midfield bow
        // preferred: attacking from the open side pins the camper against
        // its own wall); when both runways are blocked the brain's straight
        // lane (which threads between the blocks) stands.
        if (out.targetId !== null && brain.mode === 'engage') {
            const self = sense.self;
            const target = sense.foes.find((f) => f.id === out.targetId);
            if (target !== undefined && target.distance > 200 && target.health >= 30 && model.isCamping(target)) {
                const toFoe = Math.atan2(target.y - self.y, target.x - self.x);
                const cx = ARENA_WIDTH / 2 - self.x;
                const cy = ARENA_HEIGHT / 2 - self.y;
                const midBow = Math.cos(toFoe + Math.PI / 2) * cx + Math.sin(toFoe + Math.PI / 2) * cy >= 0 ? 1 : -1;
                const obstacles = sense.arena?.obstacles;
                const runwayFor = (bow: 1 | -1): { angle: number; runway: number } => {
                    const tangent = toFoe + (bow * Math.PI) / 2;
                    const goalX = clamp(
                        self.x + Math.cos(tangent) * 250 + Math.cos(toFoe) * 150,
                        20,
                        ARENA_WIDTH - 20,
                    );
                    const goalY = clamp(
                        self.y + Math.sin(tangent) * 250 + Math.sin(toFoe) * 150,
                        20,
                        ARENA_HEIGHT - 20,
                    );
                    const angle = Math.atan2(goalY - self.y, goalX - self.x);
                    const runway = obstacles !== undefined ? rayClearance(self.x, self.y, angle, obstacles) : self.blocked.ahead;
                    return { angle, runway };
                };
                const mid = runwayFor(midBow);
                const far = runwayFor(midBow === 1 ? -1 : 1);
                const pick = mid.runway > 220 ? mid : far.runway > 220 ? far : null;
                if (pick !== null) {
                    intent.throttle = throttleFor(self.heading, pick.angle);
                    intent.turn = steerTo(self.heading, pick.angle, p.steerGain);
                }
            }
        }
        // Squad roles (reference implementation): with a settled role, hold
        // the formation slot around a visible foe in the flank band instead
        // of the brain's tangent orbit. Blind approach keeps the brain's
        // lane (centroid forming would delay contact and focus chaining),
        // combat modes (engage/focus/kite/retreat) are untouched, and in
        // 1v1 the tracker idles so solo behavior is byte-identical. Tower,
        // fire, and charge always stay with the brain + opponent model
        // above — this is drive-only.
        const roleState = roles.update(sense);
        if (roleState.role !== null && brain.mode === 'flank' && sense.foes.length > 0) {
            const self = sense.self;
            const slot = roleGoal(sense, roleState.role, roleState.slots);
            if (Math.hypot(slot.x - self.x, slot.y - self.y) > 90) {
                const angle = Math.atan2(slot.y - self.y, slot.x - self.x);
                intent.throttle = throttleFor(self.heading, angle);
                intent.turn = steerTo(self.heading, angle, p.steerGain);
            }
        }
        // Role mail (claims while unsettled, sparse slot heartbeats) takes
        // the radio when due; otherwise focus votes chain as before.
        return { ...intent, radio: roleState.radio ?? (out.targetId !== null ? castFocusVote(out.targetId) : null) };
    }

    return { meta, loadout, update };
}

export function create(): RobotController {
    return createWithParams();
}
