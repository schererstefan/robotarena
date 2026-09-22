// Behavior-tree substrate for evolved robot minds (N1).
//
// A mind is plain data: JSON-serializable (see serialization.ts), printable,
// diffable. tickTree interprets one tick — conditions read the blackboard,
// actions write into an IntentBuilder. No Math.random / Date.now anywhere:
// the only nondeterminism source is the single per-tick draw cached on the
// blackboard, which comes from the match's seeded stream.
//
// NODE SEMANTICS (depth-first, left-to-right):
// - selector: tick children in order; the first 'success' wins and the
//   selector returns 'success'. Returns 'failure' only when every child
//   fails. An empty selector returns 'failure'.
// - sequence: tick children in order; the first 'failure' aborts and the
//   sequence returns 'failure'. Returns 'success' only when every child
//   succeeds. An empty sequence returns 'success'.
// - inverter: flips the child's status (success <-> failure).
// - latch(key, ttl, child): episodic memory. The first tick the child
//   succeeds, the latch records the tick; for the following ttl ticks it
//   returns 'success' WITHOUT running the child again — latched actions do
//   not re-fire while the latch holds. After ttl ticks the child runs
//   again. This is how a tree remembers "I was hit" (revenge) or "I am
//   hurt" (bloodied) across ticks.
// - condition(name, params): CONDITIONS[name].test(bb, params). An unknown
//   name fails closed ('failure'); it never throws mid-tick.
// - action(name, params): ACTIONS[name].run(bb, out, params), which writes
//   intent channels and returns a status. An unknown name fails closed.
//
// ROBUSTNESS CONTRACT:
// - tickTree enforces MAX_TREE_DEPTH and a per-tick node budget
//   (MAX_TICK_NODES); anything past either fails closed for that tick.
//   Both guards are enforced iteratively-safe: the recursion never
//   descends past the depth cap, so even a corrupt deep tree cannot
//   overflow the call stack.
// - validateTree() is the gatekeeper: unknown node kinds, unknown
//   condition/action names, wrong param counts, params outside their
//   ParamSpec range, latch keys outside LATCH_NAMES, non-positive or
//   non-finite ttls, and depth beyond MAX_TREE_DEPTH are all reported.
//   fromJSON (see serialization.ts) rejects anything validateTree flags.
// - pruneUnreachable() and simplifyTree() are semantics-preserving for
//   validateTree-clean trees. The static analysis is conservative for
//   unknown primitive names (they analyze as "can fail, can succeed",
//   matching their fail-closed tick behavior), but validation must still
//   run first: fromJSON rejects anything validateTree flags, and the GP
//   only ever generates clean trees.

import type { Blackboard } from './blackboard';
import { ACTIONS, CONDITIONS, LATCH_NAMES } from './primitives';
import type { IntentBuilder, ParamSpec } from './primitives';

export type BTStatus = 'success' | 'failure';

export type BTNode =
    | { kind: 'selector'; children: BTNode[] }
    | { kind: 'sequence'; children: BTNode[] }
    | { kind: 'inverter'; child: BTNode }
    | { kind: 'latch'; key: number; ttl: number; child: BTNode }
    | { kind: 'condition'; name: string; params: number[] }
    | { kind: 'action'; name: string; params: number[] };

/**
 * Hard cap on tree depth. validateTree rejects deeper trees; tickTree
 * fails closed past it (the recursion never descends further, so a
 * corrupt deep tree cannot overflow the call stack).
 */
export const MAX_TREE_DEPTH = 24;
/** Per-tick cap on node visits: a tick that exceeds it fails closed. */
export const MAX_TICK_NODES = 4096;
/** Sanity cap on total nodes (catches corrupt/degenerate JSON). */
export const MAX_TREE_NODES = 100000;

interface TickCtx {
    visits: number;
    depth: number;
}

