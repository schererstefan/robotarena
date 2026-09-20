// Shared replay re-simulation: decode a code, run it headless, and report
// the outcome from one lineup bot's perspective. Used by the showcase
// emitter (to ship only verified codes), tools/verify-manifest, and the
// soak manifest gate — one implementation, three callers.

import { Match, type LineupEntry } from '../../src/sim/engine';
import { decodeReplay } from '../../src/sim/replay';
import { getRobot } from '../../src/robots/registry';

export type ResimOutcome = 'win' | 'draw' | 'loss';

export interface ResimResult {
    winner: -1 | 0 | 1;
    tick: number;
    championSide: 0 | 1;
    outcome: ResimOutcome;
}

/**
 * Re-sim a replay code. Returns null when the code doesn't decode, names
 * an unknown robot, doesn't feature botId, or never finishes.
 */
export function resimReplay(code: string, botId: string): ResimResult | null {
    const data = decodeReplay(code);
    if (!data) return null;
    const slot = data.lineupIds.indexOf(botId);
    if (slot < 0) return null;
    const championSide = (slot < data.teamSize ? 0 : 1) as 0 | 1;
    const lineups: LineupEntry[] = [];
    for (let k = 0; k < data.lineupIds.length; k += 1) {
        const entry = getRobot(data.lineupIds[k] as string);
        if (!entry) return null;
        lineups.push({ team: (k < data.teamSize ? 0 : 1) as 0 | 1, controller: entry.create(), loadout: { ...(data.loadouts[k] ?? {}) } });
    }
    const match = new Match(lineups, data.seed, { arena: data.arena ?? 'open', modifiers: data.modifiers ?? {} });
    match.runToEnd();
    if (!match.result.over) return null;
    const winner = match.result.winner;
    const outcome: ResimOutcome = winner === -1 ? 'draw' : winner === championSide ? 'win' : 'loss';
    return { winner, tick: match.result.tick, championSide, outcome };
}
