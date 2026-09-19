// Ghost: a fast hit-and-run scout. Darts into gun range while the gun is
// ready, fires, then breaks away on the cooldown and circles for the next
// pass. Never trades shots standing still.

import { ARENA_HEIGHT, ARENA_WIDTH, EMP_RADIUS } from '../sim/constants';
import { angleDiff, TAU } from '../sim/math';
import type { SkillLoadout } from '../sim/skills';
import type { Intent, RobotController, RobotMeta, SenseState } from '../sim/types';
import { aimed, aimTurret, createStallTracker, steerTo } from './common';

export const meta: RobotMeta = {
    id: 'ghost',
    name: 'Ghost',
    author: 'RobotArena',
    version: '1.0.0',
    description: 'Fast hit-and-run scout: darts in on a ready gun, vanishes on cooldown.',
};

export const loadout: SkillLoadout = { overdrive: 2, gyro: 2, wideband: 1, scout: 1 };

export function create(): RobotController {
    const orbitDir = 1;
    let lastX = ARENA_WIDTH / 2;
    let lastY = ARENA_HEIGHT / 2;
    const stall = createStallTracker();

    function update(sense: SenseState): Intent {
        const self = sense.self;
        // Scout blips are live positions: chase them like contacts. The tower
        // swings onto the blip bearing and converts it to a real sighting.
        const foe = sense.foes[0] ?? sense.scout[0];
        if (foe) {
            lastX = foe.x;
            lastY = foe.y;
        }
        const goalX = foe ? foe.x : lastX;
        const goalY = foe ? foe.y : lastY;
        const toGoal = Math.atan2(goalY - self.y, goalX - self.x);

        // Gun ready: run at the target. Cooling down: break away tangentially
        // so the pass becomes an orbit, not a retreat into a corner.
        let drive = toGoal;
        if (foe) {
            const tangent = toGoal + (orbitDir * Math.PI) / 2;
            const strikeRange = self.stats.gunRange * 0.85;
            if (self.cooldown > 0 || foe.distance < strikeRange * 0.7) {
                drive = tangent;
                if (foe.distance < strikeRange * 0.45) drive = toGoal + Math.PI;
            }
        }
        // Pinned on a wall or block (blips lure through cover): sidestep off.
        if (stall.update(sense.tick, self.x, self.y, true)) drive += Math.PI / 2;
        drive = ((drive % TAU) + TAU) % TAU;
        const turn = steerTo(self.heading, drive);
        const facing = Math.abs(angleDiff(self.heading, drive)) < 1.1;
        const towerTurn = foe ? aimTurret(self.tower, foe.bearing) : 1; // wide sweep
        const fire = foe !== undefined && foe.distance < self.stats.gunRange && aimed(self.tower, foe.bearing);
        // Break contact on cooldown: dash out of the pocket and EMP the
        // pursuer so the next pass starts at our range, not theirs.
        const breaking = self.cooldown > 0 && foe !== undefined && foe.distance < 320;
        const dash = breaking && self.dashCd <= 0;
        const emp = breaking && self.empCd <= 0 && (foe?.distance ?? Infinity) < EMP_RADIUS;
        return {
            throttle: facing ? 1 : 0.4,
            turn,
            towerTurn,
            fire,
            charge: false,
            dash,
            emp,
        };
    }

    return { meta, loadout, update };
}
