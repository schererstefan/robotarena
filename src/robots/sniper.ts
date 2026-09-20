// Sniper: camps a backfield anchor, banks charge, and picks foes off at
// long range with led shots. Retreats when rushed instead of brawling.

import { ARENA_HEIGHT, ARENA_WIDTH } from '../sim/constants';
import { dist } from '../sim/math';
import type { SkillLoadout } from '../sim/skills';
import type { Intent, RobotController, RobotMeta, SenseState } from '../sim/types';
import { pickTarget, type BrainTargetPolicy } from './brain';
import { aimed, aimTurret, createStallTracker, leadAngle, manageCharge, steerTo } from './common';
import type { Genome } from './genome';

export const meta: RobotMeta = {
    id: 'sniper',
    name: 'Sniper',
    author: 'RobotArena',
    version: '1.0.0',
    description: 'Camps backfield and lands charged long-range shots. Do not stand still.',
};

export const loadout: SkillLoadout = { longscan: 2, marksman: 1, charger: 1, deadeye: 1, trigger: 1 };

/** Tunable knobs (genome §1.4 groups). Defaults = legacy behavior exactly. */
export interface SniperParams {
    anchorXNear: number;
    anchorXFar: number;
    anchorYNear: number;
    anchorYFar: number;
    anchorSettle: number;
    anchorLeave: number;
    kiteRangeFrac: number;
    anchorThrottle: number;
    idleGain: number;
    driveGain: number;
    scanTurn: number;
    aimTol: number;
    bankRangeFrac: number;
    turretGain: number;
    targetPolicy: BrainTargetPolicy;
}

export const SNIPER_DEFAULTS: SniperParams = {
    anchorXNear: 0.24,
    anchorXFar: 0.76,
    anchorYNear: 0.28,
    anchorYFar: 0.72,
    anchorSettle: 24,
    anchorLeave: 80,
    kiteRangeFrac: 0.5,
    anchorThrottle: 0.8,
    idleGain: 1.5,
    driveGain: 2.5,
    scanTurn: 0.5,
    aimTol: 0.05,
    bankRangeFrac: 0.75,
    turretGain: 3,
    targetPolicy: 'first',
};

const TARGET_POLICIES: ReadonlyArray<BrainTargetPolicy> = ['first', 'nearest', 'weakest', 'strongest'];

/** Build sniper params from a validated genome (unknown keys fall to defaults). */
export function sniperParamsFromGenome(genome: Genome): SniperParams {
    const p = genome.params;
    const num = (key: string, fallback: number): number => (typeof p[key] === 'number' ? (p[key] as number) : fallback);
    const policy = p['target.policy'];
    return {
        anchorXNear: num('anchor.xNear', SNIPER_DEFAULTS.anchorXNear),
        anchorXFar: num('anchor.xFar', SNIPER_DEFAULTS.anchorXFar),
        anchorYNear: num('anchor.yNear', SNIPER_DEFAULTS.anchorYNear),
        anchorYFar: num('anchor.yFar', SNIPER_DEFAULTS.anchorYFar),
        anchorSettle: num('anchor.settle', SNIPER_DEFAULTS.anchorSettle),
        anchorLeave: num('anchor.leave', SNIPER_DEFAULTS.anchorLeave),
        kiteRangeFrac: num('kite.rangeFrac', SNIPER_DEFAULTS.kiteRangeFrac),
        anchorThrottle: num('drive.anchorThrottle', SNIPER_DEFAULTS.anchorThrottle),
        idleGain: num('steer.idleGain', SNIPER_DEFAULTS.idleGain),
        driveGain: num('steer.driveGain', SNIPER_DEFAULTS.driveGain),
        scanTurn: num('search.scanTurn', SNIPER_DEFAULTS.scanTurn),
        aimTol: num('fire.aimTol', SNIPER_DEFAULTS.aimTol),
        bankRangeFrac: num('fire.bankRangeFrac', SNIPER_DEFAULTS.bankRangeFrac),
        turretGain: num('turret.gain', SNIPER_DEFAULTS.turretGain),
        targetPolicy:
            typeof policy === 'string' && (TARGET_POLICIES as ReadonlyArray<string>).includes(policy)
                ? (policy as BrainTargetPolicy)
                : SNIPER_DEFAULTS.targetPolicy,
    };
}

