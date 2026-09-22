// RobotArena League — Season 1 runner.
// Double round-robin over the 16 curated fighters (120 pairs x 2 legs =
// 240 duels). Leg 1 on 'open', leg 2 on 'blocks' with sides swapped.
// Fixed start Elo 1500, K=32, applied sequentially in match-id order.
// Seeded RNG only: match n (1-based) opens at seed SEASON_SEED_BASE + n - 1.
// Shootout rule: a mutual-kill draw re-runs at seed+1, +2, ... until decisive;
// the deciding seed is what the replay code pins (telemetry `shootout`
// counts the re-seeds; 0 = decided on the opening seed).
//
// Replay codes: the RA2 compact format can only index the append-only ROBOTS
// registry, and league fighters are session-only custom genomes (registry.ts
// stays untouched), so every match gets a legacy RA1 code — the substrate's
// own format for custom-robot lineups. Lineup ids are stable
// `custom:league-<genome-id>` strings; the genome JSON path per fighter is in
// season1.json, so Track B can register them session-only and decode.
//
// Bundle:
//   npx esbuild tools/league/run-season.ts --bundle --platform=node --format=esm --outfile=/tmp/league-season.mjs
//   npx esbuild tools/league/worker-season.ts --bundle --platform=node --format=esm --outfile=/tmp/league-season.worker.mjs
//   node /tmp/league-season.mjs --worker /tmp/league-season.worker.mjs

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { Worker } from 'node:worker_threads';
import { FIGHTERS, leagueLineupId } from './roster';
import { parseGenome } from '../../src/robots/bt/serialization';
import { printTree, type BTNode } from '../../src/robots/bt/tree';
import { encodeReplayLegacy } from '../../src/sim/replay';
import { sanitizeLoadout } from '../../src/sim/skills';
import { BT_LOADOUT } from '../../src/robots/bt/gp';
import type { ArenaId } from '../../src/sim/constants';

const SEASON_SEED_BASE = 910000;
const ELO_START = 1500;
const ELO_K = 32;

interface DuelJob {
    kind: 'duel';
    key: string;
    aTree: BTNode;
    bTree: BTNode;
    seed: number;
    arena: ArenaId;
}

interface DuelResult {
    key: string;
    winner: number;
    seed: number;
    shootout: number;
    ticks: number;
    suddenDeath: boolean;
    hpA: number;
    hpB: number;
    maxHp: number;
    killsA: number;
    killsB: number;
    dmgA: number;
    dmgB: number;
    shotsA: number;
    shotsB: number;
    ko: boolean;
    comeback: boolean;
    minDeficitWinner: number;
}

interface MatchJob extends DuelJob {
    matchId: string;
    aId: string;
    bId: string;
}

class Pool {
    private workers: Worker[] = [];
    private nextId = 1;
    private pending = new Map<number, { resolve: (r: DuelResult[]) => void; reject: (e: Error) => void; out: DuelResult[]; remaining: number }>();

    constructor(workerPath: string, size: number) {
        for (let i = 0; i < size; i += 1) {
            const w = new Worker(workerPath);
            w.on('message', (msg: { id: number; results: DuelResult[] }) => {
                const p = this.pending.get(msg.id);
                if (!p) return;
                p.out.push(...msg.results);
                p.remaining -= 1;
                if (p.remaining === 0) {
                    this.pending.delete(msg.id);
                    p.resolve(p.out);
                }
            });
            w.on('error', (e: Error) => {
                for (const [, p] of this.pending) p.reject(e);
                this.pending.clear();
            });
            this.workers.push(w);
        }
    }

    run(jobs: DuelJob[]): Promise<DuelResult[]> {
        if (jobs.length === 0) return Promise.resolve([]);
        const id = this.nextId++;
        const n = Math.min(this.workers.length, jobs.length);
        const chunks: DuelJob[][] = Array.from({ length: n }, () => []);
        jobs.forEach((j, i) => {
            chunks[i % n]?.push(j);
        });
        return new Promise<DuelResult[]>((resolve, reject) => {
            this.pending.set(id, { resolve, reject, out: [], remaining: n });
            chunks.forEach((chunk, i) => this.workers[i]?.postMessage({ id, jobs: chunk }));
        });
    }

