// Showcase emitter: builds the static public/data/showcase.json gallery
// manifest from the frozen champion records. One champion per base
// archetype (the latest run wins); before/after stats are a paired
// re-evaluation of the default vs champion genome on the run's veto pool;
// featured replays ship only when they re-sim to their claimed outcome
// on this tree. Usage:
//   npm run emit:showcase -- --board public/leaderboard.json --out public/data/showcase.json
// Exit codes: 0 written, 1 on errors (no champions, unverifiable replays).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { getRobot } from '../../src/robots/registry';
import { defaultGenome, genomeDefFor, genomeLoadout, validateGenome, type Genome } from '../../src/robots/genome';
import type { ShowcaseChampion, ShowcaseManifest, ShowcaseOutcome, ShowcaseRecord } from '../../src/game/showcase';
import { adapterFor, buildPool, evaluateGenome } from '../hillclimb/evaluate';
import type { TuneManifest } from '../hillclimb/manifest';
import { loadChampionRecords, type ChampionRecord } from './board';
import { resimReplay } from './resim';

interface Options {
    board: string;
    out: string;
    champions: string;
    runs: string;
    replays: number;
}

function parseArgs(argv: string[]): Options {
    const opts: Options = {
        board: join('public', 'leaderboard.json'),
        out: join('public', 'data', 'showcase.json'),
        champions: join('tools', 'hillclimb', 'champions'),
        runs: join('tools', 'hillclimb', 'runs'),
        replays: 4,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i] as string;
        const next = (): string => {
            const value = argv[i + 1];
            if (value === undefined) throw new Error(`missing value for ${arg}`);
            i += 1;
            return value;
        };
        if (arg === '--board') opts.board = next();
        else if (arg === '--out') opts.out = next();
        else if (arg === '--champions') opts.champions = next();
        else if (arg === '--runs') opts.runs = next();
        else if (arg === '--replays') {
            const n = Number(next());
            if (!Number.isInteger(n) || n < 1) throw new Error('--replays must be a positive integer');
            opts.replays = n;
        } else if (arg === '--help' || arg === '-h') {
            console.log(helpText());
            process.exit(0);
        } else throw new Error(`unknown arg ${arg} (see --help)`);
    }
    return opts;
}

function helpText(): string {
    return [
        'showcase emitter: champion records -> public/data/showcase.json',
        '',
        '  --board PATH        leaderboard JSON for per-champion rated records',
        '  --out PATH          manifest output (default public/data/showcase.json)',
        '  --champions DIR     champion records (default tools/hillclimb/champions)',
        '  --runs DIR          tune manifests (default tools/hillclimb/runs)',
        '  --replays N         featured replays per champion (default 4)',
        '',
        'Exit codes: 0 written, 1 error.',
    ].join('\n');
}

function gameVersion(root: string): string {
    try {
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown };
        return typeof pkg.version === 'string' ? pkg.version : 'unknown';
    } catch {
        return 'unknown';
    }
}

/** Latest run per base archetype (runIds are UTC timestamps: lexicographic). */
export function latestPerBase(records: Map<string, ChampionRecord>): ChampionRecord[] {
    const byBase = new Map<string, ChampionRecord>();
    for (const record of [...records.values()].sort((a, b) => (a.botId < b.botId ? -1 : 1))) {
        const prev = byBase.get(record.baseBot);
        if (!prev || record.runId > prev.runId) byBase.set(record.baseBot, record);
    }
    return [...byBase.values()].sort((a, b) => (a.baseBot < b.baseBot ? -1 : 1));
}

function loadRunManifest(runsDir: string, record: ChampionRecord): TuneManifest {
    const path = join(runsDir, `${record.runId}-${record.baseBot}.json`);
    if (!existsSync(path)) throw new Error(`run manifest not found for ${record.botId}: ${path}`);
    return JSON.parse(readFileSync(path, 'utf8')) as TuneManifest;
}

function toRecord(agg: { wins: number; losses: number; draws: number; mean: number; n: number }): ShowcaseRecord {
    return { wins: agg.wins, losses: agg.losses, draws: agg.draws, winRate: agg.mean, games: agg.n };
}

const OUTCOME_RANK: Record<string, number> = { win: 0, draw: 1, loss: 2 };

