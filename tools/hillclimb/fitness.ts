// Fitness (hillclimb plan §1.6): lexicographic — primary win rate (draw 0.5),
// tiebreak F = damageDiff_norm + 0.2*survivalBonus − stall − passivity −
// errors (floored at −1). The spy wrapper observes intents without changing
// behavior (it never catches: engine error isolation still sees throws).

import { MAX_TICKS_TOTAL } from '../../src/sim/constants';
import type { RobotSnapshot } from '../../src/sim/engine';
import type { Intent, RobotController } from '../../src/sim/types';

export interface SpyStats {
    /** Ticks alive (update is only called for living robots). */
    ticks: number;
    fireIntents: number;
    chargeIntents: number;
    moveSum: number;
}

export interface SpiedController {
    controller: RobotController;
    stats: SpyStats;
}

export function spyOn(inner: RobotController): SpiedController {
    const stats: SpyStats = { ticks: 0, fireIntents: 0, chargeIntents: 0, moveSum: 0 };
    return {
        stats,
        controller: {
            ...inner,
            update: (sense): Intent => {
                const intent = inner.update(sense);
                stats.ticks += 1;
                if (intent.fire === true) stats.fireIntents += 1;
                if (intent.charge === true) stats.chargeIntents += 1;
                if (typeof intent.throttle === 'number' && Number.isFinite(intent.throttle)) {
                    stats.moveSum += Math.abs(intent.throttle);
                }
                return intent;
            },
        },
    };
}

/** Candidate's score for one match: win 1, draw 0.5, loss 0. */
export function matchScore(winner: -1 | 0 | 1, myTeam: 0 | 1): number {
    if (winner === -1) return 0.5;
    return winner === myTeam ? 1 : 0;
}

export interface TiebreakInput {
    me: RobotSnapshot;
    /** Damage the other side dealt (1v1: the foe's damageDealt). */
    foeDamage: number;
    endTick: number;
    draw: boolean;
    spy: SpyStats;
}

/**
 * Tiebreak F. damageDiff normalized by 200 (≈ two full-health kills);
 * survival 1 when alive else end-tick fraction; stall 1 only on a capped
 * draw; passivity from shots-per-25-alive-ticks; errors capped at 1.
 */
export function tiebreak(input: TiebreakInput): number {
    const { me, foeDamage, endTick, draw, spy } = input;
    const damageDiff = (me.damageDealt - foeDamage) / 200;
    const survival = me.alive ? 1 : Math.min(1, endTick / MAX_TICKS_TOTAL);
    const stall = draw && endTick >= MAX_TICKS_TOTAL ? 1 : 0;
    const expected = Math.max(1, spy.ticks / 25);
    const passivity = 1 - Math.min(1, me.shotsFired / expected);
    const errors = Math.min(1, me.errors);
    return damageDiff + 0.2 * survival - stall - passivity - errors;
}

export interface ScoredMatch {
    score: number;
    f: number;
}

export interface Aggregate {
    n: number;
    mean: number;
    meanF: number;
    wins: number;
    draws: number;
    losses: number;
}

export function aggregate(matches: ScoredMatch[]): Aggregate {
    let wins = 0;
    let draws = 0;
    let losses = 0;
    let sum = 0;
    let sumF = 0;
    for (const m of matches) {
        sum += m.score;
        sumF += m.f;
        if (m.score === 1) wins += 1;
        else if (m.score === 0.5) draws += 1;
        else losses += 1;
    }
    const n = matches.length;
    return { n, mean: n > 0 ? sum / n : 0, meanF: n > 0 ? sumF / n : 0, wins, draws, losses };
}

/** Lexicographic: higher mean wins; mean ties (eps) break on meanF. */
export function better(a: Aggregate, b: Aggregate): boolean {
    if (Math.abs(a.mean - b.mean) > 1e-9) return a.mean > b.mean;
    return a.meanF > b.meanF;
}

export interface SignTest {
    nonTied: number;
    wins: number;
    frac: number;
    pass: boolean;
}

/**
 * CRN-paired sign test (§1.6): challenger must take ≥60% of ≥24 non-tied
 * pairs on the identical pool. Scores arrays must align by pool index.
 */
export function signTest(challenger: number[], incumbent: number[]): SignTest {
    let nonTied = 0;
    let wins = 0;
    const n = Math.min(challenger.length, incumbent.length);
    for (let i = 0; i < n; i += 1) {
        const c = challenger[i] as number;
        const b = incumbent[i] as number;
        if (c === b) continue;
        nonTied += 1;
        if (c > b) wins += 1;
    }
    const frac = nonTied > 0 ? wins / nonTied : 0;
    return { nonTied, wins, frac, pass: nonTied >= 24 && frac >= 0.6 };
}

/** Exact upper-tail P(X ≥ k) for Binomial(n, 0.5) via the k/n recurrence. */
export function binomialUpperTail(n: number, k: number): number {
    if (n <= 0 || k <= 0) return 1;
    if (k > n) return 0;
    // P(X = k) descending-free: start from P(X = 0) = 2^-n, walk up.
    let prob = Math.pow(0.5, n);
    let tail = 0;
    for (let i = 0; i <= n; i += 1) {
        if (i >= k) tail += prob;
        prob = (prob * (n - i)) / (i + 1);
    }
    return Math.min(1, tail);
}
