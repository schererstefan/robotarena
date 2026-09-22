// League Season 1: data access + session-only fighter registration for the
// in-app League view (Track B).
//
// The season's 16 fighters are custom BT genomes, NOT registry entries
// (registry.ts is append-only and must stay untouched), so every match
// carries a legacy RA1 replay code with `custom:league-<id>` lineup ids.
// Watching a replay = decode with decodeReplay, resolve each id to its
// genome JSON (bundled statically via Vite JSON imports), build a fresh
// BT brain per match exactly like tools/map-elites/worker-duel.ts and
// tools/league/verify-replays.ts do, and start the Battle scene with the
// pinned spec (seed, arena, loadouts, modifiers).
//
// Deterministic: no Math.random / Date.now anywhere in this module. The
// sim itself is untouched; this is data plumbing + render-side setup.

import { Scene } from 'phaser';
import { createBTTreeBrain } from '../robots/bt/brain';
import { BT_LOADOUT } from '../robots/bt/gp';
import { parseGenome } from '../robots/bt/serialization';
import { cloneTree, type BTNode } from '../robots/bt/tree';
import { decodeReplay } from '../sim/replay';
import type { SkillLoadout } from '../sim/skills';
import type { RobotController, RobotMeta, SenseState } from '../sim/types';
import { CALLSIGNS, defaultSkin } from './customize';
import { getImported, registerSessionRobot, type ImportedRobot } from './importRobot';
import type { BattleRequest } from './scenes/MenuScene';
import seasonRaw from '../../data/league/season1.json';
import telemetryRaw from '../../data/league/season1-telemetry.json';
import genomeBtP11120 from '../robots/bt/genomes/map-elites/bt-p1-1120.genome.json';
import genomeBtP12211 from '../robots/bt/genomes/map-elites/bt-p1-2211.genome.json';
import genomeBtP10221 from '../robots/bt/genomes/map-elites/bt-p1-0221.genome.json';
import genomeBtP11220 from '../robots/bt/genomes/map-elites/bt-p1-1220.genome.json';
import genomeBtP11221 from '../robots/bt/genomes/map-elites/bt-p1-1221.genome.json';
import genomeBtP11212 from '../robots/bt/genomes/map-elites/bt-p1-1212.genome.json';
import genomeBtP11210 from '../robots/bt/genomes/map-elites/bt-p1-1210.genome.json';
import genomeBtP11222 from '../robots/bt/genomes/map-elites/bt-p1-1222.genome.json';
import genomeBtP10222 from '../robots/bt/genomes/map-elites/bt-p1-0222.genome.json';
import genomeBtP12222 from '../robots/bt/genomes/map-elites/bt-p1-2222.genome.json';
import genomeBtP12022 from '../robots/bt/genomes/map-elites/bt-p1-2022.genome.json';
import genomeBtP11020 from '../robots/bt/genomes/map-elites/bt-p1-1020.genome.json';
import genomeBtP11010 from '../robots/bt/genomes/map-elites/bt-p1-1010.genome.json';
import genomeBtP10121 from '../robots/bt/genomes/map-elites/bt-p1-0121.genome.json';
import genomeBtP10210 from '../robots/bt/genomes/map-elites/bt-p1-0210.genome.json';
import genomeBtN1 from '../robots/bt/genomes/moth-v0.2.0.genome.json';

/** Session-only lineup id prefix (mirrors tools/league/roster.ts). */
export const LEAGUE_ID_PREFIX = 'custom:league-';

export interface LeagueFighter {
    id: string;
    name: string;
    genome: string;
    /** Pre-printed readable behavior tree (rendered verbatim on the card). */
    tree: string;
    startElo: number;
}

export interface LeagueMatch {
    id: string;
    a: string;
    b: string;
    winner: string;
    scoreA: number;
    scoreB: number;
    replay: string;
}

export interface LeagueStanding {
    fighter: string;
    rank: number;
    wins: number;
    losses: number;
    draws: number;
    elo: number;
}

export interface LeagueRivalry {
    a: string;
    b: string;
    record: string;
    note: string;
}

export interface LeagueHighlight {
    title: string;
    match: string;
    replay: string;
    note: string;
}

export interface SeasonData {
    season: number;
    format: string;
    fighters: LeagueFighter[];
    matches: LeagueMatch[];
    standings: LeagueStanding[];
    rivalries: LeagueRivalry[];
    highlights: LeagueHighlight[];
}

