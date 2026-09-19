// Rusher: charges the nearest visible foe, guns blazing. When blind, it
// sweeps its tower while driving to the last known contact (or midfield).

import { ARENA_HEIGHT, ARENA_WIDTH, GUN_RANGE } from '../sim/constants';
import { clamp } from '../sim/math';
import type { Intent, RobotController, RobotMeta, SenseState } from '../sim/types';
import { aimed, aimTurret, steerTo, throttleFor } from './common';

export const meta: RobotMeta = {
    id: 'rusher',
    name: 'Rusher',
    author: 'RobotArena',
    version: '1.0.0',
    description: 'Charges the nearest foe head-on. Simple, fast, and rude.',
};

export function create(): RobotController {
    let lastX = ARENA_WIDTH / 2;
    let lastY = ARENA_HEIGHT / 2;

    function update(sense: SenseState): Intent {
        const self = sense.self;
        const foe = sense.foes[0];
        if (foe) {
            lastX = foe.x;
            lastY = foe.y;
        }
        const goalX = foe ? foe.x : lastX;
        const goalY = foe ? foe.y : lastY;
        const goalAngle = Math.atan2(goalY - self.y, goalX - self.x);
        const fire =
            foe !== undefined &&
            foe.distance < GUN_RANGE &&
            aimed(self.tower, foe.bearing);
        return {
            throttle: throttleFor(self.heading, goalAngle),
            turn: steerTo(self.heading, goalAngle),
            towerTurn: foe ? aimTurret(self.tower, foe.bearing) : clamp(2.4 / 3.6, -1, 1),
            fire,
        };
    }

    return { meta, update };
}
