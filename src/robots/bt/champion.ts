// N1 behavior-tree GP champion (compiled).
//
// Provenance: src/robots/bt/run-evolve.ts, run 3 — seed 20260924, pop 40,
// 24 generations, opponents hunter/rusher/ghost x2 seeds on open+blocks,
// selection on score = wins + 3.0*novelty with a minimal criterion
// (drive >= 15% of ticks; stationary turrets ineligible).
// Champion: score=6.59 wins=4 nov=0.86 kills=3 dmg=576 nodes=15.
//
// NOTE (Sep 22, 2026): the damage tie-break in the comparator was inverted
// (it preferred LOWER damage on ties). After the fix, the same seeded run
// produces this different champion (deterministic: two runs, same champion
// JSON MD5 6fff1d74c7316a33a673223f3af2f383). The earlier 3-node "Dervish"
// champion was an artifact of the buggy comparator and is retired.
//
// Champion tree (pruned of unreachable nodes; pruned == raw here, 15 nodes):
//   Sequence (4)
//   ├─ Sequence (3)
//   │  ├─ DO aim at nearest foe (lead, hold-to-fire)
//   │  ├─ Sequence (4)
//   │  │  ├─ DO drive to any pad
//   │  │  ├─ DO drive to safe-circle center
//   │  │  ├─ DO sweep tower (0.7)
//   │  │  └─ IF pad within 380u
//   │  └─ IF pad within 120u
//   ├─ DO dash at foe
//   ├─ IF hp below 35%
//   └─ Sequence (3)
//      ├─ DO aim at nearest foe (lead, hold-to-fire)
//      ├─ DO orbit foe counter-clockwise
//      └─ IF pad within 120u
//
// The mind, in words: hunt powerup pads (33 pickups / 12 probe matches),
// keep the gun tracking the nearest foe, and dash straight at them whenever
// the dash is ready. When hurt (hp < 35%) it drops into a tight
// counter-clockwise orbit instead. Probe: 7/12 wins, meanDistToFoe=303u,
// dashes=14, shots/match=24.5 — a pad-hunting skirmisher, not a turret.

import type { BTNode } from './tree';
import type { TreeFitnessSummary, TreeProvenance } from './serialization';

/** The champion: what the evolved tree actually does each tick. */
export const CHAMPION_TREE: BTNode = {
    kind: 'sequence',
    children: [
        {
            kind: 'sequence',
            children: [
                { kind: 'action', name: 'aim-nearest', params: [] },
                {
                    kind: 'sequence',
                    children: [
                        { kind: 'action', name: 'drive-to-pad', params: [0] },
                        { kind: 'action', name: 'drive-to-safety', params: [] },
                        { kind: 'action', name: 'scan', params: [0.7] },
                        { kind: 'condition', name: 'pad-nearby', params: [380] },
                    ],
                },
                { kind: 'condition', name: 'pad-nearby', params: [120] },
            ],
        },
        { kind: 'action', name: 'dash-at-foe', params: [] },
        { kind: 'condition', name: 'hp-below', params: [0.35] },
        {
            kind: 'sequence',
            children: [
                { kind: 'action', name: 'aim-nearest', params: [] },
                { kind: 'action', name: 'orbit-foe', params: [-1] },
                { kind: 'condition', name: 'pad-nearby', params: [120] },
            ],
        },
    ],
};

/**
 * Provenance for the genome JSON (src/robots/bt/genomes/moth-v0.2.0.genome.json).
 * The JSON file is the canonical experiment artifact; this literal stays the
 * in-game source of truth for the bt-n1 registration (btbot.ts).
 */
export const CHAMPION_PROVENANCE: TreeProvenance = {
    runId: 'n1-run3',
    algorithm: 'gp',
    seed: 20260924,
    generation: 24,
    opponents: ['hunter', 'rusher', 'ghost'],
    arenas: ['open', 'blocks'],
    notes: 'Moth v0.2.0 — re-evolved after fixing the inverted damage tie-break in the GP comparator (score 6.59).',
};

/** Fitness summary recorded for the champion at the end of run 3. */
export const CHAMPION_FITNESS: TreeFitnessSummary = {
    score: 6.59,
    wins: 4,
    novelty01: 0.86,
    kills: 3,
    damage: 576,
    nodes: 15,
};
