// Brawler HC1: hillclimb champion bred from brawler. Do not hand-edit:
// re-run the tuner (`npm run tune -- --archetype brawler`) instead.
// tuned: run 20260920-012043 genome db4bc994a8667bcf2797f77edcbeff9272ce22c8f055acc98d78fc97b6706b4c

import type { SkillLoadout } from '../sim/skills';
import type { RobotController, RobotMeta } from '../sim/types';
import { createWithParams as createBrawlerParams, type BrawlerParams } from './brawler';

export const meta: RobotMeta = {
    id: 'brawler-hc1',
    name: 'Brawler HC1',
    author: 'RobotArena (hillclimb)',
    version: '1.0.1',
    description: 'Hillclimb champion bred from brawler (run 20260920-012043).',
};

export const loadout: SkillLoadout = { plating: 1, scout: 1, slipstream: 1, trigger: 3 };

/** Tuned behavior params (run 20260920-012043). */
export const PARAMS: BrawlerParams = {
    aimTol: 0.07,
    clinchRange: 120,
    clinchThrottle: 1,
    dashMaxRange: 520,
    dashMinRange: 200,
    faceTol: 0.5,
    scanTurn: 1,
    steerGain: 3.5237566706014487,
    targetPolicy: 'first',
    turretGain: 3,
    weaveAmp: 0.45,
    weavePeriod: 14,
    weaveRange: 160,
};

export function create(): RobotController {
    const inner = createBrawlerParams(PARAMS);
    // Forward onSpawn when the base archetype has one (anchor bots): the
    // frozen champion must behave exactly like the tuned genome.
    return inner.onSpawn === undefined
        ? { meta, loadout, update: inner.update }
        : { meta, loadout, update: inner.update, onSpawn: inner.onSpawn };
}
