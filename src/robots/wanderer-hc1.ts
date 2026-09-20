// Wanderer HC1: hillclimb champion bred from wanderer. Do not hand-edit:
// re-run the tuner (`npm run tune -- --archetype wanderer`) instead.
// tuned: run 20260920-011225 genome 69a579d86419ecbf5167fb8b4493d20e0c62a1a98138c57f50c2e8c5c6b927d7

import type { SkillLoadout } from '../sim/skills';
import type { RobotController, RobotMeta } from '../sim/types';
import { createWithParams as createWandererParams, type WandererParams } from './wanderer';

export const meta: RobotMeta = {
    id: 'wanderer-hc1',
    name: 'Wanderer HC1',
    author: 'RobotArena (hillclimb)',
    version: '2.0.1',
    description: 'Hillclimb champion bred from wanderer (run 20260920-011225).',
};

export const loadout: SkillLoadout = { plating: 1, scout: 1, slipstream: 1, trigger: 3 };

/** Tuned behavior params (run 20260920-011225). */
export const PARAMS: WandererParams = {
    aimTol: 0.07,
    engageThrottle: 0.5,
    scanTurn: 1,
    steerGain: 2.5,
    targetPolicy: 'first',
    turretGain: 3,
    wallDist: 70,
    wallRetick: 30,
    waypointArrive: 50,
    waypointMargin: 60,
};

export function create(): RobotController {
    const inner = createWandererParams(PARAMS);
    // Forward onSpawn when the base archetype has one (anchor bots): the
    // frozen champion must behave exactly like the tuned genome.
    return inner.onSpawn === undefined
        ? { meta, loadout, update: inner.update }
        : { meta, loadout, update: inner.update, onSpawn: inner.onSpawn };
}
