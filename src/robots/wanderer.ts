// Wanderer: drifts between random waypoints and shoots at anything its
// sweeping tower happens to catch. Unpredictable by design.

import { ARENA_HEIGHT, ARENA_WIDTH, ROBOT_RADIUS } from '../sim/constants';
import { dist } from '../sim/math';
import type { SkillLoadout } from '../sim/skills';
import type { Intent, RobotController, RobotMeta, SenseState } from '../sim/types';
import { aimed, aimTurret, steerTo, throttleFor } from './common';

export const meta: RobotMeta = {
    id: 'wanderer',
    name: 'Wanderer',
    author: 'RobotArena',
    version: '2.0.0',
    description: 'Roams on random waypoints and snaps shots at whatever it sees.',
};

export const loadout: SkillLoadout = { longscan: 2, wideband: 2, overdrive: 2 };

export function create(): RobotController {
    let wx = ARENA_WIDTH / 2;
    let wy = ARENA_HEIGHT / 2;
    let picked = false;

    function pickWaypoint(sense: SenseState): void {
        const margin = ROBOT_RADIUS + 60;
        wx = margin + sense.rand() * (ARENA_WIDTH - margin * 2);
        wy = margin + sense.rand() * (ARENA_HEIGHT - margin * 2);
        picked = true;
    }

    function update(sense: SenseState): Intent {
        const self = sense.self;
        if (!picked) pickWaypoint(sense);
        if (dist(self.x, self.y, wx, wy) < 50) pickWaypoint(sense);
        // Near a wall and heading into it: pick somewhere else.
        const nearWall =
            self.x < 70 || self.x > ARENA_WIDTH - 70 || self.y < 70 || self.y > ARENA_HEIGHT - 70;
        if (nearWall && sense.tick % 30 === 0) pickWaypoint(sense);

        const foe = sense.foes[0];
        const goal = Math.atan2(wy - self.y, wx - self.x);
        const towerTurn = foe ? aimTurret(self.tower, foe.bearing) : 1; // full sweep
        const fire = foe !== undefined && foe.distance < self.stats.gunRange && aimed(self.tower, foe.bearing);
        return {
            throttle: foe ? 0.5 : throttleFor(self.heading, goal),
            turn: steerTo(self.heading, goal),
            towerTurn,
            fire,
            charge: false,
        };
    }

    return { meta, loadout, update };
}
