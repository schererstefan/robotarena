// Optional steering helpers for robot authors. Robots may use these or
// inline their own math; everything here is plain deterministic code.

import { angleDiff, clamp } from '../sim/math';

/** Proportional tower control: returns a -1..1 towerTurn toward a target angle. */
export function aimTurret(current: number, target: number, gain = 3): number {
    return clamp(angleDiff(current, target) * gain, -1, 1);
}

/** Proportional chassis steering: returns a -1..1 turn toward a target angle. */
export function steerTo(heading: number, target: number, gain = 2.5): number {
    return clamp(angleDiff(heading, target) * gain, -1, 1);
}

/** Full throttle when facing the target, easing off as alignment worsens. */
export function throttleFor(heading: number, target: number): number {
    const error = Math.abs(angleDiff(heading, target));
    if (error > 2.2) return -0.5; // target behind us: back up while turning
    if (error > 1.1) return 0.25;
    return 1;
}

/** True when the tower is close enough to the target angle to fire. */
export function aimed(current: number, target: number, tolerance = 0.07): boolean {
    return Math.abs(angleDiff(current, target)) < tolerance;
}

/**
 * Charge discipline for charger builds: bank while closing or re-aiming,
 * release (stop charging) once a shot is imminent so full drive returns.
 * Returns the charge flag to send; firing consumes the bank automatically.
 */
export function manageCharge(charged: boolean, shotReady: boolean): boolean {
    if (charged) return false; // banked: drive free, fire at will
    return !shotReady; // bank while the gun isn't about to speak
}

/**
 * Stall recovery: samples position every 30 ticks and reports a stall when
 * the drive intends motion but the chassis barely moved (pinned on a wall,
 * a block, or another robot). While stalled (next 30 ticks), the caller
 * should sidestep instead of pushing. Deterministic: tick + odometry only.
 */
export function createStallTracker(): {
    update: (tick: number, x: number, y: number, moving: boolean) => boolean;
} {
    let sx = 0;
    let sy = 0;
    let sampled = -1;
    let until = -1;
    return {
        update(tick: number, x: number, y: number, moving: boolean): boolean {
            if (sampled < 0) {
                sx = x;
                sy = y;
                sampled = tick;
            }
            if (tick - sampled >= 30) {
                const moved = Math.hypot(x - sx, y - sy);
                sx = x;
                sy = y;
                sampled = tick;
                if (moving && moved < 10) until = tick + 30;
            }
            return tick < until;
        },
    };
}