export interface TelemMatch {
    id: string;
    a: string;
    b: string;
    arena: string;
    seed: number;
    shootout: number;
    winner: string;
    eloBeforeA: number;
    eloBeforeB: number;
    ticks: number;
    suddenDeath: boolean;
    hpA: number;
    hpB: number;
    hpMargin: number;
    killsA: number;
    killsB: number;
    dmgA: number;
    dmgB: number;
    shotsA: number;
    shotsB: number;
    ko: boolean;
    comeback: boolean;
    minDeficitWinner: number;
    upsetGap: number;
}

/** The season file is the source of truth: standings, rosters and trees. */
export const season = seasonRaw as unknown as SeasonData;

interface TelemetryData {
    matches: TelemMatch[];
    wallMs: number;
    drawsSeen: number;
}

const telemetry = telemetryRaw as unknown as TelemetryData;
/** Per-match telemetry by match id (ticks, HP margins, sudden deaths, ...). */
export const telemByMatch = new Map<string, TelemMatch>(telemetry.matches.map((m) => [m.id, m]));

/** Genome JSON per fighter id (bundled; needed to rebuild brains). */
const GENOMES: Record<string, unknown> = {
    'bt-p1-1120': genomeBtP11120,
    'bt-p1-2211': genomeBtP12211,
    'bt-p1-0221': genomeBtP10221,
    'bt-p1-1220': genomeBtP11220,
    'bt-p1-1221': genomeBtP11221,
    'bt-p1-1212': genomeBtP11212,
    'bt-p1-1210': genomeBtP11210,
    'bt-p1-1222': genomeBtP11222,
    'bt-p1-0222': genomeBtP10222,
    'bt-p1-2222': genomeBtP12222,
    'bt-p1-2022': genomeBtP12022,
    'bt-p1-1020': genomeBtP11020,
    'bt-p1-1010': genomeBtP11010,
    'bt-p1-0121': genomeBtP10121,
    'bt-p1-0210': genomeBtP10210,
    'bt-n1': genomeBtN1,
};

/**
 * Base-chassis sprite per fighter: session robots reuse the generic look
 * by default; assigning the 8 base chassis round-robin by standings order
 * keeps the 16 fighters visually distinct in battle. Render-only.
 */
const CHASSIS: Record<string, string> = {
    'bt-p1-1220': 'hunter',
    'bt-p1-1221': 'orbiter',
    'bt-p1-2211': 'brawler',
    'bt-p1-2222': 'ghost',
    'bt-p1-0222': 'rusher',
    'bt-p1-1222': 'sniper',
    'bt-p1-0121': 'turret',
    'bt-p1-0221': 'wanderer',
    'bt-p1-1120': 'hunter',
    'bt-p1-1212': 'orbiter',
    'bt-p1-0210': 'brawler',
    'bt-n1': 'ghost',
    'bt-p1-1210': 'rusher',
    'bt-p1-1020': 'sniper',
    'bt-p1-2022': 'turret',
    'bt-p1-1010': 'wanderer',
};

const treeCache = new Map<string, BTNode>();

function baseTree(fighterId: string): BTNode {
    const cached = treeCache.get(fighterId);
    if (cached) return cached;
    const genome = GENOMES[fighterId];
    if (genome === undefined) throw new Error(`league: no genome bundled for ${fighterId}`);
    const tree = parseGenome(genome).tree;
    treeCache.set(fighterId, tree);
    return tree;
}

export function leagueLineupId(fighterId: string): string {
    return `${LEAGUE_ID_PREFIX}${fighterId}`;
}

export function fighterIdOfLineup(lineupId: string): string {
    return lineupId.startsWith(LEAGUE_ID_PREFIX) ? lineupId.slice(LEAGUE_ID_PREFIX.length) : lineupId;
}

/**
 * Register all 16 season fighters in the session-only import registry.
 * Idempotent; safe to call on every League visit.
 */
