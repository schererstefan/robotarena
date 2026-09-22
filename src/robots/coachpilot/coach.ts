// N4 spike: the coach — slow-timescale strategy (every COACH_PERIOD ticks).
//
// Decides, per period: the team stance (commit/skirmish/retreat), the team
// focus foe (weakest live cone foe, converged across teammates through the
// focus radio so the whole squad works one target), and the waypoint
// (zone anchors, pad runs, turret captures, dives). Never touches the
// chassis or tower directly — that is the pilot's job.
//
// Deterministic: every input comes from SenseState; no Math.random.

import { ARENA_HEIGHT, ARENA_WIDTH } from '../../sim/constants';
import { clamp } from '../../sim/math';
import type { InboxMessage, SensedRobot, SenseState, TrackedFoe } from '../../sim/types';
import { castFocusVote, focusTarget } from '../comms';
import { COACH_PERIOD, type CoachOrder, type CoachStance } from './protocol';

/** Tunable strategy knobs. */
export interface CoachParams {
    /** 0..1: how aggressively to route through powerup pads. */
    greed: number;
    /** Team HP fraction below which the coach orders a full retreat. */
    retreatHpFrac: number;
    /** Stickiness multiplier for holding the current pad pick. */
    padHoldBias: number;
    /** 0..1: how eagerly to run at neutral map turrets. */
    turretGreed: number;
}

export const COACH_DEFAULTS: CoachParams = {
    greed: 0.85,
    retreatHpFrac: 0.35,
    padHoldBias: 1.4,
    turretGreed: 0.7,
};

/** One known foe position: cone (live, with health), track/scout/shared (stale, position-only). */
interface KnownFoe {
    x: number;
    y: number;
    /** Null when position-only (scout/shared/tracks). */
    health: number | null;
    /** True for a live cone sighting this tick. */
    live: boolean;
}

function knownFoes(sense: SenseState): Map<number, KnownFoe> {
    const out = new Map<number, KnownFoe>();
    for (const f of sense.foes as SensedRobot[]) {
        out.set(f.id, { x: f.x, y: f.y, health: f.health, live: true });
    }
    const stale = (id: number, x: number, y: number): void => {
        if (!out.has(id)) out.set(id, { x, y, health: null, live: false });
    };
    if (sense.tracks) for (const t of sense.tracks as TrackedFoe[]) stale(t.id, t.x, t.y);
    if (sense.scout) for (const s of sense.scout as SensedRobot[]) stale(s.id, s.x, s.y);
    if (sense.shared) for (const s of sense.shared as SensedRobot[]) stale(s.id, s.x, s.y);
    return out;
}

function backAnchor(team: 0 | 1): { x: number; y: number } {
    return { x: team === 0 ? 140 : ARENA_WIDTH - 140, y: ARENA_HEIGHT / 2 };
}

function frontAnchor(team: 0 | 1, foeY: number): { x: number; y: number } {
    return { x: team === 0 ? ARENA_WIDTH - 140 : 140, y: clamp(foeY, 60, ARENA_HEIGHT - 60) };
}

function midAnchor(team: 0 | 1): { x: number; y: number } {
    return { x: team === 0 ? ARENA_WIDTH / 2 - 60 : ARENA_WIDTH / 2 + 60, y: ARENA_HEIGHT / 2 };
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
}

