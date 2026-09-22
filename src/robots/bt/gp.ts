// Genetic programming over behavior trees (N1 spike).
//
// Seeded end to end: population init, crossover, mutation, and selection
// all draw from one mulberry32 stream (src/sim/rng); every match runs on
// an explicit seed. No Math.random / Date.now anywhere.
//
// Selection is lexicographic on (score, kills, damage, -nodes) where
//   score = wins + NOVELTY_WEIGHT * novelty01
// novelty01 is the mean behavior-space distance to the 5 nearest archive
// entries (behavior recorded during the fitness matches — no extra games).
// The novelty term is the N7 minimal-criterion idea at spike scale: it
// trades a little win-rate for behavioral distinctness, because this
// spike's success criterion is a new kind of mind on screen, not Elo.
// A hard minimal criterion (MIN_DRIVE_ACTIVITY) makes stationary turrets
// ineligible, so the search cannot re-discover stand-still-and-shoot.
// The trailing -nodes tiebreak is the parsimony pressure against bloat.

import { Match } from '../../sim/engine';
import { createRng, type Rand } from '../../sim/rng';
import type { ArenaId } from '../../sim/constants';
import type { RobotController, SenseState } from '../../sim/types';
import type { SkillLoadout } from '../../sim/skills';
import { ACTIONS, CONDITIONS, LATCH_NAMES, type ParamSpec } from './primitives';
import { cloneTree, printTree, treeSize, type BTNode } from './tree';
import { createBTTreeBrain } from './brain';

export const BT_LOADOUT: SkillLoadout = { charger: 2, trigger: 2, plating: 2 };

/** Win-equivalents granted to a maximally novel behavior. */
export const NOVELTY_WEIGHT = 3.0;
/** Minimal criterion (N7): fraction of ticks the bot must actively drive. */
export const MIN_DRIVE_ACTIVITY = 0.15;
/** Novelty neighbors. */
const NOVELTY_K = 5;
/** Raw behavior distance that maps to novelty01 = 1. */
const NOVELTY_SCALE = 1.2;

export interface Competitor {
    id: string;
    create: () => RobotController;
    loadout: SkillLoadout;
}

export interface Fitness {
    /** wins + NOVELTY_WEIGHT * novelty01: the selection objective. */
    score: number;
    wins: number;
    novelty01: number;
    kills: number;
    damage: number;
    nodes: number;
}

/** Negative when a is better (for sort), 0 on full tie. */
export function compareFitness(a: Fitness, b: Fitness): number {
    if (a.score !== b.score) return b.score - a.score;
    if (a.kills !== b.kills) return b.kills - a.kills;
    if (a.damage !== b.damage) return a.damage > b.damage ? 1 : -1;
    return a.nodes - b.nodes;
}

const COND_NAMES = Object.keys(CONDITIONS);
const ACT_NAMES = Object.keys(ACTIONS);

// ---- random generation -------------------------------------------------

function randParams(specs: ParamSpec[], r: Rand): number[] {
    return specs.map((s) => {
        const steps = Math.max(1, Math.round((s.max - s.min) / s.step));
        return s.min + Math.floor(r() * (steps + 1)) * s.step;
    });
}

function randomTerminal(r: Rand): BTNode {
    if (r() < 0.5) {
        const name = COND_NAMES[Math.floor(r() * COND_NAMES.length)] ?? 'always';
        return { kind: 'condition', name, params: randParams(CONDITIONS[name]?.params ?? [], r) };
    }
    const name = ACT_NAMES[Math.floor(r() * ACT_NAMES.length)] ?? 'scan';
    return { kind: 'action', name, params: randParams(ACTIONS[name]?.params ?? [], r) };
}

