// MAP-Elites evaluation substrate (Phase 1, part B).
//
// Self-contained headless match runner for behavior-tree minds. Records an
// extended behavior profile per tree (range, mobility, pad appetite,
// specials usage, aggression, orbit tendency, fire rate) from the fitness
// matches themselves — no extra games. All seeded; no Math.random/Date.now.
//
// The axes binning below is the MAP-Elites archive grid: 4 axes x 3 bins =
// 81 cells. Axes were chosen from Phase 0 evidence to carve REAL behavioral
// differences (how the mind moves and fights), not stat variations.

import { Match } from '../../../sim/engine';
import { createRng, type Rand } from '../../../sim/rng';
import type { ArenaId } from '../../../sim/constants';
import type { RobotController, SenseState } from '../../../sim/types';
import type { SkillLoadout } from '../../../sim/skills';
import { cloneTree, pruneUnreachable, type BTNode } from '../tree';
import { createBTTreeBrain } from '../brain';
import { BT_LOADOUT, MIN_DRIVE_ACTIVITY, NOVELTY_WEIGHT } from '../gp';

export { BT_LOADOUT, MIN_DRIVE_ACTIVITY, NOVELTY_WEIGHT };

export interface Competitor {
    id: string;
    create: () => RobotController;
    loadout: SkillLoadout;
}

export interface EvalConfig {
    opponents: Competitor[];
    seedsPerPairing: number;
    arenas: ArenaId[];
    seedBase: number;
}

/** Raw per-tick accumulators, summed over all fitness matches. */
export interface MEStats {
    ticks: number;
    driveTicks: number;
    dashUses: number;
    empUses: number;
    pads: number;
    shots: number;
    distSum: number;
    distN: number;
    damageReceived: number;
    /** Circling the foe: accumulated |angular displacement| while engaged. */
    orbitAbs: number;
    orbitTicks: number;
}

const blankStats = (): MEStats => ({
    ticks: 0,
    driveTicks: 0,
    dashUses: 0,
    empUses: 0,
    pads: 0,
    shots: 0,
    distSum: 0,
    distN: 0,
    damageReceived: 0,
    orbitAbs: 0,
    orbitTicks: 0,
});

function wrapPi(a: number): number {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
}

export interface MatchResult {
    win: boolean;
    kills: number;
    damageDealt: number;
}

/** One headless 1v1, collecting extended behavior stats for the tree side. */
export function runMatchME(tree: BTNode, foe: Competitor, seed: number, arena: ArenaId, stats?: MEStats): MatchResult {
    const brain = createBTTreeBrain(cloneTree(tree));
    let prevAng: number | null = null;
    const controller: RobotController = {
        meta: { id: 'bt-me', name: 'BT-ME', author: 'map-elites', version: '1.0.0', description: 'map-elites candidate' },
        update: (sense: SenseState) => {
            if (stats) {
                stats.ticks += 1;
                const foe0 = sense.foes[0];
                if (foe0) {
                    stats.distSum += foe0.distance ?? 0;
                    stats.distN += 1;
                    const d = foe0.distance ?? 0;
                    if (d >= 60 && d <= 600) {
                        const ang = Math.atan2(sense.self.y - foe0.y, sense.self.x - foe0.x);
                        if (prevAng !== null) {
                            stats.orbitAbs += Math.abs(wrapPi(ang - prevAng));
                            stats.orbitTicks += 1;
                        }
                        prevAng = ang;
                    } else {
                        prevAng = null;
                    }
                } else {
                    prevAng = null;
                }
                for (const e of sense.events ?? []) {
                    if (e.kind === 'pickup') stats.pads += 1;
                    else if (e.kind === 'hit-by' || e.kind === 'blast' || e.kind === 'sudden-death-pulse') {
                        stats.damageReceived += e.amount ?? 0;
                    }
                }
            }
            const intent = brain.update(sense).intent;
            if (stats) {
                if (intent.moveMode === 1 || Math.abs(intent.throttle ?? 0) > 0.05 || Math.abs(intent.strafe ?? 0) > 0.05) {
                    stats.driveTicks += 1;
                }
                if (intent.dash === true) stats.dashUses += 1;
                if (intent.emp === true) stats.empUses += 1;
            }
            return intent;
        },
    };
    const match = new Match(
        [
            { team: 0, controller, loadout: { ...BT_LOADOUT } },
            { team: 1, controller: foe.create(), loadout: { ...foe.loadout } },
        ],
        seed,
        { arena },
    );
    let guard = 0;
    while (!match.result.over && guard < 30000) {
        match.step();
        guard += 1;
    }
    const me = match.robotSnapshots[0];
    if (stats) stats.shots += me?.shotsFired ?? 0;
    return { win: match.result.winner === 0, kills: me?.kills ?? 0, damageDealt: me?.damageDealt ?? 0 };
}

