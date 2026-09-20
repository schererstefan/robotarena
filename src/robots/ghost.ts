// Ghost: a fast hit-and-run scout. Darts into gun range while the gun is
// ready, fires, then breaks away on the cooldown and circles for the next
// pass. Never trades shots standing still.

import { ARENA_HEIGHT, ARENA_WIDTH, EMP_RADIUS } from '../sim/constants';
import { angleDiff, TAU } from '../sim/math';
import type { SkillLoadout } from '../sim/skills';
import type { Intent, RobotController, RobotMeta, SenseState } from '../sim/types';
import { aimed, aimTurret, createStallTracker, dodgeVector, leadAngle, rayClearance, steerTo } from './common';

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
        // Imminent incoming fire in the cone: sidestep the lane — but never
        // jink a live shot. Dodging is for the cooldown gaps; when the gun
        // speaks this tick, the firing run holds its line.
        const shotAt = foe ? leadAngle(self.x, self.y, self.stats.bulletSpeed, foe) : undefined;
        const firing = foe !== undefined && shotAt !== undefined && self.cooldown <= 0 && foe.distance < self.stats.gunRange && aimed(self.tower, shotAt);
        const incoming = sense.bullets ?? [];
        let nearest = Infinity;
        for (const b of incoming) {
            if (b.closing > 0 && b.distance < nearest) nearest = b.distance;
        }
        if (!firing && nearest < 170) {
            const dodge = dodgeVector(self.x, self.y, incoming);
            if (dodge.x !== 0 || dodge.y !== 0) {
                // Never dodge into a wall or block: prefer the sidestep with
                // running room, and hold the line when both sides are shut.
                const obstacles = sense.arena?.obstacles ?? [];
                const a = Math.atan2(dodge.y, dodge.x);
                const clearA = rayClearance(self.x, self.y, a, obstacles);
                const clearB = rayClearance(self.x, self.y, a + Math.PI, obstacles);
                if (clearA > 50) drive = a;
                else if (clearB > 50) drive = a + Math.PI;
            }
        }
        // Pinned on a wall or block (blips lure through cover): sidestep off.
        if (stall.update(sense.tick, self.x, self.y, true)) drive += Math.PI / 2;
        drive = ((drive % TAU) + TAU) % TAU;
        const turn = steerTo(self.heading, drive);
        const facing = Math.abs(angleDiff(self.heading, drive)) < 1.1;
        // Lead the shot (computed above): wanderers and strafers die to
        // intercept bearings, not tower-on-bearing snapshots. Blips carry
        // zero velocity, so the lead degrades to the bearing gracefully.
        const shot = shotAt;
        const towerTurn = shot !== undefined ? aimTurret(self.tower, shot) : 1; // wide sweep
        const fire = shot !== undefined && foe !== undefined && foe.distance < self.stats.gunRange && aimed(self.tower, shot);
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
