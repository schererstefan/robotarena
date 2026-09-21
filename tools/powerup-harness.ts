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
    let hazardStrikesTaken = 0;
    let hazardDamage = 0;
    const lineups: LineupEntry[] = ids.map((id, i) => {
        const entry = ROBOTS.find((r) => r.meta.id === id);
        if (!entry) throw new Error(`unknown robot ${id}`);
        const inner = entry.create();
        // Non-invasive observer: counts `blast` events, never draws rand().
        const wrapped: RobotController = {
            meta: inner.meta,
            loadout: inner.loadout,
            onSpawn: inner.onSpawn,
            update: (sense: SenseState): Intent => {
                for (const e of sense.events ?? []) {
                    if (e.kind === 'blast') {
                        hazardStrikesTaken += 1;
                        hazardDamage += typeof e.amount === 'number' ? e.amount : HAZ_DAMAGE;
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
                    break;
                }
            }
        }
    }
    // Pads: pickupLog is `tick:padIdx:robotId`; kinds via the seed layout.
    const layout = Match.padLayout(seed);
    const byKind = { amp: 0, repair: 0, overdrive: 0 };
    for (const record of match.pickupLog) {
        const idx = Number(record.split(':')[1]);
        const kind = layout[idx]?.kind;
        if (kind === 'amp' || kind === 'repair' || kind === 'overdrive') byKind[kind] += 1;
    }
    // Turrets: turretCaptureLog is `tick:turretIdx:team`; first sighting of
    // a turret index = neutral->owned, later ones = steals/recaptures.
    const seen = new Set<number>();
    let first = 0;
    let steals = 0;
    for (const record of match.turretCaptureLog) {
        const idx = Number(record.split(':')[1]);
        if (seen.has(idx)) steals += 1;
        else {
            seen.add(idx);
            first += 1;
        }
    }
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
    };
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
    const rows: GameRow[] = [];
    for (const arena of ARENAS) {
        for (let i = 0; i < ACTIVE_BRAINS.length; i += 1) {
            for (let j = i + 1; j < ACTIVE_BRAINS.length; j += 1) {
                for (const seed of HARNESS_SEEDS) {
                    rows.push(runOneGame(
                        [ACTIVE_BRAINS[i] as string, ACTIVE_BRAINS[j] as string],
                        [0, 1], seed, arena, '1v1',
                    ));
                }
            }
        }
        for (const quad of SAMPLE_2V2) {
            for (const seed of HARNESS_SEEDS) {
                rows.push(runOneGame([...quad], [0, 0, 1, 1], seed, arena, '2v2'));
            }
        }
    }
    const by1v1 = rows.filter((r) => r.kind === '1v1');
    const by2v2 = rows.filter((r) => r.kind === '2v2');
    const payload = {
        tool: 'tools/powerup-harness.ts',
        activeBrains: [...ACTIVE_BRAINS],
        seeds: [...HARNESS_SEEDS],
        arenas: [...ARENAS],
        sample2v2: SAMPLE_2V2.map((q) => [...q]),
        modifiers: {},
        games: rows.length,
        overall: summarize(rows),
        per1v1: summarize(by1v1),
        per2v2: summarize(by2v2),
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
