// Repertoire evaluation: round-robin + vs roster + ELO + behavior diversity.
//
// For each elite in a MAP-Elites archive:
//   1. Repertoire round-robin: every elite pair, 1v1, 4 seeds x 2 arenas.
//   2. Vs roster: every elite vs 8 base + 8 hc1 + hunter-hc2 + bt-n1, same seeds.
//   3. ELO from all duels (canonical order, K=32, start 1200).
//   4. Behavior diversity: descriptor distances + state->intent policy probes
//      (per-elite conditional entropy H(intent|state), repertoire mean
//      pairwise JS divergence, state/intent coverage).
//
// All seeded; duel seeds derive from a fixed base so re-runs match.

import { readFileSync, writeFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { ArenaId } from '../../src/sim/constants';
import type { BTNode } from '../../src/robots/bt/tree';
import { eliteTree, type ArchiveCellJSON, type ArchiveJSON } from '../../src/robots/bt/mapelites/archive';
import { ROSTER_IDS } from './roster';

interface Elite {
    id: string;
    tree: BTNode;
    descr: number[];
}

const ARENAS: ArenaId[] = ['open', 'blocks'];
const SEEDS_PER_ARENA = 4;
const DUEL_SEED_BASE = 500000;
const PROBE_SEED_BASE = 777000;
const PROBE_FOES = ['hunter', 'rusher', 'ghost'];

type Side = { kind: 'tree'; tree: BTNode } | { kind: 'roster'; id: string };
interface DuelJob {
    kind: 'duel';
    key: string;
    a: Side;
    b: Side;
    seed: number;
    arena: ArenaId;
}
interface ProbeJob {
    kind: 'probe';
    key: string;
    tree: BTNode;
    foeId: string;
    seed: number;
    arena: ArenaId;
}
type Job = DuelJob | ProbeJob;

interface DuelResult {
    key: string;
    winner: number;
    ticks: number;
    aDamage: number;
    bDamage: number;
}
interface ProbeResult {
    key: string;
    counts: number[][];
}

class DuelPool {
    private workers: Worker[] = [];
    private nextId = 1;
    private pending = new Map<number, { resolve: (r: unknown[]) => void; reject: (e: Error) => void; out: unknown[]; remaining: number }>();

    constructor(workerPath: string, private size: number) {
        for (let i = 0; i < size; i += 1) {
            const w = new Worker(workerPath);
            w.on('message', (msg: { id: number; results: unknown[] }) => {
                const p = this.pending.get(msg.id);
                if (!p) return;
                p.out.push(...msg.results);
                p.remaining -= 1;
                if (p.remaining === 0) {
                    this.pending.delete(msg.id);
                    p.resolve(p.out);
                }
            });
            w.on('error', (e: Error) => {
                for (const [, p] of this.pending) p.reject(e);
                this.pending.clear();
            });
            this.workers.push(w);
        }
    }

    run(jobs: Job[]): Promise<unknown[]> {
        if (jobs.length === 0) return Promise.resolve([]);
        const id = this.nextId++;
        const n = Math.min(this.size, jobs.length);
        const chunks: Job[][] = Array.from({ length: n }, () => []);
        jobs.forEach((j, i) => {
            chunks[i % n]?.push(j);
        });
        return new Promise<unknown[]>((resolve, reject) => {
            this.pending.set(id, { resolve, reject, out: [], remaining: n });
            chunks.forEach((chunk, i) => this.workers[i]?.postMessage({ id, jobs: chunk }));
        });
    }

    async close(): Promise<void> {
        await Promise.all(this.workers.map((w) => w.terminate()));
        this.workers = [];
    }
}

function duelKey(a: string, b: string, seed: number, arena: string): string {
    return `duel:${a}:vs:${b}:${arena}:${seed}`;
}

function buildDuels(elites: Elite[]): DuelJob[] {
    const jobs: DuelJob[] = [];
    let pair = 0;
    const push = (aId: string, bId: string, a: Side, b: Side): void => {
        for (const arena of ARENAS) {
            for (let s = 0; s < SEEDS_PER_ARENA; s += 1) {
                const seed = (DUEL_SEED_BASE + pair * 1000 + ARENAS.indexOf(arena) * 101 + s * 17) >>> 0;
                jobs.push({ kind: 'duel', key: duelKey(aId, bId, seed, arena), a, b, seed, arena });
            }
        }
        pair += 1;
    };
    // repertoire round-robin
    for (let i = 0; i < elites.length; i += 1) {
        for (let j = i + 1; j < elites.length; j += 1) {
            const ea = elites[i]!;
            const eb = elites[j]!;
            push(ea.id, eb.id, { kind: 'tree', tree: ea.tree }, { kind: 'tree', tree: eb.tree });
        }
    }
    // vs roster
    for (const e of elites) {
        for (const rid of ROSTER_IDS) {
            push(e.id, rid, { kind: 'tree', tree: e.tree }, { kind: 'roster', id: rid });
        }
    }
    return jobs;
}

function buildProbes(elites: Elite[]): ProbeJob[] {
    const jobs: ProbeJob[] = [];
    for (const e of elites) {
        for (const foeId of PROBE_FOES) {
            for (const arena of ARENAS) {
                for (let s = 0; s < 2; s += 1) {
                    const seed = (PROBE_SEED_BASE + PROBE_FOES.indexOf(foeId) * 1000 + ARENAS.indexOf(arena) * 101 + s * 17) >>> 0;
                    jobs.push({ kind: 'probe', key: `probe:${e.id}:${foeId}:${arena}:${seed}`, tree: e.tree, foeId, seed, arena });
                }
            }
        }
    }
    return jobs;
}

// ---- ELO ----

function computeElo(results: DuelResult[]): { elo: Record<string, number>; wins: Record<string, number>; losses: Record<string, number> } {
    const elo: Record<string, number> = {};
    const wins: Record<string, number> = {};
    const losses: Record<string, number> = {};
    const K = 32;
    const ensure = (id: string): void => {
        if (elo[id] === undefined) {
            elo[id] = 1200;
            wins[id] = 0;
            losses[id] = 0;
        }
    };
    const sorted = [...results].sort((a, b) => (a.key < b.key ? -1 : 1));
    for (const r of sorted) {
        const m = /^duel:(.+):vs:(.+):([^:]+):(\d+)$/.exec(r.key);
        if (!m) continue;
        const aId = m[1] as string;
        const bId = m[2] as string;
        ensure(aId);
        ensure(bId);
        const ra = elo[aId] as number;
        const rb = elo[bId] as number;
        const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
        const sa = r.winner === 0 ? 1 : r.winner === 1 ? 0 : 0.5;
        elo[aId] = ra + K * (sa - ea);
        elo[bId] = rb + K * ((1 - sa) - (1 - ea));
        if (r.winner === 0) {
            wins[aId] = (wins[aId] ?? 0) + 1;
            losses[bId] = (losses[bId] ?? 0) + 1;
        } else if (r.winner === 1) {
            wins[bId] = (wins[bId] ?? 0) + 1;
            losses[aId] = (losses[aId] ?? 0) + 1;
        }
    }
    return { elo, wins, losses };
}

// ---- diversity: policy entropy + JS divergence ----

function normalizeCounts(counts: number[][]): number[][] {
    return counts.map((row) => {
        const sum = row.reduce((a, b) => a + b, 0);
        return sum > 0 ? row.map((c) => c / sum) : row.map(() => 1 / row.length);
    });
}

function entropy(p: number[]): number {
    let h = 0;
    for (const x of p) if (x > 0) h -= x * Math.log2(x);
    return h;
}

/** Mean state-conditional entropy, weighted by state visit frequency. */
function policyEntropy(counts: number[][]): { mean: number; visited: number } {
    const total = counts.flat().reduce((a, b) => a + b, 0);
    let acc = 0;
    let visited = 0;
    for (const row of counts) {
        const sum = row.reduce((a, b) => a + b, 0);
        if (sum === 0) continue;
        visited += 1;
        acc += (sum / total) * entropy(row.map((c) => c / sum));
    }
    return { mean: acc, visited };
}

function jsDivergence(p: number[][], q: number[][]): number {
    let js = 0;
    let w = 0;
    for (let s = 0; s < p.length; s += 1) {
        const pr = p[s] as number[];
        const qr = q[s] as number[];
        const wp = pr.reduce((a, b) => a + b, 0);
        const wq = qr.reduce((a, b) => a + b, 0);
        if (wp === 0 || wq === 0) continue;
        const pn = pr.map((c) => c / wp);
        const qn = qr.map((c) => c / wq);
        const m = pn.map((x, i) => (x + (qn[i] ?? 0)) / 2);
        let kl = 0;
        for (let i = 0; i < pn.length; i += 1) {
            const x = pn[i] ?? 0;
            const y = qn[i] ?? 0;
            const mm = m[i] ?? 1;
            if (x > 0) kl += x * Math.log2(x / mm);
            if (y > 0) kl += y * Math.log2(y / mm);
        }
        js += (wp + wq) * (kl / 2);
        w += wp + wq;
    }
    return w > 0 ? js / w : 0;
}

function descrDist(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i += 1) {
        const d = (a[i] ?? 0) - (b[i] ?? 0);
        sum += d * d;
    }
    return Math.sqrt(sum);
}

