// Hunter HC1: hillclimb champion bred from hunter. Do not hand-edit:
// re-run the tuner (`npm run tune -- --archetype hunter`) instead.
// tuned: run 20260920-002309 genome fc732fab4a3825147fe2aa340d7b686eac70831587a2769ce54843e509ed5ca1

import type { SkillLoadout } from '../sim/skills';
import type { RobotController, RobotMeta } from '../sim/types';
import { createLegacyWithParams as createHunterParams, type HunterParams } from './hunter';

export const meta: RobotMeta = {
    id: 'hunter-hc1',
    name: 'Hunter HC1',
    author: 'RobotArena (hillclimb)',
    version: '2.0.1',
    description: 'Hillclimb champion bred from hunter (run 20260920-002309).',
};

export const loadout: SkillLoadout = { charger: 1, nanorepair: 1, plating: 2, trigger: 2 };

/** Tuned behavior params (run 20260920-002309). */
export const PARAMS: HunterParams = {
    aimTol: 0.09572930077449344,
    bankRangeFrac: 0.7,
    closeRangeFrac: 0.55,
    closeThrottle: 0.35,
    scanTurn: 0.9,
    steerGain: 2.5,
    targetPolicy: 'weakest',
    turretGain: 3,
};

export function create(): RobotController {
    const inner = createHunterParams(PARAMS);
    return { meta, loadout, update: inner.update };
}
