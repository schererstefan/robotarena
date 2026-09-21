// Powerup/utility measurement harness (complexity/powerup-brains).
// Deterministic: fixed seeds, fixed matchup matrix, seeded RNG only
// (no Math.random / Date.now anywhere). Bundle like the soak:
//   esbuild tools/powerup-harness.ts --bundle --platform=node --format=esm \
//     --outfile=/tmp/robotarena-powerup.mjs && node /tmp/robotarena-powerup.mjs --out /private/tmp/powerup-baseline.json
//
// Matrix: all-pairs 1v1 among the active brains + a small 2v2 sample,
// default modifiers (powerup pads ON, asteroid strikes ON), both arenas
// (`open` for clean utility reads, `blocks` for barrier-contact ticks).
// Per game: pad pickups (total + by kind via Match.pickupLog mapped
// through Match.padLayout(seed)), turret captures (first captures vs
// steals via Match.turretCaptureLog), hazard strikes taken + hazard
// damage (observed `blast` events through a non-invasive wrapper that
// never touches sense.rand()), barrier-contact ticks (geometric contact
// vs match.obstacles each tick, same d < ROBOT_RADIUS rule as the
// engine's collideObstacles). Plus a smoke-scale Elo table over the 1v1s
// as the no-regression anchor, and a determinism spot check.

import { writeFileSync } from 'fs';
import { HAZ_DAMAGE, ROBOT_RADIUS, type ArenaId } from '../src/sim/constants';
import { Match, type LineupEntry } from '../src/sim/engine';
import { ROBOTS } from '../src/robots/registry';
import type { Intent, RobotController, SenseState } from '../src/sim/types';

/** Active brains under test (-hc1 checkpoints excluded by design). */
export const ACTIVE_BRAINS = [
    'brawler',
    'rusher',
    'hunter',
    'sniper',
    'orbiter',
    'ghost',
    'wanderer',
    'turret',
    'hunter-hc2',
] as const;

/** Fixed seeds (deterministic across runs). */
export const HARNESS_SEEDS = [101, 202, 303] as const;

/** Arenas: open (clean reads) + blocks (barrier contact). */
const ARENAS: ArenaId[] = ['open', 'blocks'];

/** Small fixed 2v2 sample (ids in spawn order, teams 0,0,1,1). */
const SAMPLE_2V2: Array<[string, string, string, string]> = [
    ['hunter', 'rusher', 'brawler', 'orbiter'],
    ['sniper', 'ghost', 'turret', 'wanderer'],
    ['hunter-hc2', 'orbiter', 'rusher', 'sniper'],
];

export interface GameRow {
    kind: '1v1' | '2v2';
    arena: ArenaId;
    seed: number;
    ids: string[];
    winner: -1 | 0 | 1;
    ticks: number;
    pickupsTotal: number;
    pickupsByKind: { amp: number; repair: number; overdrive: number };
    turretCaptures: number;
    turretFirst: number;
    turretSteals: number;
    hazardStrikesTaken: number;
    hazardDamage: number;
    barrierTicks: number;
    /** Per-robot attribution (index-aligned with ids): pickups taken,
     * turret captures scored (1v1 only, else -1), hazard strikes taken,
     * hazard damage taken, barrier-contact ticks. */
    byRobot: Array<{
        pickups: number;
        turretCaps: number;
        hazStrikes: number;
        hazDamage: number;
        barrierTicks: number;
    }>;
}

export interface BrainStats {
    games: number;
    pickupsPerGame: number;
    turretCapsPerGame: number;
    hazStrikesPerGame: number;
    hazDamagePerGame: number;
    barrierTicksPerGame: number;
}

export interface HarnessSummary {
    games: number;
    pickupsPerGame: number;
    pickupsByKindPerGame: { amp: number; repair: number; overdrive: number };
    turretCapturesPerGame: number;
    turretFirstPerGame: number;
    turretStealsPerGame: number;
    hazardStrikesPerGame: number;
    hazardDamagePerGame: number;
    barrierTicksPerGame: number;
    elo: Record<string, number>;
}

