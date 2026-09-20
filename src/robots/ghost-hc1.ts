// Ghost HC1: hillclimb champion bred from ghost. Do not hand-edit:
// re-run the tuner (`npm run tune -- --archetype ghost`) instead.
// tuned: run 20260920-012240 genome fe09051e037ae828344ecacda00eb65a29aeb16fe209ba28dc31a2fbbbe5db95

import type { SkillLoadout } from '../sim/skills';
import type { RobotController, RobotMeta } from '../sim/types';
import { createWithParams as createGhostParams, type GhostParams } from './ghost';

export const meta: RobotMeta = {
    id: 'ghost-hc1',
    name: 'Ghost HC1',
    author: 'RobotArena (hillclimb)',
    version: '1.0.1',
    description: 'Hillclimb champion bred from ghost (run 20260920-012240).',
};

export const loadout: SkillLoadout = { marksman: 2, overdrive: 1, scout: 1, trigger: 2 };

/** Tuned behavior params (run 20260920-012240). */
export const PARAMS: GhostParams = {
    aimTol: 0.07,
    alignTol: 1.1,
    breakRange: 320,
    dodgeClearance: 50,
    dodgeRange: 170,
    fleeFrac: 0.45,
    orbitDir: 1,
    orbitThrottle: 1,
    scanTurn: 1,
    steerGain: 2.5,
    strikeRangeFrac: 0.85,
    tangentFrac: 0.7,
    targetPolicy: 'first',
    turnThrottle: 0.4,
    turretGain: 3,
};

export function create(): RobotController {
    const inner = createGhostParams(PARAMS);
    // Forward onSpawn when the base archetype has one (anchor bots): the
    // frozen champion must behave exactly like the tuned genome.
    return inner.onSpawn === undefined
        ? { meta, loadout, update: inner.update }
        : { meta, loadout, update: inner.update, onSpawn: inner.onSpawn };
}
