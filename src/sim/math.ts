// Small deterministic math helpers shared by the engine and robots.

export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
    if (Number.isNaN(value)) return 0;
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(angle: number): number {
    let a = angle % TAU;
    if (a > Math.PI) a -= TAU;
    if (a <= -Math.PI) a += TAU;
    return a;
}

/** Signed smallest difference from `from` to `to`, in (-PI, PI]. */
export function angleDiff(from: number, to: number): number {
    return wrapAngle(to - from);
}

export function dist(x1: number, y1: number, x2: number, y2: number): number {
    return Math.hypot(x2 - x1, y2 - y1);
}

/** Coerce an unknown intent field to a finite number, defaulting to `fallback`. */
export function toNumber(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Shared drive-assist law (`Intent.moveMode`): throttle/turn toward a point
 * with the same gains and caps as manual drive (mirrors `common.ts`
 * `steerTo`/`throttleFor` defaults: gain 2.5, back-up past 2.2 rad, ease
 * past 1.1 rad). Holds position within 24 units of the target.
 */
export function assistSteer(
    heading: number, tx: number, ty: number, x: number, y: number,
): { throttle: number; turn: number } {
    if (Math.hypot(tx - x, ty - y) < 24) return { throttle: 0, turn: 0 };
    const target = Math.atan2(ty - y, tx - x);
    const error = Math.abs(angleDiff(heading, target));
    return {
        throttle: error > 2.2 ? -0.5 : error > 1.1 ? 0.25 : 1,
        turn: clamp(angleDiff(heading, target) * 2.5, -1, 1),
    };
}
