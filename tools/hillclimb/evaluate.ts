// CRN-paired evaluation loop: every candidate in a generation runs the
// identical seed×arena×opponent×side pool (both arenas, both sides, rotating
// opponents), so challenger-vs-incumbent comparisons are paired per match.

import type { ArenaId } from '../../src/sim/constants';
import { Match, type LineupEntry, type RobotSnapshot } from '../../src/sim/engine';
import type { Genome } from '../../src/robots/genome';
import { genomeDefFor, genomeLoadout } from '../../src/robots/genome';
import { createWithParams as createBrawler, brawlerParamsFromGenome } from '../../src/robots/brawler';
import { createWithParams as createGhost, ghostParamsFromGenome } from '../../src/robots/ghost';
import { createWithParams as createHunter, hunterParamsFromGenome } from '../../src/robots/hunter';
import { createWithParams as createOrbiter, orbiterParamsFromGenome } from '../../src/robots/orbiter';
import { createWithParams as createRusher, rusherParamsFromGenome } from '../../src/robots/rusher';
import { createWithParams as createSniper, sniperParamsFromGenome } from '../../src/robots/sniper';
import { createWithParams as createTurret, turretParamsFromGenome } from '../../src/robots/turret';
import { createWithParams as createWanderer, wandererParamsFromGenome } from '../../src/robots/wanderer';
import { getRobot, ROBOTS } from '../../src/robots/registry';
import type { RobotController } from '../../src/sim/types';
import { aggregate, matchScore, spyOn, teamTiebreak, tiebreak, type Aggregate, type ScoredMatch, type SpiedController } from './fitness';
import { fingerprintMatch } from '../eval/runner';

const ARENAS: ArenaId[] = ['open', 'blocks'];
const SIDES: Array<0 | 1> = [0, 1];

export type CreateFromGenome = (genome: Genome) => RobotController;

const ADAPTERS: Record<string, CreateFromGenome> = {
    brawler: (genome) => createBrawler(brawlerParamsFromGenome(genome)),
    ghost: (genome) => createGhost(ghostParamsFromGenome(genome)),
    hunter: (genome) => createHunter(hunterParamsFromGenome(genome)),
    orbiter: (genome) => createOrbiter(orbiterParamsFromGenome(genome)),
    rusher: (genome) => createRusher(rusherParamsFromGenome(genome)),
    sniper: (genome) => createSniper(sniperParamsFromGenome(genome)),
    turret: (genome) => createTurret(turretParamsFromGenome(genome)),
    wanderer: (genome) => createWanderer(wandererParamsFromGenome(genome)),
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

export interface TeamPoolMatch extends PoolMatch {
    teamSize: number;
}

export interface TeamPoolOptions {
    seeds: number[];
    teamSize: number;
    opponents: string[];
    offset?: number;
}

/**
 * Team pool: seeds × rotating opponent × both arenas × both sides. Same CRN
 * rotation scheme as buildPool with oppsPerSeed 1: seed i faces
 * opponents[(i + offset) % len], so successive generations rotate foes while
 * every candidate in a generation sees the same pool.
 */
export function buildTeamPool(opts: TeamPoolOptions): TeamPoolMatch[] {
    const pool: TeamPoolMatch[] = [];
    const offset = opts.offset ?? 0;
    opts.seeds.forEach((seed, si) => {
        const opponent = opts.opponents[(si + offset) % opts.opponents.length] as string;
        for (const arena of ARENAS) {
            for (const side of SIDES) {
                pool.push({ seed, arena, opponent, side, teamSize: opts.teamSize });
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

interface TeamMatchRun {
    match: Match;
    /** Candidate snapshots (lineup order) and their spies. */
    mine: RobotSnapshot[];
    foeDamage: number;
    spies: SpiedController[];
}

/** One team match: candidate genome on every candidate slot, opponent default `create()` on every foe slot. */
function runTeamMatch(create: CreateFromGenome, genome: Genome, m: TeamPoolMatch): TeamMatchRun {
    const loadout = genomeLoadout(genome);
    const foe = getRobot(m.opponent);
    if (!foe) throw new Error(`unknown opponent ${m.opponent}`);
    const foeSide = (m.side === 0 ? 1 : 0) as 0 | 1;
    const spies: SpiedController[] = [];
    const mine: LineupEntry[] = [];
    for (let s = 0; s < m.teamSize; s += 1) {
        const spied = spyOn(create(genome));
        spies.push(spied);
        mine.push({ team: m.side, controller: spied.controller, loadout: { ...loadout } });
    }
    const theirs: LineupEntry[] = [];
    for (let s = 0; s < m.teamSize; s += 1) {
        theirs.push({ team: foeSide, controller: foe.create(), loadout: { ...foe.loadout } });
    }
    // Lineup order: team 0 slots first (eval/resim convention); snapshots align by lineup index.
    const lineups = m.side === 0 ? [...mine, ...theirs] : [...theirs, ...mine];
    const match = new Match(lineups, m.seed, { arena: m.arena });
    match.runToEnd();
    const snaps = match.robotSnapshots;
    const mySnaps = m.side === 0 ? snaps.slice(0, m.teamSize) : snaps.slice(m.teamSize);
    const foeSnaps = m.side === 0 ? snaps.slice(m.teamSize) : snaps.slice(0, m.teamSize);
    return { match, mine: mySnaps, foeDamage: foeSnaps.reduce((sum, s) => sum + s.damageDealt, 0), spies };
}

/** Run one genome over a team pool; every candidate slot carries a spy. */
export function evaluateTeamGenome(create: CreateFromGenome, genome: Genome, pool: TeamPoolMatch[]): GenomeEval {
    const matches: ScoredMatch[] = pool.map((m) => {
        const run = runTeamMatch(create, genome, m);
        const winner = run.match.result.winner;
        return {
            score: matchScore(winner, m.side),
            f: teamTiebreak({ mine: run.mine, foeDamage: run.foeDamage, endTick: run.match.result.tick, draw: winner === -1, spies: run.spies.map((s) => s.stats) }),
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

export interface TeamDetailedMatch extends ScoredMatch {
    spec: TeamPoolMatch;
    fingerprint: string;
}

/** Same scoring as evaluateTeamGenome, plus per-match fingerprints (validation). */
export function evaluateTeamDetailed(create: CreateFromGenome, genome: Genome, pool: TeamPoolMatch[]): TeamDetailedMatch[] {
    return pool.map((m) => {
        const run = runTeamMatch(create, genome, m);
        const winner = run.match.result.winner;
        return {
            spec: m,
            fingerprint: fingerprintMatch(run.match),
            score: matchScore(winner, m.side),
            f: teamTiebreak({ mine: run.mine, foeDamage: run.foeDamage, endTick: run.match.result.tick, draw: winner === -1, spies: run.spies.map((s) => s.stats) }),
        };
    });
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
