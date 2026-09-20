// Leaderboard emitter (hillclimb plan §1.7 Phase A): turns an eval summary
// into the static public/leaderboard.json the client fetches. Elo starts
// at 1000 / K=32 per the harness convention (C5); the season is the game
// version. One entry per bot, sorted by Elo desc.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';
import { defaultGenome, genomeDefFor, genomeHash, type Genome } from '../../src/robots/genome';
import type { OnlineBoard, OnlineBoardEntry } from '../../src/game/onlineBoard';
import type { BotRollup } from './stats';

export interface ChampionRecord {
    botId: string;
    baseBot: string;
    runId: string;
    genomeHash: string;
    featuredReplays: Array<{ label: string; code: string; outcome: string }>;
}

function isChampionRecord(raw: unknown): raw is ChampionRecord {
    if (typeof raw !== 'object' || raw === null) return false;
    const r = raw as Record<string, unknown>;
    return (
        typeof r['botId'] === 'string' &&
        typeof r['baseBot'] === 'string' &&
        typeof r['runId'] === 'string' &&
        typeof r['genomeHash'] === 'string' &&
        Array.isArray(r['featuredReplays'])
    );
}

/** Champion records by bot id; a missing dir means no champions yet. */
export function loadChampionRecords(dir: string): Map<string, ChampionRecord> {
    const records = new Map<string, ChampionRecord>();
    if (!existsSync(dir)) return records;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
        try {
            const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown;
            if (isChampionRecord(raw)) records.set(raw.botId, raw);
        } catch {
            // A corrupt record must not sink the board; it is simply skipped.
        }
    }
    return records;
}

function showcaseCodeFor(record: ChampionRecord | undefined): string {
    if (!record || record.featuredReplays.length === 0) return '';
    const win = record.featuredReplays.find((rep) => rep.outcome === 'win' && typeof rep.code === 'string' && rep.code.length > 0);
    if (win) return win.code;
    const first = record.featuredReplays[0];
    return first && typeof first.code === 'string' ? first.code : '';
}

function genomeHashFor(botId: string, record: ChampionRecord | undefined): string {
    if (record) return record.genomeHash;
    const def = genomeDefFor(botId);
    const defaults = defaultGenome(botId);
    if (!def || !defaults) return '';
    return genomeHash(defaults as Genome);
}

export interface BoardOptions {
    gameVersion: string;
    updatedAt: string;
    championsDir: string;
}

export function buildBoard(rollups: BotRollup[], opts: BoardOptions): OnlineBoard {
    const records = loadChampionRecords(opts.championsDir);
    const entries: OnlineBoardEntry[] = rollups.map((r) => {
        const record = records.get(r.id);
        return {
            botId: r.id,
            baseRobotId: record?.baseBot ?? r.id,
            genomeHash: genomeHashFor(r.id, record),
            elo: Math.round(r.elo * 10) / 10,
            wins: r.wins,
            losses: r.losses,
            draws: r.draws,
            evals: r.games,
            showcaseCode: showcaseCodeFor(record),
            gameVersion: opts.gameVersion,
            updatedAt: opts.updatedAt,
        };
    });
    entries.sort((a, b) => b.elo - a.elo || (a.botId < b.botId ? -1 : 1));
    return { season: opts.gameVersion, gameVersion: opts.gameVersion, updatedAt: opts.updatedAt, entries };
}

export function writeBoard(path: string, board: OnlineBoard): string {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(board, null, 1)}\n`);
    return path;
}