function tickInner(node: BTNode, bb: Blackboard, out: IntentBuilder, ctx: TickCtx): BTStatus {
    ctx.depth += 1;
    ctx.visits += 1;
    const over = ctx.depth > MAX_TREE_DEPTH || ctx.visits > MAX_TICK_NODES;
    let s: BTStatus = 'failure';
    if (!over) {
        switch (node.kind) {
            case 'selector': {
                for (const c of node.children) {
                    if (tickInner(c, bb, out, ctx) === 'success') {
                        s = 'success';
                        break;
                    }
                }
                break;
            }
            case 'sequence': {
                s = 'success';
                for (const c of node.children) {
                    if (tickInner(c, bb, out, ctx) === 'failure') {
                        s = 'failure';
                        break;
                    }
                }
                break;
            }
            case 'inverter':
                s = tickInner(node.child, bb, out, ctx) === 'success' ? 'failure' : 'success';
                break;
            case 'latch': {
                // Episodic memory: once the child succeeds, the latch reports
                // success for ttl ticks without re-running the child. This is
                // how a tree remembers "I was hit" (revenge) or "I am hurt"
                // (bloodied) across ticks.
                const name = LATCH_NAMES[node.key] ?? `latch${node.key}`;
                const setAt = bb.latches.get(name);
                if (setAt !== undefined && bb.tick - setAt < node.ttl) {
                    s = 'success';
                } else {
                    const cs = tickInner(node.child, bb, out, ctx);
                    if (cs === 'success') bb.latches.set(name, bb.tick);
                    s = cs;
                }
                break;
            }
            case 'condition': {
                const cond = CONDITIONS[node.name];
                if (cond && cond.test(bb, node.params)) s = 'success';
                break;
            }
            case 'action': {
                const act = ACTIONS[node.name];
                if (act) s = act.run(bb, out, node.params);
                break;
            }
            default:
                s = 'failure';
        }
    }
    ctx.depth -= 1;
    return s;
}

