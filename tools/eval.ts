// Eval harness CLI. Bundled with esbuild (CJS) like test:sim:
//   tools/eval.ts --mode rr --seeds 50 --arena both --jobs 8 --bots hunter,orbiter --vs all --out eval/out-rr
// Exit codes: 0 pass, 1 on errors>0 (or bad usage), 2 on balance-smell regression.

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ROBOTS } from '../src/robots/registry';
import { ROBOT_API_VERSION } from '../src/sim/types';
import { runJobs } from './eval/pool';
import type { EvalRow } from './eval/runner';
import {
    BASE_SEED,
    buildLadderJobs,
    buildPairwise,
    buildSpotMatrix,
    pairLadderRound,
    type LadderStanding,
    type MatchJob,
} from './eval/schedule';
import {
    checkGolden,
    computeElo,
    headToHead,
    rollup,
    smellChecks,
    type BotRollup,
    type GoldenFile,
} from './eval/stats';
import { buildSummary, formatDelta, formatTable, writeOutputs } from './eval/report';
import { isEvalWorker, runEvalWorker } from './eval/worker';

type Mode = 'smoke' | 'rr' | 'ladder' | 'full';
const LADDER_ROUNDS = 6;

interface Options {
    mode: Mode;
    seeds: number | null;
    arena: 'open' | 'blocks' | 'both';
    jobs: number;
    bots: string;
    vs: string;
    out: string | null;
    sample: number | null;
    baseSeed?: number;
    updateGolden: boolean;
    compare: string | null;
}

function parseArgs(argv: string[]): Options {
    const opts: Options = {
        mode: 'smoke',
        seeds: null,
        arena: 'both',
        jobs: 1,
        bots: 'all',
        vs: 'all',
        out: null,
        sample: null,
        updateGolden: false,
        compare: null,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i] as string;
        const next = (): string => {
            const value = argv[i + 1];
            if (value === undefined) throw new Error(`missing value for ${arg}`);
            i += 1;
            return value;
        };
        if (arg === '--mode') {
            const mode = next();
            if (mode !== 'smoke' && mode !== 'rr' && mode !== 'ladder' && mode !== 'full') throw new Error(`bad --mode ${mode}`);
            opts.mode = mode;
        } else if (arg === '--seeds') opts.seeds = Number(next());
        else if (arg === '--arena') {
            const arena = next();
            if (arena !== 'open' && arena !== 'blocks' && arena !== 'both') throw new Error(`bad --arena ${arena}`);
            opts.arena = arena;
        } else if (arg === '--jobs') opts.jobs = Number(next());
        else if (arg === '--bots') opts.bots = next();
        else if (arg === '--vs') opts.vs = next();
        else if (arg === '--out') opts.out = next();
        else if (arg === '--sample') opts.sample = Number(next());
        else if (arg === '--base-seed') opts.baseSeed = Number(next());
        else if (arg === '--update-golden') opts.updateGolden = true;
        else if (arg === '--compare') opts.compare = next();
        else if (arg === '--help' || arg === '-h') {
            console.log(helpText());
            process.exit(0);
        } else throw new Error(`unknown arg ${arg} (see --help)`);
    }
    if (opts.seeds !== null && (!Number.isInteger(opts.seeds) || opts.seeds < 1)) throw new Error('--seeds must be a positive integer');
    if (!Number.isInteger(opts.jobs) || opts.jobs < 1) throw new Error('--jobs must be a positive integer');
    if (opts.sample !== null && (!Number.isInteger(opts.sample) || opts.sample < 1)) throw new Error('--sample must be a positive integer');
    if (opts.baseSeed !== undefined && !Number.isInteger(opts.baseSeed)) throw new Error('--base-seed must be an integer');
    return opts;
}

function helpText(): string {
    return [
        'eval harness: deterministic bot-vs-bot schedules with Elo + goldens',
        '',
        '  --mode smoke|rr|ladder|full   schedule (default smoke)',
        '  --seeds N                     seeds per pairing (default 2/50/-/200)',
        '  --arena open|blocks|both      arenas (default both; smoke defaults open)',
        '  --jobs N                      workers, 1 = in-thread (default 1)',
        '  --bots a,b|all                entrants, registry order (default all)',
        '  --vs a,b|all                  opponents for pairwise modes (default all)',
        '  --out DIR                     output dir (default eval/out-<mode>)',
        '  --sample N                    fingerprint every Nth job + all draws (default 1 smoke, 64 else)',
        '  --base-seed N                 seed base (default 0xc0ffee)',
        '  --update-golden               merge this run into tools/eval/golden.json',
        '  --compare SUMMARY.json        print Elo/W/L/D deltas vs a previous summary',
        '',
        'Exit codes: 0 pass, 1 errors>0 (or bad usage), 2 balance smell (draw spike / sweep).',
        'Golden mismatches are advisory warnings, never failures.',
    ].join('\n');
}