function summarize(rows: GameRow[]): HarnessSummary {
    const n = Math.max(1, rows.length);
    const sum = (f: (r: GameRow) => number): number => rows.reduce((a, r) => a + f(r), 0);
    return {
        games: rows.length,
        pickupsPerGame: sum((r) => r.pickupsTotal) / n,
        pickupsByKindPerGame: {
            amp: sum((r) => r.pickupsByKind.amp) / n,
            repair: sum((r) => r.pickupsByKind.repair) / n,
            overdrive: sum((r) => r.pickupsByKind.overdrive) / n,
        },
        turretCapturesPerGame: sum((r) => r.turretCaptures) / n,
        turretFirstPerGame: sum((r) => r.turretFirst) / n,
        turretStealsPerGame: sum((r) => r.turretSteals) / n,
        hazardStrikesPerGame: sum((r) => r.hazardStrikesTaken) / n,
        hazardDamagePerGame: sum((r) => r.hazardDamage) / n,
        barrierTicksPerGame: sum((r) => r.barrierTicks) / n,
        elo: computeElo(rows.filter((r) => r.kind === '1v1')),
    };
}

/** Simple Elo over 1v1s in fixed row order (1500 start, K=16). */
function computeElo(rows: GameRow[]): Record<string, number> {
    const elo: Record<string, number> = {};
    for (const id of ACTIVE_BRAINS) elo[id] = 1500;
    const expected = (a: number, b: number): number => 1 / (1 + Math.pow(10, (b - a) / 400));
    for (const r of rows) {
        if (r.ids.length !== 2) continue;
        const [a, b] = r.ids as [string, string];
        const ea = elo[a] as number;
        const eb = elo[b] as number;
        // winner is a team index; map to the robot id on that team.
        const sa = r.winner === 0 ? 1 : r.winner === 1 ? 0 : 0.5;
        const sb = 1 - sa;
        elo[a] = ea + 16 * (sa - expected(ea, eb));
        elo[b] = eb + 16 * (sb - expected(eb, ea));
    }
    return elo;
}

/** Point-to-rect distance (same clamp rule as engine collideObstacles). */
function rectDist(
    x: number, y: number,
    o: { x: number; y: number; w: number; h: number },
): number {
    const cx = Math.max(o.x, Math.min(x, o.x + o.w));
    const cy = Math.max(o.y, Math.min(y, o.y + o.h));
    return Math.hypot(x - cx, y - cy);
}

