// Champion showcase manifest: loader + validator for the static
// public/data/showcase.json emitted by the hillclimb tooling. No Phaser
// imports: scenes, the menu ticker, and the soak test share this module.

import { decodeReplay } from '../sim/replay';
import { sanitizeLoadout, type SkillLoadout } from '../sim/skills';

export const SHOWCASE_MANIFEST_URL = 'data/showcase.json';

export type ShowcaseOutcome = 'win' | 'draw' | 'loss';

export interface FeaturedReplay {
    label: string;
    code: string;
    outcome: ShowcaseOutcome;
}

export interface ShowcaseRecord {
    wins: number;
    losses: number;
    draws: number;
    winRate: number;
    games: number;
}

export interface ShowcaseChampion {
    botId: string;
    baseBot: string;
    author: string;
    seedLoadout: SkillLoadout;
    champLoadout: SkillLoadout;
    stats: { before: ShowcaseRecord; after: ShowcaseRecord };
    featuredReplays: FeaturedReplay[];
    board: { elo: number; wins: number; losses: number; draws: number } | null;
}

export interface ShowcaseManifest {
    season: string;
    version: string;
    champions: ShowcaseChampion[];
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
    return typeof raw === 'object' && raw !== null;
}

function isOutcome(raw: unknown): raw is ShowcaseOutcome {
    return raw === 'win' || raw === 'draw' || raw === 'loss';
}

function isReplay(raw: unknown): raw is FeaturedReplay {
    if (!isRecord(raw)) return false;
    if (typeof raw['label'] !== 'string' || (raw['label'] as string).length === 0) return false;
    if (typeof raw['code'] !== 'string' || decodeReplay(raw['code'] as string) === null) return false;
    return isOutcome(raw['outcome']);
}

function isStatsRecord(raw: unknown): raw is ShowcaseRecord {
    if (!isRecord(raw)) return false;
    for (const key of ['wins', 'losses', 'draws', 'games'] as const) {
        if (typeof raw[key] !== 'number' || !Number.isInteger(raw[key]) || (raw[key] as number) < 0) return false;
    }
    const winRate = raw['winRate'];
    if (typeof winRate !== 'number' || !Number.isFinite(winRate) || winRate < 0 || winRate > 1) return false;
    return true;
}

function isChampion(raw: unknown): raw is ShowcaseChampion {
    if (!isRecord(raw)) return false;
    if (typeof raw['botId'] !== 'string' || (raw['botId'] as string).length === 0) return false;
    if (typeof raw['baseBot'] !== 'string' || (raw['baseBot'] as string).length === 0) return false;
    if (typeof raw['author'] !== 'string') return false;
    if (!isRecord(raw['seedLoadout']) || !isRecord(raw['champLoadout'])) return false;
    if (!isRecord(raw['stats'])) return false;
    const stats = raw['stats'] as Record<string, unknown>;
    if (!isStatsRecord(stats['before']) || !isStatsRecord(stats['after'])) return false;
    if (!Array.isArray(raw['featuredReplays']) || raw['featuredReplays'].length === 0) return false;
    for (const rep of raw['featuredReplays']) {
        if (!isReplay(rep)) return false;
    }
    const board = raw['board'];
    if (board !== null) {
        if (!isRecord(board)) return false;
        if (typeof board['elo'] !== 'number' || !Number.isFinite(board['elo'])) return false;
        for (const key of ['wins', 'losses', 'draws'] as const) {
            if (typeof board[key] !== 'number' || !Number.isInteger(board[key])) return false;
        }
    }
    return true;
}

/**
 * Strict shape check (codes must decode; loadouts are sanitized in place).
 * Returns null for anything malformed — callers treat that as "absent".
 */
export function parseShowcaseManifest(raw: unknown): ShowcaseManifest | null {
    if (!isRecord(raw)) return null;
    if (typeof raw['season'] !== 'string' || (raw['season'] as string).length === 0) return null;
    if (typeof raw['version'] !== 'string') return null;
    if (!Array.isArray(raw['champions'])) return null;
    const champions: ShowcaseChampion[] = [];
    for (const champ of raw['champions']) {
        if (!isChampion(champ)) return null;
        champions.push({
            botId: champ['botId'] as string,
            baseBot: champ['baseBot'] as string,
            author: champ['author'] as string,
            seedLoadout: sanitizeLoadout(champ['seedLoadout']),
            champLoadout: sanitizeLoadout(champ['champLoadout']),
            stats: champ['stats'] as { before: ShowcaseRecord; after: ShowcaseRecord },
            featuredReplays: champ['featuredReplays'] as FeaturedReplay[],
            board: champ['board'] as ShowcaseChampion['board'],
        });
    }
    return { season: raw['season'] as string, version: raw['version'] as string, champions };
}

/** Fetch the manifest; null when absent, unreachable, or invalid. */
export async function fetchShowcaseManifest(url: string = SHOWCASE_MANIFEST_URL): Promise<ShowcaseManifest | null> {
    if (typeof fetch === 'undefined') return null;
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return parseShowcaseManifest((await res.json()) as unknown);
    } catch {
        return null;
    }
}

let cachedPromise: Promise<ShowcaseManifest | null> | null = null;

/** Memoized fetch: the menu button, ticker, and scene share one request. */
export function loadShowcase(url: string = SHOWCASE_MANIFEST_URL): Promise<ShowcaseManifest | null> {
    if (!cachedPromise) cachedPromise = fetchShowcaseManifest(url);
    return cachedPromise;
}
