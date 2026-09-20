// Opponent model v1 (complexity B2): per-foe dodge memory + range histogram
// feeding a counter-lead aim input. Hunter-only: no other bot imports this.
//
// State is small and fixed-size (6 foe slots x a 12-sample ring + 4 range
// bins), allocation-free after warmup, and fully deterministic: observations
// come from cone sightings only (kinematics + HP), never Math.random or
// wall-clock. Foe-signal contract holds: no foe cooldown/charge/loadout is
// read anywhere; the only foe tells consumed live are positioning (ring)
// and HP deltas (exchange histogram, recorded for tuning / v2 discipline).
// Engine tells not consumed by v1 (reserved for v2): `tracks` (blind
// prediction), `bullets` (dodge-trigger learning), `lastDamage` beyond the
// exchange histogram. Headless- and browser-safe: no node imports.

import { ARENA_HEIGHT, ARENA_WIDTH } from '../sim/constants';
import type { SensedRobot, SenseState } from '../sim/types';

/** Tunable knobs (genome `model.*` group). */
export interface ModelParams {
    /** Scales the velocity lead: 1 = full lead, <1 aims inside the arc (circlers). */
    leadScale: number;
    /** Extra lateral lead on consistent dodgers (dodge-memory bias). 0 = off. */
    counterGain: number;
    /** Minimum dominant-direction fraction over the ring to apply the bias. */
    minConf: number;
    /** Extra release tolerance in the close bin (snap-fire vs rushers). */
    aimTolBoost: number;
}

export const MODEL_DEFAULTS: ModelParams = {
    leadScale: 1,
    counterGain: 0,
    minConf: 0.7,
    aimTolBoost: 0.04,
};

/** Samples kept per foe (12 ticks = 0.2 s of memory at 60 Hz). */
export const MODEL_WINDOW = 12;
/** Foe slots (1v1 needs 1, 3v3 needs 3; headroom for more). */
export const MODEL_MAX_FOES = 6;
/** Range-bin edges: [0,150) [150,300) [300,450) [450,inf). */
export const MODEL_BIN_EDGES = [150, 300, 450] as const;
export const MODEL_BIN_COUNT = 4;
/** Lateral speeds below this (units/s) read as stationary: no bias. */
const STILL_SPEED = 8;

export function modelBinFor(distance: number): number {
    for (let b = 0; b < MODEL_BIN_EDGES.length; b += 1) {
        if (distance < (MODEL_BIN_EDGES[b] as number)) return b;
    }
    return MODEL_BIN_COUNT - 1;
}

interface FoeSlot {
    id: number;
    /** Ring count (<= MODEL_WINDOW) and write head. */
    count: number;
    head: number;
    vx: number[];
    vy: number[];
    bin: number[];
    /** Distance and tick per sample (closing-rate tell for fire discipline). */
    dist: number[];
    seenTick: number[];
    /** Per-bin sightings (range histogram) and damage exchange. */
    seen: number[];
    dealt: number[];
    taken: number[];
    /** Last sighted HP (HP-delta tell) and tick. */
    hp: number;
    tick: number;
    /** Last sighted position (blind re-acquire cue). */
    lastX: number;
    lastY: number;
}

function freshSlot(id: number): FoeSlot {
    return {
        id,
        count: 0,
        head: 0,
        vx: new Array<number>(MODEL_WINDOW).fill(0),
        vy: new Array<number>(MODEL_WINDOW).fill(0),
        bin: new Array<number>(MODEL_WINDOW).fill(0),
        dist: new Array<number>(MODEL_WINDOW).fill(0),
        seenTick: new Array<number>(MODEL_WINDOW).fill(0),
        seen: new Array<number>(MODEL_BIN_COUNT).fill(0),
        dealt: new Array<number>(MODEL_BIN_COUNT).fill(0),
        taken: new Array<number>(MODEL_BIN_COUNT).fill(0),
        hp: -1,
        tick: -1,
        lastX: 0,
        lastY: 0,
    };
}

export interface ModelSnapshot {
    id: number;
    samples: number;
    seen: number[];
    dealt: number[];
    taken: number[];
}

