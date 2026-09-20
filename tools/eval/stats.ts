// Eval stats: JSONL-ready rows reduce to rollups, Elo, head-to-head, and
// balance smells. Elo runs over rows in job-index order (never completion
// order), so worker count cannot shift a single point.

import type { EvalRow } from './runner';

export const ELO_START = 1000;
export const ELO_K = 32;

export interface BotRollup {
    id: string;
    games: number;
    wins: number;
    losses: number;
    draws: number;
    winRate: number;
    elo: number;
    damageDealt: number;
    kills: number;
    errors: number;
    perArena: Record<string, { games: number; wins: number; losses: number; draws: number }>;
}

export interface H2HCell {
    wins: number;
    losses: number;
    draws: number;
}

export interface Smells {
    matches: number;
    draws: number;
    drawRate: number;
    /** Draw rate above 5%: the game is stalling instead of deciding. */
    drawSpike: boolean;
    /** Bots with a perfect record over 10+ games: the field has an apex. */
    sweeps: string[];
}

export interface GoldenFile {
    version: 1;
    entries: Record<string, string>;
}

export interface GoldenReport {
    /** Rows carrying a fingerprint this run. */
    checked: number;
    matched: number;
    mismatched: string[];
    /** Sampled rows with no golden entry yet (new coverage, not a failure). */
    missing: number;
    goldenEntries: number;
}

function expectedScore(ra: number, rb: number): number {
    return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

/**
 * Sequential Elo in job-index order. Exhibition rows are skipped. Team
 * rating is the member mean; every member takes the same K*(S-E) step.
 */
export function computeElo(rows: EvalRow[], botIds: string[]): Map<string, number> {
    const elo = new Map<string, number>(botIds.map((id) => [id, ELO_START]));
    const ordered = [...rows].sort((a, b) => a.index - b.index);
    for (const row of ordered) {
        if (row.exhibition) continue;
        const mean = (team: string[]): number =>
            team.reduce((sum, id) => sum + (elo.get(id) ?? ELO_START), 0) / team.length;
        const ra = mean(row.teamA);
        const rb = mean(row.teamB);
        const sa = row.winner === 'A' ? 1 : row.winner === 'B' ? 0 : 0.5;
        const deltaA = ELO_K * (sa - expectedScore(ra, rb));
        for (const id of row.teamA) elo.set(id, (elo.get(id) ?? ELO_START) + deltaA);
        for (const id of row.teamB) elo.set(id, (elo.get(id) ?? ELO_START) - deltaA);
    }
    return elo;
}

export function rollup(rows: EvalRow[], botIds: string[], elo: Map<string, number>): BotRollup[] {
    const table = new Map<string, BotRollup>(
        botIds.map((id) => [
            id,
            {
                id,
                games: 0,
                wins: 0,
                losses: 0,
                draws: 0,
                winRate: 0,
                elo: Math.round((elo.get(id) ?? ELO_START) * 10) / 10,
                damageDealt: 0,
                kills: 0,
                errors: 0,
                perArena: {},
            },
        ]),
    );
    for (const row of rows) {
        for (const p of row.participants) {
            const entry = table.get(p.bot);
            if (!entry) continue;
            entry.games += 1;
            if (row.draw) entry.draws += 1;
            else if ((row.winner === 'A') === (p.team === 0)) entry.wins += 1;
            else entry.losses += 1;
            entry.damageDealt += p.damage;
            entry.kills += p.kills;
            entry.errors += p.errors;
            const split = entry.perArena[row.arena] ?? { games: 0, wins: 0, losses: 0, draws: 0 };
            split.games += 1;
            if (row.draw) split.draws += 1;
            else if ((row.winner === 'A') === (p.team === 0)) split.wins += 1;
            else split.losses += 1;
            entry.perArena[row.arena] = split;
        }
    }
    for (const entry of table.values()) {
        entry.winRate = entry.games > 0 ? Math.round(((entry.wins + 0.5 * entry.draws) / entry.games) * 10000) / 10000 : 0;
        entry.damageDealt = Math.round(entry.damageDealt * 100) / 100;
    }
    return [...table.values()];
}

/** 1v1 head-to-head from row.teamA[0]'s perspective; exhibitions skipped. */
export function headToHead(rows: EvalRow[], botIds: string[]): Record<string, Record<string, H2HCell>> {
    const h2h: Record<string, Record<string, H2HCell>> = {};
    for (const a of botIds) {
        h2h[a] = {};
        for (const b of botIds) {
            if (a !== b) (h2h[a] as Record<string, H2HCell>)[b] = { wins: 0, losses: 0, draws: 0 };
        }
    }
    for (const row of rows) {
        if (row.exhibition || row.teamSize !== 1) continue;
        const a = row.teamA[0] as string;
        const b = row.teamB[0] as string;
        const cell = h2h[a]?.[b];
        if (!cell) continue;
        if (row.draw) cell.draws += 1;
        else if (row.winner === 'A') cell.wins += 1;
        else cell.losses += 1;
    }
    return h2h;
}

export function smellChecks(rows: EvalRow[], rollups: BotRollup[]): Smells {
    const matches = rows.length;
    const draws = rows.filter((row) => row.draw).length;
    const drawRate = matches > 0 ? draws / matches : 0;
    return {
        matches,
        draws,
        drawRate: Math.round(drawRate * 10000) / 10000,
        drawSpike: drawRate > 0.05,
        sweeps: rollups.filter((r) => r.games >= 10 && r.losses === 0 && r.draws === 0).map((r) => r.id),
    };
}

/**
 * Golden fingerprint check. Advisory only: cross-CPU float behavior is not
 * guaranteed, so a mismatch warns (printed by the caller) but never fails.
 */
export function checkGolden(rows: EvalRow[], golden: GoldenFile | null): GoldenReport {
    const report: GoldenReport = {
        checked: 0,
        matched: 0,
        mismatched: [],
        missing: 0,
        goldenEntries: golden ? Object.keys(golden.entries).length : 0,
    };
    if (!golden) return report;
    for (const row of rows) {
        if (row.fingerprint === undefined) continue;
        report.checked += 1;
        const want = golden.entries[row.key];
        if (want === undefined) {
            report.missing += 1;
        } else if (want === row.fingerprint) {
            report.matched += 1;
        } else {
            report.mismatched.push(row.key);
        }
    }
    return report;
}