export function createCoach(overrides?: Partial<CoachParams>): { update(sense: SenseState): CoachOrder } {
    const p: CoachParams = { ...COACH_DEFAULTS, ...overrides };
    let lastPad = -1;
    let lastCoachTick = -COACH_PERIOD;
    let cached: CoachOrder | null = null;

    function update(sense: SenseState): CoachOrder {
        // Slow cadence: hold the last order between coach ticks.
        if (cached !== null && sense.tick - lastCoachTick < COACH_PERIOD) return cached;

        const self = sense.self;
        const team = self.team;
        const maxHp = self.stats.maxHealth;
        const known = knownFoes(sense);

        // ---- Team picture ------------------------------------------------
        const teamAlive = sense.allies.length + 1;
        const aliveFoes = sense.match?.aliveFoes ?? teamAlive;
        let teamHp = self.health;
        for (const a of sense.allies) teamHp += a.health;
        const teamHpFrac = teamHp / (teamAlive * maxHp);
        const killsTeam = sense.match?.killsTeam ?? 0;

        // ---- Stance: the team-level decision ------------------------------
        let stance: CoachStance;
        // Commit needs a real edge (numbers or a 2-kill lead); full-health
        // parity opens in skirmish — pads, turrets, midfield — which is where
        // the strategy is visible.
        if (aliveFoes > teamAlive || teamHpFrac < p.retreatHpFrac) {
            stance = 'retreat';
        } else if (teamAlive > aliveFoes || killsTeam >= 2) {
            stance = 'commit';
        } else {
            stance = 'skirmish';
        }

        // ---- Focus: weakest live foe, converged across the squad ----------
        // Team consensus first: the lowest-id live sender's vote wins, so
        // every teammate's coach adopts the same target (visible focus fire).
        const liveSenders = new Set<number>(sense.allies.map((a) => a.id));
        liveSenders.add(self.id);
        const vote = focusTarget(sense.inbox as InboxMessage[], liveSenders, new Set(known.keys()));
        let focusFoe: number | null = vote;
        let focusPlan = vote !== null ? `vote-${vote}` : 'blind';
        if (focusFoe === null) {
            let weakest: number | null = null;
            let weakestHp = Infinity;
            let nearest: number | null = null;
            let nearestD = Infinity;
            for (const [id, k] of known) {
                if (k.live && k.health !== null && k.health < weakestHp) {
                    weakestHp = k.health;
                    weakest = id;
                }
                const d = dist2(self.x, self.y, k.x, k.y);
                if (d < nearestD) {
                    nearestD = d;
                    nearest = id;
                }
            }
            focusFoe = weakest ?? nearest;
            focusPlan = weakest !== null ? `weakest-${weakest}` : nearest !== null ? `nearest-${nearest}` : 'blind';
        }
        const focusPos = focusFoe !== null ? (known.get(focusFoe) as KnownFoe | undefined) : undefined;

        // ---- Waypoint ------------------------------------------------------
        let wx: number;
        let wy: number;
        let planDetail: string;

        // Sudden death overrides strategy: get inside the circle.
        const zone = sense.zone;
        if (zone && !zone.inside && (zone.phase === 'shrinking' || zone.suddenDeathIn < 600)) {
            const dx = self.x - zone.circle.x;
            const dy = self.y - zone.circle.y;
            const d = Math.hypot(dx, dy) || 1;
            wx = clamp(zone.circle.x + (dx / d) * zone.circle.r * 0.8, 24, ARENA_WIDTH - 24);
            wy = clamp(zone.circle.y + (dy / d) * zone.circle.r * 0.8, 24, ARENA_HEIGHT - 24);
            planDetail = `zone-${zone.phase}`;
        } else if (stance === 'retreat') {
            const a = backAnchor(team);
            wx = a.x;
            wy = a.y;
            planDetail = 'anchor-back';
        } else if (stance === 'commit') {
            if (focusPos) {
                wx = clamp(focusPos.x, 24, ARENA_WIDTH - 24);
                wy = clamp(focusPos.y, 24, ARENA_HEIGHT - 24);
                planDetail = `dive-${focusFoe}`;
            } else {
                const a = frontAnchor(team, ARENA_HEIGHT / 2);
                wx = a.x;
                wy = a.y;
                planDetail = 'anchor-front';
            }
        } else {
            // Skirmish: pads first (greed), then neutral turrets, then midfield.
            const pad = pickPad(sense, p, self.x, self.y, self.health / maxHp, sense.match?.modifiers.doubleDamage === true);
            if (pad) {
                wx = pad.x;
                wy = pad.y;
                planDetail = `pad-${pad.kind}`;
            } else {
                const turret = pickTurret(sense, self.x, self.y, team, p.turretGreed);
                if (turret) {
                    wx = turret.x;
                    wy = turret.y;
                    planDetail = 'turret-capture';
                } else {
                    const a = midAnchor(team);
                    wx = a.x;
                    wy = a.y;
                    planDetail = 'anchor-mid';
                }
            }
        }

        // Coach-level hazard respect: never order into a live impact circle.
        const hz = sense.hazards;
        if (hz) {
            for (const h of hz) {
                if (h.ticksToImpact > 120) continue;
                const d = Math.hypot(h.x - wx, h.y - wy);
                if (d < h.radius + 60) {
                    const dx = wx - h.x;
                    const dy = wy - h.y;
                    const dd = Math.hypot(dx, dy) || 1;
                    wx = clamp(h.x + (dx / dd) * (h.radius + 160), 24, ARENA_WIDTH - 24);
                    wy = clamp(h.y + (dy / dd) * (h.radius + 160), 24, ARENA_HEIGHT - 24);
                    planDetail = `hazard-shift:${planDetail}`;
                    break;
                }
            }
        }

        const radio = focusFoe !== null ? castFocusVote(focusFoe) : null;
        const order: CoachOrder = {
            moveX: wx,
            moveY: wy,
            focusFoe,
            stance,
            radio,
            plan: `${stance}:${planDetail}:${focusPlan}`,
        };
        cached = order;
        lastCoachTick = sense.tick;
        return order;
    }

    /** Greedy pad pick with hold-bias so the drive never jitters between pads. */
    function pickPad(
        sense: SenseState,
        params: CoachParams,
        selfX: number,
        selfY: number,
        hpFrac: number,
        skipAmp: boolean,
    ): { x: number; y: number; kind: string } | null {
        const pads = sense.pickups;
        if (!pads || pads.length === 0 || params.greed <= 0) return null;
        let best: { x: number; y: number; kind: string } | null = null;
        let bestScore = -Infinity;
        for (let i = 0; i < pads.length; i += 1) {
            const pad = pads[i] as { x: number; y: number; kind: string; active: boolean };
            if (!pad.active) continue;
            let value: number;
            if (pad.kind === 'repair') value = hpFrac < 0.6 ? 1.3 : hpFrac < 0.85 ? 0.5 : 0.08;
            else if (pad.kind === 'amp') value = skipAmp ? 0 : 1.0;
            else if (pad.kind === 'overdrive') value = 0.9;
            else continue;
            let score = (value * params.greed) / (1 + Math.sqrt(dist2(selfX, selfY, pad.x, pad.y)) / 500);
            if (i === lastPad) score *= params.padHoldBias;
            if (score > bestScore) {
                bestScore = score;
                best = { x: pad.x, y: pad.y, kind: pad.kind };
            }
        }
        if (best !== null) {
            for (let i = 0; i < pads.length; i += 1) {
                const pad = pads[i] as { x: number; y: number };
                if (pad.x === best.x && pad.y === best.y) {
                    lastPad = i;
                    break;
                }
            }
        }
        return bestScore > 0.25 ? best : null;
    }

    /** Nearest neutral (never captured) turret for a capture run. */
    function pickTurret(
        sense: SenseState,
        selfX: number,
        selfY: number,
        team: 0 | 1,
        turretGreed: number,
    ): { x: number; y: number } | null {
        void team;
        const turrets = sense.turrets;
        if (!turrets || turrets.length === 0 || turretGreed <= 0) return null;
        let best: { x: number; y: number } | null = null;
        let bestD = 520 * turretGreed;
        for (const t of turrets) {
            if (t.state !== 'disabled') continue;
            const d = Math.sqrt(dist2(selfX, selfY, t.x, t.y));
            if (d < bestD) {
                bestD = d;
                best = { x: t.x, y: t.y };
            }
        }
        return best;
    }

    return { update };
}
