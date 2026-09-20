// Stage B: random-restart hillclimb over the full genome (behavior + loadout).
// Each generation re-evaluates the incumbent on a freshly rotated pool, tries
// C challengers on that identical pool, and accepts the best challenger that
// passes the CRN sign test. Winners face held-out validation seeds and the
// regression veto (must not lose H2H vs the default build, p < 0.05).

import { GENOME_VERSION, validateGenome, type Genome, type GenomeDef } from '../../src/robots/genome';
import { aggregate, better, binomialUpperTail, signTest, type Aggregate } from './fitness';
import { buildPool, buildTeamPool, evaluateGenome, evaluateTeamGenome, type CreateFromGenome, type GenomeEval, type PoolMatch, type TeamPoolMatch } from './evaluate';
import { mutateGenome, type Rand } from './mutate';

export interface GenRecord {
    gen: number;
    incumbentMean: number;
    incumbentF: number;
    challengers: number;
    accepted: boolean;
    acceptedMean: number;
    signNonTied: number;
    signWins: number;
}

export interface RestartResult {
    restart: number;
    incumbent: Genome;
    train: Aggregate;
    valid: Aggregate;
    /** Held-out opponents × held-out seeds (opponent-fold validation). */
    validOpp: Aggregate;
    promoted: boolean;
    history: GenRecord[];
    matchesRun: number;
    stoppedEarly: boolean;
}

export interface HillclimbOptions {
    def: GenomeDef;
    create: CreateFromGenome;
    opponents: string[];
    /** Held-out opponent fold for the validOpp promotion gate (non-empty). */
    validOpponents: string[];
    trainSeeds: number[];
    validSeeds: number[];
    generations: number;
    challengers: number;
    /** Stop after this many accept-free generations (0 disables). */
    earlyStop: number;
    rng: Rand;
    /** Bots per side; >1 runs the team arm (shared genome on every slot). Defaults to 1. */
    teamSize?: number;
}

function defaultParamsGenome(def: GenomeDef): Genome {
    return validateGenome(def, { genome_version: GENOME_VERSION, bot: def.bot, params: {} });
}

