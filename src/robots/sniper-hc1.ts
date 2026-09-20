// Sniper HC1: hillclimb champion bred from sniper. Do not hand-edit:
// re-run the tuner (`npm run tune -- --archetype sniper`) instead.
// tuned: run 20260920-011554 genome bd8b2fa92df3b0502e29107ee216b16c513603d2f9f27945c9d1103004341a89

import type { SkillLoadout } from '../sim/skills';
import type { RobotController, RobotMeta } from '../sim/types';
import { createWithParams as createSniperParams, type SniperParams } from './sniper';

export const meta: RobotMeta = {
    id: 'sniper-hc1',
    name: 'Sniper HC1',
    author: 'RobotArena (hillclimb)',
    version: '1.0.1',
    description: 'Hillclimb champion bred from sniper (run 20260920-011554).',
};

export const loadout: SkillLoadout = { charger: 2, longscan: 2, nanorepair: 1, plating: 1 };

/** Tuned behavior params (run 20260920-011554). */
export const PARAMS: SniperParams = {
    aimTol: 0.05,
    anchorLeave: 80,
    anchorSettle: 24,
    anchorThrottle: 0.8,
    anchorXFar: 0.76,
    anchorXNear: 0.28651439257942307,
    anchorYFar: 0.72,
    anchorYNear: 0.28,
    bankRangeFrac: 0.75,
    driveGain: 2.5,
    idleGain: 1.5,
    kiteRangeFrac: 0.5,
    scanTurn: 0.5,
    targetPolicy: 'weakest',
    turretGain: 3,
};

export function create(): RobotController {
    const inner = createSniperParams(PARAMS);
    // Forward onSpawn when the base archetype has one (anchor bots): the
    // frozen champion must behave exactly like the tuned genome.
    return inner.onSpawn === undefined
        ? { meta, loadout, update: inner.update }
        : { meta, loadout, update: inner.update, onSpawn: inner.onSpawn };
}
