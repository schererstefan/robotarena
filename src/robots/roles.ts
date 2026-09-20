// Squad roles over the claim/slot radio channel: pure deterministic helpers
// for claiming and holding tactical slots. The engine only routes mail (1
// msg/tick, delay 6, inbox cap 4, team-scoped); everything below runs
// identically in each receiver from its own inbox plus its own sent claim,
// so every live teammate converges on the same role map without a leader.
//
// Protocol (trio convention; roles are small ints, slots mirror roles):
//   1. CLAIM — each tick a robot whose role is unsettled broadcasts
//      `claim{role, bid}` for its top-preferred role. Bids share one scale
//      (see `preferenceBid`): higher wins, ties go to the lowest robot id
//      (the `resolveRoles` sealed-bid rule).
//   2. RESOLVE — receivers gather inbox claims from live senders plus their
//      own bid (`collectClaims`) and settle winners with `resolveRoles`.
//      `myRole` reads off the caller's own won role, if any.
//   3. HOLD — winners heartbeat `slot{role, slot}` so mates see the slot as
//      taken (`latestSlotHold`) even while claims are in flight. One radio
//      slot per tick is shared with focus votes, so claims/holds are sent
//      only when unsettled or due — never every tick.
//   4. RE-RESOLVE — dead robots neither send nor receive, so a teammate's
//      death shows up as its claims aging out of the inbox plus its id
//      leaving the live ally set. Callers re-resolve whenever the live set
//      changes (or on the `ally-down` event) and the auction re-settles
//      among the survivors; incumbents keep their slots via the hold bonus
//      in their next claim bid.
//
// All inputs here are shared knowledge (own id, live ally ids, inbox), so
// symmetric teammates compute identical auctions. Suitability rankings that
// feed preference order must also derive from shared knowledge (ally
// positions over the radio link, never own-cone-only sightings), or mates
// will settle different maps.

import { ARENA_HEIGHT, ARENA_WIDTH } from '../sim/constants';
import { focusTarget, formationSlot, resolveRoles, type RoleBid } from './comms';
import type { InboxMessage, OutboxMessage } from '../sim/types';

/** Trio role ids: point leads, wings take the flank slots. */
export const ROLE_POINT = 0;
export const ROLE_WING_LEFT = 1;
export const ROLE_WING_RIGHT = 2;

/** How many roles the trio auction settles (point + two wings). */
export const SQUAD_ROLE_COUNT = 3;

/**
 * Bid scale shared by every claimant: preference rank 0 (top pick) bids
 * highest, rank `roles - 1` bids 1. Out-of-range ranks clamp into range,
 * so a caller that only ever claims one role still bids consistently.
 * Ties at equal bids go to the lowest robot id (the auction rule), which
 * is what breaks symmetry between identical teammates.
 */
export function preferenceBid(rank: number, roles: number = SQUAD_ROLE_COUNT): number {
    const clamped = Math.max(0, Math.min(roles - 1, Math.floor(rank)));
    return roles - clamped;
}

/** Extra bid added when re-claiming the role already held (stickiness). */
export const HOLD_BONUS = 0.5;

/** Build a sealed role claim: robot bids `bid` for `role`. */
export function castClaim(role: number, bid: number): OutboxMessage {
    return { kind: 'claim', x: 0, y: 0, foe: -1, role, slot: 0, bid };
}

/** Build a slot heartbeat: winner of `role` holds formation `slot`. */
export function castSlotHold(role: number, slot: number): OutboxMessage {
    return { kind: 'slot', x: 0, y: 0, foe: -1, role, slot, bid: 0 };
}

/**
 * Gather one auction ballot: inbox `claim` messages from live senders plus
 * the caller's own bid. Non-claim kinds, dead senders, and non-finite
 * bids are ignored. `liveSenders` must include the caller's own id (its
 * own bid counts) and every live ally id; dead robots' in-flight mail is
 * already dropped by the engine, and anything older is excluded here.
 */
export function collectClaims(
    inbox: InboxMessage[],
    liveSenders: Set<number>,
    own: RoleBid,
): RoleBid[] {
    const claims: RoleBid[] = [];
    for (const msg of inbox) {
        if (msg.kind !== 'claim' || !liveSenders.has(msg.from)) continue;
        if (!Number.isFinite(msg.role) || !Number.isFinite(msg.bid)) continue;
        claims.push({ from: msg.from, role: msg.role, bid: msg.bid });
    }
    claims.push({ from: own.from, role: own.role, bid: own.bid });
    return claims;
}

/**
 * Settle `claims` and return the role won by `selfId`, or null when it won
 * nothing. Thin wrapper over `resolveRoles` so callers read their own
 * outcome off the shared auction in one call.
 */
