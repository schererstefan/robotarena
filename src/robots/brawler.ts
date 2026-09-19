// Brawler: shrugs off hits with heavy plating and walks the gun into
// knife-fight range. No finesse, no retreat, all forward pressure.

import { ARENA_HEIGHT, ARENA_WIDTH } from '../sim/constants';
import type { SkillLoadout } from '../sim/skills';
import type { Intent, RobotController, RobotMeta, SenseState } from '../sim/types';
import { aimed, aimTurret, steerTo, throttleFor } from './common';

export const meta: RobotMeta = {
    id: 'brawler',
    name: 'Brawler',
    author: 'RobotArena',
    version: '1.0.0',
    description: 'Plated bruiser that walks its gun into knife-fight range. All pressure.',
};

export const loadout: SkillLoadout = { plating: 2, overdrive: 2, trigger: 2 };

export function create(): RobotController {
    let lastX = ARENA_WIDTH / 2;
    let lastY = ARENA_HEIGHT / 2;

    function update(sense: SenseState): Intent {
        const self = sense.self;
        // Nearest foe: the brawler picks the closest fight, always.
        const foe = sense.foes[0];
        if (foe) {
            lastX = foe.x;
            lastY = foe.y;
        }
        const goalX = foe ? foe.x : lastX;
        const goalY = foe ? foe.y : lastY;
        const baseAngle = Math.atan2(goalY - self.y, goalX - self.x);
        // Heavy weave while closing: a slow target that will not jink dies.
        const closing = foe !== undefined && foe.distance > 160;
        const goalAngle = closing ? baseAngle + Math.sin(sense.tick / 14) * 0.45 : baseAngle;
        // In the clinch, keep driving through the foe: ramming breaks aim.
        const clinch = foe !== undefined && foe.distance < 120;
        const fire =
            foe !== undefined &&
            foe.distance < self.stats.gunRange &&
            aimed(self.tower, foe.bearing);
        return {
            throttle: clinch ? 1 : throttleFor(self.heading, goalAngle),
            turn: steerTo(self.heading, goalAngle),
            towerTurn: foe ? aimTurret(self.tower, foe.bearing) : 0.9,
            fire,
            charge: false,
        };
    }

    return { meta, loadout, update };
}
