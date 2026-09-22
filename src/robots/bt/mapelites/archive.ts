// MAP-Elites behavior archive (Phase 1, part B).
//
// The grid: 4 axes x 3 bins = 81 cells. Each cell keeps one elite.
// Elites are stored as schema-versioned genome JSONs (toGenomeJSON /
// parseGenome from ../serialization) with full provenance — never as
// registry entries. Insertion is deterministic: higher fitness wins,
// ties broken by fewer nodes, then lower tag.

import { parseGenome, treeToGenomeJSON, type TreeFitnessSummary, type TreeProvenance } from '../serialization';
import { treeSize, type BTNode } from '../tree';
import { compareFitness, type BehaviorProfile, type Fitness } from './eval';

export type CellCoord = [number, number, number, number];

export interface ArchiveCellJSON {
    cell: CellCoord;
    id: string;
    /** Schema-versioned genome JSON (canonical, byte-stable for same tree+provenance). */
    genome: string;
    nodes: number;
    fit: Fitness;
    profile: BehaviorProfile;
    descr: number[];
    provenance: TreeProvenance;
}

export interface ArchiveJSON {
    version: 1;
    config: Record<string, number | string>;
    cells: ArchiveCellJSON[];
}

export function cellKey(cell: CellCoord): string {
    return cell.join('');
}

/** Parse the elite's tree out of its stored genome JSON. */
export function eliteTree(cell: { genome: string }): BTNode {
    return parseGenome(cell.genome).tree;
}

/** Provenance stamped on every MAP-Elites genome. */
export function meProvenance(
    runId: string,
    seed: number,
    generation: number,
    opponents: string[],
    arenas: string[],
): TreeProvenance {
    return { runId, algorithm: 'map-elites', seed, generation, opponents, arenas };
}

export function fitnessSummary(fit: Fitness, nodes: number, descr: number[]): TreeFitnessSummary {
    return {
        score: fit.score,
        wins: fit.wins,
        novelty01: fit.novelty01,
        kills: fit.kills,
        damage: fit.damage,
        nodes,
        behav: descr,
    };
}

export class BehaviorArchive {
    private cells = new Map<string, ArchiveCellJSON>();
    insertions = 0;
    replacements = 0;
    rejections = 0;

    size(): number {
        return this.cells.size;
    }

    coordinates(): CellCoord[] {
        return [...this.cells.values()].map((c) => c.cell);
    }

    get(cell: CellCoord): ArchiveCellJSON | undefined {
        return this.cells.get(cellKey(cell));
    }

    elites(): ArchiveCellJSON[] {
        return [...this.cells.values()].sort((a, b) => a.id.localeCompare(b.id));
    }

    /** Descriptors of all current elites, canonical id order (novelty source). */
    descriptors(): number[][] {
        return this.elites().map((e) => e.descr);
    }

    /**
     * Attempt to insert a candidate tree. The genome JSON is built here so
     * the archive only ever holds validated, schema-versioned genomes.
     * Returns 'inserted' | 'replaced' | 'rejected'.
     */
    tryInsert(
        id: string,
        tree: BTNode,
        cell: CellCoord,
        descr: number[],
        fit: Fitness,
        profile: BehaviorProfile,
        provenance: TreeProvenance,
    ): 'inserted' | 'replaced' | 'rejected' {
        const key = cellKey(cell);
        const nodes = treeSize(tree);
        const fitWithNodes: Fitness = { ...fit, nodes };
        const existing = this.cells.get(key);
        if (existing) {
            const cmp = compareFitness(fitWithNodes, existing.fit);
            if (cmp >= 0) {
                this.rejections += 1;
                return 'rejected';
            }
        }
        let genome: string;
        try {
            genome = treeToGenomeJSON(tree, provenance, fitnessSummary(fit, nodes, descr));
        } catch {
            // Dirty tree (failed validation): fail closed, treat as rejected.
            this.rejections += 1;
            return 'rejected';
        }
        const record: ArchiveCellJSON = { cell, id, genome, nodes, fit: fitWithNodes, profile, descr, provenance };
        if (existing) {
            this.replacements += 1;
            this.cells.set(key, record);
            return 'replaced';
        }
        this.insertions += 1;
        this.cells.set(key, record);
        return 'inserted';
    }

    toJSON(config: Record<string, number | string>): ArchiveJSON {
        const cells = [...this.cells.values()].sort((a, b) => cellKey(a.cell).localeCompare(cellKey(b.cell)));
        return { version: 1, config, cells };
    }

    static fromJSON(json: ArchiveJSON): BehaviorArchive {
        const a = new BehaviorArchive();
        for (const c of json.cells) {
            // Validate every genome on load: fail fast on corrupt archives.
            parseGenome(c.genome);
            a.cells.set(cellKey(c.cell), c);
        }
        return a;
    }
}