/** Single restart from a Stage-A survivor loadout at default behavior params. */
export function hillclimbRestart(opts: HillclimbOptions, restart: number, seedLoadout: Genome): RestartResult {
    // Team arm: every slot (candidate and foe) runs one shared genome, so the
    // single-genome mutation/accept loop is unchanged — only the pool builders
    // and scorers swap. teamSize 1 keeps the exact 1v1 code path.
    const teamSize = opts.teamSize ?? 1;
    const teamMode = teamSize > 1;
    if (opts.validOpponents.length === 0) throw new Error('hillclimbRestart needs a non-empty validOpponents fold');
    const buildPoolFor = (seeds: number[], opponents: string[], offset: number): PoolMatch[] | TeamPoolMatch[] =>
        teamMode ? buildTeamPool({ seeds, teamSize, opponents, offset }) : buildPool({ seeds, oppsPerSeed: 1, opponents, offset });
    const evaluate = (genome: Genome, pool: PoolMatch[] | TeamPoolMatch[]): GenomeEval =>
        teamMode ? evaluateTeamGenome(opts.create, genome, pool as TeamPoolMatch[]) : evaluateGenome(opts.create, genome, pool as PoolMatch[]);
    const defaults = defaultParamsGenome(opts.def);
    let incumbent = validateGenome(opts.def, {
        genome_version: GENOME_VERSION,
        bot: opts.def.bot,
        params: { ...defaults.params, loadout: seedLoadout.params['loadout'] },
    });
    const history: GenRecord[] = [];
    let matchesRun = 0;
    let idle = 0;
    let stoppedEarly = false;
    let train: Aggregate = aggregate([]);

    for (let gen = 0; gen < opts.generations; gen += 1) {
        // Rotated pool per generation; incumbent re-evaluated every gen.
        const pool = buildPoolFor(opts.trainSeeds, opts.opponents, gen);
        const incumbentEval = evaluate(incumbent, pool);
        matchesRun += pool.length;

        const tried = [];
        for (let c = 0; c < opts.challengers; c += 1) {
            const genome = mutateGenome(opts.def, incumbent, opts.rng);
            const result = evaluate(genome, pool);
            matchesRun += pool.length;
            tried.push({ genome, result });
        }
        // Accept the best challenger that beats the incumbent on this pool
        // AND passes the paired sign test. History always records the best
        // challenger's test stats (accepted or not) as a progress signal.
        const incumbentScores = incumbentEval.matches.map((m) => m.score);
        let best: { genome: Genome; agg: Aggregate; nonTied: number; wins: number; pass: boolean; beats: boolean } | null = null;
        for (const { genome, result } of tried) {
            const test = signTest(
                result.matches.map((m) => m.score),
                incumbentScores,
            );
            const beats = better(result.agg, incumbentEval.agg);
            if (!best || better(result.agg, best.agg)) {
                best = { genome, agg: result.agg, nonTied: test.nonTied, wins: test.wins, pass: test.pass, beats };
            }
        }
        const accepted = best !== null && best.pass && best.beats;
        if (accepted && best) {
            incumbent = best.genome;
            train = best.agg;
            idle = 0;
        } else {
            train = incumbentEval.agg;
            idle += 1;
        }
        history.push({
            gen,
            incumbentMean: incumbentEval.agg.mean,
            incumbentF: incumbentEval.agg.meanF,
            challengers: opts.challengers,
            accepted,
            acceptedMean: accepted && best ? best.agg.mean : incumbentEval.agg.mean,
            signNonTied: best?.nonTied ?? 0,
            signWins: best?.wins ?? 0,
        });
        if (opts.earlyStop > 0 && idle >= opts.earlyStop) {
            stoppedEarly = true;
            break;
        }
    }

    // Held-out validation: promote only if valid ≥ train − 5pp (held-out seeds,
    // train fold) AND validOpp ≥ train − 10pp (held-out seeds × held-out foes;
    // slacker bound: novel foes are harder, so the drop allowance doubles).
    const validPool = buildPoolFor(opts.validSeeds, opts.opponents, 0);
    const valid = evaluate(incumbent, validPool).agg;
    matchesRun += validPool.length;
    const validOppPool = buildPoolFor(opts.validSeeds, opts.validOpponents, 0);
    const validOpp = evaluate(incumbent, validOppPool).agg;
    matchesRun += validOppPool.length;
    const promoted = valid.mean >= train.mean - 0.05 && validOpp.mean >= train.mean - 0.1;
    return { restart, incumbent, train, valid, validOpp, promoted, history, matchesRun, stoppedEarly };
}

export interface VetoResult {
    veto: boolean;
    champMean: number;
    defaultMean: number;
    nonTied: number;
    defaultWins: number;
    /** One-sided p: P(default this good by chance). Veto iff < 0.05. */
    p: number;
    matches: number;
}

/**
 * Regression veto: champion vs the default build (default params + default
 * loadout) on a fresh CRN pool. Freeze is blocked only when the default
 * build is *significantly* better (one-sided binomial p < 0.05).
 * teamSize > 1 runs both sides as teams on a team pool (same comparison).
 */
export function regressionVeto(create: CreateFromGenome, champion: Genome, defaults: Genome, poolSeed: Parameters<typeof buildPool>[0]['seeds'], opponents: string[], teamSize = 1): VetoResult {
    const teamMode = teamSize > 1;
    const pool = teamMode ? buildTeamPool({ seeds: poolSeed, teamSize, opponents }) : buildPool({ seeds: poolSeed, oppsPerSeed: 1, opponents });
    const champ = teamMode ? evaluateTeamGenome(create, champion, pool as TeamPoolMatch[]) : evaluateGenome(create, champion, pool as PoolMatch[]);
    const base = teamMode ? evaluateTeamGenome(create, defaults, pool as TeamPoolMatch[]) : evaluateGenome(create, defaults, pool as PoolMatch[]);
    const a = champ.matches.map((m) => m.score);
    const b = base.matches.map((m) => m.score);
    let nonTied = 0;
    let defaultWins = 0;
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] === b[i]) continue;
        nonTied += 1;
        if ((b[i] as number) > (a[i] as number)) defaultWins += 1;
    }
    const p = binomialUpperTail(nonTied, defaultWins);
    const veto = base.agg.mean > champ.agg.mean && p < 0.05;
    return { veto, champMean: champ.agg.mean, defaultMean: base.agg.mean, nonTied, defaultWins, p, matches: pool.length };
}
