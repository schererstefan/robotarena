// Eval pool: in-thread by default, worker_threads pull-queue behind --jobs N.
// Results are re-sorted by job index, so --jobs 1 and --jobs N reduce to
// byte-identical outputs.

import { Worker } from 'worker_threads';
import { runJob, type EvalRow } from './runner';
import type { MatchJob } from './schedule';

declare const __filename: string;

export async function runJobs(jobs: MatchJob[], jobsN: number): Promise<EvalRow[]> {
    const workers = Math.max(1, Math.min(Math.floor(jobsN) || 1, jobs.length || 1));
    if (workers <= 1 || jobs.length === 0) {
        return jobs.map((job) => runJob(job));
    }
    try {
        return await runPooled(jobs, workers);
    } catch (error) {
        console.warn(`worker pool failed (${error instanceof Error ? error.message : error}); falling back to in-thread`);
        return jobs.map((job) => runJob(job));
    }
}

interface ReadyMessage {
    type: 'ready';
}

interface ResultMessage {
    type: 'result';
    row: EvalRow;
}

function runPooled(jobs: MatchJob[], workers: number): Promise<EvalRow[]> {
    return new Promise((resolve, reject) => {
        const queue = [...jobs];
        const rows = new Map<number, EvalRow>();
        let exited = 0;
        let settled = false;
        const fail = (error: unknown): void => {
            if (settled) return;
            settled = true;
            reject(error instanceof Error ? error : new Error(String(error)));
        };
        for (let w = 0; w < workers; w += 1) {
            let worker: Worker;
            try {
                worker = new Worker(__filename, { workerData: { evalWorker: true } });
            } catch (error) {
                fail(error);
                return;
            }
            worker.on('message', (msg: ReadyMessage | ResultMessage) => {
                if (settled) return;
                if (msg.type === 'result') rows.set(msg.row.index, msg.row);
                // Both 'ready' and 'result' mean the worker wants more work.
                const next = queue.shift();
                if (next) worker.postMessage({ type: 'job', job: next });
                else worker.postMessage({ type: 'done' });
            });
            worker.on('error', fail);
            worker.on('exit', (code) => {
                if (code !== 0) {
                    fail(new Error(`eval worker exited with code ${code}`));
                    return;
                }
                exited += 1;
                if (exited === workers && !settled) {
                    settled = true;
                    resolve([...rows.values()].sort((a, b) => a.index - b.index));
                }
            });
        }
    });
}
