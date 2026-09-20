// Eval worker side: the bundle runs this instead of main() inside a
// worker_threads worker (see pool.ts). Pull protocol: the worker announces
// readiness, runs each job it receives, and exits on 'done'.

import { isMainThread, parentPort, workerData } from 'worker_threads';
import { runJob } from './runner';
import type { MatchJob } from './schedule';

export function isEvalWorker(): boolean {
    return !isMainThread && (workerData as { evalWorker?: boolean } | null)?.evalWorker === true;
}

interface JobMessage {
    type: 'job';
    job: MatchJob;
}

interface DoneMessage {
    type: 'done';
}

export function runEvalWorker(): void {
    const port = parentPort;
    if (!port) throw new Error('eval worker started without a parent port');
    port.on('message', (msg: JobMessage | DoneMessage) => {
        if (msg.type === 'done') {
            port.close();
            process.exit(0);
        }
        const row = runJob(msg.job);
        port.postMessage({ type: 'result', row });
    });
    port.postMessage({ type: 'ready' });
}
