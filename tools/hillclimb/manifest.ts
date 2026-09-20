// Manifest writer: one JSON per tune run at
// tools/hillclimb/runs/<ts>-<archetype>.json (runId, gitSha, gameVersion,
// full config, seeds, history, champion genome+hash+wins) plus one replay
// code per champion validation match (decodable once the champion freezes).

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ArenaId } from '../../src/sim/constants';
import { encodeReplay } from '../../src/sim/replay';
import type { SkillLoadout } from '../../src/sim/skills';
import type { Genome } from '../../src/robots/genome';
import { getRobot } from '../../src/robots/registry';
import type { Aggregate } from './fitness';
import type { HalvingRung } from './halving';
import type { GenRecord, VetoResult } from './search';

export interface TuneConfig {
    archetype: string;
    teamSize: number;
    runSeed: number;
    stageACandidates: number;
    restarts: number;
    generations: number;
    challengers: number;
    earlyStop: number;
    trainSeeds: number;
    validSeeds: number;
    opponents: string[];
}

export interface ValidationMatch {
    seed: number;
    arena: ArenaId;
    opponent: string;
    side: 0 | 1;
    /** Champion's score: 1 win, 0.5 draw, 0 loss. */
    score: number;
    f: number;
    fingerprint: string;
    code: string;
}

export interface TuneManifest {
    runId: string;
    gitSha: string;
    gameVersion: string;
    robotApiVersion: number;
    config: TuneConfig;
    trainSeeds: number[];
    validSeeds: number[];
    stageA: HalvingRung[];
    restarts: Array<{
        restart: number;
        train: Aggregate;
        valid: Aggregate;
        promoted: boolean;
        stoppedEarly: boolean;
        matchesRun: number;
        history: GenRecord[];
    }>;
    champion: {
        genome: Genome;
        hash: string;
        train: Aggregate;
        valid: Aggregate;
        fromRestart: number;
    } | null;
    veto: VetoResult | null;
    vetoSeeds: number[];
    validation: ValidationMatch[];
    frozen: string | null;
    matchesRun: number;
    elapsedMs: number;
}

export function manifestPath(runsDir: string, runId: string, archetype: string): string {
    return join(runsDir, `${runId}-${archetype}.json`);
}

export function writeManifest(runsDir: string, runId: string, archetype: string, manifest: TuneManifest): string {
    mkdirSync(runsDir, { recursive: true });
    const path = manifestPath(runsDir, runId, archetype);
    writeFileSync(path, `${JSON.stringify(manifest, null, 1)}\n`);
    return path;
}

/**
 * Validation replay code: team-0 slot first, champion on its validation side,
 * champion loadout + opponent default loadout. Decodes once the champion id
 * exists in the registry (i.e. after freeze).
 */
export function validationCode(championId: string, champLoadout: SkillLoadout, match: { seed: number; arena: ArenaId; opponent: string; side: 0 | 1 }): string {
    const foe = getRobot(match.opponent);
    if (!foe) throw new Error(`unknown opponent ${match.opponent}`);
    const lineupIds = match.side === 0 ? [championId, match.opponent] : [match.opponent, championId];
    const loadouts = match.side === 0 ? [{ ...champLoadout }, { ...foe.loadout }] : [{ ...foe.loadout }, { ...champLoadout }];
    return encodeReplay({ seed: match.seed, teamSize: 1, lineupIds, loadouts, arena: match.arena });
}
