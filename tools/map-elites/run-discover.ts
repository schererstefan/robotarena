// CLI: MAP-Elites behavior discovery driver.
//
// Bundle + run:
//   npx esbuild src/robots/bt/mapelites/run-discover.ts --bundle --platform=node \
//       --format=esm --outfile=/tmp/p1b/run-discover.mjs --log-level=warning
//   npx esbuild src/robots/bt/mapelites/worker-eval.ts --bundle --platform=node \
//       --format=esm --outfile=/tmp/p1b/run-discover.worker.mjs --log-level=warning \
//       --external:node:worker_threads
//   node /tmp/p1b/run-discover.mjs --seed 20260922 --init 60 --iters 8 \
//       --per-iter 24 --jobs 8 --out /tmp/p1b/archive-pilot.json
//
// Writes the archive JSON. Deterministic: same flags + seed => same archive
// (worker completion order cannot affect insertion order).

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { ArenaId } from '../../src/sim/constants';
import { runMapElites, type DiscoverConfig } from '../../src/robots/bt/mapelites/discover';
import { EvalPool, type PoolEvalCfg } from './pool';

function arg(name: string, def: string): string {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < process.argv.length ? (process.argv[i + 1] as string) : def;
}

const seed = Number(arg('seed', '20260922'));
const runId = arg('run-id', `mapelites-${seed}`);
const init = Number(arg('init', '200'));
const iters = Number(arg('iters', '50'));
const perIter = Number(arg('per-iter', '80'));
const jobs = Number(arg('jobs', '8'));
const out = arg('out', '/tmp/p1b-archive.json');
const seedsPerPairing = Number(arg('seeds-per-pairing', '2'));
const arenas = arg('arenas', 'open,blocks').split(',') as ArenaId[];
const seedBase = Number(arg('seed-base', '1000'));
const opponentIds = arg('opponents', 'hunter,rusher,ghost').split(',');
const defaultWorker = resolve(dirname(fileURLToPath(import.meta.url)), 'run-discover.worker.mjs');
const workerPath = arg('worker', defaultWorker);

const cfg: DiscoverConfig = {
    seed,
    runId,
    init,
    iters,
    perIter,
    initDepth: 4,
    maxNodes: 60,
    crossoverRate: 0.8,
    mutationRate: 0.3,
    opponentIds,
    seedsPerPairing,
    arenas,
    seedBase,
    log: (m) => console.log(`[discover] ${m}`),
};

const poolCfg: PoolEvalCfg = { opponentIds, seedsPerPairing, arenas, seedBase };

const t0 = process.hrtime.bigint();
const pool = new EvalPool(workerPath, jobs);
try {
    const { archive, stats } = await runMapElites(cfg, pool, poolCfg);
    const json = archive.toJSON({
        runId,
        seed,
        init,
        iters,
        perIter,
        jobs,
        opponents: opponentIds.join(','),
        seedsPerPairing,
        arenas: arenas.join(','),
        seedBase,
    });
    writeFileSync(out, JSON.stringify(json));
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(
        `[discover] done: cells=${stats.cellsFilled}/81 evals=${stats.evals} matches=${stats.matches} ` +
            `inserted=${stats.inserted} replaced=${stats.replaced} rejected=${stats.rejected} ` +
            `wall=${(ms / 1000).toFixed(1)}s (${(stats.matches / (ms / 1000)).toFixed(0)} matches/s) -> ${out}`,
    );
    for (const e of archive.elites()) {
        const p = e.profile;
        console.log(
            `[cell] ${e.id} [${e.cell.join('')}] wins=${p.wins}/${p.matches} nov=${e.fit.novelty01.toFixed(2)} ` +
                `dist=${p.meanDist.toFixed(0)}u drive=${(p.driveActivity * 100).toFixed(0)}% ` +
                `pads=${p.padsPerMatch.toFixed(1)}/m spec=${p.specialsPerMatch.toFixed(1)}/m ` +
                `agg=${p.aggression.toFixed(2)} nodes=${e.nodes} gen=${e.provenance.generation}`,
        );
    }
} finally {
    await pool.close();
}
