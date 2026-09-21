// Hunter HC2: hillclimb champion bred from hunter. Do not hand-edit:
// re-run the tuner (`npm run tune -- --archetype hunter`) instead.
// tuned: run 20260920-012539 genome f8c3a17d6aded6777c82e4d90bb309123d8a56d1308cbb60663a29f445371cf5

import type { SkillLoadout } from '../sim/skills';
import type { RobotController, RobotMeta } from '../sim/types';
import { createWithParams as createHunterParams, type HunterParams } from './hunter';

export const meta: RobotMeta = {
    id: 'hunter-hc2',
    name: 'Hunter HC2',
    author: 'RobotArena (hillclimb)',
    version: '3.0.1',
    description: 'Hillclimb champion bred from hunter (run 20260920-012539).',
};

export const loadout: SkillLoadout = { charger: 1, nanorepair: 1, plating: 2, trigger: 2 };

/** Tuned behavior params (run 20260920-012539). */
export const PARAMS: HunterParams = {
    aimTol: 0.05,
    bankRangeFrac: 0.7,
    brain: {"retreatHp":0.3,"kiteRange":200,"flankRange":350,"stayBonus":0.15,"aggression":1,"focusBonus":0.31102285886826336,"orbitDir":-1},
    closeRangeFrac: 0.55,
    closeThrottle: 0.35,
    scanTurn: 1,
    steerGain: 2.5,
    targetPolicy: 'first',
    turretGain: 3,
    // Active champion: opts into powerup/turret/hazard awareness, but
    // keeps working a fresh trail (bank discipline over detours).
    utility: true,
    utilityCold: true,
};

export function create(): RobotController {
    const inner = createHunterParams(PARAMS);
    // Forward onSpawn when the base archetype has one (anchor bots): the
    // frozen champion must behave exactly like the tuned genome.
    return inner.onSpawn === undefined
        ? { meta, loadout, update: inner.update }
        : { meta, loadout, update: inner.update, onSpawn: inner.onSpawn };
}
