// Adaptive combat brain: a 6-mode utility scorer with hysteresis. Each tick
// every mode bids from the current sense; the incumbent keeps a stay bonus,
// so the brain holds its line until a challenger clearly wins. Personalities
// are presets (mode flavors), not forks — every bot runs this scorer.

import { ARENA_HEIGHT, ARENA_WIDTH } from '../sim/constants';
import { clamp } from '../sim/math';
import type { Intent, SensedRobot, SenseState } from '../sim/types';
import { aimed, aimTurret, leadAngle, manageCharge, steerTo, throttleFor } from './common';
import { focusTarget } from './comms';

export type BrainMode = 'engage' | 'retreat' | 'kite' | 'flank' | 'focus' | 'roam';
export type BrainTargetPolicy = 'first' | 'nearest' | 'weakest' | 'strongest';

/** Tie-break order among challengers: safety first, searching last. */
const MODE_ORDER: BrainMode[] = ['retreat', 'focus', 'kite', 'flank', 'engage', 'roam'];

/** Full behavior knobs: drive/fire execution plus mode utilities. */
export interface BrainParams {
    steerGain: number;
    turretGain: number;
    aimTol: number;
    bankRangeFrac: number;
    closeRangeFrac: number;
    closeThrottle: number;
    scanTurn: number;
    targetPolicy: BrainTargetPolicy;
    /** Retreat when health fraction drops below this (and a foe is near). */
    retreatHp: number;
    /** Kite when the nearest foe is closer than this. */
    kiteRange: number;
    /** Flank band outer edge (mid-range tangent approach). */
    flankRange: number;
    /** Stay bonus added to the incumbent mode's bid (hysteresis). */
    stayBonus: number;
    /** Engage bid multiplier (bloodthirst). */
    aggression: number;
    /** Focus bid bonus over the base vote value. */
    focusBonus: number;
    /** Flank orbit direction. */
    orbitDir: 1 | -1;
}

/** Hunter-legacy execution with neutral mode utilities. */
export const BRAIN_DEFAULTS: BrainParams = {
    steerGain: 2.5,
    turretGain: 3,
    aimTol: 0.05,
    bankRangeFrac: 0.7,
    closeRangeFrac: 0.55,
    closeThrottle: 0.35,
    scanTurn: 0.9,
    targetPolicy: 'weakest',
    retreatHp: 0.3,
    kiteRange: 200,
    flankRange: 350,
    stayBonus: 0.15,
    aggression: 1,
    focusBonus: 0.3,
    orbitDir: 1,
};

/**
 * Per-robot presets: personalities kept as mode flavors. Hunter, rusher,
 * and brawler are converted so far; the rest are defined, validated, and
 * ready to wire.
 * (hunter-hc1 reuses the hunter preset when it converts; it is frozen on
 * legacy behavior until the next tune.)
 */
export const BRAIN_PRESETS: Record<string, BrainParams> = {
    hunter: { ...BRAIN_DEFAULTS },
    rusher: { ...BRAIN_DEFAULTS, aggression: 1.4, retreatHp: 0.15, kiteRange: 120, targetPolicy: 'nearest' },
    turret: { ...BRAIN_DEFAULTS, aggression: 1, retreatHp: 0.1, kiteRange: 0, flankRange: 0, scanTurn: 0.9 },
    orbiter: { ...BRAIN_DEFAULTS, aggression: 0.9, kiteRange: 240, flankRange: 420, targetPolicy: 'first' },
    wanderer: { ...BRAIN_DEFAULTS, aggression: 0.7, retreatHp: 0.25, targetPolicy: 'first', scanTurn: 1 },
    sniper: { ...BRAIN_DEFAULTS, aggression: 0.8, retreatHp: 0.35, kiteRange: 280, bankRangeFrac: 0.75, aimTol: 0.05 },
    brawler: { ...BRAIN_DEFAULTS, aggression: 1.3, retreatHp: 0.2, kiteRange: 140, targetPolicy: 'nearest' },
    ghost: { ...BRAIN_DEFAULTS, aggression: 1, retreatHp: 0.3, kiteRange: 240, targetPolicy: 'first' },
};

