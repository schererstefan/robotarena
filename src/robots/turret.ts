// Turret: drives to a defensive anchor near its spawn, parks, and spins
// its tower for full-circle awareness. Leads its shots like a Hunter.

import { ARENA_HEIGHT, ARENA_WIDTH } from '../sim/constants';
import { dist } from '../sim/math';
import type { SkillLoadout } from '../sim/skills';
import type { Intent, RobotController, RobotMeta, SensedRobot, SenseState } from '../sim/types';
import { aimed, aimTurret, steerTo } from './common';

export const meta: RobotMeta = {
    id: 'turret',
    name: 'Turret',
    author: 'RobotArena',
    version: '2.0.0',
    description: 'Parks on defense with a spinning tower. Do not walk into its lane.',
};

export const loadout: SkillLoadout = { marksman: 1, trigger: 2, longscan: 2, servos: 1 };

function leadAngle(selfX: number, selfY: number, bulletSpeed: number, foe: SensedRobot): number {
    const flightTime = foe.distance / bulletSpeed;
    const px = foe.x + Math.cos(foe.heading) * foe.speed * flightTime;
    const py = foe.y + Math.sin(foe.heading) * foe.speed * flightTime;
    return Math.atan2(py - selfY, px - selfX);
}

export function create(): RobotController {
    let anchorX = 0;
    let anchorY = 0;
    let anchored = false;

    function onSpawn(sense: SenseState): void {
        anchorX = sense.self.team === 0 ? ARENA_WIDTH * 0.32 : ARENA_WIDTH * 0.68;
        anchorY = sense.self.y < ARENA_HEIGHT / 2 ? ARENA_HEIGHT * 0.3 : ARENA_HEIGHT * 0.7;
    }

    function update(sense: SenseState): Intent {
        const self = sense.self;
        const foe = sense.foes[0];
        if (dist(self.x, self.y, anchorX, anchorY) < 24) anchored = true;

        let throttle = 0;
        let turn = 0;
        if (!anchored) {
            const goal = Math.atan2(anchorY - self.y, anchorX - self.x);
            throttle = 0.8;
            turn = steerTo(self.heading, goal);
        } else {
            // Face midfield while parked so the chassis is ready to reposition.
            const mid = Math.atan2(ARENA_HEIGHT / 2 - self.y, ARENA_WIDTH / 2 - self.x);
            turn = steerTo(self.heading, mid, 1.5);
        }

        let towerTurn = 0.85; // continuous spin: full-circle awareness
        let fire = false;
        if (foe) {
            const shot = leadAngle(self.x, self.y, self.stats.bulletSpeed, foe);
            towerTurn = aimTurret(self.tower, shot);
            fire = foe.distance < self.stats.gunRange && aimed(self.tower, shot, 0.05);
        }
        return { throttle, turn, towerTurn, fire, charge: false };
    }

    return { meta, loadout, onSpawn, update };
}