function pickFeatured(record: ChampionRecord, count: number): Array<{ label: string; code: string; outcome: ShowcaseOutcome }> {
    const ranked = record.featuredReplays
        .map((rep, i) => ({ rep, i }))
        .sort((a, b) => (OUTCOME_RANK[a.rep.outcome] ?? 9) - (OUTCOME_RANK[b.rep.outcome] ?? 9) || a.i - b.i);
    const picked: Array<{ label: string; code: string; outcome: ShowcaseOutcome }> = [];
    for (const { rep } of ranked) {
        if (picked.length >= count) break;
        if (rep.outcome !== 'win' && rep.outcome !== 'draw' && rep.outcome !== 'loss') continue;
        const resim = resimReplay(rep.code, record.botId);
        if (resim && resim.outcome === rep.outcome) picked.push({ label: rep.label, code: rep.code, outcome: rep.outcome });
    }
    return picked;
}

function boardLookup(boardPath: string): Map<string, { elo: number; wins: number; losses: number; draws: number }> {
    const table = new Map<string, { elo: number; wins: number; losses: number; draws: number }>();
    if (!existsSync(boardPath)) {
        console.log(`board: ${boardPath} not found, champion board records will be null`);
        return table;
    }
    try {
        const raw = JSON.parse(readFileSync(boardPath, 'utf8')) as {
            entries?: Array<{ botId?: unknown; elo?: unknown; wins?: unknown; losses?: unknown; draws?: unknown }>;
        };
        for (const entry of raw.entries ?? []) {
            if (
                typeof entry.botId === 'string' &&
                typeof entry.elo === 'number' &&
                typeof entry.wins === 'number' &&
                typeof entry.losses === 'number' &&
                typeof entry.draws === 'number'
            ) {
                table.set(entry.botId, { elo: entry.elo, wins: entry.wins, losses: entry.losses, draws: entry.draws });
            }
        }
    } catch {
        console.log(`board: ${boardPath} unreadable, champion board records will be null`);
    }
    return table;
}

function main(argv: string[], root: string): number {
    const opts = parseArgs(argv);
    const version = gameVersion(root);
    const records = loadChampionRecords(opts.champions);
    if (records.size === 0) throw new Error(`no champion records in ${opts.champions}`);
    const latest = latestPerBase(records);
    console.log(`champions: ${latest.map((r) => r.botId).join(', ')} (${records.size - latest.length} superseded)`);
    const board = boardLookup(opts.board);

    const champions: ShowcaseChampion[] = [];
    for (const record of latest) {
        const entry = getRobot(record.botId);
        if (!entry) throw new Error(`champion ${record.botId} not in the registry (codegen not run?)`);
        const def = genomeDefFor(record.baseBot);
        const defaults = defaultGenome(record.baseBot);
        if (!def || !defaults) throw new Error(`no genome def for base archetype ${record.baseBot}`);
        const manifest = loadRunManifest(opts.runs, record);
        // Paired before/after: default vs champion genome on the run's veto pool.
        const create = adapterFor(record.baseBot);
        const pool = buildPool({ seeds: manifest.vetoSeeds, oppsPerSeed: 1, opponents: manifest.config.opponents });
        const before = evaluateGenome(create, validateGenome(def, defaults), pool).agg;
        const beforeLoadout = genomeLoadout(validateGenome(def, defaults));
        const championGenome = validateGenome(def, manifest.champion?.genome as Genome);
        const after = evaluateGenome(create, championGenome, pool).agg;
        const featured = pickFeatured(record, opts.replays);
        if (featured.length === 0) throw new Error(`no featured replay of ${record.botId} re-sims to its claimed outcome`);
        if (featured.length < opts.replays) console.log(`warn: ${record.botId}: only ${featured.length}/${opts.replays} featured replays verify`);
        champions.push({
            botId: record.botId,
            baseBot: record.baseBot,
            author: entry.meta.author,
            seedLoadout: beforeLoadout,
            champLoadout: genomeLoadout(championGenome),
            stats: { before: toRecord(before), after: toRecord(after) },
            featuredReplays: featured,
            board: board.get(record.botId) ?? null,
        });
        console.log(
            `  ${record.botId}: ${(before.mean * 100).toFixed(1)}% -> ${(after.mean * 100).toFixed(1)}% on ${pool.length} veto games, ${featured.length} replays`,
        );
    }

    const manifest: ShowcaseManifest = { season: version, version, champions };
    mkdirSync(dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, `${JSON.stringify(manifest, null, 1)}\n`);
    console.log(`wrote ${opts.out} (${champions.length} champions, season ${version})`);
    return 0;
}

const invoked = process.argv[1] ?? '';
if (invoked.endsWith('showcase.mjs') || invoked.endsWith('showcase.cjs') || invoked.endsWith('showcase.ts')) {
    try {
        process.exitCode = main(process.argv.slice(2), process.cwd());
    } catch (error: unknown) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
