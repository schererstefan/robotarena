// Runtime validator for procedural pixel maps (no test deps allowed — C11).
// Runs behind ?debugart from ensureArtTextures: rectangular rows, known
// charset, declared dims. Console-only; no UI strings, no per-frame cost.

import { ART_CHARSET, artRegistry } from '../art';
import { FLOOR_A, FLOOR_B, FLOOR_C, FLOOR_D } from './floor';

export interface ArtIssue {
    key: string;
    detail: string;
}

function checkMap(key: string, map: string[], w: number, h: number, charset: Set<string>, issues: ArtIssue[]): void {
    if (map.length !== h) {
        issues.push({ key, detail: `height ${map.length}, declared ${h}` });
    }
    map.forEach((row, y) => {
        if (row.length !== w) {
            issues.push({ key, detail: `row ${y} width ${row.length}, declared ${w}` });
            return;
        }
        for (let x = 0; x < row.length; x += 1) {
            const ch = row[x] as string;
            if (!charset.has(ch)) {
                issues.push({ key, detail: `row ${y} col ${x}: unknown char '${ch}'` });
                return;
            }
        }
    });
}

/** Validate every baked map + the floor composite tiles. Empty = clean. */
export function validateArt(): ArtIssue[] {
    // Built per call (not module top-level): art.ts <-> validate.ts import
    // each other, so nothing here may run at module-eval time.
    const charset = new Set(ART_CHARSET.split(''));
    const issues: ArtIssue[] = [];
    for (const { key, map, w, h } of artRegistry()) checkMap(key, map, w, h, charset, issues);
    // Floor composite source tiles (baked into floor_big, not registered).
    checkMap('floor_a', FLOOR_A, 16, 16, charset, issues);
    checkMap('floor_b', FLOOR_B, 16, 16, charset, issues);
    checkMap('floor_c', FLOOR_C, 16, 16, charset, issues);
    checkMap('floor_d', FLOOR_D, 16, 16, charset, issues);
    return issues;
}