export interface OpponentModel {
    readonly params: ModelParams;
    /** Observe one tick (call before aiming). Never mutates `sense`. */
    update(sense: SenseState): void;
    /**
     * Counter-lead shot angle for a visible foe: velocity lead scaled by
     * leadScale, plus a lateral dodge-memory bias when the foe's recent
     * motion is consistent. Falls back to the plain lead when the memory
     * is cold (<3 samples).
     */
    aimAt(foe: SensedRobot, selfX: number, selfY: number, bulletSpeed: number): number;
    /** Release tolerance for this foe (close-bin snap-fire boost). */
    releaseTol(foe: SensedRobot, baseTol: number): number;
    /**
     * True when holding fire to bank charge is productive. Banking without
     * the charger skill (chargeMult 1) yields no bonus, so the bank-wait
     * never resolves and must not suppress the model's solution.
     */
    shouldBank(self: SenseState['self']): boolean;
    /** True once any foe has been sighted this match. */
    hasSeen(): boolean;
    /** Most recent sighting position (blind re-acquire cue), if any. */
    lastSeen(): { x: number; y: number; tick: number } | null;
    /**
     * True when the range to this foe is collapsing fast (units/tick over
     * the ring): a better shot is moments away, so long-range fire waits.
     */
    closingFast(foeId: number): boolean;
    /**
     * True when this foe is parked in the interior (slow now, slow across
     * the ring, away from the walls): a settled camper, not a pin. Chasing
     * a camper head-on is predictable, so the hunter flanks campers
     * instead; pinned foes (held against a wall) are executed head-on.
     */
    isCamping(foe: SensedRobot): boolean;
    /** Debug snapshot of one foe's memory (tuning / reports). */
    snapshot(foeId: number): ModelSnapshot | null;
}

