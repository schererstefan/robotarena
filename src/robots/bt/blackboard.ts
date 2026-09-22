// Blackboard: the per-tick derived view a behavior tree reasons over.
//
// Everything here is computed from the legal SenseState surface — foe
// entries carry only id/team/position/heading/speed/health/distance/bearing
// (never hidden cooldown/charge/loadout), pads/zone/hazards are public map
// knowledge, tracks are the engine's own foe memory. The foe-signal
// contract is unchanged by this file.

import type { SenseState } from '../../sim/types';
import type { Rand } from '../../sim/rng';

export interface BBFoe {
    id: number;
    x: number;
    y: number;
    heading: number;
    speed: number;
    /** Health fraction 0..1 (from the legal sensed health + maxHealth stat). */
    hpFrac: number;
    distance: number;
    bearing: number;
}

export interface BBBullet {
    distance: number;
    closing: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
}

export interface BBPad {
    kind: 'amp' | 'repair' | 'overdrive';
    x: number;
    y: number;
    distance: number;
}

export interface BBTrack {
    id: number;
    x: number;
    y: number;
    distance: number;
    /** Ticks since the foe was last inside the sensor cone. */
    age: number;
    seenNow: boolean;
}

export interface BBZone {
    suddenDeathIn: number;
    distToSafety: number;
    inside: boolean;
    shrinking: boolean;
    cx: number;
    cy: number;
}

export interface BBHazard {
    x: number;
    y: number;
    ticksToImpact: number;
    distance: number;
    radius: number;
}

export interface Blackboard {
    tick: number;
    /** One cached deterministic draw per tick (from sense.rand). */
    rand01: number;
    x: number;
    y: number;
    heading: number;
    tower: number;
    speed: number;
    hpFrac: number;
    /** Nearest visible foe (foes arrive nearest-first). */
    foe: BBFoe | null;
    weakestFoe: BBFoe | null;
    foeCount: number;
    /** Incoming foe bullets (closing > 0), nearest first. */
    bullets: BBBullet[];
    /** Pad pickups: active pads, nearest first. */
    pads: BBPad[];
    zone: BBZone | null;
    allyCount: number;
    nearestAllyDist: number;
    tracks: BBTrack[];
    /** The longest-unseen foe (ambush memory). Null when never saw a foe. */
    stalestTrack: BBTrack | null;
    justHit: boolean;
    justHitAmount: number;
    justHitBearing: number;
    justKilled: boolean;
    justPickedUp: boolean;
    gunReady: boolean;
    dashReady: boolean;
    empReady: boolean;
    charge: number;
    charged: boolean;
    slowed: boolean;
    hazard: BBHazard | null;
    blockedAhead: number;
    walls: { left: number; right: number; top: number; bottom: number };
    kills: number;
    aliveFoes: number;
    /** Episodic memory, owned by the brain (persists across ticks). */
    latches: Map<string, number>;
}

export function buildBlackboard(sense: SenseState, latches: Map<string, number>): Blackboard {
    const self = sense.self;
    const rand: Rand = sense.rand;
    const maxHealth = self.stats.maxHealth > 0 ? self.stats.maxHealth : 1;

    let foe: BBFoe | null = null;
    let weakestFoe: BBFoe | null = null;
    for (const f of sense.foes) {
        const info: BBFoe = {
            id: f.id,
            x: f.x,
            y: f.y,
            heading: f.heading,
            speed: f.speed,
            hpFrac: f.health / maxHealth,
            distance: f.distance,
            bearing: f.bearing,
        };
        if (!foe) foe = info; // foes are nearest-first
        if (!weakestFoe || info.hpFrac < weakestFoe.hpFrac) weakestFoe = info;
    }

    const bullets: BBBullet[] = [];
    for (const b of sense.bullets ?? []) {
        if (b.closing > 0) bullets.push({ distance: b.distance, closing: b.closing, x: b.x, y: b.y, vx: b.vx, vy: b.vy });
    }
    bullets.sort((a, b2) => a.distance - b2.distance);

    const pads: BBPad[] = [];
    for (const p of sense.pickups ?? []) {
        if (!p.active) continue;
        pads.push({
            kind: p.kind,
            x: p.x,
            y: p.y,
            distance: Math.hypot(p.x - self.x, p.y - self.y),
        });
    }
    pads.sort((a, b) => a.distance - b.distance);

    const z = sense.zone;
    const zone: BBZone | null = z
        ? {
              suddenDeathIn: z.suddenDeathIn,
              distToSafety: z.distToSafety,
              inside: z.inside,
              shrinking: z.phase === 'shrinking',
              cx: z.circle.x,
              cy: z.circle.y,
          }
        : null;

    let nearestAllyDist = Infinity;
    for (const a of sense.allies) {
        if (a.distance < nearestAllyDist) nearestAllyDist = a.distance;
    }

    const tracks: BBTrack[] = [];
    for (const t of sense.tracks ?? []) {
        tracks.push({
            id: t.id,
            x: t.x,
            y: t.y,
            distance: Math.hypot(t.x - self.x, t.y - self.y),
            age: sense.tick - t.lastSeenTick,
            seenNow: t.seenNow,
        });
    }
    let stalestTrack: BBTrack | null = null;
    for (const t of tracks) {
        if (!stalestTrack || t.age > stalestTrack.age) stalestTrack = t;
    }

    let justHit = false;
    let justHitAmount = 0;
    let justHitBearing = 0;
    let justKilled = false;
    let justPickedUp = false;
    for (const e of sense.events ?? []) {
        if (e.kind === 'hit-by') {
            justHit = true;
            justHitAmount = Math.max(justHitAmount, e.amount ?? 0);
            if (e.bearing !== undefined) justHitBearing = e.bearing;
        } else if (e.kind === 'kill') {
            justKilled = true;
        } else if (e.kind === 'pickup') {
            justPickedUp = true;
        }
    }

    let hazard: BBHazard | null = null;
    for (const h of sense.hazards ?? []) {
        const d = Math.hypot(h.x - self.x, h.y - self.y);
        if (!hazard || h.ticksToImpact < hazard.ticksToImpact) {
            hazard = { x: h.x, y: h.y, ticksToImpact: h.ticksToImpact, distance: d, radius: h.radius };
        }
    }

    return {
        tick: sense.tick,
        rand01: rand(),
        x: self.x,
        y: self.y,
        heading: self.heading,
        tower: self.tower,
        speed: self.speed,
        hpFrac: self.health / maxHealth,
        foe,
        weakestFoe,
        foeCount: sense.foes.length,
        bullets,
        pads,
        zone,
        allyCount: sense.allies.length,
        nearestAllyDist,
        tracks,
        stalestTrack,
        justHit,
        justHitAmount,
        justHitBearing,
        justKilled,
        justPickedUp,
        gunReady: self.cooldown === 0,
        dashReady: self.dashCd === 0,
        empReady: self.empCd === 0,
        charge: self.charge,
        charged: self.charged,
        slowed: self.slowed,
        hazard,
        blockedAhead: self.blocked.ahead,
        walls: { left: sense.walls.left, right: sense.walls.right, top: sense.walls.top, bottom: sense.walls.bottom },
        kills: sense.match?.killsYou ?? 0,
        aliveFoes: sense.match?.aliveFoes ?? sense.foes.length,
        latches,
    };
}
