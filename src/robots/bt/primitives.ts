// Primitive library for behavior trees: conditions read the blackboard,
// actions write Intent fields. This library IS the design work of the N1
// spike — every behavior the GP can discover is composed from these atoms.
//
// Channels: tower / drive / special. The first action to claim a channel
// in a tick owns it; later claims on the same channel are ignored. So a
// Sequence [aim-nearest, kite-foe] aims AND kites in one tick, while a
// Selector picks exactly one branch's drive.
//
// FOE-SIGNAL CONTRACT: every condition documents `reads` (the legal sense
// surface it touches) and every action documents `reads` + `writes` (the
// intent channels it claims). Foe entries carry only id/team/position/
// heading/speed/health/distance/bearing — never hidden cooldown/charge/
// loadout. Anything here that read a new sense field would be a contract
// change and must update docs/ROBOT_API.md.
//
// LEGIBILITY: a printed tree must read like a game plan. desc() renders
// one line per node for printTree; keep it short, concrete, and jargon-
// free ("orbit foe counter-clockwise", not "orbit-foe[-1]").

import { ARENA_HEIGHT, ARENA_WIDTH, EMP_RADIUS } from '../../sim/constants';
import type { Intent } from '../../sim/types';
import { aimed } from '../common';
import type { Blackboard } from './blackboard';
import type { BTStatus } from './tree';

/** Named episodic-memory slots the Latch decorator can use. */
export const LATCH_NAMES = ['revenge', 'bloodied', 'ambush'] as const;

export interface ParamSpec {
    min: number;
    max: number;
    step: number;
    names?: readonly string[];
}

export type Channel = 'tower' | 'drive' | 'special';

export class IntentBuilder {
    private intent: Intent = {};
    private claimed = new Set<Channel>();
    /** The last action's mode hint (vestigial BrainMode for the seam). */
    modeHint = 'roam';

    /**
     * Claim a channel and write fields. Returns false when the channel
     * was already claimed this tick (first writer wins).
     */
    claim(channel: Channel, fields: Partial<Intent>, modeHint?: string): boolean {
        if (this.claimed.has(channel)) return false;
        this.claimed.add(channel);
        Object.assign(this.intent, fields);
        if (modeHint !== undefined) this.modeHint = modeHint;
        return true;
    }

    build(): Intent {
        const out: Intent = { ...this.intent };
        // A tree that never touches the tower still scans: blind trees
        // look alive instead of staring at a wall.
        if (!this.claimed.has('tower')) out.towerTurn = 0.6;
        return out;
    }
}

export interface ConditionDef {
    desc: (params: number[]) => string;
    params: ParamSpec[];
    test: (bb: Blackboard, params: number[]) => boolean;
    /** Legal sense surface this condition reads (foe-signal contract). */
    reads: readonly string[];
}

export interface ActionDef {
    desc: (params: number[]) => string;
    params: ParamSpec[];
    run: (bb: Blackboard, out: IntentBuilder, params: number[]) => BTStatus;
    /** Legal sense surface this action reads (foe-signal contract). */
    reads: readonly string[];
    /** Intent channels this action may claim, in claim order. */
    writes: readonly Channel[];
    /**
     * True when run() can never return 'failure' (no early-outs). The
     * static analysis in tree.ts (pruneUnreachable) relies on this:
     * an action that can fail must NOT make later selector branches
     * look unreachable.
     */
    alwaysSucceeds: boolean;
}

const DIST: ParamSpec = { min: 80, max: 520, step: 20 };
const HP: ParamSpec = { min: 0.15, max: 0.9, step: 0.05 };

function clampArena(x: number, y: number): { x: number; y: number } {
    return {
        x: Math.min(ARENA_WIDTH - 20, Math.max(20, x)),
        y: Math.min(ARENA_HEIGHT - 20, Math.max(20, y)),
    };
}

/** Deterministic 0..1 hash (no RNG state): waypoint buckets for wander. */
function hash01(n: number): number {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
}

