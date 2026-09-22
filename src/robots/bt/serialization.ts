// Genome JSON for behavior trees: the interchange format for N1 experiments.
//
// A genome is plain JSON: { schema, kind, tree, provenance, fitness? }.
// Genome files live under src/robots/bt/genomes/ and are experiment
// artifacts — they are NEVER registry entries (no in-game registration,
// no manifest changes). The MAP-Elites discovery worker consumes and
// produces these files; run-evolve.ts prints them for new GP runs.
//
// Determinism note: provenance carries run id, algorithm, seed, and
// generation — everything needed to reproduce the tree. Wall-clock time is
// deliberately excluded (Date.now is banned in this substrate), so
// re-serializing the same tree with the same provenance is byte-identical.

import { validateTree, type BTNode } from './tree';

/** Genome schema version. Bump when the on-disk format changes. */
export const TREE_GENOME_SCHEMA = 1;
/** Discriminator so a genome file is never mistaken for a bare tree. */
export const TREE_GENOME_KIND = 'robotarena-bt-genome';

export type TreeGenomeAlgorithm = 'gp' | 'map-elites' | 'hand' | 'hillclimb';

export interface TreeProvenance {
    /** Experiment run id, e.g. 'n1-run3', 'map-elites-2026-09-22'. */
    runId: string;
    algorithm: TreeGenomeAlgorithm;
    /** The seed that reproduces this tree (GP seed / MAP-Elites seed). */
    seed: number;
    /** Generation (or archive iteration) that produced it; 0 for hand-built. */
    generation: number;
    opponents?: string[];
    arenas?: string[];
    notes?: string;
}

export interface TreeFitnessSummary {
    score: number;
    wins: number;
    novelty01: number;
    kills: number;
    damage: number;
    nodes: number;
    behav?: number[];
}

export interface TreeGenome {
    schema: typeof TREE_GENOME_SCHEMA;
    kind: typeof TREE_GENOME_KIND;
    tree: BTNode;
    provenance: TreeProvenance;
    fitness?: TreeFitnessSummary;
}

const ALGORITHMS: readonly string[] = ['gp', 'map-elites', 'hand', 'hillclimb'];

function checkProvenance(p: unknown): TreeProvenance {
    if (p === null || typeof p !== 'object') throw new Error('genome: provenance is not an object');
    const o = p as Record<string, unknown>;
    if (typeof o['runId'] !== 'string' || o['runId'].length === 0) throw new Error('genome: provenance.runId must be a non-empty string');
    if (typeof o['algorithm'] !== 'string' || !ALGORITHMS.includes(o['algorithm'])) {
        throw new Error(`genome: provenance.algorithm must be one of ${ALGORITHMS.join(', ')}`);
    }
    if (typeof o['seed'] !== 'number' || !Number.isFinite(o['seed'])) throw new Error('genome: provenance.seed must be a finite number');
    if (!Number.isInteger(o['generation']) || (o['generation'] as number) < 0) {
        throw new Error('genome: provenance.generation must be a non-negative integer');
    }
    for (const k of ['opponents', 'arenas'] as const) {
        const v = o[k];
        if (v !== undefined && (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))) {
            throw new Error(`genome: provenance.${k} must be an array of strings`);
        }
    }
    if (o['notes'] !== undefined && typeof o['notes'] !== 'string') throw new Error('genome: provenance.notes must be a string');
    const out: TreeProvenance = {
        runId: o['runId'] as string,
        algorithm: o['algorithm'] as TreeGenomeAlgorithm,
        seed: o['seed'] as number,
        generation: o['generation'] as number,
    };
    if (o['opponents'] !== undefined) out.opponents = o['opponents'] as string[];
    if (o['arenas'] !== undefined) out.arenas = o['arenas'] as string[];
    if (o['notes'] !== undefined) out.notes = o['notes'] as string;
    return out;
}

