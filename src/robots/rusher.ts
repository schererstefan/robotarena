// Rusher: charges the nearest visible foe, guns blazing. When blind, it
// sweeps its tower while driving to the last known contact (or midfield).

import { ARENA_HEIGHT, ARENA_WIDTH } from '../sim/constants';
import { clamp } from '../sim/math';
import type { SkillLoadout } from '../sim/skills';
import type { Intent, RobotController, RobotMeta, SenseState } from '../sim/types';
import { aimed, aimTurret, steerTo, throttleFor } from './common';

export const meta: RobotMeta = {
    id: 'rusher',
    name: 'Rusher',
    author: 'RobotArena',
    version: '2.0.0',
    description: 'Charges the nearest foe head-on. Simple, fast, and rude.',
};

export const loadout: SkillLoadout = { overdrive: 3, plating: 2, trigger: 1 };

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
        const baseAngle = Math.atan2(goalY - self.y, goalX - self.x);
        // Weave while closing so strafers and turrets can't lead us easily.
        const closing = foe !== undefined && foe.distance > 200;
        const goalAngle = closing ? baseAngle + Math.sin(sense.tick / 18) * 0.5 : baseAngle;
        const fire =
            foe !== undefined &&
            foe.distance < self.stats.gunRange &&
            aimed(self.tower, foe.bearing);
        return {
            throttle: throttleFor(self.heading, goalAngle),
            turn: steerTo(self.heading, goalAngle),
            towerTurn: foe ? aimTurret(self.tower, foe.bearing) : clamp(2.4 / 3.6, -1, 1),
            fire,
            charge: false,
        };
    }

    return { meta, loadout, update };
}