// ---- behavior profile -------------------------------------------------------

/** Human-legible per-match behavior summary. */
export interface BehaviorProfile {
    matches: number;
    meanDist: number;
    driveActivity: number;
    padsPerMatch: number;
    specialsPerMatch: number;
    aggression: number;
    meanAbsDA: number;
    shotsPerMatch: number;
    wins: number;
    kills: number;
    damageDealt: number;
    damageReceived: number;
}

export function profileOf(stats: MEStats, matches: number, wins: number, kills: number, damageDealt: number): BehaviorProfile {
    const m = Math.max(1, matches);
    const meanDist = stats.distN > 0 ? stats.distSum / stats.distN : 250;
    return {
        matches,
        meanDist,
        driveActivity: stats.ticks > 0 ? stats.driveTicks / stats.ticks : 0,
        padsPerMatch: stats.pads / m,
        specialsPerMatch: (stats.dashUses + stats.empUses) / m,
        aggression: damageDealt / (damageDealt + stats.damageReceived + 1),
        meanAbsDA: stats.orbitAbs / Math.max(1, stats.orbitTicks),
        shotsPerMatch: stats.shots / m,
        wins,
        kills,
        damageDealt,
        damageReceived: stats.damageReceived,
    };
}

/** Fixed-scale descriptor vector: novelty + honesty-analysis space. */
export function descriptorOf(p: BehaviorProfile): number[] {
    return [
        Math.min(1.5, p.meanDist / 500),
        p.driveActivity,
        Math.min(1.5, p.padsPerMatch / 2),
        Math.min(1.5, p.specialsPerMatch / 4),
        p.aggression,
        Math.min(1, p.meanAbsDA / 0.25),
        Math.min(1.5, p.shotsPerMatch / 120),
    ];
}

// ---- archive axes (4 x 3 = 81 cells) ------------------------------------------

export const AXIS_NAMES = ['range', 'mobility', 'pads', 'specials'] as const;
export const AXIS_BINS = 3;

function binRange(meanDist: number): number {
    if (meanDist < 240) return 0;
    if (meanDist < 400) return 1;
    return 2;
}
function binMobility(driveActivity: number): number {
    if (driveActivity < 0.45) return 0;
    if (driveActivity < 0.7) return 1;
    return 2;
}
function binPads(padsPerMatch: number): number {
    if (padsPerMatch === 0) return 0;
    if (padsPerMatch <= 2) return 1;
    return 2;
}
function binSpecials(specialsPerMatch: number): number {
    if (specialsPerMatch === 0) return 0;
    if (specialsPerMatch <= 2) return 1;
    return 2;
}

/** Cell coordinates [range, mobility, pads, specials], each 0..2. */
export function cellOf(p: BehaviorProfile): [number, number, number, number] {
    return [binRange(p.meanDist), binMobility(p.driveActivity), binPads(p.padsPerMatch), binSpecials(p.specialsPerMatch)];
}

export function cellKey(cell: [number, number, number, number]): string {
    return cell.join('');
}

export const CELL_LABELS: Record<string, string[]> = {
    range: ['close <240u', 'mid 240-400u', 'far >400u'],
    mobility: ['stalker 15-45%', 'mobile 45-70%', 'hyper 70%+'],
    pads: ['ignores pads', 'opportunist', 'pad farmer'],
    specials: ['no specials', 'occasional', 'specialist'],
};

