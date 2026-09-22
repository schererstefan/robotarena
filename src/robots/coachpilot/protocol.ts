// N4 spike: the coach/pilot protocol — the contract between the two timescales.
//
// The coach (slow: every COACH_PERIOD ticks) emits one CoachOrder. The pilot
// (fast: every tick) translates it into an Intent through the engine's
// assist substrate (moveMode=1 drive assist, aimMode/aimTarget turret
// assist), plus small local tactical overrides. The two failure modes are
// disjoint by design: a coach misread shows up as a bad order on screen
// (wrong zone, wrong foe), a pilot failure as bad execution (missed dodge,
// dropped aim).

import type { OutboxMessage } from '../../sim/types';

/** Coach cadence in ticks (0.5 s at 60 Hz). */
export const COACH_PERIOD = 30;

/** Team-level posture. Drives waypoint aggression and fire discipline. */
export type CoachStance = 'commit' | 'skirmish' | 'retreat';

/**
 * One strategy directive from the coach to the pilot.
 * - moveX/moveY: the waypoint the pilot must reach (via drive assist).
 * - focusFoe: the foe id the whole team should work (turret assist + focus
 *   radio), or null when blind.
 * - stance: how hard to push and how freely to fire.
 * - radio: the coach's focus vote for this period (null when blind).
 * - plan: a human-readable tag of the reasoning, for telemetry/shots.
 */
export interface CoachOrder {
    moveX: number;
    moveY: number;
    focusFoe: number | null;
    stance: CoachStance;
    radio: OutboxMessage | null;
    plan: string;
}