function runOneGame(ids: string[], teams: Array<0 | 1>, seed: number, arena: ArenaId, kind: '1v1' | '2v2'): GameRow {
    const hazStrikesByRobot = ids.map(() => 0);
    const hazDamageByRobot = ids.map(() => 0);
    const lineups: LineupEntry[] = ids.map((id, i) => {
        const entry = ROBOTS.find((r) => r.meta.id === id);
        if (!entry) throw new Error(`unknown robot ${id}`);
        const inner = entry.create();
        const index = i;
        // Non-invasive observer: counts `blast` events, never draws rand().
        const wrapped: RobotController = {
            meta: inner.meta,
            loadout: inner.loadout,
            onSpawn: inner.onSpawn,
            update: (sense: SenseState): Intent => {
                for (const e of sense.events ?? []) {
                    if (e.kind === 'blast') {
                        hazStrikesByRobot[index] = (hazStrikesByRobot[index] as number) + 1;
                        hazDamageByRobot[index] = (hazDamageByRobot[index] as number)
                            + (typeof e.amount === 'number' ? e.amount : HAZ_DAMAGE);
                    }
                }
                return inner.update(sense);
            },
        };
        return { team: teams[i] as 0 | 1, controller: wrapped, loadout: { ...entry.loadout } };
    });
    // Default modifiers: pads ON (always), hazards ON (no noHazards flag).
    const match = new Match(lineups, seed, { arena, modifiers: {} });
    let barrierTicks = 0;
    const barrierByRobot = ids.map(() => 0);
    let guard = 0;
    while (!match.result.over && guard < 20000) {
        match.step();
        guard += 1;
        const obstacles = match.obstacles;
        if (obstacles.length === 0) continue;
        for (const s of match.robotSnapshots) {
            if (!s.alive) continue;
            for (const o of obstacles) {
                if (rectDist(s.x, s.y, o) < ROBOT_RADIUS) {
                    barrierTicks += 1;
                    barrierByRobot[s.id] = (barrierByRobot[s.id] as number) + 1;
                    break;
                }
            }
        }
    }
    // Pads: pickupLog is `tick:padIdx:robotId`; kinds via the seed layout.
    const layout = Match.padLayout(seed);
    const byKind = { amp: 0, repair: 0, overdrive: 0 };
    const pickupsByRobot = ids.map(() => 0);
    for (const record of match.pickupLog) {
        const parts = record.split(':');
        const idx = Number(parts[1]);
        const robotId = Number(parts[2]);
        const kind = layout[idx]?.kind;
        if (kind === 'amp' || kind === 'repair' || kind === 'overdrive') byKind[kind] += 1;
        if (Number.isInteger(robotId) && robotId >= 0 && robotId < pickupsByRobot.length) {
            pickupsByRobot[robotId] = (pickupsByRobot[robotId] as number) + 1;
        }
    }
    // Turrets: turretCaptureLog is `tick:turretIdx:team`; first sighting of
    // a turret index = neutral->owned, later ones = steals/recaptures.
    // Attribution is exact in 1v1 (team == robot index), unknown in 2v2.
    const seen = new Set<number>();
    let first = 0;
    let steals = 0;
    const turretCapsByRobot = ids.map(() => (kind === '1v1' ? 0 : -1));
    for (const record of match.turretCaptureLog) {
        const parts = record.split(':');
        const idx = Number(parts[1]);
        const team = Number(parts[2]);
        if (seen.has(idx)) steals += 1;
        else {
            seen.add(idx);
            first += 1;
        }
        if (kind === '1v1' && (team === 0 || team === 1) && team < turretCapsByRobot.length) {
            turretCapsByRobot[team] = (turretCapsByRobot[team] as number) + 1;
        }
    }
    const hazardStrikesTaken = hazStrikesByRobot.reduce((a, b) => a + b, 0);
    const hazardDamage = hazDamageByRobot.reduce((a, b) => a + b, 0);
    return {
        kind,
        arena,
        seed,
        ids: [...ids],
        winner: match.result.winner,
        ticks: match.result.tick,
        pickupsTotal: match.pickupLog.length,
        pickupsByKind: byKind,
        turretCaptures: match.turretCaptureLog.length,
        turretFirst: first,
        turretSteals: steals,
        hazardStrikesTaken,
        hazardDamage,
        barrierTicks,
        byRobot: ids.map((_, i) => ({
            pickups: pickupsByRobot[i] as number,
            turretCaps: turretCapsByRobot[i] as number,
            hazStrikes: hazStrikesByRobot[i] as number,
            hazDamage: hazDamageByRobot[i] as number,
            barrierTicks: barrierByRobot[i] as number,
        })),
    };
}

/** Per-brain 1v1 attribution: who takes what (proves each brain's sight). */
function perBrain1v1(rows: GameRow[]): Record<string, BrainStats> {
    const acc: Record<string, { games: number; pickups: number; turretCaps: number; hazStrikes: number; hazDamage: number; barrier: number }> = {};
    for (const id of ACTIVE_BRAINS) acc[id] = { games: 0, pickups: 0, turretCaps: 0, hazStrikes: 0, hazDamage: 0, barrier: 0 };
    for (const r of rows) {
        if (r.kind !== '1v1') continue;
        r.ids.forEach((id, i) => {
            const a = acc[id];
            if (!a) return;
            const b = r.byRobot[i];
            if (!b) return;
            a.games += 1;
            a.pickups += b.pickups;
            if (b.turretCaps >= 0) a.turretCaps += b.turretCaps;
            a.hazStrikes += b.hazStrikes;
            a.hazDamage += b.hazDamage;
            a.barrier += b.barrierTicks;
        });
    }
    const out: Record<string, BrainStats> = {};
    for (const id of ACTIVE_BRAINS) {
        const a = acc[id] as { games: number; pickups: number; turretCaps: number; hazStrikes: number; hazDamage: number; barrier: number };
        const n = Math.max(1, a.games);
        out[id] = {
            games: a.games,
            pickupsPerGame: a.pickups / n,
            turretCapsPerGame: a.turretCaps / n,
            hazStrikesPerGame: a.hazStrikes / n,
            hazDamagePerGame: a.hazDamage / n,
            barrierTicksPerGame: a.barrier / n,
        };
    }
    return out;
}

