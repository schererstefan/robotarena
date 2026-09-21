// Optional steering helpers for robot authors. Robots may use these or
// inline their own math; everything here is plain deterministic code.

import { angleDiff, clamp } from '../sim/math';
import { TURRET_CAPTURE_RADIUS } from '../sim/constants';
import type {
    Intent,
    SensedBullet,
    SensedHazard,
    SensedRobot,
    SensePad,
    SenseState,
    SenseTurret,
    TrackedFoe,
} from '../sim/types';

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
/**
 * Utility (powerup/turret/hazard) awareness shared by the active brains.
 * Opportunist, not optimal: diversions only fire when blind or when the
 * fight is distant, hazard escape always wins, and the sudden-death
 * circle always owns the drive. All helpers are pure deterministic reads
 * of the sense — no Math.random, no wall-clock.
 */

/** Seek repair below this health fraction (else fight on). */
export const UTILITY_REPAIR_FRAC = 0.6;
/** Top-up repair when hurt this much and no better pad is active. */
export const UTILITY_TOPUP_FRAC = 0.85;
/** Even/healthy enough to contest an enemy turret (else defend ours). */
export const UTILITY_CONTEST_FRAC = 0.5;
/** Hysteresis: hold the current pad unless a rival is this much closer. */
export const UTILITY_PAD_STICK = 1.3;
/** React to a telegraph once it is this close to impact. */
export const UTILITY_HAZARD_TICKS = 75;
/** Extra margin around the blast radius treated as threatened. */
export const UTILITY_HAZARD_MARGIN = 90;
/** Dash out only when the blast is this imminent and nearly on top of us. */
export const UTILITY_DASH_TICKS = 25;
export const UTILITY_DASH_MARGIN = 30;

/** Per-match utility memory (pad hysteresis). Lives in the brain closure. */
export interface UtilityMemory {
    padIdx: number;
}

/** Fresh per-match utility memory. */
export function createUtilityMemory(): UtilityMemory {
    return { padIdx: -1 };
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
    return Math.hypot(ax - bx, ay - by);
}

/**
 * Pick a powerup pad index (fixed pad order) or -1. Nearest ACTIVE pad of
 * the wanted kind: repair when hurt, else amp/overdrive (repair top-up
 * when wounded and nothing better burns). Dark (respawning) pads are
 * never picked. Holds the current pick while it stays active and no
 * rival is clearly closer, so the drive never jitters between two pads.
 * Pass `skipAmp` under the double-damage exhibition modifier, where AMP
 * is worthless (damage bonuses never stack — the strongest wins).
 */
export function selectPad(
    pads: ReadonlyArray<SensePad>,
    selfX: number, selfY: number, hpFrac: number,
    currentIdx: number,
    skipAmp = false,
): number {
    if (pads.length === 0) return -1;
    const burnKinds: ReadonlyArray<string> = skipAmp ? ['overdrive'] : ['amp', 'overdrive'];
    const wantRepair = hpFrac < UTILITY_REPAIR_FRAC;
    let kinds: ReadonlyArray<string>;
    if (wantRepair) {
        kinds = ['repair'];
    } else if (hpFrac < UTILITY_TOPUP_FRAC) {
        kinds = [...burnKinds, 'repair'];
        // Prefer a damage/speed pad over a top-up: rank repair last.
        const burn = nearestActivePad(pads, selfX, selfY, burnKinds);
        if (burn >= 0) return stickToCurrent(pads, selfX, selfY, currentIdx, burnKinds, burn);
        kinds = ['repair'];
    } else {
        kinds = burnKinds;
    }
    const best = nearestActivePad(pads, selfX, selfY, kinds);
    if (best < 0) return -1;
    return stickToCurrent(pads, selfX, selfY, currentIdx, kinds, best);
}

