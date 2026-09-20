// Eval schedules: deterministic job lists. Every job carries a global index;
// its seed derives from that index alone, so schedules stay stable as modes
// evolve and goldens keyed by job key survive reshuffles.

import type { ArenaId, MatchModifiers } from '../../src/sim/constants';

export interface MatchJob {
    index: number;
    arena: ArenaId;
    teamSize: number;
    teamA: string[];
    teamB: string[];
    seed: number;
    modifiers: MatchModifiers;
    /** Attach the match fingerprint to the result row (draws always attach). */
    sample: boolean;
}

/** Golden-ratio step: adjacent jobs get maximally distant seeds. */
export const SEED_STEP = 0x9e3779b9;
export const BASE_SEED = 0xc0ffee;

export function jobSeed(index: number, base: number = BASE_SEED): number {
    return (base + Math.imul(index, SEED_STEP)) >>> 0;
}

/** Stable golden key: teams + arena + seed (+ modifiers when exhibition). */
export function jobKey(job: Pick<MatchJob, 'arena' | 'teamSize' | 'teamA' | 'teamB' | 'seed' | 'modifiers'>): string {
    const mods = Object.keys(job.modifiers).length > 0 ? `|${JSON.stringify(job.modifiers)}` : '';
    return `t${job.teamSize}/${job.arena}/${job.teamA.join(',')}vs${job.teamB.join(',')}/seed${job.seed}${mods}`;
}

export interface PairwiseOptions {
    bots: string[];
    vs: string[];
    seedsPerPair: number;
    arenas: ArenaId[];
    sampleEvery: number;
    startIndex?: number;
    baseSeed?: number;
}

/** Ordered 1v1 pairs (a in bots, b in vs, a != b) x seeds x arenas. */
export function buildPairwise(opts: PairwiseOptions): MatchJob[] {
    const jobs: MatchJob[] = [];
    let i = opts.startIndex ?? 0;
    for (const arena of opts.arenas) {
        for (const a of opts.bots) {
            for (const b of opts.vs) {
                if (a === b) continue;
                for (let s = 0; s < opts.seedsPerPair; s += 1) {
                    const index = i;
                    i += 1;
                    jobs.push({
                        index,
                        arena,
                        teamSize: 1,
                        teamA: [a],
                        teamB: [b],
                        seed: jobSeed(index, opts.baseSeed),
                        modifiers: {},
                        sample: index % opts.sampleEvery === 0,
                    });
                }
            }
        }
    }
    return jobs;
}

export interface LadderStanding {
    id: string;
    score: number;
    faced: Set<string>;
    byes: number;
}

export type LadderPairing = { a: string; b: string } | { bye: string };

/**
 * Swiss pairing: score-desc, id-asc order, greedy match avoiding rematches.
 * Odd entrant out takes a bye (scores as a win, no game played).
 */
export function pairLadderRound(standings: LadderStanding[]): LadderPairing[] {
    const order = [...standings].sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1));
    const pairs: LadderPairing[] = [];
    const used = new Set<string>();
    for (const s of order) {
        if (used.has(s.id)) continue;
        used.add(s.id);
        const opp =
            order.find((o) => !used.has(o.id) && !s.faced.has(o.id)) ?? order.find((o) => !used.has(o.id));
        if (!opp) {
            pairs.push({ bye: s.id });
            continue;
        }
        used.add(opp.id);
        pairs.push({ a: s.id, b: opp.id });
    }
    return pairs;
}

export function buildLadderJobs(
    pairings: LadderPairing[],
    round: number,
    arena: ArenaId,
    startIndex: number,
    sampleEvery: number,
    baseSeed?: number,
): { jobs: MatchJob[]; played: Array<{ a: string; b: string }> } {
    const jobs: MatchJob[] = [];
    const played: Array<{ a: string; b: string }> = [];
    let i = startIndex;
    pairings.forEach((pairing, k) => {
        if ('bye' in pairing) return;
        // Alternate sides across rounds so nobody camps team A.
        const swap = (round + k) % 2 === 1;
        const a = swap ? pairing.b : pairing.a;
        const b = swap ? pairing.a : pairing.b;
        const index = i;
        i += 1;
        jobs.push({
            index,
            arena,
            teamSize: 1,
            teamA: [a],
            teamB: [b],
            seed: jobSeed(index, baseSeed),
            modifiers: {},
            sample: index % sampleEvery === 0,
        });
        played.push({ a, b });
    });
    return { jobs, played };
}

/**
 * Fixed 2v2/3v3 spot matrix from the resolved bot list (registry order):
 * bots[0..1] vs bots[2..3], bots[0..2] vs bots[3..5]. Skipped when the
 * bot list is too short for a matchup.
 */
export function buildSpotMatrix(
    bots: string[],
    arenas: ArenaId[],
    seedsPerMatchup: number,
    startIndex: number,
    sampleEvery: number,
    baseSeed?: number,
): MatchJob[] {
    const matchups: Array<[string[], string[]]> = [];
    if (bots.length >= 4) matchups.push([bots.slice(0, 2), bots.slice(2, 4)]);
    if (bots.length >= 6) matchups.push([bots.slice(0, 3), bots.slice(3, 6)]);
    const jobs: MatchJob[] = [];
    let i = startIndex;
    for (const arena of arenas) {
        for (const [teamA, teamB] of matchups) {
            for (let s = 0; s < seedsPerMatchup; s += 1) {
                const index = i;
                i += 1;
                jobs.push({
                    index,
                    arena,
                    teamSize: teamA.length,
                    teamA: [...teamA],
                    teamB: [...teamB],
                    seed: jobSeed(index, baseSeed),
                    modifiers: {},
                    sample: index % sampleEvery === 0,
                });
            }
        }
    }
    return jobs;
}
