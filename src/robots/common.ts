// Optional steering helpers for robot authors. Robots may use these or
// inline their own math; everything here is plain deterministic code.

import { angleDiff, clamp } from '../sim/math';
import type { SensedBullet, SensedRobot, TrackedFoe } from '../sim/types';

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
 * Intercept bearing from explicit kinematics: aim here so the bullet meets
 * a constant-velocity target. Works for sightings and stale tracks alike.
 */
export function leadShot(
    selfX: number, selfY: number, bulletSpeed: number,
    tx: number, ty: number, velX: number, velY: number,
): number {
    const flightTime = Math.hypot(tx - selfX, ty - selfY) / bulletSpeed;
    return Math.atan2(ty + velY * flightTime - selfY, tx + velX * flightTime - selfX);
}

/**
 * Intercept bearing: aim here so the bullet meets a constant-velocity foe.
 * Shared helper (was hunter-local); every bot's lead math must agree.
 */
export function leadAngle(selfX: number, selfY: number, bulletSpeed: number, foe: SensedRobot | TrackedFoe): number {
    return leadShot(selfX, selfY, bulletSpeed, foe.x, foe.y, Math.cos(foe.heading) * foe.speed, Math.sin(foe.heading) * foe.speed);
}

/**
 * Dodge vector: a normalized escape direction away from incoming rounds.
 * Each closing bullet pushes along its own line of flight (sidestep the
 * lane, don't outrun the bullet), weighted by closing speed over distance.
 * Returns a zero vector when nothing threatens.
 */
export function dodgeVector(selfX: number, selfY: number, bullets: SensedBullet[]): { x: number; y: number } {
    let px = 0;
    let py = 0;
    for (const b of bullets) {
        if (b.closing <= 0 || b.distance <= 0 || b.distance > 280) continue;
        // Perpendicular of the bullet's velocity, pointing away from its path.
        const speed = Math.hypot(b.vx, b.vy);
        if (speed <= 0) continue;
        const nx = -b.vy / speed;
        const ny = b.vx / speed;
        const side = (selfX - b.x) * nx + (selfY - b.y) * ny >= 0 ? 1 : -1;
        const weight = b.closing / Math.max(40, b.distance);
        px += nx * side * weight;
        py += ny * side * weight;
    }
    const len = Math.hypot(px, py);
    if (len <= 0) return { x: 0, y: 0 };
    return { x: px / len, y: py / len };
}

/**
 * Clearance along a ray: distance from (x, y) to the nearest wall or
 * obstacle rect along `angle`. Arena bounds default to 960x640.
 */
export function rayClearance(
    x: number, y: number, angle: number,
    obstacles: ReadonlyArray<{ x: number; y: number; w: number; h: number }>,
    w = 960, h = 640,
): number {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let best = Infinity;
    if (dx > 0) best = Math.min(best, (w - x) / dx);
    else if (dx < 0) best = Math.min(best, (0 - x) / dx);
    if (dy > 0) best = Math.min(best, (h - y) / dy);
    else if (dy < 0) best = Math.min(best, (0 - y) / dy);
    for (const o of obstacles) {
        let tmin = 0;
        let tmax = Infinity;
        if (dx !== 0) {
            const t1 = (o.x - x) / dx;
            const t2 = (o.x + o.w - x) / dx;
            tmin = Math.max(tmin, Math.min(t1, t2));
            tmax = Math.min(tmax, Math.max(t1, t2));
        } else if (x < o.x || x > o.x + o.w) {
            continue;
        }
        if (dy !== 0) {
            const t1 = (o.y - y) / dy;
            const t2 = (o.y + o.h - y) / dy;
            tmin = Math.max(tmin, Math.min(t1, t2));
            tmax = Math.min(tmax, Math.max(t1, t2));
        } else if (y < o.y || y > o.y + o.h) {
            continue;
        }
        if (tmax >= tmin && tmin < best) best = tmin;
    }
    return best;
}

/** Heat-map cell index for an arena position (-1 when out of bounds). */
export function toGrid(x: number, y: number, cell: number, w: number, h: number): number {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return -1;
    return cy * w + cx;
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