function nearestActivePad(
    pads: ReadonlyArray<SensePad>,
    selfX: number, selfY: number,
    kinds: ReadonlyArray<string>,
): number {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < pads.length; i += 1) {
        const pad = pads[i] as SensePad;
        if (!pad.active) continue;
        if (!kinds.includes(pad.kind)) continue;
        const d = dist2(selfX, selfY, pad.x, pad.y);
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    }
    return best;
}

function stickToCurrent(
    pads: ReadonlyArray<SensePad>,
    selfX: number, selfY: number,
    currentIdx: number,
    kinds: ReadonlyArray<string>,
    best: number,
): number {
    const cur = currentIdx >= 0 && currentIdx < pads.length ? (pads[currentIdx] as SensePad) : undefined;
    if (cur !== undefined && cur.active && kinds.includes(cur.kind)) {
        const curDist = dist2(selfX, selfY, cur.x, cur.y);
        const bestPad = pads[best] as SensePad;
        const bestDist = dist2(selfX, selfY, bestPad.x, bestPad.y);
        if (curDist <= bestDist * UTILITY_PAD_STICK) return currentIdx;
    }
    return best;
}

/**
 * Pick a map-turret index (fixed turret order) to walk to, or -1.
 * Neutral turrets first (capture), then — when even/healthy — the
 * nearest enemy turret (contest), else the nearest owned turret
 * (defend). Reads the ownership/progress fields every brain already
 * receives; progress itself needs no reaction beyond presence.
 */
export function selectTurret(
    turrets: ReadonlyArray<SenseTurret>,
    selfX: number, selfY: number, selfTeam: 0 | 1,
    killsTeam: number, hpFrac: number,
): number {
    if (turrets.length === 0) return -1;
    const neutral: number[] = [];
    const enemy: number[] = [];
    const owned: number[] = [];
    for (let i = 0; i < turrets.length; i += 1) {
        const t = turrets[i] as SenseTurret;
        if (t.owner === -1) neutral.push(i);
        else if (t.owner === selfTeam) owned.push(i);
        else enemy.push(i);
    }
    const nearestOf = (ids: number[]): number => {
        let best = -1;
        let bestDist = Infinity;
        for (const i of ids) {
            const t = turrets[i] as SenseTurret;
            const d = dist2(selfX, selfY, t.x, t.y);
            if (d < bestDist) {
                bestDist = d;
                best = i;
            }
        }
        return best;
    };
    if (neutral.length > 0) return nearestOf(neutral);
    const evenOrWinning = killsTeam > 0 || hpFrac >= UTILITY_CONTEST_FRAC;
    if (evenOrWinning) {
        const contest = nearestOf(enemy);
        if (contest >= 0) return contest;
        return -1;
    }
    const defend = nearestOf(owned);
    if (defend >= 0) return defend;
    return nearestOf(enemy);
}

/**
 * Escape bearing away from telegraphed strikes, or null when nothing
 * threatens. Urgent once a strike is close to impact and its blast
 * (+ margin) reaches us; weight leans on the most imminent strike.
 * The caller keeps its tower/fire solution — this is drive-only.
 */
export function hazardEscape(
    hazards: ReadonlyArray<SensedHazard>,
    selfX: number, selfY: number,
): number | null {
    let px = 0;
    let py = 0;
    for (const hz of hazards) {
        if (hz.ticksToImpact > UTILITY_HAZARD_TICKS) continue;
        const d = dist2(selfX, selfY, hz.x, hz.y);
        const reach = hz.radius + UTILITY_HAZARD_MARGIN;
        if (d >= reach) continue;
        const urgency = (1 - Math.max(0, hz.ticksToImpact) / UTILITY_HAZARD_TICKS) * (1 - d / reach);
        const dx = selfX - hz.x;
        const dy = selfY - hz.y;
        const len = Math.hypot(dx, dy) || 1;
        px += (dx / len) * urgency;
        py += (dy / len) * urgency;
    }
    if (px === 0 && py === 0) return null;
    return Math.atan2(py, px);
}

