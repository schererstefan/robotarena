// BT-N1 "Moth": the in-game wrapper around the N1 behavior-tree GP
// champion (src/robots/bt/champion.ts). Append-only registration; the
// brain itself lives in src/robots/bt/.
//
// v0.2.0 (Sep 22, 2026): champion re-evolved after fixing the inverted
// damage tie-break in the GP comparator. The old 3-node "Dervish" champion
// was an artifact of that bug.

import type { SkillLoadout } from '../sim/skills';
import type { RobotController, RobotMeta } from '../sim/types';
import { createBTTreeBrain } from './bt/brain';
import { CHAMPION_TREE } from './bt/champion';
import { BT_LOADOUT } from './bt/gp';

export const meta: RobotMeta = {
    id: 'bt-n1',
    name: 'Moth',
    author: 'GP spike N1',
    version: '0.2.0',
    description: 'Evolved behavior tree: hunts powerup pads, gun tracks nearest foe, dashes at them, orbits counter-clockwise when hurt.',
};

export const loadout: SkillLoadout = { ...BT_LOADOUT };

export function create(): RobotController {
    const brain = createBTTreeBrain(CHAMPION_TREE);
    return {
        meta,
        update: (sense) => brain.update(sense).intent,
    };
}
