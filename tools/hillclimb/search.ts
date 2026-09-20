// Stage B: random-restart hillclimb over the full genome (behavior + loadout).
// Each generation re-evaluates the incumbent on a freshly rotated pool, tries
// C challengers on that identical pool, and accepts the best challenger that
// passes the CRN sign test. Winners face held-out validation seeds and the
// regression veto (must not lose H2H vs the default build, p < 0.05).

import { GENOME_VERSION, validateGenome, type Genome, type GenomeDef } from '../../src/robots/genome';
import { aggregate, better, binomialUpperTail, signTest, type Aggregate } from './fitness';
import { buildPool, evaluateGenome, type CreateFromGenome } from './evaluate';
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
    promoted: boolean;
    history: GenRecord[];
    matchesRun: number;
    stoppedEarly: boolean;
}

export interface HillclimbOptions {
    def: GenomeDef;
    create: CreateFromGenome;
    opponents: string[];
    trainSeeds: number[];
    validSeeds: number[];
    generations: number;
    challengers: number;
    /** Stop after this many accept-free generations (0 disables). */
    earlyStop: number;
    rng: Rand;
}

function defaultParamsGenome(def: GenomeDef): Genome {
    return validateGenome(def, { genome_version: GENOME_VERSION, bot: def.bot, params: {} });
}

/** Single restart from a Stage-A survivor loadout at default behavior params. */
export function hillclimbRestart(opts: HillclimbOptions, restart: number, seedLoadout: Genome): RestartResult {
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
        const pool = buildPool({ seeds: opts.trainSeeds, oppsPerSeed: 1, opponents: opts.opponents, offset: gen });
        const incumbentEval = evaluateGenome(opts.create, incumbent, pool);
        matchesRun += pool.length;

        const tried = [];
        for (let c = 0; c < opts.challengers; c += 1) {
            const genome = mutateGenome(opts.def, incumbent, opts.rng);
            const result = evaluateGenome(opts.create, genome, pool);
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

    // Held-out validation: promote only if valid ≥ train − 5pp.
    const validPool = buildPool({ seeds: opts.validSeeds, oppsPerSeed: 1, opponents: opts.opponents });
    const valid = evaluateGenome(opts.create, incumbent, validPool).agg;
    matchesRun += validPool.length;
    return { restart, incumbent, train, valid, promoted: valid.mean >= train.mean - 0.05, history, matchesRun, stoppedEarly };
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
 */
export function regressionVeto(create: CreateFromGenome, champion: Genome, defaults: Genome, poolSeed: Parameters<typeof buildPool>[0]['seeds'], opponents: string[]): VetoResult {
    const pool = buildPool({ seeds: poolSeed, oppsPerSeed: 1, opponents });
    const champ = evaluateGenome(create, champion, pool);
    const base = evaluateGenome(create, defaults, pool);
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
