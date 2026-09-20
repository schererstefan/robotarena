// Sniper: camps a backfield anchor, banks charge, and picks foes off at
// long range with led shots. Retreats when rushed instead of brawling.

import { ARENA_HEIGHT, ARENA_WIDTH } from '../sim/constants';
import { dist } from '../sim/math';
import type { SkillLoadout } from '../sim/skills';
import type { Intent, RobotController, RobotMeta, SenseState } from '../sim/types';
import { aimed, aimTurret, createStallTracker, leadAngle, manageCharge, steerTo } from './common';

export const meta: RobotMeta = {
    id: 'sniper',
    name: 'Sniper',
    author: 'RobotArena',
    version: '1.0.0',
    description: 'Camps backfield and lands charged long-range shots. Do not stand still.',
};

export const loadout: SkillLoadout = { marksman: 2, longscan: 2, charger: 1, deadeye: 1 };

export function create(): RobotController {
    let anchorX = 0;
    let anchorY = 0;
    let anchored = false;
    const stall = createStallTracker();

    function onSpawn(sense: SenseState): void {
        // Deeper than the turret: maximum standoff for the long gun.
        anchorX = sense.self.team === 0 ? ARENA_WIDTH * 0.24 : ARENA_WIDTH * 0.76;
        anchorY = sense.self.y < ARENA_HEIGHT / 2 ? ARENA_HEIGHT * 0.28 : ARENA_HEIGHT * 0.72;
    }

    function update(sense: SenseState): Intent {
        const self = sense.self;
        const foe = sense.foes[0];
        const anchorDist = dist(self.x, self.y, anchorX, anchorY);
        if (anchorDist < 24) anchored = true;
        else if (anchorDist > 80) anchored = false; // shoved off: re-drive in

        // Rushed: kite away at full drive to re-establish standoff range.
        const rushed = foe !== undefined && foe.distance < self.stats.gunRange * 0.5;
        // Sudden death outside the circle: the anchor is scrap, run to safety.
        const zone = sense.zone;
        const unsafe = zone !== undefined && zone.phase === 'shrinking' && (zone.distToSafety > 0 || !zone.inside);
        let throttle = 0;
        let goal = self.heading;
        if (unsafe && zone) {
            goal = Math.atan2(zone.circle.y - self.y, zone.circle.x - self.x);
            throttle = 1;
        } else if (rushed && foe) {
            goal = Math.atan2(self.y - foe.y, self.x - foe.x);
            throttle = 1;
        } else if (!anchored) {
            goal = Math.atan2(anchorY - self.y, anchorX - self.x);
            throttle = 0.8;
        } else {
            goal = Math.atan2(ARENA_HEIGHT / 2 - self.y, ARENA_WIDTH / 2 - self.x);
        }
        // Pinned kiting into a wall or block: sidestep along it instead of
        // pushing, so the kite never degrades into a static trade.
        if (throttle !== 0 && stall.update(sense.tick, self.x, self.y, true)) {
            goal += Math.PI / 2;
        }
        const turn = steerTo(self.heading, goal, throttle === 0 ? 1.5 : 2.5);

        let towerTurn = 0.5; // slow scan while blind
        let fire = false;
        let charge = false;
        // Blind but with a memory: swing the tower onto the freshest track
        // instead of scanning empty air — re-acquire, don't wander.
        const tracks = sense.tracks ?? [];
        let memory = -1;
        for (let i = 0; i < tracks.length; i += 1) {
            const t = tracks[i] as { lastSeenTick: number };
            if (!tracks[i]?.seenNow && (memory < 0 || t.lastSeenTick > (tracks[memory]?.lastSeenTick ?? -1))) memory = i;
        }
        const mem = memory >= 0 ? tracks[memory] : undefined;
        if (!foe && mem) {
            towerTurn = aimTurret(self.tower, Math.atan2(mem.y - self.y, mem.x - self.x));
        }
        if (foe) {
            const shot = leadAngle(self.x, self.y, self.stats.bulletSpeed, foe);
            towerTurn = aimTurret(self.tower, shot);
            const inRange = foe.distance < self.stats.gunRange;
            const onTarget = aimed(self.tower, shot, 0.05);
            // The longest shots and kiting parting shots wait for a full
            // bank; otherwise the gun speaks whenever it bears.
            const holdForBank = foe.distance > self.stats.gunRange * 0.75 || rushed;
            fire = inRange && onTarget && (!holdForBank || self.charged);
            charge = inRange && !fire ? manageCharge(self.charged, onTarget && !holdForBank) : false;
        }
        return { throttle, turn, towerTurn, fire, charge };
    }

    return { meta, loadout, onSpawn, update };
}
