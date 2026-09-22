// BT-N1 "Dervish": the in-game wrapper around the N1 behavior-tree GP
// champion (src/robots/bt/champion.ts). Append-only registration; the
// brain itself lives in src/robots/bt/.

import type { SkillLoadout } from '../sim/skills';
import type { RobotController, RobotMeta } from '../sim/types';
import { createBTTreeBrain } from './bt/brain';
import { CHAMPION_TREE } from './bt/champion';
import { BT_LOADOUT } from './bt/gp';

export const meta: RobotMeta = {
    id: 'bt-n1',
    name: 'Dervish',
    author: 'GP spike N1',
    version: '0.1.0',
    description: 'Evolved behavior tree: tight counter-clockwise orbit, gun tracking, dashes through its foe.',
};

export const loadout: SkillLoadout = { ...BT_LOADOUT };

export function create(): RobotController {
    const brain = createBTTreeBrain(CHAMPION_TREE);
    return {
        meta,
        update: (sense) => brain.update(sense).intent,
    };
}