/** One tick of the tree: evaluate top-down, actions accumulate intent. */
export function tickTree(node: BTNode, bb: Blackboard, out: IntentBuilder): BTStatus {
    return tickInner(node, bb, out, { visits: 0, depth: 0 });
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

/** Depth of the tree: a lone terminal has depth 1. */
export function treeDepth(node: BTNode): number {
    switch (node.kind) {
        case 'selector':
        case 'sequence':
            return 1 + node.children.reduce((d, c) => Math.max(d, treeDepth(c)), 0);
        case 'inverter':
        case 'latch':
            return 1 + treeDepth(node.child);
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

/** Static analysis: can this subtree never fail? */
function guaranteedSuccess(n: BTNode): boolean {
    switch (n.kind) {
        case 'action': {
            // Most actions CAN fail (no foe, cooldowns, no pads...). Only
            // primitives flagged alwaysSucceeds are provably infallible.
            // Unknown names fail closed at tick time, so they analyze
            // as not-guaranteed (conservative).
            const act = ACTIONS[n.name];
            return act?.alwaysSucceeds ?? false;
        }
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
 * never run. Semantics-preserving for validateTree-clean trees: the pruned
 * tree ticks identically. Applied to champions before printing/registering,
 * so the printed tree is the tree that actually runs — no dead branches to
 * misread.
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

/**
 * Remove structural redundancy without changing tick semantics (for
 * validateTree-clean trees): single-child composites collapse to the child,
 * double inverters cancel, empty composites normalize to their canonical
 * constant (empty selector always fails, empty sequence always succeeds).
 */
export function collapseRedundant(node: BTNode): BTNode {
    switch (node.kind) {
        case 'selector':
        case 'sequence': {
            const kids = node.children.map(collapseRedundant);
            if (kids.length === 1) return kids[0] as BTNode;
            if (kids.length === 0) {
                return node.kind === 'selector'
                    ? { kind: 'inverter', child: { kind: 'condition', name: 'always', params: [] } }
                    : { kind: 'condition', name: 'always', params: [] };
            }
            return { kind: node.kind, children: kids };
        }
        case 'inverter': {
            const c = collapseRedundant(node.child);
            // Double negation cancels: inverter(inverter(x)) === x.
            if (c.kind === 'inverter') return c.child;
            return { kind: 'inverter', child: c };
        }
        case 'latch':
            return { kind: 'latch', key: node.key, ttl: node.ttl, child: collapseRedundant(node.child) };
        default:
            return cloneTree(node);
    }
}

/**
 * The GP bloat pass (scoped in Phase 0): dead-code elimination plus
 * structural collapse, iterated to a fixpoint. Both passes only shrink the
 * tree and are semantics-preserving for validateTree-clean trees, so this
 * is safe to apply to every offspring before evaluation — it keeps the
 * parsimony tiebreak honest (fitness nodes count the tree that runs) and
 * keeps printed champions legible.
 */
export function simplifyTree(node: BTNode): BTNode {
    let cur = pruneUnreachable(node);
    for (let i = 0; i < 16; i += 1) {
        const next = collapseRedundant(pruneUnreachable(cur));
        if (treeSize(next) >= treeSize(cur)) return cur;
        cur = next;
    }
    return cur;
}

function checkParams(
    path: string,
    kind: string,
    name: string,
    params: unknown,
    specs: ParamSpec[],
    errors: string[],
): void {
    if (!Array.isArray(params)) {
        errors.push(`${path}: '${name}' ${kind} params is not an array`);
        return;
    }
    if (params.length !== specs.length) {
        errors.push(`${path}: '${name}' ${kind} expects ${specs.length} params, got ${params.length}`);
        return;
    }
    params.forEach((p: unknown, i) => {
        const s = specs[i] as ParamSpec | undefined;
        if (!s) return;
        if (typeof p !== 'number' || !Number.isFinite(p)) {
            errors.push(`${path}: '${name}' param ${i} is not a finite number`);
            return;
        }
        if (p < s.min - 1e-9 || p > s.max + 1e-9) {
            errors.push(`${path}: '${name}' param ${i}=${p} outside [${s.min}, ${s.max}]`);
        }
    });
}

/**
 * Structural validation: returns a list of human-readable errors, empty
 * when the tree is clean. Checks unknown node kinds, unknown
 * condition/action names, param counts and ranges against each primitive's
 * ParamSpec, latch key/ttl ranges, total node count, and MAX_TREE_DEPTH.
 * The walk never descends past the depth cap, so corrupt deep JSON cannot
 * overflow the call stack here either.
 */
export function validateTree(node: BTNode): string[] {
    const errors: string[] = [];
    let count = 0;
    let halted = false;
    const walk = (n: BTNode, depth: number, path: string): void => {
        if (halted) return;
        count += 1;
        if (count > MAX_TREE_NODES) {
            errors.push(`root: more than ${MAX_TREE_NODES} nodes (corrupt or degenerate tree)`);
            halted = true;
            return;
        }
        if (depth > MAX_TREE_DEPTH) {
            errors.push(`${path}: depth ${depth} exceeds MAX_TREE_DEPTH (${MAX_TREE_DEPTH})`);
            return;
        }
        if (n === null || typeof n !== 'object') {
            errors.push(`${path}: node is not an object`);
            return;
        }
        const kind: unknown = (n as { kind?: unknown }).kind;
        if (kind === 'selector' || kind === 'sequence') {
            const children: unknown = (n as { children?: unknown }).children;
            if (!Array.isArray(children)) {
                errors.push(`${path}: '${kind}' children is not an array`);
                return;
            }
            children.forEach((c, i) => walk(c as BTNode, depth + 1, `${path}/${kind}[${i}]`));
            return;
        }
        if (kind === 'inverter' || kind === 'latch') {
            if (kind === 'latch') {
                const key: unknown = (n as { key?: unknown }).key;
                const ttl: unknown = (n as { ttl?: unknown }).ttl;
                if (!Number.isInteger(key) || (key as number) < 0 || (key as number) >= LATCH_NAMES.length) {
                    errors.push(`${path}: latch key ${String(key)} outside [0, ${LATCH_NAMES.length})`);
                }
                if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 0 || ttl > 1e6) {
                    errors.push(`${path}: latch ttl ${String(ttl)} not in (0, 1000000]`);
                }
            }
            const child: unknown = (n as { child?: unknown }).child;
            if (child === undefined || child === null) {
                errors.push(`${path}: '${kind}' is missing its child`);
                return;
            }
            walk(child as BTNode, depth + 1, `${path}/${kind}`);
            return;
        }
        if (kind === 'condition' || kind === 'action') {
            const name: unknown = (n as { name?: unknown }).name;
            const params: unknown = (n as { params?: unknown }).params;
            const table = kind === 'condition' ? CONDITIONS : ACTIONS;
            const def = typeof name === 'string' ? table[name] : undefined;
            if (!def) {
                errors.push(`${path}: unknown ${kind} '${String(name)}'`);
                return;
            }
            checkParams(path, kind, name as string, params, def.params, errors);
            return;
        }
        errors.push(`${path}: unknown node kind '${String(kind)}'`);
    };
    walk(node, 0, 'root');
    return errors;
}