export function createWithParams(overrides?: Partial<SniperParams>): RobotController {
    const p: SniperParams = { ...SNIPER_DEFAULTS, ...overrides };
    let anchorX = 0;
    let anchorY = 0;
    let anchored = false;
    const stall = createStallTracker();

    function onSpawn(sense: SenseState): void {
        // Deeper than the turret: maximum standoff for the long gun.
        anchorX = sense.self.team === 0 ? ARENA_WIDTH * p.anchorXNear : ARENA_WIDTH * p.anchorXFar;
        anchorY = sense.self.y < ARENA_HEIGHT / 2 ? ARENA_HEIGHT * p.anchorYNear : ARENA_HEIGHT * p.anchorYFar;
    }

    function update(sense: SenseState): Intent {
        const self = sense.self;
        const foe = pickTarget(sense.foes, p.targetPolicy);
        const anchorDist = dist(self.x, self.y, anchorX, anchorY);
        if (anchorDist < p.anchorSettle) anchored = true;
        else if (anchorDist > p.anchorLeave) anchored = false; // shoved off: re-drive in

        // Rushed: kite away at full drive to re-establish standoff range.
        const rushed = foe !== undefined && foe.distance < self.stats.gunRange * p.kiteRangeFrac;
        // Sudden death outside the circle: the anchor is scrap, run to safety.
        const zone = sense.zone;
        const unsafe = zone !== undefined && zone.phase === 'shrinking' && (zone.distToSafety > 0 || !zone.inside);
        let throttle = 0;
        let goal = self.heading;
        if (unsafe && zone) {
            goal = Math.atan2(zone.circle.y - self.y, zone.circle.x - self.x);
            throttle = 1;
        } else if (rushed && foe) {
            goal = Math.atan2(self.y - foe.y, self.x - foe.x);
            throttle = 1;
        } else if (!anchored) {
            goal = Math.atan2(anchorY - self.y, anchorX - self.x);
            throttle = p.anchorThrottle;
        } else {
            goal = Math.atan2(ARENA_HEIGHT / 2 - self.y, ARENA_WIDTH / 2 - self.x);
        }
        // Pinned kiting into a wall or block: sidestep along it instead of
        // pushing, so the kite never degrades into a static trade.
        if (throttle !== 0 && stall.update(sense.tick, self.x, self.y, true)) {
            goal += Math.PI / 2;
        }
        const turn = steerTo(self.heading, goal, throttle === 0 ? p.idleGain : p.driveGain);

        let towerTurn = p.scanTurn; // slow scan while blind
        let fire = false;
        let charge = false;
        // Blind but with a memory: swing the tower onto the freshest track
        // instead of scanning empty air — re-acquire, don't wander.
        const tracks = sense.tracks ?? [];
        let memory = -1;
        for (let i = 0; i < tracks.length; i += 1) {
            const t = tracks[i] as { lastSeenTick: number };
            if (!tracks[i]?.seenNow && (memory < 0 || t.lastSeenTick > (tracks[memory]?.lastSeenTick ?? -1))) memory = i;
        }
        const mem = memory >= 0 ? tracks[memory] : undefined;
        if (!foe && mem) {
            towerTurn = aimTurret(self.tower, Math.atan2(mem.y - self.y, mem.x - self.x), p.turretGain);
        }
        if (foe) {
            const shot = leadAngle(self.x, self.y, self.stats.bulletSpeed, foe);
            towerTurn = aimTurret(self.tower, shot, p.turretGain);
            const inRange = foe.distance < self.stats.gunRange;
            const onTarget = aimed(self.tower, shot, p.aimTol);
            // The longest shots and kiting parting shots wait for a full
            // bank; otherwise the gun speaks whenever it bears.
            const holdForBank = foe.distance > self.stats.gunRange * p.bankRangeFrac || rushed;
            fire = inRange && onTarget && (!holdForBank || self.charged);
            charge = inRange && !fire ? manageCharge(self.charged, onTarget && !holdForBank) : false;
        }
        return { throttle, turn, towerTurn, fire, charge };
    }

    return { meta, loadout, onSpawn, update };
}

export function create(): RobotController {
    return createWithParams();
}