export function myRole(claims: RoleBid[], selfId: number): number | null {
    const winners = resolveRoles(claims);
    for (const [role, from] of winners) {
        if (from === selfId) return role;
    }
    return null;
}

/**
 * Newest `slot` heartbeat holding formation `slot`, or null when no mate
 * (or self-echo, which never happens) holds it freshly. `nowTick` is the
 * receiver's current tick; holds older than `maxAge` ticks are stale —
 * their sender died or moved on, and the slot is free to re-claim.
 */
export function latestSlotHold(
    inbox: InboxMessage[],
    slot: number,
    nowTick: number,
    maxAge: number = 30,
): { role: number; from: number; sent: number } | null {
    let best: { role: number; from: number; sent: number } | null = null;
    for (const msg of inbox) {
        if (msg.kind !== 'slot' || msg.slot !== slot) continue;
        if (nowTick - msg.sent > maxAge) continue;
        if (!best || msg.sent > best.sent || (msg.sent === best.sent && msg.from < best.from)) {
            best = { role: msg.role, from: msg.from, sent: msg.sent };
        }
    }
    return best;
}

/**
 * Where role `role` should stand: formation slot `role` of `slots` around
 * (`anchorX`, `anchorY`) at `radius`. Roles map 1:1 onto formation slots,
 * so the point (role 0) takes the north slot and the wings ring clockwise
 * from it. Thin wrapper over `formationSlot` pinning the role→slot map.
 */
export function roleSlot(
    role: number,
    slots: number,
    anchorX: number,
    anchorY: number,
    radius: number,
): { x: number; y: number } {
    return formationSlot(role, slots, anchorX, anchorY, radius);
}

// ---------------------------------------------------------------------------
// Role behavior: take and keep formation slots, re-resolve on teammate death.
// ---------------------------------------------------------------------------

/** Formation ring radius around the anchor (keeps wings in gun range). */
export const SLOT_RADIUS = 170;

/** Slot heartbeat cadence in ticks (well inside the hold freshness window). */
export const HOLD_EVERY = 12;

/** Slot holds older than this are stale; the slot is free to re-claim. */
export const HOLD_MAX_AGE = 30;

/** Narrow sense surface the tracker needs (SenseState is assignable). */
export interface RoleSense {
    tick: number;
    self: { id: number; x: number; y: number };
    allies: Array<{ id: number; x: number; y: number }>;
    inbox: InboxMessage[];
}

/** Narrow sense surface for slot goals (SenseState is assignable). */
export interface RoleGoalSense {
    self: { id: number; x: number; y: number };
    allies: Array<{ id: number; x: number; y: number }>;
    foes: Array<{ id: number; x: number; y: number; distance: number }>;
    inbox: InboxMessage[];
}

/**
 * Live team ids from shared knowledge, ascending. radio-link allies are
 * always exactly the living teammates, so this doubles as the liveness
 * set for the auction — no separate death detection needed.
 */
export function liveTeamIds(selfId: number, allies: Array<{ id: number }>): number[] {
    return [selfId, ...allies.map((a) => a.id)].sort((a, b) => a - b);
}

/**
 * Teammate preference ranking, closest to midfield first, id breaks ties.
 * Inputs (own + ally positions) are shared knowledge over the radio link,
 * so every mate computes the identical order and the trio's top picks are
 * distinct with no negotiation: rank 0 takes point, the rest take wings.
 */
export function rankByMidfield(
    selfId: number, selfX: number, selfY: number,
    allies: Array<{ id: number; x: number; y: number }>,
): number[] {
    const cx = ARENA_WIDTH / 2;
    const cy = ARENA_HEIGHT / 2;
    return [{ id: selfId, x: selfX, y: selfY }, ...allies]
        .map((m) => ({ id: m.id, d: (m.x - cx) * (m.x - cx) + (m.y - cy) * (m.y - cy) }))
        .sort((a, b) => (a.d === b.d ? a.id - b.id : a.d - b.d))
        .map((m) => m.id);
}

export interface RoleState {
    /** Settled role, or null while contended (caller keeps claiming). */
    role: number | null;
    /** Formation slot (1:1 with role); slots counts the live ring. */
    slot: number;
    slots: number;
    /** Radio to send this tick, or null so the caller may vote focus. */
    radio: OutboxMessage | null;
}

export interface RoleTracker {
    readonly role: number | null;
    update(sense: RoleSense): RoleState;
}

export interface RoleTrackerOptions {
    roles?: number;
    holdEvery?: number;
}

