// MAP-Elites discovery loop (Phase 1, part B).
//
// Seeded end to end. Init: random trees (ramped half-and-half, like gp.ts).
// Iterate: sample parents uniformly from filled cells, vary with subtree
// crossover + mutation, simplify (the hardened substrate's bloat pass),
// evaluate in parallel, insert into the archive in canonical tag order.
// Elites are stored as schema-versioned genome JSONs with full provenance.
// Novelty is re-scored in the main thread against the canonical descriptor
// archive, so re-runs are byte-identical regardless of worker order.

import type { ArenaId } from '../../../sim/constants';
import { createRng, type Rand } from '../../../sim/rng';
import { cloneTree, simplifyTree, treeSize, type BTNode } from '../tree';
import { crossover, mutate, randomTree } from '../gp';
import {
    NOVELTY_WEIGHT,
    compareFitness,
    noveltyOf,
    type PoolEvalCfg,
    type PoolItem,
    type PoolResult,
} from './eval';
import { BehaviorArchive, eliteTree, meProvenance, type CellCoord } from './archive';

/** Anything that can evaluate a batch of trees in parallel (tools/map-elites/pool.ts). */
export interface BatchEvaluator {
    evaluate(items: PoolItem[], cfg: PoolEvalCfg, noveltyArchive: number[][]): Promise<PoolResult[]>;
}

export interface DiscoverConfig {
    seed: number;
    runId: string;
    init: number;
    iters: number;
    perIter: number;
    initDepth: number;
    maxNodes: number;
    crossoverRate: number;
    mutationRate: number;
    opponentIds: string[];
    seedsPerPairing: number;
    arenas: ArenaId[];
    seedBase: number;
    log?: (msg: string) => void;
}

export interface DiscoverStats {
    evals: number;
    matches: number;
    inserted: number;
    replaced: number;
    rejected: number;
    cellsFilled: number;
}

function rescore(r: PoolResult, noveltyArchive: number[][]): PoolResult {
    const novelty01 = noveltyOf(r.descr, noveltyArchive);
    const eligible = r.eligible; // computed in evaluateME against MIN_DRIVE_ACTIVITY
    return {
        ...r,
        fit: {
            score: eligible ? r.profile.wins + NOVELTY_WEIGHT * novelty01 : -1,
            wins: r.profile.wins,
            novelty01,
            kills: r.profile.kills,
            damage: r.profile.damageDealt,
            nodes: treeSize(r.tree),
        },
        eligible,
    };
}

export async function runMapElites(
    cfg: DiscoverConfig,
    pool: BatchEvaluator,
    poolCfg: PoolEvalCfg,
): Promise<{ archive: BehaviorArchive; stats: DiscoverStats }> {
    const log = cfg.log ?? ((): void => undefined);
    const r: Rand = createRng(cfg.seed);
    const archive = new BehaviorArchive();
    const noveltyArchive: number[][] = [];
    let tag = 0;
    let inserted = 0;
    let replaced = 0;
    let rejected = 0;

    const provenance = (gen: number) =>
        meProvenance(cfg.runId, cfg.seed, gen, [...cfg.opponentIds], cfg.arenas.map(String));

    const commit = (results: PoolResult[], gen: number): void => {
        for (const raw of results) {
            const res = rescore(raw, noveltyArchive);
            noveltyArchive.push([...res.descr]);
            const id = `bt-p1-${res.cell.join('')}`;
            const out = archive.tryInsert(
                id,
                res.tree,
                res.cell,
                res.descr,
                res.fit,
                res.profile,
                provenance(gen),
            );
            if (out === 'inserted') inserted += 1;
            else if (out === 'replaced') replaced += 1;
            else rejected += 1;
        }
    };

    // ---- init: ramped half-and-half random trees, simplified ----
    log(`init: ${cfg.init} random trees (seed ${cfg.seed})`);
    const initItems: PoolItem[] = Array.from({ length: cfg.init }, (_, i) => {
        const depth = 2 + (i % Math.max(1, cfg.initDepth - 1));
        const method = i % 2 === 0 ? 'full' : 'grow';
        const tree = simplifyTree(randomTree(r, depth, method));
        return { tag: tag++, tree };
    });
    commit(await pool.evaluate(initItems, poolCfg, []), 0);
    log(`init done: ${archive.size()}/81 cells filled`);

    // ---- iterate: sample cells, vary, simplify, evaluate, insert ----
    for (let gen = 1; gen <= cfg.iters; gen += 1) {
        const coords: CellCoord[] = archive.coordinates();
        if (coords.length === 0) {
            log(`gen ${gen}: archive empty, stopping`);
            break;
        }
        const items: PoolItem[] = [];
        for (let k = 0; k < cfg.perIter; k += 1) {
            const c1 = coords[Math.floor(r() * coords.length)] ?? coords[0]!;
            const p1 = archive.get(c1);
            if (!p1) continue;
            const t1 = eliteTree(p1);
            let child: BTNode;
            if (r() < cfg.crossoverRate) {
                const c2 = coords[Math.floor(r() * coords.length)] ?? coords[0]!;
                const p2 = archive.get(c2);
                child = p2 ? crossover(r, t1, eliteTree(p2), cfg.maxNodes) : cloneTree(t1);
            } else {
                child = cloneTree(t1);
            }
            if (r() < cfg.mutationRate) child = mutate(r, child);
            child = simplifyTree(child);
            if (treeSize(child) > cfg.maxNodes) child = cloneTree(t1);
            items.push({ tag: tag++, tree: child });
        }
        const results = await pool.evaluate(items, poolCfg, noveltyArchive);
        commit(results, gen);
        if (gen % 5 === 0 || gen === cfg.iters) {
            const best = archive
                .elites()
                .map((e) => e.fit)
                .sort(compareFitness)[0];
            log(
                `gen ${gen}: cells=${archive.size()}/81 evals=${tag} ` +
                    `best(score=${best?.score.toFixed(2)} wins=${best?.wins} nov=${best?.novelty01.toFixed(2)})`,
            );
        }
    }

    const evals = tag;
    // Actual matches: opponents x seed repetitions; the arena is selected per
    // repetition ((foe + rep) % arenas), not nested, so arenas do NOT multiply.
    const matches = evals * cfg.opponentIds.length * cfg.seedsPerPairing;
    return {
        archive,
        stats: { evals, matches, inserted, replaced, rejected, cellsFilled: archive.size() },
    };
}
