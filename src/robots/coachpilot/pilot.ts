// N4 spike: the pilot — fast-timescale execution (every tick).
//
// Translates the coach's CoachOrder into an Intent through the engine's
// assist substrate:
//   - drive: moveMode=1 drive assist to the coach waypoint (shared steer law,
//     same caps as manual drive — no hidden power);
//   - tower: aimMode=2 turret assist tracking the coach's focus foe (with
//     lead on live cone sightings), else a sweep toward the waypoint;
//   - fire: per-stance discipline (commit = hold-to-fire on a locked assist,
//     skirmish = aimed shots at the focus foe only, retreat = rear-guard).
//
// The pilot's own tactical autonomy is small and local: urgent asteroid
// dodges (the 30-tick coach can't react to a 75-tick telegraph), incoming
// bullet sidesteps via strafe (applies on top of drive assist), and the
// dash/EMP actives. If the coach orders a bad waypoint, the pilot still
// walks into it — that is the coach's failure mode, visible on screen.

import { ARENA_HEIGHT, ARENA_WIDTH } from '../../sim/constants';
import { clamp } from '../../sim/math';
import type { Intent, SensedRobot, SenseState } from '../../sim/types';
import { aimed, aimTurret, dodgeVector, leadAngle } from '../common';
import type { CoachOrder } from './protocol';

const HAZ_DODGE_TICKS = 50;
const HAZ_DODGE_MARGIN = 110;
const DASH_COMMIT_RANGE = 420;
const EMP_RANGE = 220;

export function createPilot(): { update(sense: SenseState, order: CoachOrder): Intent } {
    function update(sense: SenseState, order: CoachOrder): Intent {
        const self = sense.self;

        // 1. Waypoint: the coach's order, nudged by urgent hazard dodges.
        let wx = clamp(order.moveX, 24, ARENA_WIDTH - 24);
        let wy = clamp(order.moveY, 24, ARENA_HEIGHT - 24);
        const escape = hazardEscapePoint(sense);
        if (escape !== null) {
            wx = escape.x;
            wy = escape.y;
        }

        const intent: Intent = { moveMode: 1, moveX: wx, moveY: wy };

        // 2. Bullet sidestep: strafe applies on top of drive assist.
        intent.strafe = bulletStrafe(sense);

        // 3. Tower: track the coach's focus foe, else sweep toward the waypoint.
        const focus = order.focusFoe;
        if (focus !== null) {
            intent.aimMode = 2;
            intent.aimTarget = focus;
        } else {
            const toWp = Math.atan2(wy - self.y, wx - self.x);
            // Slow deterministic sweep while blind: ±0.8 rad around the
            // waypoint bearing, 30-tick period, tick-driven (no RNG).
            const sweep = toWp + Math.sin(sense.tick / 30) * 0.8;
            intent.aimMode = 0;
            intent.towerTurn = aimTurret(self.tower, sweep, 1.5);
        }

        // 4. Fire discipline by stance.
        if (order.stance === 'commit') {
            // Hold-to-fire: the gun fires itself whenever the turret assist
            // is locked and the tower bears (cooldown gate unchanged).
            intent.fireMode = 1;
        } else {
            // Aimed shots at the focus foe only, and only off a live cone
            // sighting — never at stale positions.
            const foe = focus !== null ? sense.foes.find((f) => f.id === focus) : undefined;
            if (foe !== undefined) {
                const shot = leadAngle(self.x, self.y, self.stats.bulletSpeed, foe);
                const inRange =
                    order.stance === 'skirmish' ? true : foe.distance < self.stats.gunRange * 0.8;
                if (inRange && aimed(self.tower, shot, 0.07)) intent.fire = true;
            }
        }

        // 5. Actives: dash to close on a commit dive, EMP when crowded.
        if (order.stance === 'commit' && self.dashCd === 0 && focus !== null) {
            const foe = sense.foes.find((f) => f.id === focus) as SensedRobot | undefined;
            if (foe !== undefined && foe.distance > DASH_COMMIT_RANGE) intent.dash = true;
        }
        if (order.stance !== 'retreat' && self.empCd === 0) {
            for (const f of sense.foes) {
                if (f.distance < EMP_RANGE) {
                    intent.emp = true;
                    break;
                }
            }
        }

        // 6. The coach's focus vote rides the single radio slot.
        if (order.radio !== null) intent.radio = order.radio;

        return intent;
    }

    /**
     * Urgent asteroid dodge: when a live strike will land near us within
     * HAZ_DODGE_TICKS, sidestep out of the blast circle. The coach re-plans
     * every 30 ticks, but a 75-tick telegraph needs tick-level reaction.
     */
    function hazardEscapePoint(sense: SenseState): { x: number; y: number } | null {
        const hazards = sense.hazards;
        if (!hazards || hazards.length === 0) return null;
        const self = sense.self;
        for (const h of hazards) {
            if (h.ticksToImpact > HAZ_DODGE_TICKS) continue;
            const d = Math.hypot(h.x - self.x, h.y - self.y);
            if (d >= h.radius + HAZ_DODGE_MARGIN) continue;
            let dx = self.x - h.x;
            let dy = self.y - h.y;
            const dd = Math.hypot(dx, dy);
            if (dd < 1) {
                dx = 1;
                dy = 0;
            } else {
                dx /= dd;
                dy /= dd;
            }
            return {
                x: clamp(self.x + dx * (h.radius + HAZ_DODGE_MARGIN + 40), 24, ARENA_WIDTH - 24),
                y: clamp(self.y + dy * (h.radius + HAZ_DODGE_MARGIN + 40), 24, ARENA_HEIGHT - 24),
            };
        }
        return null;
    }

    /** Lateral sidestep away from incoming bullet lanes. */
    function bulletStrafe(sense: SenseState): number {
        const bullets = sense.bullets;
        if (!bullets || bullets.length === 0) return 0;
        const dodge = dodgeVector(sense.self.x, sense.self.y, bullets);
        if (dodge.x === 0 && dodge.y === 0) return 0;
        // Starboard axis of the chassis heading (y-down screen coords).
        const sx = Math.cos(sense.self.heading + Math.PI / 2);
        const sy = Math.sin(sense.self.heading + Math.PI / 2);
        const side = dodge.x * sx + dodge.y * sy;
        if (Math.abs(side) < 0.3) return 0;
        return side > 0 ? 1 : -1;
    }

    return { update };
}