/**
 * Fresh per-match role tracker (held role + live set live in the closure).
 * Takes a formation slot via the claim auction, keeps it with heartbeats
 * and an incumbency bidding bonus, and re-resolves from the midfield
 * ranking whenever the live set changes (teammate death). With no allies
 * (1v1) it stays idle — role null, radio null — so solo behavior is
 * byte-identical with or without the tracker.
 */
export function createRoleTracker(opts?: RoleTrackerOptions): RoleTracker {
    const roles = opts?.roles ?? SQUAD_ROLE_COUNT;
    const holdEvery = opts?.holdEvery ?? HOLD_EVERY;
    let held: number | null = null;
    let lastLiveKey = '';
    let fallback = 0;
    let lastHoldSent = -Infinity;

    function update(sense: RoleSense): RoleState {
        const selfId = sense.self.id;
        const live = liveTeamIds(selfId, sense.allies);
        const n = live.length;
        if (n <= 1) {
            held = null;
            lastLiveKey = '';
            fallback = 0;
            return { role: null, slot: 0, slots: 1, radio: null };
        }
        const liveKey = live.join(',');
        if (liveKey !== lastLiveKey) {
            // Live set changed (teammate death or first contact): drop the
            // held slot and re-resolve from the shared ranking.
            held = null;
            fallback = 0;
            lastLiveKey = liveKey;
        }
        const ranking = rankByMidfield(selfId, sense.self.x, sense.self.y, sense.allies);
        const topRole = ranking.indexOf(selfId) % roles;
        // Preference rotation: top pick first, then the rest in ring order,
        // so a contested loser falls back to a distinct role deterministically.
        const rotation: number[] = [];
        for (let i = 0; i < roles; i += 1) rotation.push((topRole + i) % roles);
        const sticking = held !== null;
        const claimRole = sticking ? (held as number) : rotation[Math.min(fallback, roles - 1)] as number;
        // Incumbents outbid every fresh top pick (max `roles`), so slots are
        // kept through position shifts and only re-resolve on live-set change.
        const bid = sticking ? roles + HOLD_BONUS : preferenceBid(rotation.indexOf(claimRole), roles);
        const claims = collectClaims(sense.inbox, new Set(live), { from: selfId, role: claimRole, bid });
        const role = myRole(claims, selfId);
        if (role !== null) {
            held = role;
            fallback = 0;
            let radio: OutboxMessage | null = null;
            if (sense.tick - lastHoldSent >= holdEvery) {
                radio = castSlotHold(role, role);
                lastHoldSent = sense.tick;
            }
            return { role, slot: role, slots: n, radio };
        }
        // Lost the auction: hold nothing, advance the fallback, and rebid
        // immediately so mates hear the bid this resolve counted.
        held = null;
        fallback = Math.min(fallback + 1, roles - 1);
        return { role: null, slot: claimRole, slots: n, radio: castClaim(claimRole, bid) };
    }

    return {
        get role(): number | null {
            return held;
        },
        update,
    };
}

/**
 * Where role `role` should stand this tick: formation slot `role` of
 * `slots` around the team's focus-vote target when it is in the caller's
 * own cone (a shared anchor, so mates ring the same foe instead of each
 * chasing its own nearest), else around the nearest visible foe, else
 * around the live-team centroid while blind (shared knowledge, so blind
 * mates cohere). Own-cone confirmation still gates firing — this only
 * steadies the formation anchor.
 */
export function roleGoal(
    sense: RoleGoalSense,
    role: number,
    slots: number,
    radius: number = SLOT_RADIUS,
): { x: number; y: number } {
    let anchorX = sense.self.x;
    let anchorY = sense.self.y;
    if (sense.foes.length > 0) {
        let anchor = sense.foes[0] as RoleGoalSense['foes'][number];
        for (const foe of sense.foes) {
            if (foe.distance < anchor.distance) anchor = foe;
        }
        if (sense.inbox.length > 0) {
            const liveSenders = new Set(sense.allies.map((a) => a.id));
            liveSenders.add(sense.self.id);
            const voted = focusTarget(sense.inbox, liveSenders, new Set(sense.foes.map((f) => f.id)));
            const votedFoe = voted !== null ? sense.foes.find((f) => f.id === voted) : undefined;
            if (votedFoe !== undefined) anchor = votedFoe;
        }
        anchorX = anchor.x;
        anchorY = anchor.y;
    } else {
        const xs = [sense.self.x, ...sense.allies.map((a) => a.x)];
        const ys = [sense.self.y, ...sense.allies.map((a) => a.y)];
        anchorX = xs.reduce((a, b) => a + b, 0) / xs.length;
        anchorY = ys.reduce((a, b) => a + b, 0) / ys.length;
    }
    return roleSlot(role, slots, anchorX, anchorY, radius);
}
