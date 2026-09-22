// Behavior-tree brain: plugs any BTNode mind into the Brain seam
// (update(sense: SenseState) -> { mode, intent, targetId }).
//
// Deliberately NOT imported from '../brain': the tree is a standalone
// architecture with its own mode vocabulary; the structural types below
// are assignment-compatible with the seam by shape.

import type { Intent, SenseState } from '../../sim/types';
import { buildBlackboard } from './blackboard';
import { IntentBuilder } from './primitives';
import { tickTree, type BTNode } from './tree';

export type BTBrainMode = 'engage' | 'retreat' | 'kite' | 'flank' | 'focus' | 'roam';

const MODES: readonly BTBrainMode[] = ['engage', 'retreat', 'kite', 'flank', 'focus', 'roam'];

export interface BTBrainOutput {
    mode: BTBrainMode;
    intent: Intent;
    /** The foe id the tree is working, if any. */
    targetId: number | null;
}

export interface BTBrain {
    readonly mode: BTBrainMode;
    update(sense: SenseState): BTBrainOutput;
}

export interface TreeTick {
    intent: Intent;
    modeHint: BTBrainMode;
    targetId: number | null;
}

/** Run one tree tick with caller-owned latch memory (for headless use). */
export function runTree(tree: BTNode, sense: SenseState, latches: Map<string, number>): TreeTick {
    const bb = buildBlackboard(sense, latches);
    const out = new IntentBuilder();
    tickTree(tree, bb, out);
    const hint = out.modeHint;
    const mode: BTBrainMode = (MODES as readonly string[]).includes(hint) ? (hint as BTBrainMode) : 'engage';
    return { intent: out.build(), modeHint: mode, targetId: bb.foe ? bb.foe.id : null };
}

/** Fresh per-match brain: latch memory lives in the closure. */
export function createBTTreeBrain(tree: BTNode): BTBrain {
    const latches = new Map<string, number>();
    let current: BTBrainMode = 'roam';
    function update(sense: SenseState): BTBrainOutput {
        const ticked = runTree(tree, sense, latches);
        current = ticked.modeHint;
        return { mode: current, intent: ticked.intent, targetId: ticked.targetId };
    }
    return {
        get mode(): BTBrainMode {
            return current;
        },
        update,
    };
}
