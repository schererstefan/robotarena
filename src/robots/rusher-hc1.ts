// Rusher HC1: hillclimb champion bred from rusher. Do not hand-edit:
// re-run the tuner (`npm run tune -- --archetype rusher`) instead.
// tuned: run 20260920-010027 genome 3890a3ea534bc01ae337ad1cca88e724a13b298d0401aaccfd242fc2ab6e4348

import type { SkillLoadout } from '../sim/skills';
import type { RobotController, RobotMeta } from '../sim/types';
import { createWithParams as createRusherParams, type RusherParams } from './rusher';

export const meta: RobotMeta = {
    id: 'rusher-hc1',
    name: 'Rusher HC1',
    author: 'RobotArena (hillclimb)',
    version: '2.0.1',
    description: 'Hillclimb champion bred from rusher (run 20260920-010027).',
};

export const loadout: SkillLoadout = { longscan: 2, nanorepair: 1, plating: 2, trigger: 1 };

/** Tuned behavior params (run 20260920-010027). */
export const PARAMS: RusherParams = {
    aimTol: 0.07,
    scanRate: 2.4,
    steerGain: 2.5,
    targetPolicy: 'first',
    turretGain: 3,
    weaveAmp: 0.5,
    weavePeriod: 18,
    weaveRange: 200,
};

export function create(): RobotController {
    const inner = createRusherParams(PARAMS);
    // Forward onSpawn when the base archetype has one (anchor bots): the
    // frozen champion must behave exactly like the tuned genome.
    return inner.onSpawn === undefined
        ? { meta, loadout, update: inner.update }
        : { meta, loadout, update: inner.update, onSpawn: inner.onSpawn };
}
