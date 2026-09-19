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

// ---- Daily seeded challenge ----------------------------------------------
// Same date => same seed and matchup for everyone; the board keeps one
// best result per day (decisive beats draw, faster beats slower).

export interface DailyBest {
    date: string;
    seed: number;
    lineupIds: string[];
    winner: -1 | 0 | 1;
    ticks: number;
    recordedAt: number;
}

export type NewDailyResult = Omit<DailyBest, 'date' | 'recordedAt'>;

const DAILY_KEY = 'robotarena.daily.v1';
const MAX_DAILY = 30;

/** Local calendar day as YYYY-MM-DD. */
export function dailyDateKey(now: Date = new Date()): string {
    const month = `${now.getMonth() + 1}`.padStart(2, '0');
    const day = `${now.getDate()}`.padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
}

/** Date-derived match seed (FNV-1a, stable across browsers). */
export function dailySeed(dateKey: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < dateKey.length; i += 1) {
        hash ^= dateKey.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

/** The fixed daily matchup. */
export function dailyLineup(): string[] {
    return ['hunter', 'orbiter'];
}

function isDailyBest(raw: unknown): raw is DailyBest {
    if (typeof raw !== 'object' || raw === null) return false;
    const r = raw as Record<string, unknown>;
    if (typeof r['date'] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r['date'])) return false;
    if (typeof r['seed'] !== 'number' || typeof r['recordedAt'] !== 'number') return false;
    if (!Array.isArray(r['lineupIds']) || r['lineupIds'].length === 0) return false;
    if (r['winner'] !== -1 && r['winner'] !== 0 && r['winner'] !== 1) return false;
    if (typeof r['ticks'] !== 'number' || !Number.isInteger(r['ticks']) || r['ticks'] < 0) return false;
    return r['lineupIds'].every((id) => typeof id === 'string' && id.length > 0);
}

function readDaily(): DailyBest[] {
    const store = storage();
    if (!store) return [];
    try {
        const raw = store.getItem(DAILY_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isDailyBest);
    } catch {
        return [];
    }
}

function writeDaily(board: DailyBest[]): void {
    const store = storage();
    if (!store) return;
    try {
        const sorted = [...board].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
        store.setItem(DAILY_KEY, JSON.stringify(sorted.slice(0, MAX_DAILY)));
    } catch {
        // Quota or privacy mode: the board just doesn't persist.
    }
}

/** Newest first. */
export function loadDailyBoard(): DailyBest[] {
    return [...readDaily()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function isBetterDaily(next: NewDailyResult, prev: DailyBest): boolean {
    const nextDecisive = next.winner !== -1;
    const prevDecisive = prev.winner !== -1;
    if (nextDecisive !== prevDecisive) return nextDecisive;
    return next.ticks < prev.ticks;
}

/** Record a daily result; keeps the better of the stored and new result. */
export function recordDailyResult(date: string, result: NewDailyResult): DailyBest {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid daily date');
    const candidate: DailyBest = { ...result, date, recordedAt: Date.now() };
    if (!isDailyBest(candidate)) throw new Error('invalid daily result');
    const board = readDaily();
    const existing = board.find((entry) => entry.date === date);
    if (!existing || isBetterDaily(result, existing)) {
        writeDaily([...board.filter((entry) => entry.date !== date), candidate]);
        return candidate;
    }
    return existing;
}

export function clearDailyBoard(): void {
    const store = storage();
    if (!store) return;
    try {
        store.removeItem(DAILY_KEY);
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