/**
 * True when dashing out of a nearly-impacting blast is warranted: a
 * strike about to land with its radius (+ small margin) on us.
 */
export function hazardDash(
    hazards: ReadonlyArray<SensedHazard>,
    selfX: number, selfY: number,
): boolean {
    for (const hz of hazards) {
        if (hz.ticksToImpact > UTILITY_DASH_TICKS) continue;
        if (dist2(selfX, selfY, hz.x, hz.y) < hz.radius + UTILITY_DASH_MARGIN) return true;
    }
    return false;
}

/**
 * True when a goal point sits inside a strike zone that will still be
 * hot on arrival: don't path through a zone that lands before we can
 * cross it. ETA assumes straight-line top-speed sprint.
 */
export function arrivalHot(
    goalX: number, goalY: number,
    selfX: number, selfY: number, topSpeed: number,
    hazards: ReadonlyArray<SensedHazard>,
): boolean {
    if (topSpeed <= 0) return false;
    const eta = Math.ceil(dist2(selfX, selfY, goalX, goalY) / topSpeed);
    for (const hz of hazards) {
        if (hz.ticksToImpact > eta) continue;
        if (dist2(goalX, goalY, hz.x, hz.y) < hz.radius) return true;
    }
    return false;
}

/**
 * Hazard-only drive override: run from telegraphed strikes (dashing out
 * of an imminent blast). Never touches tower/fire/radio. Returns null
 * when nothing threatens, so callers can layer their own drive first.
 */
export function hazardEscapeDrive(sense: SenseState, intent: Intent): Intent | null {
    const self = sense.self;
    const hazards = sense.hazards ?? [];
    const escape = hazardEscape(hazards, self.x, self.y);
    if (escape === null) return null;
    const out: Intent = {
        ...intent,
        throttle: 1,
        turn: steerTo(self.heading, escape, 2.5),
    };
    if (self.dashCd <= 0 && hazardDash(hazards, self.x, self.y)) out.dash = true;
    return out;
}

/**
 * True when a fresh foe trail exists — chase the lead, don't go shopping.
 * Per-brain opt-in (hunter-hc2's bank discipline): the default divert
 * rule is blind-only, which the melee brains all convert.
 */
export function hasFreshLead(sense: SenseState): boolean {
    const tracks = sense.tracks ?? [];
    for (const t of tracks) {
        if (t.seenNow) return true;
        if (sense.tick - t.lastSeenTick < 60) return true;
    }
    return false;
}

/** Per-brain divert tuning (all fields optional, all default off/true). */
export interface DivertOpts {
    /** Divert only with no fresh foe trail (bank-discipline brains). */
    coldOnly?: boolean;
    /** Also divert with a visible-but-distant foe (hit-and-run sustain). */
    eager?: boolean;
    /** Walk turrets (default true; anchor bots may narrow this). */
    turrets?: boolean;
    /** Take amp/overdrive while healthy (default true; sustenance-only
     * brains set false and only ever detour to repair). */
    opportunistic?: boolean;
}

/**
 * Pad/turret diversion pass (no hazard handling — pair with
 * hazardEscapeDrive). Default: blind-only detour to the nearer of the
 * picked pad / turret goal (repair when hurt, else amp/overdrive or a
 * turret walk). `DivertOpts` narrows or widens per brain identity.
 * Never diverts out of the sudden-death circle run, never into a
 * soon-hot arrival, never touches tower/fire/radio/dash. Returns the
 * intent.
 */