/** Ramped half-and-half style: 'full' forces composites until maxDepth. */
export function randomTree(r: Rand, maxDepth: number, method: 'grow' | 'full', depth = 0): BTNode {
    if (depth >= maxDepth) return randomTerminal(r);
    if (method === 'grow' && depth > 0 && r() < 0.4) return randomTerminal(r);
    const roll = r();
    if (roll < 0.42) {
        const n = 2 + Math.floor(r() * 3);
        const children: BTNode[] = [];
        for (let i = 0; i < n; i += 1) children.push(randomTree(r, maxDepth, method, depth + 1));
        return { kind: r() < 0.5 ? 'selector' : 'sequence', children };
    }
    if (roll < 0.56) return { kind: 'inverter', child: randomTree(r, maxDepth, method, depth + 1) };
    if (roll < 0.66) {
        return {
            kind: 'latch',
            key: Math.floor(r() * LATCH_NAMES.length),
            ttl: 120 * (1 + Math.floor(r() * 5)),
            child: randomTree(r, maxDepth, method, depth + 1),
        };
    }
    return randomTerminal(r);
}

// ---- subtree addressing -------------------------------------------------

interface NodeRef {
    node: BTNode;
    depth: number;
    /** Replace this node in its parent (root-safe via replaceRef). */
    set: (n: BTNode) => void;
}

function enumerate(root: BTNode): NodeRef[] {
    const refs: NodeRef[] = [];
    const walk = (node: BTNode, set: (n: BTNode) => void, depth: number): void => {
        refs.push({ node, depth, set });
        if (node.kind === 'selector' || node.kind === 'sequence') {
            node.children.forEach((c, i) => {
                walk(c, (n) => {
                    node.children[i] = n;
                }, depth + 1);
            });
        } else if (node.kind === 'inverter' || node.kind === 'latch') {
            walk(
                node.child,
                (n) => {
                    node.child = n;
                },
                depth + 1,
            );
        }
    };
    walk(root, () => undefined, 0);
    return refs;
}

function replaceRef(root: BTNode, ref: NodeRef, n: BTNode): BTNode {
    if (ref.depth === 0) return cloneTree(n);
    ref.set(cloneTree(n));
    return root;
}

function isComposite(node: BTNode): boolean {
    return node.kind === 'selector' || node.kind === 'sequence' || node.kind === 'inverter' || node.kind === 'latch';
}

function pickRef(r: Rand, refs: NodeRef[]): NodeRef {
    // Koza-style: 90% of crossover points are internal (composite) nodes,
    // so crossover swaps behavior blocks, not just leaves.
    const internal = refs.filter((x) => x.depth > 0 && isComposite(x.node));
    const pool = r() < 0.9 && internal.length > 0 ? internal : refs;
    return pool[Math.floor(r() * pool.length)] ?? refs[0]!;
}

// ---- operators ------------------------------------------------------------

export function crossover(r: Rand, a: BTNode, b: BTNode, maxNodes: number): BTNode {
    const ca = cloneTree(a);
    const cb = cloneTree(b);
    const ra = pickRef(r, enumerate(ca));
    const rb = pickRef(r, enumerate(cb));
    const child = replaceRef(ca, ra, rb.node);
    // Bloat guard: reject the child when it exceeds the node budget.
    if (treeSize(child) > maxNodes) return cloneTree(a);
    return child;
}

export function mutate(r: Rand, tree: BTNode): BTNode {
    const t = cloneTree(tree);
    const refs = enumerate(t);
    const ref = refs[Math.floor(r() * refs.length)] ?? refs[0]!;
    const roll = r();
    if (roll < 0.5 || (ref.node.kind !== 'condition' && ref.node.kind !== 'action')) {
        // Subtree replacement: grow a small fresh branch.
        return replaceRef(t, ref, randomTree(r, 2, 'grow'));
    }
    if (roll < 0.8) {
        // Point mutation: swap the primitive for another of the same kind.
        const isCond = ref.node.kind === 'condition';
        const names = isCond ? COND_NAMES : ACT_NAMES;
        const table = isCond ? CONDITIONS : ACTIONS;
        const name = names[Math.floor(r() * names.length)] ?? names[0]!;
        const params = randParams(table[name]?.params ?? [], r);
        const kind = ref.node.kind;
        return replaceRef(t, ref, { kind, name, params } as BTNode);
    }
    // Parameter perturbation: nudge one numeric param by one step.
    const node = ref.node;
    if (node.kind !== 'condition' && node.kind !== 'action') return t;
    const table = node.kind === 'condition' ? CONDITIONS : ACTIONS;
    const spec = table[node.name]?.params;
    if (!spec || spec.length === 0) return t;
    const pi = Math.floor(r() * spec.length);
    const s = spec[pi];
    if (!s) return t;
    const cur = node.params[pi] ?? s.min;
    const next = cur + (r() < 0.5 ? -s.step : s.step);
    const clamped = Math.min(s.max, Math.max(s.min, next));
    const params = [...node.params];
    params[pi] = clamped;
    return replaceRef(t, ref, { kind: node.kind, name: node.name, params } as BTNode);
}

