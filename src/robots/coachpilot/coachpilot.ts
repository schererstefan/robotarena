// CoachPilot — the N4 hierarchical coach/pilot spike.
//
// A slow coach (every 30 ticks: zone anchors, pad/turret strategy, team
// focus target, commit/retreat stance) commands a fast pilot (every tick:
// drive-assist to the coach waypoint, turret-assist on the focus foe, fire
// discipline per stance, plus local hazard/bullet dodges). Same contract as
// every other robot: SenseState in, Intent out; seeded RNG only.

import type { RobotController, RobotMeta, SenseState } from '../../sim/types';
import type { SkillLoadout } from '../../sim/skills';
import { createCoach } from './coach';
import { createPilot } from './pilot';
import { COACH_PERIOD, type CoachOrder } from './protocol';

export const meta: RobotMeta = {
    id: 'coachpilot',
    name: 'CoachPilot',
    author: 'mycroft',
    version: '0.1.0',
    description: 'N4 spike: a slow coach picks waypoints, focus foe, and stance; a fast pilot executes via drive/turret assists.',
};

// Scout feeds the coach 2x-range foe blips; the pilot fights up close.
export const loadout: SkillLoadout = { overdrive: 1, trigger: 2, plating: 2, scout: 1 };

export function create(): RobotController {
    const coach = createCoach();
    const pilot = createPilot();
    let order: CoachOrder | null = null;
    let lastCoachTick = -COACH_PERIOD;

    function update(sense: SenseState) {
        // Coach ticks: recompute strategy. Pilot ticks: execute the standing order.
        if (order === null || sense.tick - lastCoachTick >= COACH_PERIOD) {
            order = coach.update(sense);
            lastCoachTick = sense.tick;
        }
        return pilot.update(sense, order);
    }

    return { meta, loadout, update };
}
