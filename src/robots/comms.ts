// Team radio resolution: pure deterministic helpers over inbox messages.
// The engine only routes (delayed, team-scoped, capped); every decision
// below runs identically in each receiver from its own inbox plus its own
// sent message. Receivers treat votes as steering hints — firing still
// requires own-cone confirmation.

import type { InboxMessage, OutboxMessage } from '../sim/types';

/** Build a focus vote naming a foe id. */
export function castFocusVote(foe: number): OutboxMessage {
    return { kind: 'focus', x: 0, y: 0, foe, role: 0, slot: 0, bid: 0 };
}

/** Build a contact report: a (delay-stale) foe position. */
export function castContact(x: number, y: number, foe: number): OutboxMessage {
    return { kind: 'contact', x, y, foe, role: 0, slot: 0, bid: 0 };
}

/**
 * Focus resolution: among votes from live senders about live foes, the
 * lowest-id sender wins. Returns the voted foe id, or null when no valid
 * vote exists. Callers pass liveness from their own sense (allies for
 * senders, cone sightings for foes).
 */
export function focusTarget(
    inbox: InboxMessage[],
    liveSenders: Set<number>,
    liveFoes: Set<number>,
): number | null {
    let winner: number | null = null;
    let winnerFrom = Infinity;
    for (const msg of inbox) {
        if (msg.kind !== 'focus' || !liveSenders.has(msg.from) || !liveFoes.has(msg.foe)) continue;
        if (msg.from < winnerFrom || (msg.from === winnerFrom && (winner === null || msg.foe < winner))) {
            winnerFrom = msg.from;
            winner = msg.foe;
        }
    }
    return winner;
}

/** One sealed role bid: robot `from` claims `role` at price `bid`. */
export interface RoleBid {
    from: number;
    role: number;
    bid: number;
}

/**
 * Sealed-bid role auction: the highest bid per role wins, ties go to the
 * lowest robot id. Returns the winning robot per claimed role; unclaimed
 * roles are absent. Callers assemble claims from their own bid plus inbox
 * `claim` messages, so every teammate converges on the same map.
 */
export function resolveRoles(claims: RoleBid[]): Map<number, number> {
    const winners = new Map<number, { from: number; bid: number }>();
    const ordered = [...claims].sort((a, b) => a.from - b.from);
    for (const claim of ordered) {
        const cur = winners.get(claim.role);
        if (!cur || claim.bid > cur.bid) winners.set(claim.role, { from: claim.from, bid: claim.bid });
    }
    return new Map([...winners.entries()].map(([role, w]) => [role, w.from]));
}

/**
 * Formation slot geometry: slot i of n evenly spaced around an anchor at
 * radius r, starting north and going clockwise (screen coordinates). One
 * slot collapses onto the anchor.
 */
export function formationSlot(
    slot: number, slots: number, anchorX: number, anchorY: number, radius: number,
): { x: number; y: number } {
    if (slots <= 1) return { x: anchorX, y: anchorY };
    const i = ((slot % slots) + slots) % slots;
    const angle = -Math.PI / 2 + (i / slots) * Math.PI * 2;
    return { x: anchorX + Math.cos(angle) * radius, y: anchorY + Math.sin(angle) * radius };
}

/**
 * Newest contact report in the inbox (lowest-id sender wins ties), or null
 * when none. Positions are delay-stale: drive the tower onto them to
 * convert them into sightings, never fire off them directly.
 */
export function latestContact(
    inbox: InboxMessage[],
): { x: number; y: number; foe: number; from: number } | null {
    let best: { x: number; y: number; foe: number; from: number; sent: number } | null = null;
    for (const msg of inbox) {
        if (msg.kind !== 'contact') continue;
        if (!best || msg.sent > best.sent || (msg.sent === best.sent && msg.from < best.from)) {
            best = { x: msg.x, y: msg.y, foe: msg.foe, from: msg.from, sent: msg.sent };
        }
    }
    return best ? { x: best.x, y: best.y, foe: best.foe, from: best.from } : null;
}
