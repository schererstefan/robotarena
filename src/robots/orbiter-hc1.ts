// Orbiter HC1: hillclimb champion bred from orbiter. Do not hand-edit:
// re-run the tuner (`npm run tune -- --archetype orbiter`) instead.
// tuned: run 20260920-010338 genome 8f9eada1a49d2c29222f45f876db170a7f18c15b6b18be096b2a040eaf121b32

import type { SkillLoadout } from '../sim/skills';
import type { RobotController, RobotMeta } from '../sim/types';
import { createWithParams as createOrbiterParams, type OrbiterParams } from './orbiter';

export const meta: RobotMeta = {
    id: 'orbiter-hc1',
    name: 'Orbiter HC1',
    author: 'RobotArena (hillclimb)',
    version: '2.0.1',
    description: 'Hillclimb champion bred from orbiter (run 20260920-010338).',
};

export const loadout: SkillLoadout = { charger: 1, nanorepair: 1, plating: 2, trigger: 2 };

/** Tuned behavior params (run 20260920-010338). */
export const PARAMS: OrbiterParams = {
    aimTol: 0.07,
    alignTol: 1.2,
    orbitBand: 60,
    orbitDir: 1,
    orbitRange: 220.584486887502,
    orbitThrottle: 0.9,
    scanTurn: 0.8,
    steerGain: 2.5,
    targetPolicy: 'first',
    turnThrottle: 0.3,
    turretGain: 3,
};

export function create(): RobotController {
    const inner = createOrbiterParams(PARAMS);
    // Forward onSpawn when the base archetype has one (anchor bots): the
    // frozen champion must behave exactly like the tuned genome.
    return inner.onSpawn === undefined
        ? { meta, loadout, update: inner.update }
        : { meta, loadout, update: inner.update, onSpawn: inner.onSpawn };
}
