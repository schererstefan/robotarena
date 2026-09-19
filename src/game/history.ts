// Local match history: a localStorage log of past matches plus per-robot
// aggregates for the menu stats panel. No backend (static hosting only),
// so everything here degrades to in-memory no-op when storage is missing.

import { sanitizeLoadout, type SkillLoadout } from '../sim/skills';

export interface MatchRecord {
    playedAt: number;
    teamSize: number;
    lineupIds: string[];
    loadouts: SkillLoadout[];
    winner: -1 | 0 | 1;
    ticks: number;
    seed: number;
}

export type NewMatchRecord = Omit<MatchRecord, 'playedAt'>;

export interface RobotRate {
    id: string;
    games: number;
    wins: number;
    draws: number;
    /** wins / games, 0 when the robot never played. */
    rate: number;
}

const STORAGE_KEY = 'robotarena.history.v1';
const MAX_HISTORY = 200;

function storage(): Storage | null {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage;
    } catch {
        return null;
    }
}

function isRecord(raw: unknown): raw is MatchRecord {
    if (typeof raw !== 'object' || raw === null) return false;
    const r = raw as Record<string, unknown>;
    if (typeof r['playedAt'] !== 'number' || typeof r['seed'] !== 'number') return false;
    if (typeof r['teamSize'] !== 'number' || !Number.isInteger(r['teamSize'])) return false;
    const teamSize = r['teamSize'];
    if (teamSize < 1 || teamSize > 3) return false;
    if (!Array.isArray(r['lineupIds']) || r['lineupIds'].length !== teamSize * 2) return false;
    if (!Array.isArray(r['loadouts']) || r['loadouts'].length !== teamSize * 2) return false;
    if (r['winner'] !== -1 && r['winner'] !== 0 && r['winner'] !== 1) return false;
    if (typeof r['ticks'] !== 'number' || !Number.isInteger(r['ticks']) || r['ticks'] < 0) return false;
    return r['lineupIds'].every((id) => typeof id === 'string' && id.length > 0);
}

function readAll(): MatchRecord[] {
    const store = storage();
    if (!store) return [];
    try {
        const raw = store.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isRecord).map((r) => ({
            ...r,
            loadouts: r.loadouts.map((l) => sanitizeLoadout(l)),
        }));
    } catch {
        return [];
    }
}

function writeAll(records: MatchRecord[]): void {
    const store = storage();
    if (!store) return;
    try {
        store.setItem(STORAGE_KEY, JSON.stringify(records.slice(-MAX_HISTORY)));
    } catch {
        // Quota or privacy mode: history just doesn't persist.
    }
}

/** Chronological (oldest first). Malformed entries are dropped. */
export function loadHistory(): MatchRecord[] {
    return readAll();
}

export function recordMatch(entry: NewMatchRecord): MatchRecord {
    const record: MatchRecord = { ...entry, playedAt: Date.now() };
    if (!isRecord(record)) throw new Error('invalid match record');
    const records = readAll();
    records.push(record);
    writeAll(records);
    return record;
}

export function clearHistory(): void {
    const store = storage();
    if (!store) return;
    try {
        store.removeItem(STORAGE_KEY);
    } catch {
        // Ignore: nothing persisted anyway.
    }
}

/** Per-robot appearance/win/draw counts. Draws count as games, not wins. */
export function winRates(robotIds: string[]): RobotRate[] {
    const table = new Map<string, RobotRate>(robotIds.map((id) => [id, { id, games: 0, wins: 0, draws: 0, rate: 0 }]));
    for (const record of readAll()) {
        record.lineupIds.forEach((id, slot) => {
            const row = table.get(id);
            if (!row) return;
            row.games += 1;
            const team = (slot < record.teamSize ? 0 : 1) as 0 | 1;
            if (record.winner === -1) row.draws += 1;
            else if (record.winner === team) row.wins += 1;
        });
    }
    for (const row of table.values()) {
        row.rate = row.games > 0 ? row.wins / row.games : 0;
    }
    return [...table.values()];
}
