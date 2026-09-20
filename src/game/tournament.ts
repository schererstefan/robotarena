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

// ---- Cross-scene session ----------------------------------------------------
// Bracket matches play out in the Battle scene, which tears down the
// Tournament scene. The live bracket survives the trip in this store:
// TournamentScene saves before launching a battle, BattleScene settles the
// result on match end, and TournamentScene resumes (or finishes) on return.

export interface TournamentSession {
    size: 4 | 8;
    entrants: string[];
    rounds: BracketMatch[][];
    seedBase: number;
    matchCounter: number;
}

let session: TournamentSession | null = null;

/** Deep-copied save: later scene edits never alias the stored bracket. */
export function saveTournamentSession(next: TournamentSession): void {
    session = {
        size: next.size,
        entrants: [...next.entrants],
        rounds: next.rounds.map((round) => round.map((slot) => ({ ...slot }))),
        seedBase: next.seedBase,
        matchCounter: next.matchCounter,
    };
}

/** Live stored reference (or null); callers restore then re-save on change. */
export function loadTournamentSession(): TournamentSession | null {
    return session;
}

export function clearTournamentSession(): void {
    session = null;
}

/**
 * Record a watched battle into the stored bracket. Idempotent per slot:
 * a re-settle (rematch replayed the same slot) keeps the first result.
 */
export function settleTournamentMatch(round: number, index: number, winner: string, draw: boolean, ticks: number): void {
    const stored = session;
    if (!stored) return;
    const slot = stored.rounds[round]?.[index];
    if (!slot || slot.winner) return;
    slot.winner = winner;
    slot.draw = draw;
    slot.ticks = ticks;
}