export function utilityDivert(sense: SenseState, intent: Intent, mem: UtilityMemory, opts?: DivertOpts): Intent {
    const self = sense.self;
    const hazards = sense.hazards ?? [];
    // The circle owns the drive once it starts shrinking under us.
    const zone = sense.zone;
    if (zone !== undefined && zone.phase === 'shrinking' && !zone.inside) return intent;
    const foes = sense.foes;
    const nearest = foes.length > 0 ? (foes[0] as SensedRobot).distance : Infinity;
    const gunRange = self.stats.gunRange;
    const fighting = nearest < gunRange * 0.8;
    const far = foes.length === 0 || ((opts?.eager === true) && nearest > gunRange);
    // A live (close) fight is a standing order: fight, don't shop.
    if (!far) return intent;
    if (opts?.coldOnly === true && hasFreshLead(sense)) return intent;
    const hpFrac = self.health / self.stats.maxHealth;
    const pads = sense.pickups ?? [];
    const turrets = sense.turrets ?? [];

    // Goal candidates: the picked pad and/or turret, nearer one wins.
    let goalX: number | null = null;
    let goalY: number | null = null;
    let goalDist = Infinity;
    const consider = (x: number, y: number): void => {
        const d = dist2(self.x, self.y, x, y);
        if (d < goalDist) {
            goalDist = d;
            goalX = x;
            goalY = y;
        }
    };
    const blind = foes.length === 0;
    const hurt = hpFrac < UTILITY_REPAIR_FRAC;
    const wantTurrets = opts?.turrets !== false;
    const wantGreed = opts?.opportunistic !== false;
    // AMP is worthless under double damage (bonuses never stack): skip it.
    const skipAmp = sense.match?.modifiers.doubleDamage === true;
    if (pads.length > 0 && ((hurt && !fighting) || (wantGreed && blind))) {
        const padIdx = selectPad(pads, self.x, self.y, hpFrac, mem.padIdx, skipAmp);
        if (padIdx >= 0) {
            const pad = pads[padIdx] as SensePad;
            mem.padIdx = padIdx;
            consider(pad.x, pad.y);
        }
    }
    if (turrets.length > 0 && wantTurrets) {
        if (sense.match !== undefined) {
            const tidx = selectTurret(
                turrets, self.x, self.y, self.team,
                sense.match.killsTeam, hpFrac,
            );
            if (tidx >= 0) {
                const t = turrets[tidx] as SenseTurret;
                // Already sitting on the capture point: hold, don't orbit it.
                if (dist2(self.x, self.y, t.x, t.y) > TURRET_CAPTURE_RADIUS * 0.75) consider(t.x, t.y);
            }
        } else {
            // Ambiguous scoreboard: still capture neutrals, never contest.
            let best = -1;
            let bestDist = Infinity;
            for (let i = 0; i < turrets.length; i += 1) {
                const t = turrets[i] as SenseTurret;
                if (t.owner !== -1) continue;
                const d = dist2(self.x, self.y, t.x, t.y);
                if (d < bestDist) {
                    bestDist = d;
                    best = i;
                }
            }
            if (best >= 0) {
                const t = turrets[best] as SenseTurret;
                if (dist2(self.x, self.y, t.x, t.y) > TURRET_CAPTURE_RADIUS * 0.75) consider(t.x, t.y);
            }
        }
    }
    if (goalX === null || goalY === null) return intent;
    const gx = goalX as number;
    const gy = goalY as number;
    // Don't walk into a blast to reach a pickup: hold the combat lane.
    if (arrivalHot(gx, gy, self.x, self.y, self.stats.maxSpeed / 60, hazards)) return intent;
    // Already collecting: let the base drive stand (pads grab at 26u).
    if (goalDist < 30) return intent;
    const angle = Math.atan2(gy - self.y, gx - self.x);
    return {
        ...intent,
        throttle: throttleFor(self.heading, angle),
        turn: steerTo(self.heading, angle, 2.5),
    };
}

/**
 * Full drive-only utility post-pass: hazard escape first, then the
 * pad/turret diversion. Anchor bots (turret, sniper) layer the pieces
 * themselves so parking survives contact.
 */
export function utilityDrive(sense: SenseState, intent: Intent, mem: UtilityMemory, opts?: DivertOpts): Intent {
    return utilityDivert(sense, hazardEscapeDrive(sense, intent) ?? intent, mem, opts);
}

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