function fingerprintGame(ids: string[], teams: Array<0 | 1>, seed: number, arena: ArenaId): string {
    const run = (): string => {
        const lineups: LineupEntry[] = ids.map((id, i) => {
            const entry = ROBOTS.find((r) => r.meta.id === id);
            if (!entry) throw new Error(`unknown robot ${id}`);
            return { team: teams[i] as 0 | 1, controller: entry.create(), loadout: { ...entry.loadout } };
        });
        const m = new Match(lineups, seed, { arena, modifiers: {} });
        m.runToEnd();
        return m.robotSnapshots.map((s) => [s.health, s.x, s.y, s.kills, s.damageDealt].join(',')).join('|')
            + `#${m.result.winner}@${m.result.tick}#${m.pickupLog.join(';')}#${m.turretCaptureLog.join(';')}`;
    };
    const a = run();
    const b = run();
    return a === b ? `identical:${a.length}` : `MISMATCH ${a} vs ${b}`;
}

function main(): void {
    const outIdx = process.argv.indexOf('--out');
    const out = outIdx >= 0 ? process.argv[outIdx + 1] : '/private/tmp/powerup-baseline.json';
    const seedsIdx = process.argv.indexOf('--seeds');
    const seeds: number[] = seedsIdx >= 0
        ? String(process.argv[seedsIdx + 1]).split(',').map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0)
        : [...HARNESS_SEEDS];
    if (seeds.length === 0) throw new Error('no valid --seeds');
    // Focus mode: --pairs "ghost:hunter,hunter-hc2:brawler" runs only
    // those 1v1s (both arenas). Empty = the full matrix.
    const pairsIdx = process.argv.indexOf('--pairs');
    const pairs: Array<[string, string]> = pairsIdx >= 0
        ? String(process.argv[pairsIdx + 1]).split(',').map((s) => {
            const [a, b] = s.split(':');
            if (!a || !b) throw new Error(`bad --pairs entry ${s}`);
            return [a, b] as [string, string];
        })
        : [];
    const rows: GameRow[] = [];
    for (const arena of ARENAS) {
        if (pairs.length > 0) {
            for (const [a, b] of pairs) {
                for (const seed of seeds) {
                    rows.push(runOneGame([a, b], [0, 1], seed, arena, '1v1'));
                }
            }
            continue;
        }
        for (let i = 0; i < ACTIVE_BRAINS.length; i += 1) {
            for (let j = i + 1; j < ACTIVE_BRAINS.length; j += 1) {
                for (const seed of seeds) {
                    rows.push(runOneGame(
                        [ACTIVE_BRAINS[i] as string, ACTIVE_BRAINS[j] as string],
                        [0, 1], seed, arena, '1v1',
                    ));
                }
            }
        }
        for (const quad of SAMPLE_2V2) {
            for (const seed of seeds) {
                rows.push(runOneGame([...quad], [0, 0, 1, 1], seed, arena, '2v2'));
            }
        }
    }
    const by1v1 = rows.filter((r) => r.kind === '1v1');
    const by2v2 = rows.filter((r) => r.kind === '2v2');
    const payload = {
        tool: 'tools/powerup-harness.ts',
        activeBrains: [...ACTIVE_BRAINS],
        seeds: [...seeds],
        arenas: [...ARENAS],
        sample2v2: SAMPLE_2V2.map((q) => [...q]),
        modifiers: {},
        games: rows.length,
        overall: summarize(rows),
        per1v1: summarize(by1v1),
        per2v2: summarize(by2v2),
        perBrain1v1: perBrain1v1(rows),
        determinismSpot: [
            fingerprintGame(['hunter', 'rusher'], [0, 1], HARNESS_SEEDS[0] as number, 'open'),
            fingerprintGame(['sniper', 'ghost'], [0, 1], HARNESS_SEEDS[1] as number, 'blocks'),
        ],
        rows,
    };
    if (out && out !== '-') {
        writeFileSync(out, `${JSON.stringify(payload, null, 1)}\n`);
        // eslint-disable-next-line no-console
        console.log(`wrote ${out}`);
    } else {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(payload, null, 1));
    }
}

main();
