// Single-elimination tournament bracket helpers. No Phaser imports: the
// TournamentScene renders these, and the soak test runs them headless.

import type { RobotSnapshot } from '../sim/engine';
import { roundNameFor } from './strings';

export interface BracketMatch {
    a: string;
    b: string;
    winner: string | null;
    /** True when a draw was resolved by the damage tiebreak. */
    draw: boolean;
    ticks: number;
}

export function initialRound(entrants: string[]): BracketMatch[] {
    if (entrants.length !== 4 && entrants.length !== 8) {
        throw new Error('tournament needs 4 or 8 entrants');
    }
    const round: BracketMatch[] = [];
    for (let i = 0; i < entrants.length; i += 2) {
        round.push({ a: entrants[i] as string, b: entrants[i + 1] as string, winner: null, draw: false, ticks: 0 });
    }
    return round;
}

/** Pair winners (in bracket order) into the next round. Null until complete. */
export function nextRound(round: BracketMatch[]): BracketMatch[] | null {
    const winners: string[] = [];
    for (const match of round) {
        if (!match.winner) return null;
        winners.push(match.winner);
    }
    if (winners.length < 2 || winners.length % 2 !== 0) return null;
    const next: BracketMatch[] = [];
    for (let i = 0; i < winners.length; i += 2) {
        next.push({ a: winners[i] as string, b: winners[i + 1] as string, winner: null, draw: false, ticks: 0 });
    }
    return next;
}

/** Deterministic tiebreak for drawn matches: more damage wins, then order. */
export function tiebreakWinner(snaps: RobotSnapshot[], a: string, b: string): string {
    const damageA = snaps[0]?.damageDealt ?? 0;
    const damageB = snaps[1]?.damageDealt ?? 0;
    if (damageA === damageB) return a;
    return damageA > damageB ? a : b;
}

export function roundName(roundIndex: number, roundCount: number): string {
    return roundNameFor(roundIndex, roundCount);
}
