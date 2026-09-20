// Turret HC1: hillclimb champion bred from turret. Do not hand-edit:
// re-run the tuner (`npm run tune -- --archetype turret`) instead.
// tuned: run 20260920-010715 genome 1c7774242df0ce171c55150c801b076ab5b648629de75602f85b0a25a0d31a2b

import type { SkillLoadout } from '../sim/skills';
import type { RobotController, RobotMeta } from '../sim/types';
import { createWithParams as createTurretParams, type TurretParams } from './turret';

export const meta: RobotMeta = {
    id: 'turret-hc1',
    name: 'Turret HC1',
    author: 'RobotArena (hillclimb)',
    version: '2.0.1',
    description: 'Hillclimb champion bred from turret (run 20260920-010715).',
};

export const loadout: SkillLoadout = { charger: 1, nanorepair: 1, plating: 2, trigger: 2 };

/** Tuned behavior params (run 20260920-010715). */
export const PARAMS: TurretParams = {
    aimTol: 0.05,
    anchorLeave: 60,
    anchorSettle: 35.35348157159837,
    anchorThrottle: 0.8,
    anchorXFar: 0.68,
    anchorXNear: 0.32,
    anchorYFar: 0.7,
    anchorYNear: 0.3,
    driveGain: 2.5,
    parkGain: 1.5,
    scanTurn: 0.85,
    targetPolicy: 'first',
    turretGain: 3,
};

export function create(): RobotController {
    const inner = createTurretParams(PARAMS);
    // Forward onSpawn when the base archetype has one (anchor bots): the
    // frozen champion must behave exactly like the tuned genome.
    return inner.onSpawn === undefined
        ? { meta, loadout, update: inner.update }
        : { meta, loadout, update: inner.update, onSpawn: inner.onSpawn };
}