// ---- evaluation ------------------------------------------------------------

export interface BehavStats {
    distSum: number;
    distN: number;
    driveTicks: number;
    ticks: number;
    pads: number;
    dashes: number;
    shots: number;
}

export interface MatchScore {
    win: boolean;
    kills: number;
    damage: number;
}

function runMatch(tree: BTNode, foe: Competitor, seed: number, arena: ArenaId, stats?: BehavStats): MatchScore {
    const brain = createBTTreeBrain(cloneTree(tree));
    const controller: RobotController = {
        meta: { id: 'bt-evo', name: 'BT-Evo', author: 'gp', version: '0.1.0', description: 'evolving behavior tree' },
        update: (sense: SenseState) => {
            if (stats) {
                stats.ticks += 1;
                if (sense.foes.length > 0) {
                    stats.distSum += sense.foes[0]?.distance ?? 0;
                    stats.distN += 1;
                }
                for (const e of sense.events ?? []) {
                    if (e.kind === 'pickup') stats.pads += 1;
                }
            }
            const intent = brain.update(sense).intent;
            if (stats) {
                if (intent.moveMode === 1 || Math.abs(intent.throttle ?? 0) > 0.05 || Math.abs(intent.strafe ?? 0) > 0.05) {
                    stats.driveTicks += 1;
                }
                if (intent.dash === true) stats.dashes += 1;
            }
            return intent;
        },
    };
    const match = new Match(
        [
            { team: 0, controller, loadout: { ...BT_LOADOUT } },
            { team: 1, controller: foe.create(), loadout: { ...foe.loadout } },
        ],
        seed,
        { arena },
    );
    let guard = 0;
    while (!match.result.over && guard < 30000) {
        match.step();
        guard += 1;
    }
    const me = match.robotSnapshots[0];
    if (stats) stats.shots += me?.shotsFired ?? 0;
    return {
        win: match.result.winner === 0,
        kills: me?.kills ?? 0,
        damage: me?.damageDealt ?? 0,
    };
}

export interface EvalConfig {
    opponents: Competitor[];
    seedsPerPairing: number;
    arenas: ArenaId[];
    seedBase: number;
}

const blankStats = (): BehavStats => ({ distSum: 0, distN: 0, driveTicks: 0, ticks: 0, pads: 0, dashes: 0, shots: 0 });

/**
 * Behavior descriptor, averaged over the fitness matches (no extra games):
 * [meanDistToFoe/500, driveActivity, padPickups/match, dashes/match, shots/match].
 */
export function behaviorOf(stats: BehavStats, matches: number): number[] {
    const m = Math.max(1, matches);
    return [
        Math.min(1.5, (stats.distN > 0 ? stats.distSum / stats.distN : 250) / 500),
        stats.ticks > 0 ? stats.driveTicks / stats.ticks : 0,
        Math.min(1.5, stats.pads / m / 2),
        Math.min(1.5, stats.dashes / m / 4),
        Math.min(1.5, stats.shots / m / 120),
    ];
}

function behavDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i += 1) {
        const d = (a[i] ?? 0) - (b[i] ?? 0);
        sum += d * d;
    }
    return Math.sqrt(sum);
}

