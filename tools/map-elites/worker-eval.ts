// MAP-Elites evaluation worker (bundled standalone, run under node worker_threads).
//
// Receives { id, items: [{ tag, tree }], cfg } and posts back
// { id, results: [{ tag, tree, profile, descr, cell, fit, eligible }] }.
// Opponents are reconstructed inside the worker from ids (functions cannot
// cross the thread boundary). Everything stays seeded.

import { parentPort } from 'node:worker_threads';
import { create as createHunter, loadout as hunterLoadout } from '../../src/robots/hunter';
import { create as createRusher, loadout as rusherLoadout } from '../../src/robots/rusher';
import { create as createGhost, loadout as ghostLoadout } from '../../src/robots/ghost';
import type { ArenaId } from '../../src/sim/constants';
import type { BTNode } from '../../src/robots/bt/tree';
import { evaluateME, type Competitor, type EvalConfig } from '../../src/robots/bt/mapelites/eval';

const OPPONENTS: Record<string, Competitor> = {
    hunter: { id: 'hunter', create: createHunter, loadout: hunterLoadout },
    rusher: { id: 'rusher', create: createRusher, loadout: rusherLoadout },
    ghost: { id: 'ghost', create: createGhost, loadout: ghostLoadout },
};

interface WorkItem {
    tag: number;
    tree: BTNode;
}

interface WorkCfg {
    opponentIds: string[];
    seedsPerPairing: number;
    arenas: ArenaId[];
    seedBase: number;
}

interface WorkMsg {
    id: number;
    items: WorkItem[];
    cfg: WorkCfg;
    /** Descriptors evaluated so far, canonical tag order (novelty source). */
    noveltyArchive: number[][];
}

const port = parentPort;
if (!port) throw new Error('worker-eval must run under worker_threads');

port.on('message', (msg: WorkMsg) => {
    const cfg: EvalConfig = {
        opponents: msg.cfg.opponentIds.map((id) => {
            const c = OPPONENTS[id];
            if (!c) throw new Error(`unknown opponent ${id}`);
            return c;
        }),
        seedsPerPairing: msg.cfg.seedsPerPairing,
        arenas: msg.cfg.arenas,
        seedBase: msg.cfg.seedBase,
    };
    // NOTE: novelty inside a parallel batch is computed against the archive
    // snapshot from batch start; the driver re-scores in canonical tag order,
    // so worker-side novelty is informational only.
    const results = msg.items.map((item) => {
        const ev = evaluateME(item.tree, cfg, item.tag, msg.noveltyArchive);
        return {
            tag: item.tag,
            tree: ev.tree,
            profile: ev.profile,
            descr: ev.descr,
            cell: ev.cell,
            fit: ev.fit,
            eligible: ev.eligible,
        };
    });
    port.postMessage({ id: msg.id, results });
});