export const CONDITIONS: Record<string, ConditionDef> = {
    'always': {
        desc: () => 'always',
        params: [],
        test: () => true,
        reads: [],
    },
    'foe-visible': {
        desc: () => 'foe visible',
        params: [],
        test: (bb) => bb.foe !== null,
        reads: ['foes[]'],
    },
    'foe-closer-than': {
        desc: (p) => `foe closer than ${p[0]}u`,
        params: [DIST],
        test: (bb, p) => bb.foe !== null && bb.foe.distance < (p[0] ?? 0),
        reads: ['foes[].distance'],
    },
    'foe-farther-than': {
        desc: (p) => `foe farther than ${p[0]}u`,
        params: [DIST],
        test: (bb, p) => bb.foe !== null && bb.foe.distance > (p[0] ?? 0),
        reads: ['foes[].distance'],
    },
    'foe-count-at-least': {
        desc: (p) => `${p[0]}+ foes visible`,
        params: [{ min: 1, max: 3, step: 1 }],
        test: (bb, p) => bb.foeCount >= (p[0] ?? 1),
        reads: ['foes[]'],
    },
    'hp-below': {
        desc: (p) => `hp below ${Math.round((p[0] ?? 0) * 100)}%`,
        params: [HP],
        test: (bb, p) => bb.hpFrac < (p[0] ?? 0),
        reads: ['self.health'],
    },
    'hp-above': {
        desc: (p) => `hp above ${Math.round((p[0] ?? 0) * 100)}%`,
        params: [HP],
        test: (bb, p) => bb.hpFrac > (p[0] ?? 0),
        reads: ['self.health'],
    },
    'gun-ready': {
        desc: () => 'gun ready',
        params: [],
        test: (bb) => bb.gunReady,
        reads: ['self.cooldown'],
    },
    'bullet-incoming': {
        desc: () => 'bullet incoming',
        params: [],
        test: (bb) => bb.bullets.length > 0,
        reads: ['bullets[]'],
    },
    'bullet-closer-than': {
        desc: (p) => `bullet closer than ${p[0]}u`,
        params: [{ min: 60, max: 300, step: 20 }],
        test: (bb, p) => bb.bullets.length > 0 && (bb.bullets[0]?.distance ?? Infinity) < (p[0] ?? 0),
        reads: ['bullets[].distance'],
    },
    'pad-nearby': {
        desc: (p) => `pad within ${p[0]}u`,
        params: [{ min: 60, max: 400, step: 20 }],
        test: (bb, p) => bb.pads.some((pad) => pad.distance < (p[0] ?? 0)),
        reads: ['pickups[]'],
    },
    'pad-kind-nearby': {
        desc: (p) => `${['amp', 'repair', 'overdrive'][Math.round(p[0] ?? 0)] ?? '?'} pad within ${p[1]}u`,
        params: [
            { min: 0, max: 2, step: 1, names: ['amp', 'repair', 'overdrive'] },
            { min: 60, max: 400, step: 20 },
        ],
        test: (bb, p) => {
            const kinds = ['amp', 'repair', 'overdrive'] as const;
            const kind = kinds[Math.round(p[0] ?? 0)] ?? 'amp';
            return bb.pads.some((pad) => pad.kind === kind && pad.distance < (p[1] ?? 0));
        },
        reads: ['pickups[]'],
    },
    'zone-shrinking': {
        desc: () => 'sudden death shrinking',
        params: [],
        test: (bb) => bb.zone !== null && bb.zone.shrinking,
        reads: ['zone.phase'],
    },
    'outside-zone': {
        desc: () => 'outside safe circle',
        params: [],
        test: (bb) => bb.zone !== null && !bb.zone.inside,
        reads: ['zone.inside'],
    },
    'sudden-death-soon': {
        desc: (p) => `sudden death within ${p[0]} ticks`,
        params: [{ min: 60, max: 900, step: 60 }],
        test: (bb, p) => bb.zone !== null && bb.zone.suddenDeathIn < (p[0] ?? 0),
        reads: ['zone.suddenDeathIn'],
    },
    'ally-nearby': {
        desc: (p) => `ally within ${p[0]}u`,
        params: [{ min: 60, max: 500, step: 20 }],
        test: (bb, p) => bb.allyCount > 0 && bb.nearestAllyDist < (p[0] ?? 0),
        reads: ['allies[]'],
    },
    'just-hit': {
        desc: () => 'just got hit',
        params: [],
        test: (bb) => bb.justHit,
        reads: ['events[]'],
    },
    'just-hit-hard': {
        desc: (p) => `just hit for ${p[0]}+ dmg`,
        params: [{ min: 8, max: 40, step: 4 }],
        test: (bb, p) => bb.justHit && bb.justHitAmount >= (p[0] ?? 0),
        reads: ['events[]'],
    },
    'track-stale': {
        desc: () => 'stale foe track (seen before, blind now)',
        params: [],
        test: (bb) => bb.stalestTrack !== null && !bb.stalestTrack.seenNow,
        reads: ['tracks[]'],
    },
    'hazard-soon': {
        desc: (p) => `asteroid impact within ${p[0]} ticks`,
        params: [{ min: 30, max: 240, step: 30 }],
        test: (bb, p) =>
            bb.hazard !== null &&
            bb.hazard.ticksToImpact < (p[0] ?? 0) &&
            bb.hazard.distance < bb.hazard.radius + 140,
        reads: ['hazards[]'],
    },
    'dash-ready': {
        desc: () => 'dash ready',
        params: [],
        test: (bb) => bb.dashReady,
        reads: ['self.dashCd'],
    },
    'emp-ready': {
        desc: () => 'emp ready',
        params: [],
        test: (bb) => bb.empReady,
        reads: ['self.empCd'],
    },
    'charged-shot': {
        desc: () => 'full charge banked',
        params: [],
        test: (bb) => bb.charged,
        reads: ['self.charged'],
    },
    'slowed': {
        desc: () => 'slowed by enemy emp',
        params: [],
        test: (bb) => bb.slowed,
        reads: ['self.slowed'],
    },
    'kills-at-least': {
        desc: (p) => `${p[0]}+ kills`,
        params: [{ min: 1, max: 4, step: 1 }],
        test: (bb, p) => bb.kills >= (p[0] ?? 1),
        reads: ['match.killsYou'],
    },
    'foe-weak': {
        desc: (p) => `foe hp below ${Math.round((p[0] ?? 0) * 100)}%`,
        params: [{ min: 0.15, max: 0.8, step: 0.05 }],
        test: (bb, p) => bb.foe !== null && bb.foe.hpFrac < (p[0] ?? 0),
        reads: ['foes[].health'],
    },
};

