// Worker-thread pool for MAP-Elites evaluation.
//
// Fans evaluation batches across N workers (default: machine cores). Results
// always come back in canonical ascending tag order, so archive insertion
// order — and therefore novelty scoring — is identical run to run,
// regardless of which worker finishes first.

import { Worker } from 'node:worker_threads';
import type { PoolEvalCfg, PoolItem, PoolResult } from '../../src/robots/bt/mapelites/eval';

export type { PoolEvalCfg, PoolItem, PoolResult };

interface Pending {
    resolve: (r: PoolResult[]) => void;
    reject: (e: Error) => void;
    results: PoolResult[];
    remaining: number;
}

export class EvalPool {
    private workers: Worker[] = [];
    private nextId = 1;
    private pending = new Map<number, Pending>();

    constructor(workerPath: string, private size: number) {
        for (let i = 0; i < size; i += 1) {
            const w = new Worker(workerPath);
            w.on('message', (msg: { id: number; results: PoolResult[] }) => this.onMessage(msg));
            w.on('error', (e: Error) => this.onError(e));
            this.workers.push(w);
        }
    }

    private onMessage(msg: { id: number; results: PoolResult[] }): void {
        const p = this.pending.get(msg.id);
        if (!p) return;
        p.results.push(...msg.results);
        p.remaining -= 1;
        if (p.remaining === 0) {
            this.pending.delete(msg.id);
            p.results.sort((a, b) => a.tag - b.tag);
            p.resolve(p.results);
        }
    }

    private onError(e: Error): void {
        for (const [, p] of this.pending) p.reject(e);
        this.pending.clear();
    }

    /**
     * Evaluate items in parallel; resolves with results sorted by tag.
     * noveltyArchive is the canonical-order descriptor list evaluated so far.
     */
    evaluate(items: PoolItem[], cfg: PoolEvalCfg, noveltyArchive: number[][]): Promise<PoolResult[]> {
        if (items.length === 0) return Promise.resolve([]);
        const id = this.nextId++;
        const n = Math.min(this.size, items.length);
        const chunks: PoolItem[][] = Array.from({ length: n }, () => []);
        items.forEach((item, i) => {
            chunks[i % n]?.push(item);
        });
        return new Promise<PoolResult[]>((resolve, reject) => {
            const pending: Pending = { resolve, reject, results: [], remaining: n };
            this.pending.set(id, pending);
            chunks.forEach((chunk, i) => {
                this.workers[i]?.postMessage({
                    id,
                    items: chunk,
                    cfg: {
                        opponentIds: cfg.opponentIds,
                        seedsPerPairing: cfg.seedsPerPairing,
                        arenas: cfg.arenas,
                        seedBase: cfg.seedBase,
                    },
                    noveltyArchive,
                });
            });
        });
    }

    async close(): Promise<void> {
        await Promise.all(this.workers.map((w) => w.terminate()));
        this.workers = [];
    }
}
