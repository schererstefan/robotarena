// Hillclimb tuner CLI (plan §1.6 Stage A→B).
//   npm run tune -- --archetype hunter --teamSize 1
//   npm run tune -- --verify tools/hillclimb/runs/<runId>-<archetype>.json
// Exit codes: 0 run complete and champion frozen (or --no-freeze), 2 run
// complete but nothing frozen (no promotion or regression veto), 1 on
// usage errors, verification mismatches, or crashes.

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ROBOT_API_VERSION } from '../../src/sim/types';
import { Match } from '../../src/sim/engine';
import { decodeReplay } from '../../src/sim/replay';
import { defaultGenome, GENOME_VERSION, genomeDefFor, genomeHash, genomeLoadout, validateGenome } from '../../src/robots/genome';
import { getRobot } from '../../src/robots/registry';
import { fingerprintMatch } from '../eval/runner';
import { adapterFor, buildPool, buildTeamPool, defaultOpponents, evaluateDetailed, evaluateTeamDetailed, type PoolMatch, type TeamPoolMatch } from './evaluate';
import { better } from './fitness';
import { stageA } from './halving';
import { validationCode, writeManifest, type TuneManifest, type ValidationMatch } from './manifest';
import { freezeChampion } from './codegen';
import { hillclimbRestart, regressionVeto } from './search';
import { rngFromSeed } from './mutate';

const SEED_STEP = 0x9e3779b9;
const DEFAULT_RUN_SEED = 0xc11cb5;

interface TuneOptions {
    archetype: string;
    teamSize: number;
    runSeed: number;
    stageACandidates: number;
    restarts: number;
    generations: number;
    challengers: number;
    /** True when the flag was passed explicitly (disables genome-aware scaling for that knob). */
    generationsSet: boolean;
    challengersSet: boolean;
    earlyStop: number;
    trainSeedCount: number;
    validSeedCount: number;
    freeze: boolean;
    outDir: string;
    verify: string | null;
}

function parseArgs(argv: string[]): TuneOptions {
    const opts: TuneOptions = {
        archetype: '',
        teamSize: 1,
        runSeed: DEFAULT_RUN_SEED,
        stageACandidates: 256,
        restarts: 8,
        generations: 25,
        challengers: 4,
        generationsSet: false,
        challengersSet: false,
        earlyStop: 8,
        trainSeedCount: 32,
        validSeedCount: 16,
        freeze: true,
        outDir: join('tools', 'hillclimb', 'runs'),
        verify: null,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i] as string;
        const next = (): string => {
            const value = argv[i + 1];
            if (value === undefined) throw new Error(`missing value for ${arg}`);
            i += 1;
            return value;
        };
        const nextInt = (flag: string, min: number): number => {
            const value = Number(next());
            if (!Number.isInteger(value) || value < min) throw new Error(`${flag} must be an integer >= ${min}`);
            return value;
        };
        if (arg === '--archetype') opts.archetype = next();
        else if (arg === '--teamSize') opts.teamSize = nextInt('--teamSize', 1);
        else if (arg === '--seed') opts.runSeed = nextInt('--seed', 0);
        else if (arg === '--stageA') opts.stageACandidates = nextInt('--stageA', 8);
        else if (arg === '--restarts') opts.restarts = nextInt('--restarts', 1);
        else if (arg === '--generations') {
            opts.generations = nextInt('--generations', 1);
            opts.generationsSet = true;
        } else if (arg === '--challengers') {
            opts.challengers = nextInt('--challengers', 1);
            opts.challengersSet = true;
        }
        else if (arg === '--early-stop') opts.earlyStop = nextInt('--early-stop', 0);
        else if (arg === '--train-seeds') opts.trainSeedCount = nextInt('--train-seeds', 4);
        else if (arg === '--valid-seeds') opts.validSeedCount = nextInt('--valid-seeds', 4);
        else if (arg === '--out') opts.outDir = next();
        else if (arg === '--no-freeze') opts.freeze = false;
        else if (arg === '--verify') opts.verify = next();
        else if (arg === '--help' || arg === '-h') {
            console.log(helpText());
            process.exit(0);
        } else throw new Error(`unknown arg ${arg} (see --help)`);
    }
    return opts;
}