function checkFitness(f: unknown): TreeFitnessSummary {
    if (f === null || typeof f !== 'object') throw new Error('genome: fitness is not an object');
    const o = f as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of ['score', 'wins', 'novelty01', 'kills', 'damage', 'nodes'] as const) {
        const v = o[k];
        if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`genome: fitness.${k} must be a finite number`);
        out[k] = v;
    }
    if (o['behav'] !== undefined) {
        if (!Array.isArray(o['behav']) || o['behav'].some((x) => typeof x !== 'number' || !Number.isFinite(x))) {
            throw new Error('genome: fitness.behav must be an array of finite numbers');
        }
        out['behav'] = o['behav'] as number[];
    }
    return out as unknown as TreeFitnessSummary;
}

/** Build a genome object from a tree plus its provenance (no I/O). */
export function makeGenome(tree: BTNode, provenance: TreeProvenance, fitness?: TreeFitnessSummary): TreeGenome {
    // Fail fast: a genome must never carry a dirty tree.
    const errors = validateTree(tree);
    if (errors.length > 0) throw new Error(`genome: tree failed validation:\n- ${errors.join('\n- ')}`);
    const genome: TreeGenome = {
        schema: TREE_GENOME_SCHEMA,
        kind: TREE_GENOME_KIND,
        tree,
        provenance: checkProvenance(provenance),
    };
    if (fitness !== undefined) genome.fitness = checkFitness(fitness);
    return genome;
}

/**
 * Serialize a genome to canonical JSON (2-space indent, fixed key order).
 * Same tree + same provenance => byte-identical output, always.
 */
export function toGenomeJSON(genome: TreeGenome): string {
    // Re-validate on the way out: a genome file must never carry a dirty tree.
    const errors = validateTree(genome.tree);
    if (errors.length > 0) throw new Error(`genome: tree failed validation:\n- ${errors.join('\n- ')}`);
    return JSON.stringify(
        {
            schema: TREE_GENOME_SCHEMA,
            kind: TREE_GENOME_KIND,
            tree: genome.tree,
            provenance: genome.provenance,
            ...(genome.fitness !== undefined ? { fitness: genome.fitness } : {}),
        },
        null,
        2,
    );
}

/** Convenience: tree + provenance (+ optional fitness) straight to JSON. */
export function treeToGenomeJSON(tree: BTNode, provenance: TreeProvenance, fitness?: TreeFitnessSummary): string {
    return toGenomeJSON(makeGenome(tree, provenance, fitness));
}

/**
 * Parse and fully validate a genome (from a JSON string or an already-
 * parsed value). Throws a descriptive Error on anything malformed:
 * bad JSON, wrong schema/kind, dirty tree, or bad provenance/fitness.
 */
export function parseGenome(input: string | unknown): TreeGenome {
    let raw: unknown = input;
    if (typeof input === 'string') {
        try {
            raw = JSON.parse(input);
        } catch {
            throw new Error('genome: input is not valid JSON');
        }
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('genome: top level must be an object');
    }
    const o = raw as Record<string, unknown>;
    if (o['schema'] !== TREE_GENOME_SCHEMA) {
        throw new Error(`genome: unsupported schema ${String(o['schema'])} (expected ${TREE_GENOME_SCHEMA})`);
    }
    if (o['kind'] !== TREE_GENOME_KIND) {
        throw new Error(`genome: wrong kind '${String(o['kind'])}' (expected '${TREE_GENOME_KIND}')`);
    }
    const tree = o['tree'] as BTNode;
    const errors = validateTree(tree);
    if (errors.length > 0) throw new Error(`genome: tree failed validation:\n- ${errors.join('\n- ')}`);
    const provenance = checkProvenance(o['provenance']);
    const genome: TreeGenome = { schema: TREE_GENOME_SCHEMA, kind: TREE_GENOME_KIND, tree, provenance };
    if (o['fitness'] !== undefined) genome.fitness = checkFitness(o['fitness']);
    return genome;
}

/** Parse a genome and return its tree (validated). */
export function genomeTree(input: string | unknown): BTNode {
    return parseGenome(input).tree;
}
