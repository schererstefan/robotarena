// Online leaderboard client (hillclimb plan §1.7 Phase A): fetches the
// static board JSON with a timeout and falls back to the last cached copy
// in localStorage when offline. No Phaser imports: scenes and the soak
// test share the parser.

export interface OnlineBoardEntry {
    botId: string;
    baseRobotId: string;
    genomeHash: string;
    elo: number;
    wins: number;
    losses: number;
    draws: number;
    evals: number;
    showcaseCode: string;
    gameVersion: string;
    updatedAt: string;
}

export interface OnlineBoard {
    season: string;
    gameVersion: string;
    updatedAt: string;
    entries: OnlineBoardEntry[];
}

export const ONLINE_BOARD_URL = 'leaderboard.json';
export const ONLINE_BOARD_TIMEOUT_MS = 4000;

const CACHE_KEY = 'robotarena.onlineBoard.v1';

function isRecord(raw: unknown): raw is Record<string, unknown> {
    return typeof raw === 'object' && raw !== null;
}

function isEntry(raw: unknown): raw is OnlineBoardEntry {
    if (!isRecord(raw)) return false;
    const strings: Array<keyof OnlineBoardEntry> = ['botId', 'baseRobotId', 'genomeHash', 'showcaseCode', 'gameVersion', 'updatedAt'];
    for (const key of strings) {
        if (typeof raw[key] !== 'string') return false;
    }
    if ((raw['botId'] as string).length === 0) return false;
    const numbers: Array<keyof OnlineBoardEntry> = ['elo', 'wins', 'losses', 'draws', 'evals'];
    for (const key of numbers) {
        const value = raw[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return false;
    }
    for (const key of ['wins', 'losses', 'draws', 'evals'] as const) {
        if (!Number.isInteger(raw[key])) return false;
    }
    return true;
}

/** Strict shape check; malformed boards (or entries) are rejected wholesale. */
export function parseOnlineBoard(raw: unknown): OnlineBoard | null {
    if (!isRecord(raw)) return null;
    if (typeof raw['season'] !== 'string' || (raw['season'] as string).length === 0) return null;
    if (typeof raw['gameVersion'] !== 'string' || typeof raw['updatedAt'] !== 'string') return null;
    if (!Array.isArray(raw['entries'])) return null;
    const entries: OnlineBoardEntry[] = [];
    for (const entry of raw['entries']) {
        if (!isEntry(entry)) return null;
        entries.push(entry);
    }
    return { season: raw['season'] as string, gameVersion: raw['gameVersion'] as string, updatedAt: raw['updatedAt'] as string, entries };
}

function storage(): Storage | null {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage;
    } catch {
        return null;
    }
}

/** Last successfully fetched board, or null when nothing cached yet. */
export function loadCachedBoard(): OnlineBoard | null {
    const store = storage();
    if (!store) return null;
    try {
        const raw = store.getItem(CACHE_KEY);
        if (!raw) return null;
        return parseOnlineBoard(JSON.parse(raw) as unknown);
    } catch {
        return null;
    }
}

function cacheBoard(board: OnlineBoard): void {
    const store = storage();
    if (!store) return;
    try {
        store.setItem(CACHE_KEY, JSON.stringify(board));
    } catch {
        // Quota or privacy mode: the board just doesn't persist.
    }
}

export interface FetchBoardResult {
    board: OnlineBoard | null;
    /** True when the board came from cache (fetch failed, timed out, or invalid). */
    cached: boolean;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        return await fetch(url, { signal: ctrl.signal });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Fetch the board, caching the latest good copy. Any failure (network,
 * timeout, HTTP error, invalid JSON) falls back to the cache; null means
 * neither source had a board.
 */
export async function fetchOnlineBoard(
    url: string = ONLINE_BOARD_URL,
    timeoutMs: number = ONLINE_BOARD_TIMEOUT_MS,
): Promise<FetchBoardResult> {
    if (typeof fetch === 'undefined') return { board: loadCachedBoard(), cached: true };
    try {
        const res = await fetchWithTimeout(url, timeoutMs);
        if (!res.ok) return { board: loadCachedBoard(), cached: true };
        const board = parseOnlineBoard((await res.json()) as unknown);
        if (!board) return { board: loadCachedBoard(), cached: true };
        cacheBoard(board);
        return { board, cached: false };
    } catch {
        return { board: loadCachedBoard(), cached: true };
    }
}
