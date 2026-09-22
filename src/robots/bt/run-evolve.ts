// Headless GP driver for the N1 behavior-tree spike.
//
// Bundle + run (no tsc dependency on node types — config is constants):
//   npx esbuild src/robots/bt/run-evolve.ts --bundle --platform=node \
//       --format=esm --outfile=/tmp/robotarena-evolve-bt.mjs --log-level=warning \
//   && node /tmp/robotarena-evolve-bt.mjs
//
// Prints: per-generation best, the champion's full printed tree, the
// champion as a JSON literal (paste into champion.ts), and a behavior probe.

import { BT_LOADOUT, MIN_DRIVE_ACTIVITY, NOVELTY_WEIGHT, probeBehavior, runEvolution, type Competitor } from './gp';
import { printTree, pruneUnreachable, treeSize } from './tree';
import { create as createHunter, loadout as hunterLoadout } from '../hunter';
import { create as createRusher, loadout as rusherLoadout } from '../rusher';
import { create as createGhost, loadout as ghostLoadout } from '../ghost';

// ---- run config (edit between runs; everything stays seeded) ----
// Run 1 (seed 20260922, no novelty): champion was a 1-node turret.
// Run 3 (this): novelty weight 3.0 + minimal criterion (must drive >=15%
// of ticks) + dead-code pruning of the champion before printing.
const SEED = 20260924;
const POP_SIZE = 40;
const GENERATIONS = 24;

const OPPONENTS: Competitor[] = [
    { id: 'hunter', create: createHunter, loadout: hunterLoadout },
    { id: 'rusher', create: createRusher, loadout: rusherLoadout },
    { id: 'ghost', create: createGhost, loadout: ghostLoadout },
];

const result = runEvolution({
    seed: SEED,
    popSize: POP_SIZE,
    generations: GENERATIONS,
    initDepth: 4,
    maxNodes: 60,
    tournamentSize: 4,
    crossoverRate: 0.8,
    mutationRate: 0.3,
    elite: 2,
    opponents: OPPONENTS,
    seedsPerPairing: 2,
    arenas: ['open', 'blocks'],
    seedBase: 1000,
    log: (msg: string) => console.log(`[evolve] ${msg}`),
});

const champ = result.champion;
const pruned = pruneUnreachable(champ.tree);
console.log(`\n[evolve] loadout: ${JSON.stringify(BT_LOADOUT)} noveltyWeight=${NOVELTY_WEIGHT} minDrive=${MIN_DRIVE_ACTIVITY}`);
console.log(
    `[evolve] champion fitness: score=${champ.fit.score.toFixed(2)} wins=${champ.fit.wins} ` +
        `nov=${champ.fit.novelty01.toFixed(2)} kills=${champ.fit.kills} ` +
        `dmg=${Math.round(champ.fit.damage)} nodes=${champ.fit.nodes} prunedNodes=${treeSize(pruned)}`,
);
console.log('\n===== CHAMPION TREE (read the mind) =====');
console.log(printTree(champ.tree));
console.log('\n===== CHAMPION TREE, PRUNED (what actually runs) =====');
console.log(printTree(pruned));
console.log('===== CHAMPION JSON (for champion.ts) =====');
console.log(JSON.stringify(pruned));

console.log('\n===== BEHAVIOR PROBE (fresh seeds, pruned champion) =====');
const probe = probeBehavior(pruned, {
    opponents: OPPONENTS,
    seedsPerPairing: 4,
    arenas: ['open', 'blocks'],
    seedBase: 777000,
});
console.log(
    `[probe] ${probe.wins}/${probe.matches} wins, ` +
        `meanDistToFoe=${Math.round(probe.meanDistToFoe)}u, ` +
        `dashes=${probe.dashUses}, emps=${probe.empUses}, padPickups=${probe.padPickups}, ` +
        `shots/match=${probe.shotsPerMatch.toFixed(1)}`,
);