/** Target pick shared by every brain (same four policies as the factories). */
export function pickTarget(foes: SensedRobot[], policy: BrainTargetPolicy): SensedRobot | undefined {
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

/**
 * Where to run when the zone forces a retreat: hold when safely inside,
 * otherwise the circle center.
 */
export function safeCircleFor(
    selfX: number, selfY: number, circle: { x: number; y: number; r: number },
): { x: number; y: number } {
    if (Math.hypot(circle.x - selfX, circle.y - selfY) < circle.r * 0.8) return { x: selfX, y: selfY };
    return { x: circle.x, y: circle.y };
}

export interface BrainOutput {
    mode: BrainMode;
    intent: Intent;
    /** The foe id the brain is working, if any (for focus votes). */
    targetId: number | null;
}

export interface Brain {
    readonly mode: BrainMode;
    update(sense: SenseState): BrainOutput;
}

/** Fresh per-match brain (mode + memory live in the closure). */
export function createBrain(overrides?: Partial<BrainParams>): Brain {
    const p: BrainParams = { ...BRAIN_DEFAULTS, ...overrides };
    let current: BrainMode = 'roam';
    let lastX = ARENA_WIDTH / 2;
    let lastY = ARENA_HEIGHT / 2;

    function update(sense: SenseState): BrainOutput {
        const self = sense.self;
        const foe = pickTarget(sense.foes, p.targetPolicy);
        if (foe) {
            lastX = foe.x;
            lastY = foe.y;
        }
        const hpFrac = self.health / self.stats.maxHealth;
        const nearest = sense.foes.length > 0 ? (sense.foes[0] as SensedRobot).distance : Infinity;
        // A live teammate's vote for a foe in our own cone.
        let votedFoe: SensedRobot | undefined;
        if (sense.inbox.length > 0 && sense.foes.length > 0) {
            const liveSenders = new Set(sense.allies.map((a) => a.id));
            liveSenders.add(self.id);
            const voted = focusTarget(sense.inbox, liveSenders, new Set(sense.foes.map((f) => f.id)));
            votedFoe = voted !== null ? sense.foes.find((f) => f.id === voted) : undefined;
        }
        const zone = sense.zone;
        const fleeZone = zone !== undefined && zone.phase === 'shrinking' && !zone.inside;
        const weakFoe = foe !== undefined && foe.health < 30;
        const bids: Record<BrainMode, number> = {
            engage: foe ? 0.45 * p.aggression + (weakFoe ? 0.3 : 0) + (nearest > p.flankRange ? 0.15 : 0) : 0,
            retreat: fleeZone ? 2 : hpFrac < p.retreatHp ? (foe ? 1 : 0.55) : 0,
            kite: foe && nearest < p.kiteRange && hpFrac >= p.retreatHp ? 0.7 : 0,
            flank: foe && nearest >= p.kiteRange && nearest <= p.flankRange && hpFrac >= p.retreatHp ? 0.6 : 0,
            focus: votedFoe ? 0.55 + p.focusBonus : 0,
            roam: foe ? 0.05 : 0.45,
        };
        bids[current] += p.stayBonus;
        let mode = current;
        let best = bids[current] as number;
        for (const m of MODE_ORDER) {
            if (m === current) continue;
            if ((bids[m] as number) > best) {
                best = bids[m] as number;
                mode = m;
            }
        }
        current = mode;

        const target = mode === 'focus' && votedFoe ? votedFoe : foe;
        let goalX = lastX;
        let goalY = lastY;
        let throttle: number | null = null;
        if (mode === 'retreat') {
            if (fleeZone && zone) {
                const safe = safeCircleFor(self.x, self.y, zone.circle);
                goalX = safe.x;
                goalY = safe.y;
            } else if (foe) {
                const dx = self.x - foe.x;
                const dy = self.y - foe.y;
                const d = Math.hypot(dx, dy) || 1;
                goalX = clamp(self.x + (dx / d) * 300, 20, ARENA_WIDTH - 20);
                goalY = clamp(self.y + (dy / d) * 300, 20, ARENA_HEIGHT - 20);
            } else {
                goalX = self.team === 0 ? 130 : ARENA_WIDTH - 130;
                goalY = clamp(self.y, 20, ARENA_HEIGHT - 20);
            }
            throttle = 1;
        } else if (mode === 'kite' && foe) {
            const dx = self.x - foe.x;
            const dy = self.y - foe.y;
            const d = Math.hypot(dx, dy) || 1;
            goalX = clamp(foe.x + (dx / d) * p.kiteRange, 20, ARENA_WIDTH - 20);
            goalY = clamp(foe.y + (dy / d) * p.kiteRange, 20, ARENA_HEIGHT - 20);
        } else if (mode === 'flank' && foe) {
            const toFoe = Math.atan2(foe.y - self.y, foe.x - self.x);
            const tangent = toFoe + (p.orbitDir * Math.PI) / 2;
            goalX = clamp(self.x + Math.cos(tangent) * 250, 20, ARENA_WIDTH - 20);
            goalY = clamp(self.y + Math.sin(tangent) * 250, 20, ARENA_HEIGHT - 20);
        } else if ((mode === 'engage' || mode === 'focus') && target) {
            goalX = target.x;
            goalY = target.y;
        }
        const goalAngle = Math.atan2(goalY - self.y, goalX - self.x);
        if (throttle === null) {
            if ((mode === 'engage' || mode === 'focus') && target && target.distance < self.stats.gunRange * p.closeRangeFrac) {
                throttle = p.closeThrottle;
            } else {
                throttle = throttleFor(self.heading, goalAngle);
            }
        }
        const turn = steerTo(self.heading, goalAngle, p.steerGain);

        let towerTurn = p.scanTurn;
        let fire = false;
        if (target) {
            const shot = leadAngle(self.x, self.y, self.stats.bulletSpeed, target);
            towerTurn = aimTurret(self.tower, shot, p.turretGain);
            const wantBank = target.distance > self.stats.gunRange * p.bankRangeFrac && !self.charged;
            fire = target.distance < self.stats.gunRange && aimed(self.tower, shot, p.aimTol) && !wantBank;
        }
        const tracking = target !== undefined && target.distance < self.stats.gunRange;
        const charge = tracking && !fire ? manageCharge(self.charged, fire) : false;
        return { mode, intent: { throttle, turn, towerTurn, fire, charge }, targetId: target ? target.id : null };
    }

    return {
        get mode(): BrainMode {
            return current;
        },
        update,
    };
}
