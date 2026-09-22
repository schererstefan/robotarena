// Duel + policy-probe worker (bundled standalone, node worker_threads).
//
// Two job kinds:
//   { kind: 'duel', a, b, seed, arena }  -> { winner: 0|1|2, ticks }
//   { kind: 'probe', tree, foeId, seed, arena } -> { counts: number[16][8] }
//
// Sides: { kind: 'tree', tree } (a MAP-Elites elite, BT_LOADOUT) or
// { kind: 'roster', id } (a roster bot with its own loadout).
//
// The probe records the elite's state->intent policy: 16 coarse states
// (dist x hp x pad) x 8 intent classes (drive x fire x dash). This is the
// conditional-entropy-style action|state metric for the diversity analysis.

import { parentPort } from 'node:worker_threads';
import { Match } from '../../src/sim/engine';
import type { ArenaId } from '../../src/sim/constants';
import type { RobotController, SenseState } from '../../src/sim/types';
import type { SkillLoadout } from '../../src/sim/skills';
import { cloneTree, type BTNode } from '../../src/robots/bt/tree';
import { createBTTreeBrain } from '../../src/robots/bt/brain';
import { BT_LOADOUT } from '../../src/robots/bt/gp';
import { rosterBot } from './roster';

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

function makeController(side: Side, tag: string): { controller: RobotController; loadout: SkillLoadout } {
    if (side.kind === 'roster') {
        const r = rosterBot(side.id);
        return { controller: r.create(), loadout: { ...r.loadout } };
    }
    const brain = createBTTreeBrain(cloneTree(side.tree));
    return {
        controller: {
            meta: { id: tag, name: tag, author: 'map-elites', version: '1.0.0', description: '' },
            update: (sense: SenseState) => brain.update(sense).intent,
        },
        loadout: { ...BT_LOADOUT },
    };
}

function runDuel(job: DuelJob): { key: string; winner: number; ticks: number; aDamage: number; bDamage: number } {
    const a = makeController(job.a, `${job.key}-a`);
    const b = makeController(job.b, `${job.key}-b`);
    const match = new Match(
        [
            { team: 0, controller: a.controller, loadout: a.loadout },
            { team: 1, controller: b.controller, loadout: b.loadout },
        ],
        job.seed,
        { arena: job.arena },
    );
    match.runToEnd();
    const snaps = match.robotSnapshots;
    return {
        key: job.key,
        winner: match.result.winner,
        ticks: match.result.tick,
        aDamage: snaps[0]?.damageDealt ?? 0,
        bDamage: snaps[1]?.damageDealt ?? 0,
    };
}

// ---- policy probe: state -> intent counts ----

// state: dist(0 none,1 close<240,2 mid<400,3 far) x hp(0 low<35%,1 ok) x pad(0/1 nearby)
const N_STATES = 16;
const N_INTENTS = 8; // drive(0/1) x fire(0/1) x dash(0/1)

function stateOf(sense: SenseState): number {
    const foe = sense.foes[0];
    const distBin = !foe ? 0 : (foe.distance ?? 9999) < 240 ? 1 : (foe.distance ?? 9999) < 400 ? 2 : 3;
    const hpBin = sense.self.health < 35 ? 0 : 1;
    const padBin = (sense.pickups?.length ?? 0) > 0 ? 1 : 0;
    return distBin * 4 + hpBin * 2 + padBin;
}

function runProbe(job: ProbeJob): { key: string; counts: number[][] } {
    const brain = createBTTreeBrain(cloneTree(job.tree));
    const foe = rosterBot(job.foeId);
    const counts: number[][] = Array.from({ length: N_STATES }, () => new Array(N_INTENTS).fill(0));
    const controller: RobotController = {
        meta: { id: job.key, name: job.key, author: 'map-elites', version: '1.0.0', description: '' },
        update: (sense: SenseState) => {
            const s = stateOf(sense);
            const out = brain.update(sense);
            const drive = out.intent.moveMode === 1 ? 1 : 0;
            const fire = out.intent.fire === true ? 1 : 0;
            const dash = out.intent.dash === true ? 1 : 0;
            const row = counts[s];
            if (row) row[drive * 4 + fire * 2 + dash] = (row[drive * 4 + fire * 2 + dash] ?? 0) + 1;
            return out.intent;
        },
    };
    const match = new Match(
        [
            { team: 0, controller, loadout: { ...BT_LOADOUT } },
            { team: 1, controller: foe.create(), loadout: { ...foe.loadout } },
        ],
        job.seed,
        { arena: job.arena },
    );
    match.runToEnd();
    return { key: job.key, counts };
}

const port = parentPort;
if (!port) throw new Error('worker-duel must run under worker_threads');

port.on('message', (msg: { id: number; jobs: Job[] }) => {
    const results = msg.jobs.map((job) => (job.kind === 'duel' ? runDuel(job) : runProbe(job)));
    port.postMessage({ id: msg.id, results });
});
