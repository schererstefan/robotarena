// Season 1 duel worker: runs one 1v1 with drama telemetry.
// Bundled standalone (node worker_threads). Job:
//   { kind: 'duel', key, aTree, bTree, seed, arena }
// Result:
//   { key, winner, ticks, suddenDeath, hpA, hpB, maxHp, killsA, killsB,
//     dmgA, dmgB, shotsA, shotsB, ko, comeback, minDeficitWinner, samples }
// winner: 0 | 1 | -1 (draw). comeback: the winner trailed by >=40% maxHp at
// some 90-tick sample and still won. minDeficitWinner: worst (winnerHp -
// loserHp) seen by the eventual winner across samples (negative = trailed).

import { parentPort } from 'node:worker_threads';
import { Match } from '../../src/sim/engine';
import type { ArenaId } from '../../src/sim/constants';
import type { RobotController } from '../../src/sim/types';
import { cloneTree, type BTNode } from '../../src/robots/bt/tree';
import { createBTTreeBrain } from '../../src/robots/bt/brain';
import { BT_LOADOUT } from '../../src/robots/bt/gp';

interface DuelJob {
    kind: 'duel';
    key: string;
    aTree: BTNode;
    bTree: BTNode;
    seed: number;
    arena: ArenaId;
}

interface DuelResult {
    key: string;
    winner: number;
    /** Deciding seed (== job seed unless the shootout advanced it). */
    seed: number;
    /** Shootout re-seeds used: 0 = decided on the opening seed. */
    shootout: number;
    ticks: number;
    suddenDeath: boolean;
    hpA: number;
    hpB: number;
    maxHp: number;
    killsA: number;
    killsB: number;
    dmgA: number;
    dmgB: number;
    shotsA: number;
    shotsB: number;
    ko: boolean;
    comeback: boolean;
    minDeficitWinner: number;
}

function makeController(tree: BTNode, tag: string): RobotController {
    const brain = createBTTreeBrain(cloneTree(tree));
    return {
        meta: { id: tag, name: tag, author: 'league-season1', version: '1.0.0', description: '' },
        update: (sense) => brain.update(sense).intent,
    };
}

const SAMPLE_EVERY = 90;
/** Shootout cap: mutual-kill draws re-seed until decisive. */
const SHOOTOUT_MAX = 32;

interface SimOut {
    winner: number;
    ticks: number;
    suddenDeath: boolean;
    hpA: number;
    hpB: number;
    maxHp: number;
    killsA: number;
    killsB: number;
    dmgA: number;
    dmgB: number;
    shotsA: number;
    shotsB: number;
    minDeficitWinner: number;
}

function simOnce(aTree: BTNode, bTree: BTNode, seed: number, arena: ArenaId, tag: string): SimOut {
    const match = new Match(
        [
            { team: 0, controller: makeController(aTree, `${tag}-a`), loadout: { ...BT_LOADOUT } },
            { team: 1, controller: makeController(bTree, `${tag}-b`), loadout: { ...BT_LOADOUT } },
        ],
        seed,
        { arena },
    );
    let minDefA = Infinity;
    let minDefB = Infinity;
    let guard = 0;
    const maxGuard = 200000;
    while (!match.over && guard < maxGuard) {
        match.step();
        guard += 1;
        if (match.tick % SAMPLE_EVERY === 0) {
            const snaps = match.robotSnapshots;
            const a = snaps.find((s) => s.team === 0);
            const b = snaps.find((s) => s.team === 1);
            if (a && b) {
                const defA = a.health - b.health;
                if (defA < minDefA) minDefA = defA;
                if (-defA < minDefB) minDefB = -defA;
            }
        }
    }
    const result = match.result;
    const snaps = match.robotSnapshots;
    const a = snaps.find((s) => s.team === 0);
    const b = snaps.find((s) => s.team === 1);
    const maxHp = Math.max(a?.maxHealth ?? 100, b?.maxHealth ?? 100, 1);
    const winner = result.winner;
    const minDeficitWinner = winner === 0 ? minDefA : winner === 1 ? minDefB : 0;
    return {
        winner,
        ticks: result.tick,
        suddenDeath: result.suddenDeath,
        hpA: a?.health ?? 0,
        hpB: b?.health ?? 0,
        maxHp,
        killsA: a?.kills ?? 0,
        killsB: b?.kills ?? 0,
        dmgA: a?.damageDealt ?? 0,
        dmgB: b?.damageDealt ?? 0,
        shotsA: a?.shotsFired ?? 0,
        shotsB: b?.shotsFired ?? 0,
        minDeficitWinner: Number.isFinite(minDeficitWinner) ? minDeficitWinner : 0,
    };
}

// Shootout rule: a mutual-kill draw (winner -1) re-runs at seed+1, seed+2,
// ... until decisive. Deterministic; the deciding seed is what the replay
// code pins.
function runDuel(job: DuelJob): DuelResult {
    let seed = job.seed;
    let shootout = 0;
    let sim = simOnce(job.aTree, job.bTree, seed, job.arena, job.key);
    while (sim.winner === -1 && shootout < SHOOTOUT_MAX) {
        seed += 1;
        shootout += 1;
        sim = simOnce(job.aTree, job.bTree, seed, job.arena, job.key);
    }
    const ko = sim.winner >= 0 && (sim.winner === 0 ? sim.hpB : sim.hpA) <= 0;
    return {
        key: job.key,
        winner: sim.winner,
        seed,
        shootout,
        ticks: sim.ticks,
        suddenDeath: sim.suddenDeath,
        hpA: sim.hpA,
        hpB: sim.hpB,
        maxHp: sim.maxHp,
        killsA: sim.killsA,
        killsB: sim.killsB,
        dmgA: sim.dmgA,
        dmgB: sim.dmgB,
        shotsA: sim.shotsA,
        shotsB: sim.shotsB,
        ko,
        comeback: sim.winner >= 0 && sim.minDeficitWinner <= -0.4 * sim.maxHp,
        minDeficitWinner: sim.minDeficitWinner,
    };
}

const port = parentPort;
if (!port) throw new Error('worker-season must run under worker_threads');

port.on('message', (msg: { id: number; jobs: DuelJob[] }) => {
    const results = msg.jobs.map(runDuel);
    port.postMessage({ id: msg.id, results });
});