/** Mean distance to the K nearest archive entries, scaled to 0..1. */
export function noveltyOf(behav: number[], archive: number[][]): number {
    if (archive.length === 0) return 1;
    const dists = archive.map((a) => behavDistance(behav, a)).sort((x, y) => x - y);
    const k = Math.min(NOVELTY_K, dists.length);
    let sum = 0;
    for (let i = 0; i < k; i += 1) sum += dists[i] ?? 0;
    return Math.min(1, sum / k / NOVELTY_SCALE);
}

export interface Evaluated {
    wins: number;
    kills: number;
    damage: number;
    behav: number[];
}

export function evaluate(tree: BTNode, cfg: EvalConfig, tag: number): Evaluated {
    let wins = 0;
    let kills = 0;
    let damage = 0;
    let matches = 0;
    const stats = blankStats();
    cfg.opponents.forEach((foe, fi) => {
        for (let rep = 0; rep < cfg.seedsPerPairing; rep += 1) {
            const seed = (cfg.seedBase + tag * 7919 + fi * 131 + rep * 17) >>> 0;
            const arena = cfg.arenas[(fi + rep) % cfg.arenas.length] ?? 'open';
            const s = runMatch(tree, foe, seed, arena, stats);
            if (s.win) wins += 1;
            kills += s.kills;
            damage += s.damage;
            matches += 1;
        }
    });
    return { wins, kills, damage, behav: behaviorOf(stats, matches) };
}

function toFitness(ev: Evaluated, nodes: number, archive: number[][]): Fitness {
    const novelty01 = noveltyOf(ev.behav, archive);
    const driveActivity = ev.behav[1] ?? 0;
    // Minimal criterion (N7 style): a bot that never drives is a turret and
    // is ineligible — this forces the search into mobile minds instead of
    // re-discovering stand-still-and-shoot. Documented, not hidden.
    const mobile = driveActivity >= MIN_DRIVE_ACTIVITY;
    return {
        score: mobile ? ev.wins + NOVELTY_WEIGHT * novelty01 : -1,
        wins: ev.wins,
        novelty01,
        kills: ev.kills,
        damage: ev.damage,
        nodes,
    };
}

// ---- behavior probe (what does it LOOK like?) -------------------------------

export interface BehaviorReport {
    matches: number;
    wins: number;
    meanDistToFoe: number;
    dashUses: number;
    empUses: number;
    padPickups: number;
    shotsPerMatch: number;
}

export function probeBehavior(tree: BTNode, cfg: EvalConfig): BehaviorReport {
    let matches = 0;
    let wins = 0;
    let distSum = 0;
    let distN = 0;
    let dashUses = 0;
    let empUses = 0;
    let padPickups = 0;
    let shots = 0;
    cfg.opponents.forEach((foe, fi) => {
        for (let rep = 0; rep < cfg.seedsPerPairing; rep += 1) {
            const brain = createBTTreeBrain(cloneTree(tree));
            const controller: RobotController = {
                meta: { id: 'bt-probe', name: 'BT-Probe', author: 'gp', version: '0.1.0', description: '' },
                update: (sense: SenseState) => {
                    if (sense.foes.length > 0) {
                        distSum += sense.foes[0]?.distance ?? 0;
                        distN += 1;
                    }
                    for (const e of sense.events ?? []) {
                        if (e.kind === 'pickup') padPickups += 1;
                    }
                    const intent = brain.update(sense).intent;
                    if (intent.dash === true) dashUses += 1;
                    if (intent.emp === true) empUses += 1;
                    return intent;
                },
            };
            const seed = (cfg.seedBase + 4242 + fi * 131 + rep * 17) >>> 0;
            const arena = cfg.arenas[(fi + rep) % cfg.arenas.length] ?? 'open';
            const match = new Match(
                [
                    { team: 0, controller, loadout: { ...BT_LOADOUT } },
                    { team: 1, controller: foe.create(), loadout: { ...foe.loadout } },
                ],
                seed,
                { arena },
            );
            let guard = 0;
            while (!match.result.over && guard < 30000) {
                match.step();
                guard += 1;
            }
            if (match.result.winner === 0) wins += 1;
            shots += match.robotSnapshots[0]?.shotsFired ?? 0;
            matches += 1;
        }
    });
    return {
        matches,
        wins,
        meanDistToFoe: distN > 0 ? distSum / distN : 0,
        dashUses,
        empUses,
        padPickups,
        shotsPerMatch: matches > 0 ? shots / matches : 0,
    };
}

