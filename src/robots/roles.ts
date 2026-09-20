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

import { formationSlot, resolveRoles, type RoleBid } from './comms';
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