export function describeCell(cell: [number, number, number, number]): string {
    return AXIS_NAMES.map((ax, i) => CELL_LABELS[ax]?.[cell[i] ?? 0] ?? '?').join(' / ');
}

// ---- selection (Phase 0 lesson: novelty + minimal criterion, NOT win-rate) ---

export interface Fitness {
    score: number;
    wins: number;
    novelty01: number;
    kills: number;
    damage: number;
    nodes: number;
}

/** Negative when a is better (for sort), 0 on full tie. Same as gp.ts. */
export function compareFitness(a: Fitness, b: Fitness): number {
    if (a.score !== b.score) return b.score - a.score;
    if (a.kills !== b.kills) return b.kills - a.kills;
    if (a.damage !== b.damage) return a.damage > b.damage ? -1 : 1;
    return a.nodes - b.nodes;
}

/** Mean distance to the K nearest archive descriptors, scaled to 0..1. */
export function noveltyOf(descr: number[], archive: number[][], k = 5, scale = 1.2): number {
    if (archive.length === 0) return 1;
    const dists = archive.map((a) => {
        let sum = 0;
        for (let i = 0; i < descr.length; i += 1) {
            const d = (descr[i] ?? 0) - (a[i] ?? 0);
            sum += d * d;
        }
        return Math.sqrt(sum);
    });
    dists.sort((x, y) => x - y);
    const kk = Math.min(k, dists.length);
    let sum = 0;
    for (let i = 0; i < kk; i += 1) sum += dists[i] ?? 0;
    return Math.min(1, sum / kk / scale);
}

export interface EvaluatedME {
    /** The pruned tree (what actually runs) — this is what the archive stores. */
    tree: BTNode;
    profile: BehaviorProfile;
    descr: number[];
    cell: [number, number, number, number];
    fit: Fitness;
    eligible: boolean;
}

/**
 * Evaluate one tree: matches vs all opponents (seeded tag scheme identical
 * to gp.ts so pilot numbers stay comparable to Phase 0), then profile,
 * descriptor, cell, and fitness. Novelty is computed against the caller
 * supplied descriptor archive — callers MUST pass archives in canonical
 * (tag) order for run-to-run determinism.
 */
export function evaluateME(rawTree: BTNode, cfg: EvalConfig, tag: number, noveltyArchive: number[][]): EvaluatedME {
    const tree = pruneUnreachable(cloneTree(rawTree));
    let wins = 0;
    let kills = 0;
    let damageDealt = 0;
    let matches = 0;
    const stats = blankStats();
    cfg.opponents.forEach((foe, fi) => {
        for (let rep = 0; rep < cfg.seedsPerPairing; rep += 1) {
            const seed = (cfg.seedBase + tag * 7919 + fi * 131 + rep * 17) >>> 0;
            const arena = cfg.arenas[(fi + rep) % cfg.arenas.length] ?? 'open';
            const s = runMatchME(tree, foe, seed, arena, stats);
            if (s.win) wins += 1;
            kills += s.kills;
            damageDealt += s.damageDealt;
            matches += 1;
        }
    });
    const profile = profileOf(stats, matches, wins, kills, damageDealt);
    const descr = descriptorOf(profile);
    const novelty01 = noveltyOf(descr, noveltyArchive);
    const eligible = profile.driveActivity >= MIN_DRIVE_ACTIVITY;
    const fit: Fitness = {
        score: eligible ? wins + NOVELTY_WEIGHT * novelty01 : -1,
        wins,
        novelty01,
        kills,
        damage: damageDealt,
        nodes: 0, // filled in by the caller (needs the pruned tree size)
    };
    return { tree, profile, descr, cell: cellOf(profile), fit, eligible };
}

export { createRng, type Rand };

/** Worker-pool message types (implemented by tools/map-elites/pool.ts). */
export interface PoolEvalCfg {
    opponentIds: string[];
    seedsPerPairing: number;
    arenas: ArenaId[];
    seedBase: number;
}

export interface PoolItem {
    tag: number;
    tree: BTNode;
}

export interface PoolResult {
    tag: number;
    tree: BTNode;
    profile: BehaviorProfile;
    descr: number[];
    cell: [number, number, number, number];
    fit: Fitness;
    eligible: boolean;
}