function helpText(): string {
    return [
        'hillclimb tuner: Stage A halving + Stage B random-restart hillclimb',
        '',
        '  --archetype ID        tunable bot: brawler, ghost, hunter, orbiter,',
        '                          rusher, sniper, turret, wanderer [required]',
        '  --teamSize N          bots per side: 1 for 1v1 (default), 2-3 for team search',
        '  --seed N              run seed (default 0xc11cb5)',
        '  --stageA N            Stage-A loadout candidates (default 256)',
        '  --restarts N          Stage-B restarts (default 8)',
        '  --generations N       max generations per restart (default 25 for 12-param genomes,',
        '                          scales as round(25*sqrt(n/12)) clamped 25-60; n excludes loadout)',
        '  --challengers N       challengers per generation (default 4 for 12-param genomes,',
        '                          scales as round(4*sqrt(n/12)) clamped 4-12)',
        '  --early-stop N        stop a restart after N accept-free gens, 0 disables (default 8)',
        '  --train-seeds N       training seeds (default 32)',
        '  --valid-seeds N       held-out validation seeds (default 16)',
        '  --out DIR             manifest dir (default tools/hillclimb/runs)',
        '  --no-freeze           tune + manifest only, skip champion codegen',
        '  --verify MANIFEST     replay every validation code from the registry',
        '',
        'Exit codes: 0 frozen (or --no-freeze complete), 2 nothing frozen (veto / no promotion), 1 error.',
    ].join('\n');
}

/** Disjoint deterministic seed blocks: train, valid, veto. */
export function deriveSeeds(runSeed: number, train: number, valid: number, veto: number): { trainSeeds: number[]; validSeeds: number[]; vetoSeeds: number[] } {
    const block = (offset: number, n: number): number[] => {
        const seeds: number[] = [];
        for (let i = 0; i < n; i += 1) seeds.push((runSeed + Math.imul(offset + i, SEED_STEP)) >>> 0);
        return seeds;
    };
    const trainSeeds = block(0, train);
    const validSeeds = block(100000, valid);
    const vetoSeeds = block(200000, veto);
    const used = new Set(trainSeeds);
    for (const list of [validSeeds, vetoSeeds]) {
        for (let i = 0; i < list.length; i += 1) {
            while (used.has(list[i] as number)) list[i] = (((list[i] as number) + 1) >>> 0);
            used.add(list[i] as number);
        }
    }
    return { trainSeeds, validSeeds, vetoSeeds };
}

/**
 * Opponent fold split (opponent-diverse validation). Fold rule: sort the
 * roster ids and hold out every 3rd archetype (1-based positions 3, 6, 9, …)
 * as the validation fold; the rest trains. Deterministic from the roster
 * alone, so the manifest's opponent list reproduces the split. Rosters
 * shorter than 3 hold out the last id so the fold is never empty.
 */
export function splitOpponentFolds(opponents: string[]): { train: string[]; heldOut: string[] } {
    const sorted = [...opponents].sort();
    const train: string[] = [];
    const heldOut: string[] = [];
    sorted.forEach((id, i) => {
        if ((i + 1) % 3 === 0) heldOut.push(id);
        else train.push(id);
    });
    if (heldOut.length === 0 && train.length > 0) {
        heldOut.push(train.pop() as string);
    }
    return { train, heldOut };
}

function gitSha(): string {
    try {
        return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    } catch {
        return 'unknown';
    }
}

function gameVersion(root: string): string {
    try {
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown };
        return typeof pkg.version === 'string' ? pkg.version : 'unknown';
    } catch {
        return 'unknown';
    }
}

