// CRN-paired evaluation loop: every candidate in a generation runs the
// identical seed×arena×opponent×side pool (both arenas, both sides, rotating
// opponents), so challenger-vs-incumbent comparisons are paired per match.

import type { ArenaId } from '../../src/sim/constants';
import { Match } from '../../src/sim/engine';
import type { Genome } from '../../src/robots/genome';
import { genomeDefFor, genomeLoadout } from '../../src/robots/genome';
import { createWithParams as createHunter, hunterParamsFromGenome } from '../../src/robots/hunter';
import { createWithParams as createOrbiter, orbiterParamsFromGenome } from '../../src/robots/orbiter';
import { getRobot, ROBOTS } from '../../src/robots/registry';
import type { RobotController } from '../../src/sim/types';
import { aggregate, matchScore, spyOn, tiebreak, type Aggregate, type ScoredMatch } from './fitness';
import { fingerprintMatch } from '../eval/runner';

const ARENAS: ArenaId[] = ['open', 'blocks'];
const SIDES: Array<0 | 1> = [0, 1];

export type CreateFromGenome = (genome: Genome) => RobotController;

const ADAPTERS: Record<string, CreateFromGenome> = {
    hunter: (genome) => createHunter(hunterParamsFromGenome(genome)),
    orbiter: (genome) => createOrbiter(orbiterParamsFromGenome(genome)),
};

export function adapterFor(archetype: string): CreateFromGenome {
    const adapter = ADAPTERS[archetype];
    if (!adapter || !genomeDefFor(archetype)) throw new Error(`no tunable archetype ${archetype} (known: ${Object.keys(ADAPTERS).join(',')})`);
    return adapter;
}

export function defaultOpponents(archetype: string): string[] {
    return ROBOTS.map((r) => r.meta.id).filter((id) => id !== archetype);
}

export interface PoolMatch {
    seed: number;
    arena: ArenaId;
    opponent: string;
    side: 0 | 1;
}

export interface PoolOptions {
    seeds: number[];
    /** Opponents per seed; rotating across the list with `offset`. */
    oppsPerSeed: number;
    opponents: string[];
    offset?: number;
}

/**
 * Cartesian pool: seeds × opponents-per-seed × both arenas × both sides.
 * Opponent for (seedIndex, k) rotates so successive seeds / generations face
 * different foes while every candidate in a generation sees the same pool.
 */
export function buildPool(opts: PoolOptions): PoolMatch[] {
    const pool: PoolMatch[] = [];
    const offset = opts.offset ?? 0;
    opts.seeds.forEach((seed, si) => {
        for (let k = 0; k < opts.oppsPerSeed; k += 1) {
            const opponent = opts.opponents[(si + offset + k) % opts.opponents.length] as string;
            for (const arena of ARENAS) {
                for (const side of SIDES) {
                    pool.push({ seed, arena, opponent, side });
                }
            }
        }
    });
    return pool;
}

export interface GenomeEval {
    matches: ScoredMatch[];
    agg: Aggregate;
}

/** Run one genome over a pool; the candidate always carries the spy. */
export function evaluateGenome(create: CreateFromGenome, genome: Genome, pool: PoolMatch[]): GenomeEval {
    const loadout = genomeLoadout(genome);
    const matches: ScoredMatch[] = pool.map((m) => {
        const foe = getRobot(m.opponent);
        if (!foe) throw new Error(`unknown opponent ${m.opponent}`);
        const spied = spyOn(create(genome));
        const candidateEntry = { team: m.side, controller: spied.controller, loadout: { ...loadout } };
        const foeEntry = { team: (m.side === 0 ? 1 : 0) as 0 | 1, controller: foe.create(), loadout: { ...foe.loadout } };
        const lineups = m.side === 0 ? [candidateEntry, foeEntry] : [foeEntry, candidateEntry];
        const match = new Match(lineups, m.seed, { arena: m.arena });
        match.runToEnd();
        const snaps = match.robotSnapshots;
        const mine = snaps[m.side === 0 ? 0 : 1] as (typeof snaps)[number];
        const theirs = snaps[m.side === 0 ? 1 : 0] as (typeof snaps)[number];
        const winner = match.result.winner;
        return {
            score: matchScore(winner, m.side),
            f: tiebreak({ me: mine, foeDamage: theirs.damageDealt, endTick: match.result.tick, draw: winner === -1, spy: spied.stats }),
        };
    });
    return { matches, agg: aggregate(matches) };
}

export function allBotIds(): string[] {
    return ROBOTS.map((r) => r.meta.id);
}

export interface DetailedMatch extends ScoredMatch {
    spec: PoolMatch;
    fingerprint: string;
}

/** Same scoring as evaluateGenome, plus per-match fingerprints (validation). */
export function evaluateDetailed(create: CreateFromGenome, genome: Genome, pool: PoolMatch[]): DetailedMatch[] {
    const loadout = genomeLoadout(genome);
    return pool.map((m) => {
        const foe = getRobot(m.opponent);
        if (!foe) throw new Error(`unknown opponent ${m.opponent}`);
        const spied = spyOn(create(genome));
        const candidateEntry = { team: m.side, controller: spied.controller, loadout: { ...loadout } };
        const foeEntry = { team: (m.side === 0 ? 1 : 0) as 0 | 1, controller: foe.create(), loadout: { ...foe.loadout } };
        const lineups = m.side === 0 ? [candidateEntry, foeEntry] : [foeEntry, candidateEntry];
        const match = new Match(lineups, m.seed, { arena: m.arena });
        match.runToEnd();
        const snaps = match.robotSnapshots;
        const mine = snaps[m.side === 0 ? 0 : 1] as (typeof snaps)[number];
        const theirs = snaps[m.side === 0 ? 1 : 0] as (typeof snaps)[number];
        const winner = match.result.winner;
        return {
            spec: m,
            fingerprint: fingerprintMatch(match),
            score: matchScore(winner, m.side),
            f: tiebreak({ me: mine, foeDamage: theirs.damageDealt, endTick: match.result.tick, draw: winner === -1, spy: spied.stats }),
        };
    });
}
