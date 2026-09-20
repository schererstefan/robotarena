// Stage A: Successive Halving over loadouts at default behavior params.
// N candidates × small pool → keep 1/4 → double the pool → … → survivors.
// Every rung reuses one shared pool (CRN); a Hamming-1 diversity guard keeps
// survivors from collapsing onto near-identical loadouts.

import { GENOME_VERSION, validateGenome, type Genome, type GenomeDef } from '../../src/robots/genome';
import { genomeLoadout } from '../../src/robots/genome';
import { aggregate, better, type Aggregate } from './fitness';
import { buildPool, evaluateGenome, type CreateFromGenome } from './evaluate';
import { loadoutDistance, randomLoadout, type Rand } from './mutate';

export interface Survivor {
    genome: Genome;
    agg: Aggregate;
}

export interface HalvingRung {
    rung: number;
    candidates: number;
    poolSize: number;
    seeds: number;
    topMean: number;
    cutoffMean: number;
    kept: number;
}

export interface HalvingResult {
    survivors: Survivor[];
    rungs: HalvingRung[];
    matchesRun: number;
}

export interface HalvingOptions {
    def: GenomeDef;
    create: CreateFromGenome;
    opponents: string[];
    trainSeeds: number[];
    candidates: number;
    survivors: number;
    rng: Rand;
}

const OPPS_PER_SEED = 2;

/**
 * Greedy diversity select: walk the ranked list, keep a candidate only if
 * its loadout differs in ≥2 catalog entries from every kept loadout. If the
 * guard yields too few, fill from the ranked remainder (guard noted).
 */
export function diversitySelect(ranked: Survivor[], keep: number): { kept: Survivor[]; guardTripped: boolean } {
    const kept: Survivor[] = [];
    let guardTripped = false;
    for (const candidate of ranked) {
        if (kept.length >= keep) break;
        const loadout = genomeLoadout(candidate.genome);
        const tooClose = kept.some((s) => loadoutDistance(loadout, genomeLoadout(s.genome)) < 2);
        if (tooClose) {
            guardTripped = true;
            continue;
        }
        kept.push(candidate);
    }
    for (const candidate of ranked) {
        if (kept.length >= keep) break;
        if (!kept.includes(candidate)) kept.push(candidate);
    }
    return { kept, guardTripped };
}

export function stageA(opts: HalvingOptions): HalvingResult {
    // Default behavior params + random loadout chromosomes.
    const base = validateGenome(opts.def, { genome_version: GENOME_VERSION, bot: opts.def.bot, params: {} });
    let candidates: Genome[] = [];
    for (let i = 0; i < opts.candidates; i += 1) {
        candidates.push(validateGenome(opts.def, { genome_version: GENOME_VERSION, bot: opts.def.bot, params: { ...base.params, loadout: randomLoadout(opts.rng) } }));
    }

    // Rung schedule: 4 seeds, then double until `survivors` remain.
    const rungSeeds: number[] = [];
    for (let seeds = 4, n = opts.candidates; n > opts.survivors; seeds *= 2, n = Math.ceil(n / 4)) {
        rungSeeds.push(Math.min(seeds, opts.trainSeeds.length));
        if (seeds >= opts.trainSeeds.length && n / 4 <= opts.survivors) break;
    }

    const rungs: HalvingRung[] = [];
    let matchesRun = 0;
    let ranked: Survivor[] = [];
    rungSeeds.forEach((seeds, rung) => {
        const pool = buildPool({ seeds: opts.trainSeeds.slice(0, seeds), oppsPerSeed: OPPS_PER_SEED, opponents: opts.opponents });
        ranked = candidates.map((genome) => ({ genome, agg: evaluateGenome(opts.create, genome, pool).agg }));
        matchesRun += candidates.length * pool.length;
        ranked.sort((a, b) => (better(a.agg, b.agg) ? -1 : better(b.agg, a.agg) ? 1 : 0));
        const keep = rung === rungSeeds.length - 1 ? opts.survivors : Math.max(opts.survivors, Math.ceil(candidates.length / 4));
        const { kept } = diversitySelect(ranked, keep);
        rungs.push({
            rung,
            candidates: candidates.length,
            poolSize: pool.length,
            seeds,
            topMean: ranked[0]?.agg.mean ?? 0,
            cutoffMean: kept.length > 0 ? (kept[kept.length - 1] as Survivor).agg.mean : 0,
            kept: kept.length,
        });
        candidates = kept.map((s) => s.genome);
    });

    const survivors = candidates.map((genome) => {
        const found = ranked.find((r) => r.genome === genome);
        return found ?? { genome, agg: aggregate([]) };
    });
    return { survivors, rungs, matchesRun };
}
