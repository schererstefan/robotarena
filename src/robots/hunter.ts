// Hunter: pursues the nearest foe and leads its shots, aiming where the
// target will be when the bullet arrives. The thinking player's bot.

import { ARENA_HEIGHT, ARENA_WIDTH, BULLET_SPEED, GUN_RANGE } from '../sim/constants';
import type { Intent, RobotController, RobotMeta, SensedRobot, SenseState } from '../sim/types';
import { aimed, aimTurret, steerTo, throttleFor } from './common';

export const meta: RobotMeta = {
    id: 'hunter',
    name: 'Hunter',
    author: 'RobotArena',
    version: '1.0.0',
    description: 'Pursues relentlessly and leads its shots. The thinking player bot.',
};

function leadAngle(selfX: number, selfY: number, foe: SensedRobot): number {
    const flightTime = foe.distance / BULLET_SPEED;
    const px = foe.x + Math.cos(foe.heading) * foe.speed * flightTime;
    const py = foe.y + Math.sin(foe.heading) * foe.speed * flightTime;
    return Math.atan2(py - selfY, px - selfX);
}

export function create(): RobotController {
    // Prefer the weakest visible foe; fall back to midfield when blind.
    let lastX = ARENA_WIDTH / 2;
    let lastY = ARENA_HEIGHT / 2;

    function update(sense: SenseState): Intent {
        const self = sense.self;
        let foe: SensedRobot | undefined;
        for (const candidate of sense.foes) {
            if (!foe || candidate.health < foe.health) foe = candidate;
        }
        if (foe) {
            lastX = foe.x;
            lastY = foe.y;
        }
        const goalX = foe ? foe.x : lastX;
        const goalY = foe ? foe.y : lastY;
        const goal = Math.atan2(goalY - self.y, goalX - self.x);

        let towerTurn = 0.9; // scan while blind
        let fire = false;
        if (foe) {
            const shot = leadAngle(self.x, self.y, foe);
            towerTurn = aimTurret(self.tower, shot);
            fire = foe.distance < GUN_RANGE && aimed(self.tower, shot, 0.05);
        }
        // Ease off the throttle in gun range so we don't ram past our target.
        const inRange = foe !== undefined && foe.distance < GUN_RANGE * 0.55;
        return {
            throttle: inRange ? 0.35 : throttleFor(self.heading, goal),
            turn: steerTo(self.heading, goal),
            towerTurn,
            fire,
        };
    }

    return { meta, update };
}
