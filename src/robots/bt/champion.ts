// N1 behavior-tree GP champion (compiled).
//
// Provenance: src/robots/bt/run-evolve.ts, run 3 — seed 20260924, pop 40,
// 24 generations, opponents hunter/rusher/ghost x2 seeds on open+blocks,
// selection on score = wins + 3.0*novelty with a minimal criterion
// (drive >= 15% of ticks; stationary turrets ineligible).
// Champion: score=5.78 wins=4 nov=0.59 kills=3 dmg=636 nodes=21.
//
// The raw 21-node champion's effective behavior was verified identical to
// the 3-node core below (probe on 12 fixed matches: wins, meanDistToFoe,
// dashes, emps, padPickups, shots all exactly equal — see
// /private/tmp/bt-evolve-3.log). This file registers the core: the mind
// the tree actually runs, with nothing unreachable to misread.
//
// Raw champion (what GP printed):
//   Sequence (4)
//   ├─ Selector (3)
//   │  ├─ Sequence (3)
//   │  │  ├─ DO aim at nearest foe (lead, hold-to-fire)
//   │  │  ├─ DO orbit foe counter-clockwise
//   │  │  └─ IF pad within 120u
//   │  ├─ IF just got hit
//   │  └─ DO orbit foe clockwise
//   ├─ DO dash at foe
//   ├─ IF hp below 35%
//   └─ Sequence (3)
//      ├─ DO aim at nearest foe (lead, hold-to-fire)
//      ├─ DO orbit foe counter-clockwise
//      └─ Sequence (3)
//         ├─ Inverter
//         │  └─ IF full charge banked
//         ├─ DO orbit foe counter-clockwise
//         └─ Sequence (3)
//            ├─ DO aim at nearest foe (lead, hold-to-fire)
//            ├─ DO orbit foe counter-clockwise
//            └─ IF pad within 120u
//
// The mind, in words: circle the nearest foe counter-clockwise at close
// range (~138u) with the gun tracking them, and dash straight through them
// whenever the dash is ready. A dervish, not a turret.

import type { BTNode } from './tree';

/** The effective champion: what the evolved tree actually does each tick. */
export const CHAMPION_TREE: BTNode = {
    kind: 'sequence',
    children: [
        { kind: 'action', name: 'aim-nearest', params: [] },
        { kind: 'action', name: 'orbit-foe', params: [-1] },
        { kind: 'action', name: 'dash-at-foe', params: [] },
    ],
};