    async close(): Promise<void> {
        await Promise.all(this.workers.map((w) => w.terminate()));
        this.workers = [];
    }
}

function arg(name: string, fallback: string): string {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}

interface FighterTree {
    id: string;
    tree: BTNode;
    treeText: string;
}

async function main(): Promise<void> {
    const workerPath = arg('worker', '/tmp/league-season.worker.mjs');
    const outDir = arg('out', 'data/league');

    const fighters: FighterTree[] = FIGHTERS.map((f) => {
        const raw = readFileSync(f.genomePath, 'utf8');
        const tree = parseGenome(raw).tree;
        return { id: f.id, tree, treeText: printTree(tree) };
    });
    const treeOf = new Map(fighters.map((f) => [f.id, f.tree] as const));

    // Build the double round-robin schedule (canonical order).
    const jobs: MatchJob[] = [];
    let n = 0;
    for (let i = 0; i < FIGHTERS.length; i += 1) {
        for (let j = i + 1; j < FIGHTERS.length; j += 1) {
            const fa = FIGHTERS[i]!;
            const fb = FIGHTERS[j]!;
            const legs: Array<{ a: (typeof FIGHTERS)[number]; b: (typeof FIGHTERS)[number]; arena: ArenaId }> = [
                { a: fa, b: fb, arena: 'open' },
                { a: fb, b: fa, arena: 'blocks' },
            ];
            for (const leg of legs) {
                n += 1;
                const matchId = `s1-m${String(n).padStart(3, '0')}`;
                jobs.push({
                    kind: 'duel',
                    key: matchId,
                    matchId,
                    aId: leg.a.id,
                    bId: leg.b.id,
                    aTree: treeOf.get(leg.a.id)!,
                    bTree: treeOf.get(leg.b.id)!,
                    seed: (SEASON_SEED_BASE + n - 1) >>> 0,
                    arena: leg.arena,
                });
            }
        }
    }

    const pool = new Pool(workerPath, Math.min(8, Math.max(1, cpus().length)));
    const t0 = Date.now();
    const results = await pool.run(jobs);
    await pool.close();
    const wallMs = Date.now() - t0;
    const byKey = new Map(results.map((r) => [r.key, r] as const));

    const loadout = sanitizeLoadout({ ...BT_LOADOUT });
    const elo = new Map<string, number>(FIGHTERS.map((f) => [f.id, ELO_START]));
    const wins = new Map<string, number>(FIGHTERS.map((f) => [f.id, 0]));
    const losses = new Map<string, number>(FIGHTERS.map((f) => [f.id, 0]));
    const draws = new Map<string, number>(FIGHTERS.map((f) => [f.id, 0]));

    const matches: unknown[] = [];
    const telemetry: unknown[] = [];

    for (const job of jobs) {
        const r = byKey.get(job.key);
        if (!r) throw new Error(`missing result for ${job.key}`);
        const ra = elo.get(job.aId)!;
        const rb = elo.get(job.bId)!;
        const sa = r.winner === 0 ? 1 : r.winner === 1 ? 0 : 0.5;
        const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
        elo.set(job.aId, ra + ELO_K * (sa - ea));
        elo.set(job.bId, rb + ELO_K * ((1 - sa) - (1 - ea)));
        let winnerId: string;
        let scoreA = 0;
        let scoreB = 0;
        if (r.winner === 0) {
            winnerId = job.aId;
            scoreA = 1;
            wins.set(job.aId, wins.get(job.aId)! + 1);
            losses.set(job.bId, losses.get(job.bId)! + 1);
        } else if (r.winner === 1) {
            winnerId = job.bId;
            scoreB = 1;
            wins.set(job.bId, wins.get(job.bId)! + 1);
            losses.set(job.aId, losses.get(job.aId)! + 1);
        } else {
            winnerId = '';
            scoreA = 0.5;
            scoreB = 0.5;
            draws.set(job.aId, draws.get(job.aId)! + 1);
            draws.set(job.bId, draws.get(job.bId)! + 1);
        }
        const replay = encodeReplayLegacy({
            seed: r.seed,
            teamSize: 1,
            lineupIds: [leagueLineupId(job.aId), leagueLineupId(job.bId)],
            loadouts: [{ ...loadout }, { ...loadout }],
            arena: job.arena,
        });
        matches.push({
            id: job.matchId,
            a: job.aId,
            b: job.bId,
            winner: winnerId,
            scoreA,
            scoreB,
            replay,
        });
        telemetry.push({
            id: job.matchId,
            a: job.aId,
            b: job.bId,
            arena: job.arena,
            seed: r.seed,
            shootout: r.shootout,
            winner: winnerId,
            eloBeforeA: Math.round(ra * 10) / 10,
            eloBeforeB: Math.round(rb * 10) / 10,
            ticks: r.ticks,
            suddenDeath: r.suddenDeath,
            hpA: Math.round(r.hpA * 10) / 10,
            hpB: Math.round(r.hpB * 10) / 10,
            hpMargin: Math.round(Math.abs((r.winner === 0 ? r.hpA : r.winner === 1 ? r.hpB : 0) - (r.winner === 0 ? r.hpB : r.winner === 1 ? r.hpA : 0)) * 10) / 10,
            killsA: r.killsA,
            killsB: r.killsB,
            dmgA: Math.round(r.dmgA * 10) / 10,
            dmgB: Math.round(r.dmgB * 10) / 10,
            shotsA: r.shotsA,
            shotsB: r.shotsB,
            ko: r.ko,
            comeback: r.comeback,
            minDeficitWinner: Math.round(r.minDeficitWinner * 10) / 10,
            upsetGap: winnerId !== '' ? Math.round(Math.max(0, (winnerId === job.aId ? rb : ra) - (winnerId === job.aId ? ra : rb)) * 10) / 10 : 0,
        });
    }

    const drawsSeen = (telemetry as Array<{ winner: string }>).filter((t) => t.winner === '').length;

    const standings = FIGHTERS.map((f) => ({
        fighter: f.id,
        wins: wins.get(f.id)!,
        losses: losses.get(f.id)!,
        draws: draws.get(f.id)!,
        elo: Math.round(elo.get(f.id)!),
    }))
        .sort((x, y) => y.wins - x.wins || y.draws - x.draws || y.elo - x.elo)
        .map((s, i) => ({ ...s, rank: i + 1 }));

    const season = {
        season: 'Season 1',
        format: 'double round-robin',
        fighters: FIGHTERS.map((f, i) => ({
            id: f.id,
            name: f.name,
            genome: f.genomePath,
            tree: fighters[i]!.treeText,
            startElo: ELO_START,
        })),
        matches,
        standings,
        rivalries: [],
        highlights: [],
    };

    mkdirSync(outDir, { recursive: true });
    writeFileSync(`${outDir}/season1.json`, `${JSON.stringify(season, null, 2)}\n`);
    writeFileSync(`${outDir}/season1-telemetry.json`, `${JSON.stringify({ matches: telemetry, wallMs, drawsSeen }, null, 2)}\n`);
    console.log(`season: ${jobs.length} duels in ${wallMs}ms, draws=${drawsSeen}, shootouts=${(telemetry as Array<{ shootout: number }>).filter((t) => t.shootout > 0).length}`);
    console.log('standings:');
    for (const s of standings) {
        console.log(`  #${s.rank} ${s.fighter} ${s.wins}W-${s.losses}L-${s.draws}D elo=${s.elo}`);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
