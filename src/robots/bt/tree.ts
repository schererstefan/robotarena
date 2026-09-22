// Behavior-tree substrate for evolved robot minds (N1 spike).
//
// A mind is plain data: JSON-serializable, printable, diffable. tickTree
// interprets one tick — conditions read the blackboard, actions write into
// an IntentBuilder. No Math.random / Date.now anywhere: the only
// nondeterminism source is the single per-tick draw cached on the
// blackboard, which comes from the match's seeded stream.

import type { Blackboard } from './blackboard';
import { ACTIONS, CONDITIONS, LATCH_NAMES } from './primitives';
import type { IntentBuilder } from './primitives';

export type BTStatus = 'success' | 'failure';

export type BTNode =
    | { kind: 'selector'; children: BTNode[] }
    | { kind: 'sequence'; children: BTNode[] }
    | { kind: 'inverter'; child: BTNode }
    | { kind: 'latch'; key: number; ttl: number; child: BTNode }
    | { kind: 'condition'; name: string; params: number[] }
    | { kind: 'action'; name: string; params: number[] };

/** One tick of the tree: evaluate top-down, actions accumulate intent. */
export function tickTree(node: BTNode, bb: Blackboard, out: IntentBuilder): BTStatus {
    switch (node.kind) {
        case 'selector': {
            for (const c of node.children) {
                if (tickTree(c, bb, out) === 'success') return 'success';
            }
            return 'failure';
        }
        case 'sequence': {
            for (const c of node.children) {
                if (tickTree(c, bb, out) === 'failure') return 'failure';
            }
            return 'success';
        }
        case 'inverter':
            return tickTree(node.child, bb, out) === 'success' ? 'failure' : 'success';
        case 'latch': {
            // Episodic memory: once the child succeeds, the latch reports
            // success for ttl ticks without re-running the child. This is
            // how a tree remembers "I was hit" (revenge) or "I am hurt"
            // (bloodied) across ticks.
            const name = LATCH_NAMES[node.key] ?? `latch${node.key}`;
            const setAt = bb.latches.get(name);
            if (setAt !== undefined && bb.tick - setAt < node.ttl) return 'success';
            const s = tickTree(node.child, bb, out);
            if (s === 'success') bb.latches.set(name, bb.tick);
            return s;
        }
        case 'condition': {
            const cond = CONDITIONS[node.name];
            if (!cond) return 'failure';
            return cond.test(bb, node.params) ? 'success' : 'failure';
        }
        case 'action': {
            const act = ACTIONS[node.name];
            if (!act) return 'failure';
            return act.run(bb, out, node.params);
        }
    }
}

export function cloneTree(node: BTNode): BTNode {
    switch (node.kind) {
        case 'selector':
        case 'sequence':
            return { kind: node.kind, children: node.children.map(cloneTree) };
        case 'inverter':
            return { kind: 'inverter', child: cloneTree(node.child) };
        case 'latch':
            return { kind: 'latch', key: node.key, ttl: node.ttl, child: cloneTree(node.child) };
        case 'condition':
            return { kind: 'condition', name: node.name, params: [...node.params] };
        case 'action':
            return { kind: 'action', name: node.name, params: [...node.params] };
    }
}

export function treeSize(node: BTNode): number {
    switch (node.kind) {
        case 'selector':
        case 'sequence':
            return 1 + node.children.reduce((n, c) => n + treeSize(c), 0);
        case 'inverter':
        case 'latch':
            return 1 + treeSize(node.child);
        case 'condition':
        case 'action':
            return 1;
    }
}

function childrenOf(node: BTNode): BTNode[] {
    switch (node.kind) {
        case 'selector':
        case 'sequence':
            return node.children;
        case 'inverter':
        case 'latch':
            return [node.child];
        case 'condition':
        case 'action':
            return [];
    }
}

function describeNode(node: BTNode): string {
    switch (node.kind) {
        case 'selector':
            return `Selector (${node.children.length})`;
        case 'sequence':
            return `Sequence (${node.children.length})`;
        case 'inverter':
            return 'Inverter';
        case 'latch': {
            const name = LATCH_NAMES[node.key] ?? `latch${node.key}`;
            return `Latch '${name}' ttl=${node.ttl}`;
        }
        case 'condition': {
            const cond = CONDITIONS[node.name];
            return cond ? `IF ${cond.desc(node.params)}` : `IF ??${node.name}??`;
        }
        case 'action': {
            const act = ACTIONS[node.name];
            return act ? `DO ${act.desc(node.params)}` : `DO ??${node.name}??`;
        }
    }
}

/** Human-readable print: "read a champion's mind". */
export function printTree(node: BTNode): string {
    const lines: string[] = [];
    const walk = (n: BTNode, prefix: string, isLast: boolean, isRoot: boolean): void => {
        const branch = isRoot ? '' : isLast ? '└─ ' : '├─ ';
        lines.push(`${prefix}${branch}${describeNode(n)}`);
        const childPrefix = isRoot ? '' : `${prefix}${isLast ? '   ' : '│  '}`;
        const kids = childrenOf(n);
        kids.forEach((k, i) => walk(k, childPrefix, i === kids.length - 1, false));
    };
    walk(node, '', true, true);
    return lines.join('\n');
}

/** Static analysis: can this subtree never fail? (actions always succeed) */
function guaranteedSuccess(n: BTNode): boolean {
    switch (n.kind) {
        case 'action':
            return true;
        case 'condition':
            return false;
        case 'inverter':
            return guaranteedFail(n.child);
        case 'latch':
            return guaranteedSuccess(n.child);
        case 'selector':
            return n.children.some(guaranteedSuccess);
        case 'sequence':
            return n.children.every(guaranteedSuccess);
    }
}

/** Static analysis: can this subtree never succeed? */
function guaranteedFail(n: BTNode): boolean {
    switch (n.kind) {
        case 'action':
            return false;
        case 'condition':
            return false;
        case 'inverter':
            return guaranteedSuccess(n.child);
        case 'latch':
            return guaranteedFail(n.child);
        case 'selector':
            return n.children.every(guaranteedFail);
        case 'sequence':
            return n.children.some(guaranteedFail);
    }
}

/**
 * Remove provably unreachable subtrees. In a selector, everything after the
 * first child that always succeeds can never run (the selector returns at
 * it); in a sequence, everything after the first child that always fails can
 * never run. Semantics-preserving: the pruned tree ticks identically.
 * Applied to champions before printing/registering, so the printed tree is
 * the tree that actually runs — no dead branches to misread.
 */
export function pruneUnreachable(node: BTNode): BTNode {
    switch (node.kind) {
        case 'selector': {
            const children: BTNode[] = [];
            for (const c of node.children) {
                const pc = pruneUnreachable(c);
                children.push(pc);
                if (guaranteedSuccess(pc)) break;
            }
            return { kind: 'selector', children };
        }
        case 'sequence': {
            const children: BTNode[] = [];
            for (const c of node.children) {
                const pc = pruneUnreachable(c);
                children.push(pc);
                if (guaranteedFail(pc)) break;
            }
            return { kind: 'sequence', children };
        }
        case 'inverter':
            return { kind: 'inverter', child: pruneUnreachable(node.child) };
        case 'latch':
            return { kind: 'latch', key: node.key, ttl: node.ttl, child: pruneUnreachable(node.child) };
        default:
            return cloneTree(node);
    }
}