export function ensureLeagueFighters(): void {
    for (const f of season.fighters) {
        const lineupId = leagueLineupId(f.id);
        if (getImported(lineupId) !== undefined) continue;
        const meta: RobotMeta = {
            id: f.id,
            name: f.name,
            author: 'League Season 1',
            version: '1.0.0',
            description: `Season 1 fighter ${f.id}`,
        };
        const create = (): RobotController => {
            // Fresh brain per match: latch memory lives in the closure,
            // exactly like the season workers.
            const brain = createBTTreeBrain(cloneTree(baseTree(f.id)));
            return {
                meta: { ...meta },
                update: (sense: SenseState) => brain.update(sense).intent,
            };
        };
        const robot: ImportedRobot = {
            meta,
            loadout: { ...BT_LOADOUT } as SkillLoadout,
            create,
            displayId: CHASSIS[f.id] ?? 'wanderer',
        };
        registerSessionRobot(lineupId, robot);
    }
}

function loadTrailsPref(): boolean {
    try {
        const raw = localStorage.getItem('robotarena_trails');
        return raw === null ? true : raw === '1';
    } catch {
        return true;
    }
}

/**
 * Watch a season replay code in the Battle scene. Returns null on success,
 * or an error line to show in the UI when the code is unusable.
 */
export function watchLeagueReplay(scenePlugin: Scene['scene'], code: string): string | null {
    ensureLeagueFighters();
    const data = decodeReplay(code);
    if (!data) return 'INVALID REPLAY CODE';
    for (const id of data.lineupIds) {
        if (getImported(id) === undefined) return 'REPLAY REFERENCES AN UNKNOWN FIGHTER';
    }
    scenePlugin.start('Battle', {
        teamSize: data.teamSize,
        lineupIds: [...data.lineupIds],
        loadouts: data.loadouts.map((l) => ({ ...l })),
        skins: data.lineupIds.map((id, i) =>
            defaultSkin(
                (fighterById(fighterIdOfLineup(id))?.name ?? id).toUpperCase(),
                i,
                (i < data.teamSize ? 0 : 1) as 0 | 1,
            ),
        ),
        trails: loadTrailsPref(),
        seed: data.seed,
        arena: data.arena ?? 'open',
        modifiers: data.modifiers ?? {},
        replay: true,
        league: true,
    } satisfies BattleRequest);
    return null;
}

// ---- Data helpers (all driven by season1.json / telemetry) ----------------

export function fighterById(id: string): LeagueFighter | undefined {
    return season.fighters.find((f) => f.id === id);
}

export function fighterName(id: string): string {
    return fighterById(id)?.name ?? id;
}

export function standingOf(id: string): LeagueStanding | undefined {
    return season.standings.find((s) => s.fighter === id);
}

export function matchesOf(id: string): LeagueMatch[] {
    return season.matches.filter((m) => m.a === id || m.b === id);
}

/** The season's two legs between a and b, in match order (leg 1, leg 2). */
export function headToHead(a: string, b: string): LeagueMatch[] {
    return season.matches.filter((m) => (m.a === a && m.b === b) || (m.a === b && m.b === a));
}

export function rivalryOf(a: string, b: string): LeagueRivalry | undefined {
    return season.rivalries.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
}

export function resultFor(m: LeagueMatch, id: string): 'W' | 'L' | 'D' {
    if (m.winner === '') return 'D';
    return m.winner === id ? 'W' : 'L';
}

export function wldLine(s: LeagueStanding): string {
    return `${s.wins}-${s.losses}-${s.draws}`;
}

export interface FighterStats {
    kos: number;
    avgTicks: number;
    avgDmg: number;
    suddenDeaths: number;
    comebacks: number;
    matches: number;
}

/** Fun per-fighter stats aggregated from the season telemetry. */
export function fighterStats(id: string): FighterStats {
    let kos = 0;
    let ticks = 0;
    let dmg = 0;
    let suddenDeaths = 0;
    let comebacks = 0;
    let n = 0;
    for (const m of telemetry.matches) {
        if (m.a !== id && m.b !== id) continue;
        n += 1;
        ticks += m.ticks;
        if (m.suddenDeath) suddenDeaths += 1;
        if (m.winner === id) {
            if (m.ko) kos += 1;
            if (m.comeback) comebacks += 1;
        }
        dmg += m.a === id ? m.dmgA : m.dmgB;
    }
    return {
        kos,
        avgTicks: n > 0 ? Math.round(ticks / n) : 0,
        avgDmg: n > 0 ? Math.round(dmg / n) : 0,
        suddenDeaths,
        comebacks,
        matches: n,
    };
}

export function callsignFor(i: number): string {
    return CALLSIGNS[i % CALLSIGNS.length] ?? `R${i + 1}`;
}
