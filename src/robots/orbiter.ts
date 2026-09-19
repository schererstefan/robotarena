// Orbiter: keeps its distance and circle-strafes around its target,
// holding a mid-range orbit where its gun still reaches.

import { ARENA_HEIGHT, ARENA_WIDTH } from '../sim/constants';
import { angleDiff, TAU } from '../sim/math';
import type { SkillLoadout } from '../sim/skills';
import type { Intent, RobotController, RobotMeta, SenseState } from '../sim/types';
import { aimed, aimTurret, steerTo } from './common';

export const meta: RobotMeta = {
    id: 'orbiter',
    name: 'Orbiter',
    author: 'RobotArena',
    version: '2.0.0',
    description: 'Circle-strafes at mid range. Hard to hit, always annoying.',
};

export const loadout: SkillLoadout = { gyro: 2, overdrive: 2, trigger: 1, plating: 1 };

const ORBIT_RANGE = 330;

export function create(): RobotController {
    const orbitDir = 1;
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
        const toGoal = Math.atan2(goalY - self.y, goalX - self.x);
        const gap = foe ? foe.distance - ORBIT_RANGE : 0;

        // Drive tangentially (orbit) plus a radial correction toward ORBIT_RANGE.
        const tangent = toGoal + (orbitDir * Math.PI) / 2;
        let drive = tangent;
        if (gap < -60) drive = toGoal + Math.PI; // too close: back away
        else if (gap > 60) drive = toGoal; // too far: close in
        drive = ((drive % TAU) + TAU) % TAU;

        const turn = steerTo(self.heading, drive);
        const facing = Math.abs(angleDiff(self.heading, drive)) < 1.2;
        const throttle = facing ? 0.9 : 0.3;
        const towerTurn = foe ? aimTurret(self.tower, foe.bearing) : 0.8;
        const fire = foe !== undefined && foe.distance < self.stats.gunRange && aimed(self.tower, foe.bearing);
        return { throttle, turn, towerTurn, fire, charge: false };
    }

    return { meta, loadout, update };
}