// ---- evolution ---------------------------------------------------------------

export interface GPConfig extends EvalConfig {
    seed: number;
    popSize: number;
    generations: number;
    initDepth: number;
    maxNodes: number;
    tournamentSize: number;
    crossoverRate: number;
    mutationRate: number;
    elite: number;
    log?: (msg: string) => void;
}

export interface Individual {
    tree: BTNode;
    fit: Fitness;
    behav: number[];
}

function tournament(r: Rand, pop: Individual[], size: number): Individual {
    let best = pop[Math.floor(r() * pop.length)] ?? pop[0]!;
    for (let i = 1; i < size; i += 1) {
        const cand = pop[Math.floor(r() * pop.length)] ?? pop[0]!;
        if (compareFitness(cand.fit, best.fit) < 0) best = cand;
    }
    return best;
}

export interface EvolutionResult {
    champion: Individual;
    generations: number;
    bestHistory: Fitness[];
}

export function runEvolution(cfg: GPConfig): EvolutionResult {
    const r = createRng(cfg.seed);
    const log = cfg.log ?? ((): void => undefined);
    const archive: number[][] = [];

    const evaluateInto = (tree: BTNode, tag: number): Individual => {
        const ev = evaluate(tree, cfg, tag);
        const fit = toFitness(ev, treeSize(tree), archive);
        archive.push(ev.behav);
        return { tree, fit, behav: ev.behav };
    };

    let pop: Individual[] = [];
    for (let i = 0; i < cfg.popSize; i += 1) {
        const depth = 2 + (i % Math.max(1, cfg.initDepth - 1));
        const method = i % 2 === 0 ? 'full' : 'grow';
        pop.push(evaluateInto(randomTree(r, depth, method), i));
    }
    pop.sort((a, b) => compareFitness(a.fit, b.fit));
    const bestHistory: Fitness[] = [pop[0]?.fit ?? { score: 0, wins: 0, novelty01: 0, kills: 0, damage: 0, nodes: 0 }];
    const fmt = (f: Fitness): string =>
        `score=${f.score.toFixed(2)} wins=${f.wins} nov=${f.novelty01.toFixed(2)} kills=${f.kills} ` +
        `dmg=${Math.round(f.damage)} nodes=${f.nodes}`;
    log(`gen 0: best ${fmt(pop[0]?.fit ?? { score: 0, wins: 0, novelty01: 0, kills: 0, damage: 0, nodes: 0 })}`);

    for (let gen = 1; gen <= cfg.generations; gen += 1) {
        const next: Individual[] = pop.slice(0, cfg.elite);
        let tag = cfg.popSize + gen * cfg.popSize;
        while (next.length < cfg.popSize) {
            const p1 = tournament(r, pop, cfg.tournamentSize);
            const p2 = tournament(r, pop, cfg.tournamentSize);
            let child = r() < cfg.crossoverRate ? crossover(r, p1.tree, p2.tree, cfg.maxNodes) : cloneTree(p1.tree);
            if (r() < cfg.mutationRate) child = mutate(r, child);
            if (treeSize(child) > cfg.maxNodes) child = cloneTree(p1.tree);
            next.push(evaluateInto(child, tag));
            tag += 1;
        }
        pop = next;
        pop.sort((a, b) => compareFitness(a.fit, b.fit));
        const best = pop[0]?.fit ?? { score: 0, wins: 0, novelty01: 0, kills: 0, damage: 0, nodes: 0 };
        bestHistory.push(best);
        log(`gen ${gen}: best ${fmt(best)}`);
    }

    const champion = pop[0] ?? {
        tree: randomTree(r, 2, 'grow'),
        fit: { score: 0, wins: 0, novelty01: 0, kills: 0, damage: 0, nodes: 1 },
        behav: [0, 0, 0, 0, 0],
    };
    return { champion, generations: cfg.generations, bestHistory };
}

export { printTree };