function runIdNow(): string {
    const d = new Date();
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function tune(opts: TuneOptions, root: string): number {
    const started = Date.now();
    if (!opts.archetype) throw new Error('--archetype is required (see --help)');
    if (opts.teamSize < 1 || opts.teamSize > 3) throw new Error(`--teamSize ${opts.teamSize} unsupported (1-3; replay codec caps at 3v3)`);
    // Team mode mutates the single shared genome (all slots share it);
    // mutateTeamGenome stays unwired (per-slot genomes are future work).
    const teamMode = opts.teamSize > 1;
    const def = genomeDefFor(opts.archetype);
    if (!def) throw new Error(`no genome def for archetype ${opts.archetype}`);
    const create = adapterFor(opts.archetype);
    const opponents = defaultOpponents(opts.archetype);
    const folds = splitOpponentFolds(opponents);
    const runId = runIdNow();
    const { trainSeeds, validSeeds, vetoSeeds } = deriveSeeds(opts.runSeed, opts.trainSeedCount, opts.validSeedCount, 16);
    const rng = rngFromSeed(opts.runSeed);
    // Genome-aware search budget: scale Stage-B effort with the behavior-param
    // count n (excluding loadout) — challengers = clamp(round(4·√(n/12)),4,12),
    // generations = clamp(round(25·√(n/12)),25,60). Explicit flags override;
    // 12-param genomes (and smaller, via the clamp floor) keep 25×4 exactly.
    const behaviorParams = Object.values(def.params).filter((p) => p.type !== 'loadout').length;
    const budgetScale = Math.sqrt(behaviorParams / 12);
    if (!opts.generationsSet) opts.generations = Math.min(60, Math.max(25, Math.round(25 * budgetScale)));
    if (!opts.challengersSet) opts.challengers = Math.min(12, Math.max(4, Math.round(4 * budgetScale)));
    console.log(`tune ${opts.archetype} ${teamMode ? `${opts.teamSize}v${opts.teamSize}` : '1v1'}: run ${runId}, seed ${opts.runSeed}, opponents ${opponents.length} (train fold ${folds.train.length}, held-out ${folds.heldOut.length})`);
    console.log(
        `budget: ${behaviorParams} behavior params -> ${opts.generations} gens x ${opts.challengers} challengers` +
            (!opts.generationsSet || !opts.challengersSet ? ' (genome-aware defaults)' : ' (explicit flags)'),
    );

    // Stage A: loadout-first halving at default params (train fold only).
    console.log(`stage A: ${opts.stageACandidates} loadouts, survivors ${opts.restarts}`);
    const halving = stageA({ def, create, opponents: folds.train, trainSeeds, candidates: opts.stageACandidates, survivors: opts.restarts, rng, teamSize: opts.teamSize });
    for (const rung of halving.rungs) {
        console.log(`  rung ${rung.rung}: ${rung.candidates} cands x ${rung.poolSize} pool -> keep ${rung.kept} (top ${(rung.topMean * 100).toFixed(1)}%, cutoff ${(rung.cutoffMean * 100).toFixed(1)}%)`);
    }
    let matchesRun = halving.matchesRun;

    // Stage B: one restart per survivor.
    const restarts = [];
    for (let r = 0; r < halving.survivors.length; r += 1) {
        const survivor = halving.survivors[r] as (typeof halving.survivors)[number];
        const result = hillclimbRestart(
            {
                def,
                create,
                opponents: folds.train,
                validOpponents: folds.heldOut,
                trainSeeds,
                validSeeds,
                generations: opts.generations,
                challengers: opts.challengers,
                earlyStop: opts.earlyStop,
                rng,
                teamSize: opts.teamSize,
            },
            r,
            survivor.genome,
        );
        matchesRun += result.matchesRun;
        const accepts = result.history.filter((h) => h.accepted).length;
        console.log(
            `  restart ${r}: train ${(result.train.mean * 100).toFixed(1)}% valid ${(result.valid.mean * 100).toFixed(1)}% validOpp ${(result.validOpp.mean * 100).toFixed(1)}% ` +
                `${result.promoted ? 'PROMOTED' : 'held-out'} accepts ${accepts}/${result.history.length}${result.stoppedEarly ? ' (early stop)' : ''}`,
        );
        restarts.push(result);
    }

    // Champion = best promoted restart (valid, then train).
    const promoted = restarts.filter((r) => r.promoted);
    promoted.sort((a, b) => (better(b.valid, a.valid) ? 1 : better(a.valid, b.valid) ? -1 : better(b.train, a.train) ? 1 : -1));
    const winner = promoted[0];

    const defaults = defaultGenome(opts.archetype);
    if (!defaults) throw new Error(`no default genome for ${opts.archetype}`);
    const validatedDefaults = validateGenome(def, defaults);

    let champion: TuneManifest['champion'] = null;
    let veto: TuneManifest['veto'] = null;
    let validation: ValidationMatch[] = [];
    let frozen: string | null = null;

    if (winner) {
        champion = {
            genome: winner.incumbent,
            hash: genomeHash(winner.incumbent),
            train: winner.train,
            valid: winner.valid,
            validOpp: winner.validOpp,
            fromRestart: winner.restart,
        };
        // Re-run validation with fingerprints + replay codes (determinism self-check).
        const validPool: PoolMatch[] | TeamPoolMatch[] = teamMode
            ? buildTeamPool({ seeds: validSeeds, teamSize: opts.teamSize, opponents: folds.train })
            : buildPool({ seeds: validSeeds, oppsPerSeed: 1, opponents: folds.train });
        const detailed = teamMode
            ? evaluateTeamDetailed(create, winner.incumbent, validPool as TeamPoolMatch[])
            : evaluateDetailed(create, winner.incumbent, validPool as PoolMatch[]);
        matchesRun += validPool.length;
        const reMean = detailed.reduce((s, m) => s + m.score, 0) / detailed.length;
        if (Math.abs(reMean - winner.valid.mean) > 1e-9) throw new Error(`validation re-run diverged (${reMean} vs ${winner.valid.mean})`);
        const champLoadout = genomeLoadout(winner.incumbent);
        validation = detailed.map((d) => ({
            seed: d.spec.seed,
            arena: d.spec.arena,
            opponent: d.spec.opponent,
            side: d.spec.side,
            score: d.score,
            f: d.f,
            fingerprint: d.fingerprint,
            code: '', // filled after freeze (champion id known then)
        }));

        veto = regressionVeto(create, winner.incumbent, validatedDefaults, vetoSeeds, folds.train, opts.teamSize);
        matchesRun += veto.matches;
        console.log(
            `veto: champ ${(veto.champMean * 100).toFixed(1)}% vs default ${(veto.defaultMean * 100).toFixed(1)}% ` +
                `(nonTied ${veto.nonTied}, defaultWins ${veto.defaultWins}, p=${veto.p.toFixed(4)}) -> ${veto.veto ? 'VETOED' : 'pass'}`,
        );

        if (!veto.veto && opts.freeze) {
            const { id } = freezeChampion(root, {
                archetype: opts.archetype,
                genome: winner.incumbent,
                runId,
                trainMean: winner.train.mean,
                validMean: winner.valid.mean,
                validation,
            });
            frozen = id;
            for (const v of validation) v.code = validationCode(id, champLoadout, v, opts.teamSize);
            // Patch the champion record with final codes (freeze ran with empty codes).
            const recordPath = join(root, 'tools', 'hillclimb', 'champions', `${id}.json`);
            const record = JSON.parse(readFileSync(recordPath, 'utf8')) as { featuredReplays: Array<{ code: string }> };
            record.featuredReplays.forEach((rep, i) => {
                rep.code = (validation[i] as ValidationMatch).code;
            });
            writeFileSync(recordPath, `${JSON.stringify(record, null, 1)}\n`);
            console.log(`frozen: ${id}`);
        } else if (!veto.veto && !opts.freeze) {
            console.log('freeze skipped (--no-freeze); validation codes need a champion id');
        }
    } else {
        console.log('no restart promoted (need valid ≥ train − 5pp and validOpp ≥ train − 10pp); nothing to freeze');
    }

    const manifest: TuneManifest = {
        runId,
        gitSha: gitSha(),
        gameVersion: gameVersion(root),
        robotApiVersion: ROBOT_API_VERSION,
        config: {
            archetype: opts.archetype,
            teamSize: opts.teamSize,
            runSeed: opts.runSeed,
            stageACandidates: opts.stageACandidates,
            restarts: opts.restarts,
            generations: opts.generations,
            challengers: opts.challengers,
            earlyStop: opts.earlyStop,
            trainSeeds: opts.trainSeedCount,
            validSeeds: opts.validSeedCount,
            opponents,
        },
        trainSeeds,
        validSeeds,
        stageA: halving.rungs,
        restarts: restarts.map((r) => ({ restart: r.restart, train: r.train, valid: r.valid, validOpp: r.validOpp, promoted: r.promoted, stoppedEarly: r.stoppedEarly, matchesRun: r.matchesRun, history: r.history })),
        champion,
        veto,
        vetoSeeds,
        validation,
        frozen,
        matchesRun,
        elapsedMs: Date.now() - started,
    };
    const path = writeManifest(opts.outDir, runId, opts.archetype, manifest);
    console.log(`matches: ${matchesRun}, elapsed: ${((Date.now() - started) / 1000).toFixed(1)}s`);
    console.log(`wrote ${path} (genome v${GENOME_VERSION})`);
    if (champion && veto && !veto.veto && (frozen || !opts.freeze)) return 0;
    return 2;
}

function verify(manifestPath: string): number {
    if (!existsSync(manifestPath)) throw new Error(`manifest not found: ${manifestPath}`);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as TuneManifest;
    if (!manifest.champion || !manifest.frozen) throw new Error('manifest has no frozen champion to verify');
    if (manifest.validation.length === 0) throw new Error('manifest has no validation matches');
    let mismatched = 0;
    manifest.validation.forEach((v, i) => {
        const data = decodeReplay(v.code);
        let ok = false;
        let detail = '';
        if (!data) {
            detail = 'code does not decode';
        } else {
            const lineups = data.lineupIds.map((id, k) => {
                const entry = getRobot(id);
                if (!entry) throw new Error(`unknown robot ${id} (champion frozen? registry rebuilt?)`);
                return { team: (k < data.teamSize ? 0 : 1) as 0 | 1, controller: entry.create(), loadout: { ...(data.loadouts[k] ?? {}) } };
            });
            const match = new Match(lineups, data.seed, { arena: data.arena ?? 'open', modifiers: data.modifiers ?? {} });
            match.runToEnd();
            const champWon = v.score === 1;
            const champDrew = v.score === 0.5;
            const winner = match.result.winner;
            const sideWins = winner === v.side;
            const draws = winner === -1;
            const outcomeOk = (champWon && sideWins) || (champDrew && draws) || (!champWon && !champDrew && !sideWins && !draws);
            const fpOk = fingerprintMatch(match) === v.fingerprint;
            ok = outcomeOk && fpOk;
            if (!outcomeOk) detail = `outcome mismatch (code replays winner=${winner}, expected score=${v.score} on side ${v.side})`;
            else if (!fpOk) detail = 'fingerprint mismatch';
        }
        if (!ok) {
            mismatched += 1;
            console.log(`  MISMATCH #${i} seed=${v.seed} ${v.arena} vs ${v.opponent}: ${detail}`);
        }
    });
    console.log(`verify: ${manifest.validation.length - mismatched}/${manifest.validation.length} validation codes replay exactly`);
    return mismatched === 0 ? 0 : 1;
}

const invoked = process.argv[1] ?? '';
if (invoked.endsWith('tune.mjs') || invoked.endsWith('tune.cjs') || invoked.endsWith('tune.ts')) {
    const root = process.cwd();
    try {
        const opts = parseArgs(process.argv.slice(2));
        process.exitCode = opts.verify ? verify(opts.verify) : tune(opts, root);
    } catch (error: unknown) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