export function createOpponentModel(overrides?: Partial<ModelParams>): OpponentModel {
    const params: ModelParams = { ...MODEL_DEFAULTS, ...overrides };
    const slots: FoeSlot[] = [];
    for (let i = 0; i < MODEL_MAX_FOES; i += 1) slots.push(freshSlot(-1));

    function slotFor(foeId: number, tick: number): FoeSlot {
        for (const s of slots) {
            if (s.id === foeId) return s;
        }
        // Evict the stalest slot (lowest tick; empty slots sit at -1).
        let victim = slots[0] as FoeSlot;
        for (const s of slots) {
            if (s.tick < victim.tick) victim = s;
        }
        const fresh = freshSlot(foeId);
        victim.id = fresh.id;
        victim.count = 0;
        victim.head = 0;
        victim.vx = fresh.vx;
        victim.vy = fresh.vy;
        victim.bin = fresh.bin;
        victim.dist = fresh.dist;
        victim.seenTick = fresh.seenTick;
        victim.seen = fresh.seen;
        victim.dealt = fresh.dealt;
        victim.taken = fresh.taken;
        victim.hp = -1;
        victim.tick = tick;
        victim.lastX = 0;
        victim.lastY = 0;
        return victim;
    }

    function findSlot(foeId: number): FoeSlot | null {
        for (const s of slots) {
            if (s.id === foeId) return s;
        }
        return null;
    }

    return {
        params,
        update(sense: SenseState): void {
            const tick = sense.tick;
            const dmg = sense.self.lastDamage;
            for (const foe of sense.foes) {
                const slot = slotFor(foe.id, tick);
                const b = modelBinFor(foe.distance);
                const at = slot.head;
                slot.vx[at] = Math.cos(foe.heading) * foe.speed;
                slot.vy[at] = Math.sin(foe.heading) * foe.speed;
                slot.bin[at] = b;
                slot.dist[at] = foe.distance;
                slot.seenTick[at] = tick;
                slot.head = (slot.head + 1) % MODEL_WINDOW;
                if (slot.count < MODEL_WINDOW) slot.count += 1;
                slot.seen[b] = (slot.seen[b] as number) + 1;
                if (slot.hp >= 0 && foe.health < slot.hp) {
                    // HP-delta tell: somebody hurt this foe since we last saw
                    // it (1v1 pre-sudden-death: our own bullets landing).
                    slot.dealt[b] = (slot.dealt[b] as number) + (slot.hp - foe.health);
                }
                slot.hp = foe.health;
                slot.tick = tick;
                slot.lastX = foe.x;
                slot.lastY = foe.y;
                if (dmg !== null && dmg.tick === tick && dmg.fromId === foe.id) {
                    slot.taken[b] = (slot.taken[b] as number) + dmg.amount;
                }
            }
        },
        aimAt(foe: SensedRobot, selfX: number, selfY: number, bulletSpeed: number): number {
            const dx = foe.x - selfX;
            const dy = foe.y - selfY;
            const dist = Math.max(1, Math.hypot(dx, dy));
            const flight = dist / bulletSpeed;
            const ivx = Math.cos(foe.heading) * foe.speed;
            const ivy = Math.sin(foe.heading) * foe.speed;
            const slot = findSlot(foe.id);
            if (slot === null || slot.count < 3) {
                // Cold memory: plain constant-velocity lead (common.leadShot math).
                return Math.atan2(foe.y + ivy * flight - selfY, foe.x + ivx * flight - selfX);
            }
            // Line of sight and its perp (lateral speed is v dot perp).
            const ux = dx / dist;
            const uy = dy / dist;
            const nx = -uy;
            const ny = ux;
            let px = foe.x + ivx * flight * params.leadScale;
            let py = foe.y + ivy * flight * params.leadScale;
            if (params.counterGain !== 0) {
                // Dodge memory: when the ring's lateral motion is consistent
                // (same dodge direction), push the aim point further along it.
                let pos = 0;
                let neg = 0;
                let latSum = 0;
                for (let i = 0; i < slot.count; i += 1) {
                    const lat = (slot.vx[i] as number) * nx + (slot.vy[i] as number) * ny;
                    latSum += lat;
                    if (lat > STILL_SPEED) pos += 1;
                    else if (lat < -STILL_SPEED) neg += 1;
                }
                const dom = Math.max(pos, neg);
                const conf = dom / slot.count;
                const latMean = latSum / slot.count;
                if (conf >= params.minConf && Math.abs(latMean) >= STILL_SPEED) {
                    const off = params.counterGain * latMean * flight;
                    px += nx * off;
                    py += ny * off;
                }
            }
            return Math.atan2(py - selfY, px - selfX);
        },
        releaseTol(foe: SensedRobot, baseTol: number): number {
            if (params.aimTolBoost > 0 && foe.distance < (MODEL_BIN_EDGES[0] as number)) {
                return baseTol + params.aimTolBoost;
            }
            return baseTol;
        },
        shouldBank(self: SenseState['self']): boolean {
            return self.stats.chargeMult > 1;
        },
        hasSeen(): boolean {
            for (const s of slots) {
                if (s.count > 0) return true;
            }
            return false;
        },
        lastSeen(): { x: number; y: number; tick: number } | null {
            let best: FoeSlot | null = null;
            for (const s of slots) {
                if (s.count === 0) continue;
                if (best === null || s.tick > best.tick) best = s;
            }
            return best === null ? null : { x: best.lastX, y: best.lastY, tick: best.tick };
        },
        closingFast(foeId: number): boolean {
            const slot = findSlot(foeId);
            if (slot === null || slot.count < 3) return false;
            const first = (slot.head - slot.count + MODEL_WINDOW * 2) % MODEL_WINDOW;
            const last = (slot.head - 1 + MODEL_WINDOW * 2) % MODEL_WINDOW;
            const dt = (slot.seenTick[last] as number) - (slot.seenTick[first] as number);
            if (dt <= 0) return false;
            const rate = ((slot.dist[first] as number) - (slot.dist[last] as number)) / dt;
            return rate > 1.5;
        },
        isCamping(foe: SensedRobot): boolean {
            if (foe.speed >= 30) return false;
            if (foe.x < 60 || foe.x > ARENA_WIDTH - 60 || foe.y < 60 || foe.y > ARENA_HEIGHT - 60) return false;
            const slot = findSlot(foe.id);
            if (slot === null || slot.count < 3) return false;
            let sum = 0;
            for (let i = 0; i < slot.count; i += 1) {
                sum += Math.hypot(slot.vx[i] as number, slot.vy[i] as number);
            }
            return sum / slot.count < 50;
        },
        snapshot(foeId: number): ModelSnapshot | null {
            const slot = findSlot(foeId);
            if (slot === null || slot.count === 0) return null;
            return { id: slot.id, samples: slot.count, seen: [...slot.seen], dealt: [...slot.dealt], taken: [...slot.taken] };
        },
    };
}
