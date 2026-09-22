// Phase 1B capture bridge (worktree-only, never merge to main as-is).
//
// Registers embedded MAP-Elites genome JSONs (mapelites-capture.ts,
// generated) as session-only imported robots (custom: ids) for the ?bgshot
// capture harness. Genomes stay genome JSONs — this never touches
// src/robots/registry.ts or the ROBOTS array.

import type { RobotController, RobotMeta } from '../../sim/types';
import { parseGenome } from './serialization';
import { createBTTreeBrain } from './brain';
import { BT_LOADOUT } from './gp';
import { registerCaptureRobot, type ImportedRobot } from '../../game/importRobot';
import { P1_CAPTURE_GENOMES } from './mapelites-capture';

const registered = new Set<string>();

export function p1CaptureId(id: string): string {
    return `custom:p1-${id}`;
}

/**
 * Map lineup ids to battle-ready ids: p1 genome ids become session-only
 * custom: registrations (parsed from their genome JSON); anything else
 * passes through untouched for normal registry resolution.
 */
export function registerP1CaptureLineup(ids: string[]): string[] {
    const out: string[] = [];
    for (const id of ids) {
        const g = P1_CAPTURE_GENOMES.find((x) => x.id === id);
        if (!g) {
            out.push(id);
            continue;
        }
        const cid = p1CaptureId(id);
        if (!registered.has(cid)) {
            const tree = parseGenome(g.genome).tree; // validates the genome
            const meta: RobotMeta = {
                id: cid,
                name: g.name,
                author: 'map-elites-p1',
                version: '1.0.0',
                description: g.blurb,
            };
            const entry: ImportedRobot = {
                meta,
                loadout: { ...BT_LOADOUT },
                create: (): RobotController => {
                    const brain = createBTTreeBrain(tree);
                    return { meta, update: (sense) => brain.update(sense).intent };
                },
            };
            registerCaptureRobot(cid, entry);
            registered.add(cid);
        }
        out.push(cid);
    }
    return out;
}
