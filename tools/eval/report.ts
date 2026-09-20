// Eval report: summary.json + console table + delta vs a previous summary.
// Outputs carry no timestamps, timings, or job counts, so --jobs 1 and
// --jobs 8 reduce to byte-identical files.

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { EvalRow } from './runner';
import { ELO_K, ELO_START, type BotRollup, type GoldenReport, type H2HCell, type Smells } from './stats';

export interface SummaryMeta {
    mode: string;
    seedsPerPair: number | null;
    arenas: string[];
    bots: string[];
    teamSizes: number[];
    matchCount: number;
    gameVersion: string;
    robotApiVersion: number;
    eloStart: number;
    eloK: number;
}

export interface Summary {
    meta: SummaryMeta;
    bots: Record<string, BotRollup>;
    h2h: Record<string, Record<string, H2HCell>>;
    smells: Smells;
    golden: GoldenReport;
}

export function buildSummary(
    meta: SummaryMeta,
    rollups: BotRollup[],
    h2h: Record<string, Record<string, H2HCell>>,
    smells: Smells,
    golden: GoldenReport,
): Summary {
    const bots: Record<string, BotRollup> = {};
    for (const rollup of rollups) bots[rollup.id] = rollup;
    return { meta, bots, h2h, smells, golden };
}

export function writeOutputs(outDir: string, rows: EvalRow[], summary: Summary): { resultsPath: string; summaryPath: string } {
    mkdirSync(outDir, { recursive: true });
    const ordered = [...rows].sort((a, b) => a.index - b.index);
    const resultsPath = join(outDir, 'results.jsonl');
    const summaryPath = join(outDir, 'summary.json');
    writeFileSync(resultsPath, `${ordered.map((row) => JSON.stringify(row)).join('\n')}\n`);
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    return { resultsPath, summaryPath };
}

function pad(value: string | number, width: number, left = false): string {
    const s = String(value);
    if (s.length >= width) return s;
    const fill = ' '.repeat(width - s.length);
    return left ? s + fill : fill + s;
}

export function formatTable(summary: Summary): string {
    const rows = Object.values(summary.bots).sort((a, b) => b.elo - a.elo || (a.id < b.id ? -1 : 1));
    const lines = ['  # bot          games   W   L   D  win%    elo    dmg kills err'];
    rows.forEach((r, i) => {
        lines.push(
            `  ${pad(i + 1, 2)} ${pad(r.id, 12, true)} ${pad(r.games, 5)} ${pad(r.wins, 3)} ${pad(r.losses, 3)} ${pad(r.draws, 3)} ${pad((r.winRate * 100).toFixed(1), 5)} ${pad(r.elo.toFixed(1), 7)} ${pad(Math.round(r.damageDealt), 6)} ${pad(r.kills, 5)} ${pad(r.errors, 3)}`,
        );
    });
    return lines.join('\n');
}

export function formatDelta(oldSummary: Summary, newSummary: Summary): string {
    const lines = ['  bot          eloΔ   WΔ   LΔ   DΔ'];
    const ids = [...new Set([...Object.keys(oldSummary.bots), ...Object.keys(newSummary.bots)])].sort();
    for (const id of ids) {
        const old = oldSummary.bots[id];
        const cur = newSummary.bots[id];
        if (!old || !cur) {
            lines.push(`  ${pad(id, 12, true)} ${!old ? '(new)' : '(gone)'}`);
            continue;
        }
        const eloDelta = cur.elo - old.elo;
        const sign = eloDelta >= 0 ? '+' : '';
        lines.push(
            `  ${pad(id, 12, true)} ${pad(`${sign}${eloDelta.toFixed(1)}`, 5)} ${pad(cur.wins - old.wins, 4)} ${pad(cur.losses - old.losses, 4)} ${pad(cur.draws - old.draws, 4)}`,
        );
    }
    return lines.join('\n');
}

export function eloConvention(): { start: number; k: number } {
    return { start: ELO_START, k: ELO_K };
}