function resolveBots(spec: string, label: string): string[] {
    const all = ROBOTS.map((r) => r.meta.id);
    if (spec === 'all') return all;
    const ids = spec.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    if (ids.length === 0) throw new Error(`--${label} names no bots`);
    for (const id of ids) {
        if (!all.includes(id)) throw new Error(`unknown robot ${id} in --${label} (known: ${all.join(',')})`);
    }
    return [...new Set(ids)];
}

function gameVersion(): string {
    try {
        const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version?: unknown };
        return typeof pkg.version === 'string' ? pkg.version : 'unknown';
    } catch {
        return 'unknown';
    }
}

function goldenPath(): string {
    return join(process.cwd(), 'tools', 'eval', 'golden.json');
}

function loadGolden(): GoldenFile | null {
    try {
        const raw = JSON.parse(readFileSync(goldenPath(), 'utf8')) as GoldenFile;
        if (raw.version !== 1 || typeof raw.entries !== 'object' || raw.entries === null) return null;
        return raw;
    } catch {
        return null;
    }
}

async function main(argv: string[]): Promise<number> {
    const opts = parseArgs(argv);
    const started = Date.now();
    const bots = resolveBots(opts.bots, 'bots');
    const vs = resolveBots(opts.vs, 'vs');
    const arenas = opts.arena === 'both' ? (['open', 'blocks'] as const) : ([opts.arena] as const);
    const outDir = opts.out ?? join('eval', `out-${opts.mode}`);
    const baseSeed = opts.baseSeed ?? BASE_SEED;

    let jobs: MatchJob[] = [];
    let seedsPerPair: number | null = null;
    if (opts.mode === 'ladder') {
        if (bots.length < 2) throw new Error('ladder needs at least 2 --bots');
    } else if (bots.length < 1 || vs.length < 1) {
        throw new Error('empty --bots/--vs selection');
    }

    const rows: EvalRow[] = [];
    if (opts.mode === 'ladder') {
        // Swiss rounds are sequential (pairing follows standings), but each
        // round's jobs still fan out across workers.
        const standings: LadderStanding[] = bots.map((id) => ({ id, score: 0, faced: new Set<string>(), byes: 0 }));
        const byId = new Map(standings.map((s) => [s.id, s]));
        const sampleEvery = opts.sample ?? 64;
        let index = 0;
        for (let round = 0; round < LADDER_ROUNDS; round += 1) {
            const arena = arenas.length === 1 ? arenas[0] : round % 2 === 0 ? 'open' : 'blocks';
            const pairings = pairLadderRound(standings);
            const built = buildLadderJobs(pairings, round, arena, index, sampleEvery, baseSeed);
            index += built.jobs.length;
            jobs.push(...built.jobs);
            const roundRows = await runJobs(built.jobs, opts.jobs);
            rows.push(...roundRows);
            const byIndex = new Map(roundRows.map((row) => [row.index, row]));
            built.jobs.forEach((job, k) => {
                const played = built.played[k] as { a: string; b: string };
                const row = byIndex.get(job.index);
                if (!row) return;
                (byId.get(played.a) as LadderStanding).faced.add(played.b);
                (byId.get(played.b) as LadderStanding).faced.add(played.a);
                if (row.draw) {
                    (byId.get(played.a) as LadderStanding).score += 0.5;
                    (byId.get(played.b) as LadderStanding).score += 0.5;
                } else {
                    const winner = row.winner === 'A' ? played.a : played.b;
                    (byId.get(winner) as LadderStanding).score += 1;
                }
            });
            for (const pairing of pairings) {
                if ('bye' in pairing) {
                    const s = byId.get(pairing.bye) as LadderStanding;
                    s.score += 1;
                    s.byes += 1;
                }
            }
            console.log(`round ${round + 1}/${LADDER_ROUNDS}: ${built.jobs.length} games on ${arena}`);
        }
    } else {
        const defaults = { smoke: 2, rr: 50, full: 200 } as const;
        seedsPerPair = opts.seeds ?? defaults[opts.mode as 'smoke' | 'rr' | 'full'];
        const modeArenas = opts.mode === 'smoke' && opts.arena === 'both' ? (['open'] as const) : arenas;
        const sampleEvery = opts.sample ?? (opts.mode === 'smoke' ? 1 : 64);
        jobs = buildPairwise({ bots, vs, seedsPerPair, arenas: [...modeArenas], sampleEvery, baseSeed });
        if (opts.mode === 'full') {
            jobs.push(...buildSpotMatrix(bots, [...modeArenas], 20, jobs.length, sampleEvery, baseSeed));
        }
        rows.push(...(await runJobs(jobs, opts.jobs)));
    }
    rows.sort((a, b) => a.index - b.index);

    const elo = computeElo(rows, bots);
    const rollups: BotRollup[] = rollup(rows, bots, elo);
    const smells = smellChecks(rows, rollups);
    const golden = loadGolden();
    const goldenReport = checkGolden(rows, golden);

    if (opts.updateGolden) {
        const entries: Record<string, string> = { ...(golden?.entries ?? {}) };
        let added = 0;
        for (const row of rows) {
            if (row.fingerprint === undefined) continue;
            if (entries[row.key] !== row.fingerprint) added += 1;
            entries[row.key] = row.fingerprint;
        }
        const sorted: Record<string, string> = {};
        for (const key of Object.keys(entries).sort()) sorted[key] = entries[key] as string;
        writeFileSync(goldenPath(), `${JSON.stringify({ version: 1, entries: sorted }, null, 1)}\n`);
        console.log(`golden: ${added} new/changed entries, ${Object.keys(sorted).length} total`);
    } else if (!golden) {
        console.log('golden: no tools/eval/golden.json yet (run --update-golden to seed it)');
    }

    const summary = buildSummary(
        {
            mode: opts.mode,
            seedsPerPair,
            arenas: opts.mode === 'smoke' && opts.arena === 'both' ? ['open'] : [...arenas],
            bots,
            teamSizes: [...new Set(jobs.map((j) => j.teamSize))].sort(),
            matchCount: rows.length,
            gameVersion: gameVersion(),
            robotApiVersion: ROBOT_API_VERSION,
            eloStart: 1000,
            eloK: 32,
        },
        rollups,
        headToHead(rows, bots),
        smells,
        goldenReport,
    );
    const { resultsPath, summaryPath } = writeOutputs(outDir, rows, summary);

    const errors = rows.reduce((sum, row) => sum + row.errors, 0);
    const exhibitions = rows.filter((row) => row.exhibition).length;
    console.log(`eval/${opts.mode}: ${rows.length} games, ${bots.length} bots, ${((Date.now() - started) / 1000).toFixed(1)}s`);
    console.log(formatTable(summary));
    console.log(`draws: ${smells.draws}/${smells.matches} (${(smells.drawRate * 100).toFixed(1)}%), errors: ${errors}, exhibitions: ${exhibitions}`);
    if (golden && goldenReport.checked > 0) {
        console.log(`golden: ${goldenReport.matched}/${goldenReport.checked} matched, ${goldenReport.missing} new, ${goldenReport.mismatched.length} mismatched`);
        for (const key of goldenReport.mismatched.slice(0, 10)) console.log(`  MISMATCH ${key}`);
    }
    if (smells.drawSpike) console.log('SMELL: draw spike (>5% draws)');
    if (smells.sweeps.length > 0) console.log(`SMELL: sweep (${smells.sweeps.join(', ')})`);
    console.log(`wrote ${resultsPath} + ${summaryPath}`);

    if (opts.compare) {
        try {
            const old = JSON.parse(readFileSync(opts.compare, 'utf8')) as Parameters<typeof formatDelta>[0];
            console.log(`delta vs ${opts.compare}:`);
            console.log(formatDelta(old, summary));
        } catch {
            console.error(`cannot read --compare ${opts.compare}`);
            return 1;
        }
    }

    if (errors > 0) return 1;
    if (smells.drawSpike || smells.sweeps.length > 0) return 2;
    return 0;
}

// Entry point last: main() runs synchronously to its first await, so every
// module-level const above must already be initialized when it is called.
if (isEvalWorker()) {
    runEvalWorker();
} else {
    void main(process.argv.slice(2)).then(
        (code) => {
            process.exitCode = code;
        },
        (error: unknown) => {
            console.error(error instanceof Error ? error.message : error);
            process.exitCode = 1;
        },
    );
}