// ---- main ----

function arg(name: string, def: string): string {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < process.argv.length ? (process.argv[i + 1] as string) : def;
}

const archivePath = arg('archive', '/tmp/p1b-archive.json');
const out = arg('out', '/tmp/p1b-eval.json');
const jobs = Number(arg('jobs', '8'));
const defaultWorker = resolve(dirname(fileURLToPath(import.meta.url)), 'run-eval.worker.mjs');
const workerPath = arg('worker', defaultWorker);

const archiveJson = JSON.parse(readFileSync(archivePath, 'utf8')) as ArchiveJSON;
const elites: Elite[] = (archiveJson.cells as ArchiveCellJSON[]).map((c) => ({
    id: c.id,
    tree: eliteTree(c),
    descr: c.descr,
}));

const pool = new DuelPool(workerPath, jobs);
try {
    console.log(`[eval] ${elites.length} elites: building duels...`);
    const duels = buildDuels(elites);
    const probes = buildProbes(elites);
    console.log(`[eval] ${duels.length} duels + ${probes.length} probes`);
    const duelResults = (await pool.run(duels)) as DuelResult[];
    const probeResults = (await pool.run(probes)) as ProbeResult[];

    const { elo, wins, losses } = computeElo(duelResults);

    // aggregate probe counts per elite
    const policyById = new Map<string, number[][]>();
    for (const pr of probeResults) {
        const id = pr.key.split(':')[1] as string;
        const acc = policyById.get(id) ?? Array.from({ length: 16 }, () => new Array(8).fill(0));
        for (let s = 0; s < 16; s += 1) {
            for (let a = 0; a < 8; a += 1) {
                const row = acc[s] as number[];
                row[a] = (row[a] ?? 0) + ((pr.counts[s] as number[])[a] ?? 0);
            }
        }
        policyById.set(id, acc);
    }

    const policyStats: Record<string, { entropy: number; statesVisited: number }> = {};
    for (const e of elites) {
        const counts = policyById.get(e.id) ?? [];
        const { mean, visited } = policyEntropy(counts);
        policyStats[e.id] = { entropy: mean, statesVisited: visited };
    }

    // mean pairwise JS divergence over the repertoire (policy space)
    const ids = elites.map((e) => e.id);
    let jsSum = 0;
    let jsN = 0;
    for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
            const a = policyById.get(ids[i] as string) ?? [];
            const b = policyById.get(ids[j] as string) ?? [];
            jsSum += jsDivergence(normalizeCounts(a), normalizeCounts(b));
            jsN += 1;
        }
    }

    // mean pairwise descriptor distance
    let ddSum = 0;
    let ddN = 0;
    for (let i = 0; i < elites.length; i += 1) {
        for (let j = i + 1; j < elites.length; j += 1) {
            ddSum += descrDist(elites[i]?.descr ?? [], elites[j]?.descr ?? []);
            ddN += 1;
        }
    }

    // state/intent coverage across the repertoire
    const covered = new Set<string>();
    for (const [, counts] of policyById) {
        for (let s = 0; s < 16; s += 1) {
            for (let a = 0; a < 8; a += 1) {
                if (((counts[s] as number[])[a] ?? 0) > 0) covered.add(`${s}:${a}`);
            }
        }
    }

    const result = {
        archive: archivePath,
        elites: ids,
        elo,
        wins,
        losses,
        policyStats,
        diversity: {
            meanPairwiseJSDivergence: jsN > 0 ? jsSum / jsN : 0,
            meanPairwiseDescrDist: ddN > 0 ? ddSum / ddN : 0,
            stateIntentCoverage: covered.size / (16 * 8),
            cellsFilled: elites.length,
        },
    };
    writeFileSync(out, JSON.stringify(result, null, 1));
    console.log(`[eval] wrote ${out}`);

    const ranked = [...ids].sort((a, b) => (elo[b] ?? 0) - (elo[a] ?? 0));
    console.log('[eval] ELO (top 15):');
    for (const id of ranked.slice(0, 15)) {
        const w = wins[id] ?? 0;
        const l = losses[id] ?? 0;
        const wr = w + l > 0 ? ((100 * w) / (w + l)).toFixed(0) : '-';
        console.log(`[eval]   ${id}: ${(elo[id] ?? 0).toFixed(0)} (${w}W/${l}L ${wr}%) H=${(policyStats[id]?.entropy ?? 0).toFixed(2)}`);
    }
    console.log(
        `[eval] diversity: meanPairwiseJS=${result.diversity.meanPairwiseJSDivergence.toFixed(3)} ` +
            `meanDescrDist=${result.diversity.meanPairwiseDescrDist.toFixed(3)} ` +
            `coverage=${(result.diversity.stateIntentCoverage * 100).toFixed(1)}%`,
    );
} finally {
    await pool.close();
}