export const ACTIONS: Record<string, ActionDef> = {
    'aim-nearest': {
        desc: () => 'aim at nearest foe (lead, hold-to-fire)',
        params: [],
        run: (bb, out) => {
            const foe = bb.foe;
            if (!foe) return 'failure';
            out.claim(
                'tower',
                {
                    aimMode: 2,
                    aimTarget: foe.id,
                    aimLead: true,
                    fireMode: 1,
                    fire: aimed(bb.tower, foe.bearing, 0.07),
                },
                'engage',
            );
            return 'success';
        },
        reads: ['foes[]', 'self.tower'],
        writes: ['tower'],
        alwaysSucceeds: false,
    },
    'aim-weakest': {
        desc: () => 'aim at weakest foe (lead, hold-to-fire)',
        params: [],
        run: (bb, out) => {
            const foe = bb.weakestFoe;
            if (!foe) return 'failure';
            out.claim(
                'tower',
                {
                    aimMode: 2,
                    aimTarget: foe.id,
                    aimLead: true,
                    fireMode: 1,
                    fire: aimed(bb.tower, foe.bearing, 0.07),
                },
                'engage',
            );
            return 'success';
        },
        reads: ['foes[]', 'self.tower'],
        writes: ['tower'],
        alwaysSucceeds: false,
    },
    'aim-track': {
        desc: () => 'aim at stale track (ambush the last-known position)',
        params: [],
        run: (bb, out) => {
            const t = bb.stalestTrack;
            if (!t) return 'failure';
            out.claim('tower', { aimMode: 1, aimTarget: t.id, fireMode: 0, fire: false }, 'focus');
            return 'success';
        },
        reads: ['tracks[]'],
        writes: ['tower'],
        alwaysSucceeds: false,
    },
    'scan': {
        desc: (p) => `sweep tower (${(p[0] ?? 0.6).toFixed(1)})`,
        params: [{ min: 0.3, max: 1, step: 0.1 }],
        run: (_bb, out, p) => {
            out.claim('tower', { aimMode: 0, towerTurn: p[0] ?? 0.6, fireMode: 0 }, 'roam');
            return 'success';
        },
        reads: [],
        writes: ['tower'],
        alwaysSucceeds: true,
    },
    'drive-to-foe': {
        desc: () => 'drive at foe',
        params: [],
        run: (bb, out) => {
            const foe = bb.foe;
            if (!foe) return 'failure';
            const t = clampArena(foe.x, foe.y);
            out.claim('drive', { moveMode: 1, moveX: t.x, moveY: t.y }, 'engage');
            return 'success';
        },
        reads: ['foes[]'],
        writes: ['drive'],
        alwaysSucceeds: false,
    },
    'kite-foe': {
        desc: (p) => `hold ${p[0]}u from foe`,
        params: [{ min: 160, max: 420, step: 20 }],
        run: (bb, out, p) => {
            const foe = bb.foe;
            if (!foe) return 'failure';
            const d = p[0] ?? 260;
            const dx = bb.x - foe.x;
            const dy = bb.y - foe.y;
            const dist = Math.hypot(dx, dy) || 1;
            const t = clampArena(foe.x + (dx / dist) * d, foe.y + (dy / dist) * d);
            out.claim('drive', { moveMode: 1, moveX: t.x, moveY: t.y }, 'kite');
            return 'success';
        },
        reads: ['foes[]', 'self.position'],
        writes: ['drive'],
        alwaysSucceeds: false,
    },
    'orbit-foe': {
        desc: (p) => `orbit foe ${(p[0] ?? 1) > 0 ? 'clockwise' : 'counter-clockwise'}`,
        params: [{ min: -1, max: 1, step: 2, names: ['ccw', 'cw'] }],
        run: (bb, out, p) => {
            const foe = bb.foe;
            if (!foe) return 'failure';
            const dir = p[0] ?? 1;
            const dx = foe.x - bb.x;
            const dy = foe.y - bb.y;
            const dist = Math.hypot(dx, dy) || 1;
            // Tangent point 200u to the side of the foe: circling approach.
            const tx = foe.x + (-dy / dist) * dir * 200;
            const ty = foe.y + (dx / dist) * dir * 200;
            const t = clampArena(tx, ty);
            out.claim('drive', { moveMode: 1, moveX: t.x, moveY: t.y }, 'flank');
            return 'success';
        },
        reads: ['foes[]', 'self.position'],
        writes: ['drive'],
        alwaysSucceeds: false,
    },
    'drive-to-pad': {
        desc: (p) => `drive to ${['any', 'amp', 'repair', 'overdrive'][Math.round(p[0] ?? 0)] ?? 'any'} pad`,
        params: [{ min: 0, max: 3, step: 1, names: ['any', 'amp', 'repair', 'overdrive'] }],
        run: (bb, out, p) => {
            const kinds = ['any', 'amp', 'repair', 'overdrive'] as const;
            const want = kinds[Math.round(p[0] ?? 0)] ?? 'any';
            const pad = bb.pads.find((pd) => want === 'any' || pd.kind === want);
            if (!pad) return 'failure';
            out.claim('drive', { moveMode: 1, moveX: pad.x, moveY: pad.y }, 'roam');
            return 'success';
        },
        reads: ['pickups[]'],
        writes: ['drive'],
        alwaysSucceeds: false,
    },
    'drive-to-safety': {
        desc: () => 'drive to safe-circle center',
        params: [],
        run: (bb, out) => {
            if (!bb.zone) return 'failure';
            out.claim('drive', { moveMode: 1, moveX: bb.zone.cx, moveY: bb.zone.cy }, 'retreat');
            return 'success';
        },
        reads: ['zone.circle'],
        writes: ['drive'],
        alwaysSucceeds: false,
    },
    'drive-to-track': {
        desc: () => "drive to foe's last-known position",
        params: [],
        run: (bb, out) => {
            const t = bb.stalestTrack;
            if (!t) return 'failure';
            const c = clampArena(t.x, t.y);
            out.claim('drive', { moveMode: 1, moveX: c.x, moveY: c.y }, 'focus');
            return 'success';
        },
        reads: ['tracks[]'],
        writes: ['drive'],
        alwaysSucceeds: false,
    },
    'flee-foe': {
        desc: () => 'run from foe',
        params: [],
        run: (bb, out) => {
            const foe = bb.foe;
            if (!foe) return 'failure';
            const dx = bb.x - foe.x;
            const dy = bb.y - foe.y;
            const dist = Math.hypot(dx, dy) || 1;
            const t = clampArena(bb.x + (dx / dist) * 420, bb.y + (dy / dist) * 420);
            out.claim('drive', { moveMode: 1, moveX: t.x, moveY: t.y }, 'retreat');
            return 'success';
        },
        reads: ['foes[]', 'self.position'],
        writes: ['drive'],
        alwaysSucceeds: false,
    },
    'dodge': {
        desc: () => 'sidestep the nearest incoming bullet lane',
        params: [],
        run: (bb, out) => {
            const b = bb.bullets[0];
            if (!b) return 'failure';
            const v = Math.hypot(b.vx, b.vy);
            if (v <= 0) return 'failure';
            // Step perpendicular to the bullet's line of flight.
            const t = clampArena(bb.x + (-b.vy / v) * 140, bb.y + (b.vx / v) * 140);
            out.claim('drive', { moveMode: 1, moveX: t.x, moveY: t.y }, 'kite');
            return 'success';
        },
        reads: ['bullets[]'],
        writes: ['drive'],
        alwaysSucceeds: false,
    },
    'hold': {
        desc: () => 'hold position',
        params: [],
        run: (_bb, out) => {
            out.claim('drive', { moveMode: 0, throttle: 0, turn: 0, strafe: 0 }, 'roam');
            return 'success';
        },
        reads: [],
        writes: ['drive'],
        alwaysSucceeds: true,
    },
    'wander': {
        desc: () => 'wander to a fresh waypoint',
        params: [],
        run: (bb, out) => {
            const bucket = Math.floor(bb.tick / 150);
            const wx = 60 + hash01(bucket * 2 + 7) * (ARENA_WIDTH - 120);
            const wy = 60 + hash01(bucket * 2 + 13) * (ARENA_HEIGHT - 120);
            out.claim('drive', { moveMode: 1, moveX: wx, moveY: wy }, 'roam');
            return 'success';
        },
        reads: ['tick'],
        writes: ['drive'],
        alwaysSucceeds: true,
    },
    'dash-at-foe': {
        desc: () => 'dash at foe',
        params: [],
        run: (bb, out) => {
            const foe = bb.foe;
            if (!foe || !bb.dashReady) return 'failure';
            out.claim('special', { dash: true }, 'engage');
            const t = clampArena(foe.x, foe.y);
            out.claim('drive', { moveMode: 1, moveX: t.x, moveY: t.y }, 'engage');
            return 'success';
        },
        reads: ['foes[]', 'self.dashCd'],
        writes: ['special', 'drive'],
        alwaysSucceeds: false,
    },
    'dash-away': {
        desc: () => 'dash away from foe',
        params: [],
        run: (bb, out) => {
            const foe = bb.foe;
            if (!foe || !bb.dashReady) return 'failure';
            const dx = bb.x - foe.x;
            const dy = bb.y - foe.y;
            const dist = Math.hypot(dx, dy) || 1;
            out.claim('special', { dash: true }, 'retreat');
            const t = clampArena(bb.x + (dx / dist) * 420, bb.y + (dy / dist) * 420);
            out.claim('drive', { moveMode: 1, moveX: t.x, moveY: t.y }, 'retreat');
            return 'success';
        },
        reads: ['foes[]', 'self.dashCd'],
        writes: ['special', 'drive'],
        alwaysSucceeds: false,
    },
    'emp': {
        desc: () => 'emp burst (foe in radius)',
        params: [],
        run: (bb, out) => {
            if (!bb.empReady) return 'failure';
            if (!bb.foe || bb.foe.distance > EMP_RADIUS) return 'failure';
            out.claim('special', { emp: true }, 'engage');
            return 'success';
        },
        reads: ['self.empCd', 'foes[].distance'],
        writes: ['special'],
        alwaysSucceeds: false,
    },
    'bank-charge': {
        desc: () => 'bank charge (slow drive, charged shot)',
        params: [],
        run: (_bb, out) => {
            out.claim('special', { charge: true }, 'engage');
            return 'success';
        },
        reads: [],
        writes: ['special'],
        alwaysSucceeds: true,
    },
};
