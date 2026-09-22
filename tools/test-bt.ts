// N1 behavior-tree substrate tests: interpreter robustness, primitive
// catalog audit, genome JSON round-trips, bloat-pass semantics preservation,
// champion behavior pinning, and determinism.
//
// Run with `npm run test:bt`:
//   esbuild tools/test-bt.ts --bundle --platform=node --format=esm \
//       --outfile=/tmp/robotarena-test-bt.mjs --log-level=warning \
//   && node /tmp/robotarena-test-bt.mjs
//
// Exits non-zero on any failure. No Math.random / Date.now anywhere.

import { readFileSync } from 'fs';
import { Match } from '../src/sim/engine';
import { createRng, type Rand } from '../src/sim/rng';
import type { RobotController, SenseState } from '../src/sim/types';
import {
    cloneTree,
    collapseRedundant,
    MAX_TREE_DEPTH,
    printTree,
    pruneUnreachable,
    simplifyTree,
    tickTree,
    treeDepth,
    treeSize,
    validateTree,
    type BTNode,
} from '../src/robots/bt/tree';
import {
    genomeTree,
    makeGenome,
    parseGenome,
    treeToGenomeJSON,
    TREE_GENOME_KIND,
    TREE_GENOME_SCHEMA,
    type TreeProvenance,
} from '../src/robots/bt/serialization';
import { ACTIONS, CONDITIONS, IntentBuilder } from '../src/robots/bt/primitives';
import type { Blackboard } from '../src/robots/bt/blackboard';
import { createBTTreeBrain } from '../src/robots/bt/brain';
import {
    BT_LOADOUT,
    crossover,
    evaluate,
    mutate,
    probeBehavior,
    randomTree,
    runEvolution,
    type Competitor,
    type EvalConfig,
    type GPConfig,
} from '../src/robots/bt/gp';
import { CHAMPION_FITNESS, CHAMPION_PROVENANCE, CHAMPION_TREE } from '../src/robots/bt/champion';
import { create as createHunter, loadout as hunterLoadout } from '../src/robots/hunter';
import { create as createRusher, loadout as rusherLoadout } from '../src/robots/rusher';
import { create as createGhost, loadout as ghostLoadout } from '../src/robots/ghost';

let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
    if (condition) {
        console.log(`  ok   ${name}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ''}`);
    }
}

function throws(name: string, fn: () => void, want: RegExp): void {
    try {
        fn();
        check(name, false, 'did not throw');
    } catch (e) {
        check(name, want.test((e as Error).message), `wrong message: ${(e as Error).message}`);
    }
}

/** Minimal blackboard for unit-ticking trees without a match. */
function fakeBB(withFoe: boolean): Blackboard {
    return {
        tick: 1000,
        rand01: 0.5,
        x: 400,
        y: 300,
        heading: 0,
        tower: 0,
        speed: 0,
        hpFrac: 1,
        foe: withFoe
            ? { id: 7, x: 500, y: 300, heading: 0, speed: 100, hpFrac: 0.8, distance: 100, bearing: 0.5 }
            : null,
        weakestFoe: withFoe
            ? { id: 7, x: 500, y: 300, heading: 0, speed: 100, hpFrac: 0.8, distance: 100, bearing: 0.5 }
            : null,
        foeCount: withFoe ? 1 : 0,
        bullets: [],
        pads: [],
        zone: null,
        allyCount: 0,
        nearestAllyDist: Infinity,
        tracks: [],
        stalestTrack: null,
        justHit: false,
        justHitAmount: 0,
        justHitBearing: 0,
        justKilled: false,
        justPickedUp: false,
        gunReady: true,
        dashReady: true,
        empReady: true,
        charge: 0,
        charged: false,
        slowed: false,
        hazard: null,
        blockedAhead: 0,
        walls: { left: 0, right: 800, top: 0, bottom: 600 },
        kills: 0,
        aliveFoes: 1,
        latches: new Map<string, number>(),
    };
}

function tickOnce(tree: BTNode, withFoe: boolean): { status: string; intent: string } {
    const out = new IntentBuilder();
    const status = tickTree(tree, fakeBB(withFoe), out);
    return { status, intent: JSON.stringify(out.build()) };
}

const OPPONENTS: Competitor[] = [
    { id: 'hunter', create: createHunter, loadout: hunterLoadout },
    { id: 'rusher', create: createRusher, loadout: rusherLoadout },
    { id: 'ghost', create: createGhost, loadout: ghostLoadout },
];

const EVAL: EvalConfig = { opponents: OPPONENTS, seedsPerPairing: 2, arenas: ['open', 'blocks'], seedBase: 1000 };

// ---- 1. primitive catalog audit -------------------------------------------

console.log('[catalog]');
for (const [name, def] of Object.entries(CONDITIONS)) {
    check(`cond name '${name}'`, /^[a-z0-9-]+$/.test(name));
    const params = def.params.map((s) => s.min);
    let desc = '';
    try {
        desc = def.desc(params);
    } catch {
        desc = '';
    }
    check(`cond '${name}' desc`, typeof desc === 'string' && desc.length > 0);
    check(
        `cond '${name}' specs sane`,
        def.params.every((s) => Number.isFinite(s.min) && Number.isFinite(s.max) && s.min <= s.max && s.step > 0) &&
            (def.params.every((s) => s.names === undefined || s.names.length === Math.round((s.max - s.min) / s.step) + 1)),
    );
    check(`cond '${name}' reads documented`, Array.isArray(def.reads) && def.reads.every((r) => typeof r === 'string'));
}
for (const [name, def] of Object.entries(ACTIONS)) {
    check(`action name '${name}'`, /^[a-z0-9-]+$/.test(name));
    const params = def.params.map((s) => s.min);
    let desc = '';
    try {
        desc = def.desc(params);
    } catch {
        desc = '';
    }
    check(`action '${name}' desc`, typeof desc === 'string' && desc.length > 0);
    check(
        `action '${name}' specs sane`,
        def.params.every((s) => Number.isFinite(s.min) && Number.isFinite(s.max) && s.min <= s.max && s.step > 0) &&
            (def.params.every((s) => s.names === undefined || s.names.length === Math.round((s.max - s.min) / s.step) + 1)),
    );
    check(`action '${name}' reads documented`, Array.isArray(def.reads) && def.reads.every((r) => typeof r === 'string'));
    check(
        `action '${name}' writes documented`,
        def.writes.length > 0 && def.writes.every((c) => c === 'tower' || c === 'drive' || c === 'special'),
    );
}

// ---- 2. validateTree -------------------------------------------------------

console.log('[validate]');
check('champion validates clean', validateTree(CHAMPION_TREE).length === 0);
check('simplified champion validates clean', validateTree(simplifyTree(CHAMPION_TREE)).length === 0);
{
    const bad = cloneTree(CHAMPION_TREE);
    const first = bad.kind === 'sequence' ? bad.children[0] : bad;
    if (first && first.kind === 'sequence' && first.children[0]) {
        first.children[0] = { kind: 'condition', name: 'nope-not-real', params: [] };
    }
    const errs = validateTree(bad);
    check('unknown condition flagged', errs.some((e) => e.includes('nope-not-real')), errs.join(' | '));
}
{
    const bad: BTNode = { kind: 'condition', name: 'hp-below', params: [5] };
    check('param out of range flagged', validateTree(bad).some((e) => e.includes('outside')));
}
{
    const bad: BTNode = { kind: 'condition', name: 'hp-below', params: [] };
    check('param count flagged', validateTree(bad).some((e) => e.includes('expects 1 params')));
}
{
    const bad: BTNode = { kind: 'latch', key: 99, ttl: 120, child: { kind: 'condition', name: 'always', params: [] } };
    check('latch key flagged', validateTree(bad).some((e) => e.includes('latch key')));
}
{
    const bad: BTNode = { kind: 'latch', key: 0, ttl: 0, child: { kind: 'condition', name: 'always', params: [] } };
    check('latch ttl flagged', validateTree(bad).some((e) => e.includes('latch ttl')));
}
{
    const bad = { kind: 'selector', children: 'nope' } as unknown as BTNode;
    check('non-array children flagged', validateTree(bad).some((e) => e.includes('not an array')));
}
{
    const bad = { kind: 'frobnicate' } as unknown as BTNode;
    check('unknown kind flagged', validateTree(bad).some((e) => e.includes('unknown node kind')));
}
{
    let deep: BTNode = { kind: 'condition', name: 'always', params: [] };
    for (let i = 0; i < MAX_TREE_DEPTH + 10; i += 1) deep = { kind: 'inverter', child: deep };
    check('excessive depth flagged', validateTree(deep).some((e) => e.includes('exceeds MAX_TREE_DEPTH')));
}
check('empty selector is valid (fails closed)', validateTree({ kind: 'selector', children: [] }).length === 0);
check('empty sequence is valid (succeeds)', validateTree({ kind: 'sequence', children: [] }).length === 0);

// ---- 3. tickTree robustness -------------------------------------------------

console.log('[tick]');
check('empty selector fails closed', tickOnce({ kind: 'selector', children: [] }, false).status === 'failure');
check('empty sequence succeeds', tickOnce({ kind: 'sequence', children: [] }, false).status === 'success');
check(
    'unknown action fails closed',
    tickOnce({ kind: 'action', name: 'bogus', params: [] }, false).status === 'failure',
);
check(
    'unknown condition fails closed',
    tickOnce({ kind: 'condition', name: 'bogus', params: [] }, false).status === 'failure',
);
{
    // Corrupt deep tree: the depth guard fails closed in O(depth) steps —
    // it cannot hang or stack-overflow by construction.
    let deep: BTNode = { kind: 'condition', name: 'always', params: [] };
    for (let i = 0; i < 500; i += 1) deep = { kind: 'inverter', child: deep };
    check('deep corrupt tree fails closed', tickOnce(deep, false).status === 'failure');
}
{
    // Latch semantics: fires once, then holds without re-running the child.
    const tree: BTNode = {
        kind: 'latch',
        key: 0,
        ttl: 100,
        child: { kind: 'condition', name: 'just-hit', params: [] },
    };
    const bb = fakeBB(false);
    bb.justHit = true;
    const out1 = new IntentBuilder();
    check('latch fires on child success', tickTree(tree, bb, out1) === 'success');
    check('latch recorded the tick', bb.latches.get('revenge') === bb.tick);
    bb.justHit = false;
    const out2 = new IntentBuilder();
    check('latch holds without child', tickTree(tree, bb, out2) === 'success');
    bb.tick += 1000;
    const out3 = new IntentBuilder();
    check('latch expires', tickTree(tree, bb, out3) === 'failure');
}

// ---- 4. simplifyTree: unit cases + semantics preservation --------------------

console.log('[simplify]');
{
    const x: BTNode = { kind: 'action', name: 'scan', params: [0.7] };
    const single: BTNode = { kind: 'selector', children: [cloneTree(x)] };
    check('single-child selector collapses', JSON.stringify(collapseRedundant(single)) === JSON.stringify(x));
    const dbl: BTNode = {
        kind: 'inverter',
        child: { kind: 'inverter', child: cloneTree(x) },
    };
    check('double inverter cancels', JSON.stringify(collapseRedundant(dbl)) === JSON.stringify(x));
    const dead: BTNode = {
        kind: 'selector',
        children: [cloneTree(x), { kind: 'action', name: 'hold', params: [] }],
    };
    // 'scan' always succeeds, so the tail is unreachable — but the
    // selector wrapper itself is collapseRedundant's job, not prune's.
    check(
        'unreachable tail pruned',
        JSON.stringify(pruneUnreachable(dead)) ===
            JSON.stringify({ kind: 'selector', children: [cloneTree(x)] }),
    );
    const simplified = simplifyTree(dead);
    check('simplify fixes to one node', treeSize(simplified) === 1);
    // The Moth is already minimal: simplify must not change it.
    check(
        'champion is simplify-fixpoint',
        JSON.stringify(simplifyTree(CHAMPION_TREE)) === JSON.stringify(CHAMPION_TREE),
    );
}
{
    // Regression: an action that CAN fail (aim-nearest with no foe visible)
    // must not make later selector branches look unreachable. The old
    // analysis treated every action as infallible and pruned the fallback.
    const tree: BTNode = {
        kind: 'selector',
        children: [
            { kind: 'action', name: 'aim-nearest', params: [] },
            { kind: 'action', name: 'hold', params: [] },
        ],
    };
    const s = simplifyTree(tree);
    check('can-fail action keeps its fallback branch', treeSize(s) === 3, printTree(s));
    const t = tickOnce(s, false);
    check('fallback ticks when aim fails', t.status === 'success' && t.intent.includes('"moveMode":0'), t.intent);
}
{
    // Semantics preservation: 30 seeded random trees tick identically
    // before/after simplify (status + full intent), with and without a foe.
    const r: Rand = createRng(20260922);
    let mismatches = 0;
    for (let i = 0; i < 30; i += 1) {
        const t = randomTree(r, 4, i % 2 === 0 ? 'full' : 'grow');
        const s = simplifyTree(t);
        if (validateTree(s).length !== 0) mismatches += 1;
        if (treeSize(s) > treeSize(t)) mismatches += 1;
        for (const withFoe of [false, true]) {
            const a = tickOnce(t, withFoe);
            const b = tickOnce(s, withFoe);
            if (a.status !== b.status || a.intent !== b.intent) mismatches += 1;
        }
    }
    check('simplify preserves tick semantics (30 trees x foe/no-foe)', mismatches === 0, `${mismatches} mismatches`);
}
{
    // GP operators keep trees clean and within budget.
    const r: Rand = createRng(777);
    let bad = 0;
    for (let i = 0; i < 40; i += 1) {
        const a = randomTree(r, 4, 'grow');
        const b = randomTree(r, 4, 'full');
        if (validateTree(a).length !== 0 || treeDepth(a) > 5) bad += 1;
        const c = crossover(r, a, b, 60);
        const m = mutate(r, a);
        if (validateTree(c).length !== 0 || treeSize(c) > 60) bad += 1;
        if (validateTree(m).length !== 0) bad += 1;
    }
    check('GP operators stay clean and within budget', bad === 0, `${bad} bad`);
}

// ---- 5. genome JSON round-trips -----------------------------------------------

console.log('[genome]');
const PROV: TreeProvenance = { runId: 'test-run', algorithm: 'gp', seed: 42, generation: 3 };
{
    const json = treeToGenomeJSON(CHAMPION_TREE, PROV, CHAMPION_FITNESS);
    const back = genomeTree(json);
    check('champion round-trips', JSON.stringify(back) === JSON.stringify(CHAMPION_TREE));
    check('byte-identical re-serialize', treeToGenomeJSON(CHAMPION_TREE, PROV, CHAMPION_FITNESS) === json);
    const g = parseGenome(json);
    check('schema version', g.schema === TREE_GENOME_SCHEMA && g.kind === TREE_GENOME_KIND);
    check('provenance survives', g.provenance.runId === 'test-run' && g.provenance.seed === 42 && g.provenance.generation === 3);
    check('fitness survives', g.fitness?.score === CHAMPION_FITNESS.score && g.fitness?.wins === 4);
}
{
    // Seeded random trees round-trip too.
    const r: Rand = createRng(31337);
    let bad = 0;
    for (let i = 0; i < 20; i += 1) {
        const t = simplifyTree(randomTree(r, 4, 'grow'));
        const json = treeToGenomeJSON(t, { runId: 'rt', algorithm: 'map-elites', seed: i, generation: i });
        if (JSON.stringify(genomeTree(json)) !== JSON.stringify(t)) bad += 1;
        if (parseGenome(JSON.parse(json)).provenance.seed !== i) bad += 1;
    }
    check('20 random trees round-trip', bad === 0, `${bad} bad`);
}
{
    const good = treeToGenomeJSON(CHAMPION_TREE, PROV);
    const mutateJson = (fn: (o: Record<string, unknown>) => void): string => {
        const o = JSON.parse(good) as Record<string, unknown>;
        fn(o);
        return JSON.stringify(o);
    };
    throws('reject non-JSON', () => parseGenome('nope{'), /not valid JSON/);
    throws('reject bad schema', () => parseGenome(mutateJson((o) => { o['schema'] = 999; })), /unsupported schema/);
    throws('reject bad kind', () => parseGenome(mutateJson((o) => { o['kind'] = 'tree'; })), /wrong kind/);
    throws(
        'reject unknown condition',
        () => parseGenome(mutateJson((o) => { (o['tree'] as Record<string, unknown>)['kind'] = 'condition'; (o['tree'] as Record<string, unknown>)['name'] = 'bogus'; })),
        /unknown condition/,
    );
    throws(
        'reject param out of range',
        () =>
            parseGenome(
                treeToGenomeJSON({ kind: 'condition', name: 'hp-below', params: [5] }, PROV),
            ),
        /outside/,
    );
    throws(
        'reject bad latch key',
        () =>
            parseGenome(
                treeToGenomeJSON(
                    { kind: 'latch', key: 99, ttl: 10, child: { kind: 'condition', name: 'always', params: [] } },
                    PROV,
                ),
            ),
        /latch key/,
    );
    throws('reject missing provenance', () => parseGenome(mutateJson((o) => { delete o['provenance']; })), /provenance/);
    throws('reject bad algorithm', () => parseGenome(mutateJson((o) => {
        (o['provenance'] as Record<string, unknown>)['algorithm'] = 'evolution-strategies';
    })), /algorithm/);
    // makeGenome validates eagerly too.
    throws('makeGenome rejects dirty tree', () => makeGenome({ kind: 'action', name: 'bogus', params: [] }, PROV), /unknown action/);
}

// ---- 6. moth genome artifact ----------------------------------------------------

console.log('[artifact]');
{
    const raw = readFileSync('src/robots/bt/genomes/moth-v0.2.0.genome.json', 'utf8');
    const g = parseGenome(raw);
    check('moth genome parses', g.provenance.runId === CHAMPION_PROVENANCE.runId);
    check('moth genome tree == CHAMPION_TREE', JSON.stringify(g.tree) === JSON.stringify(CHAMPION_TREE));
    check('moth provenance seed/generation', g.provenance.seed === 20260924 && g.provenance.generation === 24);
    check('moth fitness recorded', g.fitness?.score === 6.59 && g.fitness?.wins === 4);
    const printed = printTree(g.tree);
    check(
        'moth prints readably',
        printed.includes('DO aim at nearest foe (lead, hold-to-fire)') &&
            printed.includes('DO drive to any pad') &&
            printed.includes('IF hp below 35%'),
        printed.split('\n')[0] ?? '',
    );
}

// ---- 7. champion behavior pinning -----------------------------------------------

console.log('[champion]');
{
    // Phase-0 probe config (seedBase 777000, 4 seeds/pairing, open+blocks):
    // the hardened interpreter must not change what the Moth does.
    const probe = probeBehavior(CHAMPION_TREE, {
        opponents: OPPONENTS,
        seedsPerPairing: 4,
        arenas: ['open', 'blocks'],
        seedBase: 777000,
    });
    check('probe wins 7/12', probe.wins === 7, `${probe.wins}/12`);
    check('probe meanDistToFoe ~303u', Math.round(probe.meanDistToFoe) === 303, `${probe.meanDistToFoe}`);
    check('probe padPickups 33', probe.padPickups === 33, `${probe.padPickups}`);
    check('probe dashes 14', probe.dashUses === 14, `${probe.dashUses}`);
    check('probe shots/match 24.5', probe.shotsPerMatch.toFixed(1) === '24.5', `${probe.shotsPerMatch}`);
}

// ---- 8. determinism ---------------------------------------------------------------

console.log('[determinism]');
{
    // Same evaluate() twice: identical behavior stats and score.
    const tree = simplifyTree(randomTree(createRng(99), 3, 'grow'));
    const e1 = evaluate(tree, EVAL, 7);
    const e2 = evaluate(tree, EVAL, 7);
    check('evaluate is deterministic', JSON.stringify(e1) === JSON.stringify(e2));
}
{
    // Same 1v1 replayed twice: identical outcome, tick count, damage.
    function duel(seed: number): string {
        const brain = createBTTreeBrain(cloneTree(CHAMPION_TREE));
        const me: RobotController = {
            meta: { id: 'bt', name: 'bt', author: 't', version: '0', description: '' },
            update: (sense: SenseState) => brain.update(sense).intent,
        };
        const match = new Match(
            [
                { team: 0, controller: me, loadout: { ...BT_LOADOUT } },
                { team: 1, controller: createHunter(), loadout: { ...hunterLoadout } },
            ],
            seed,
            { arena: 'open' },
        );
        let guard = 0;
        while (!match.result.over && guard < 30000) {
            match.step();
            guard += 1;
        }
        const snap = match.robotSnapshots[0];
        return JSON.stringify({ w: match.result.winner, t: match.result.tick, d: snap?.damageDealt, k: snap?.kills });
    }
    check('replay is byte-identical', duel(123456) === duel(123456));
}
{
    // Short evolve twice: identical champion genome JSON.
    const tiny: GPConfig = {
        seed: 4242,
        popSize: 8,
        generations: 3,
        initDepth: 3,
        maxNodes: 40,
        tournamentSize: 3,
        crossoverRate: 0.8,
        mutationRate: 0.3,
        elite: 1,
        opponents: OPPONENTS,
        seedsPerPairing: 1,
        arenas: ['open'],
        seedBase: 9000,
    };
    const prov: TreeProvenance = { runId: 'det-check', algorithm: 'gp', seed: 4242, generation: 3 };
    const r1 = runEvolution({ ...tiny });
    const r2 = runEvolution({ ...tiny });
    const j1 = treeToGenomeJSON(simplifyTree(r1.champion.tree), prov, {
        score: r1.champion.fit.score,
        wins: r1.champion.fit.wins,
        novelty01: r1.champion.fit.novelty01,
        kills: r1.champion.fit.kills,
        damage: r1.champion.fit.damage,
        nodes: r1.champion.fit.nodes,
    });
    const j2 = treeToGenomeJSON(simplifyTree(r2.champion.tree), prov, {
        score: r2.champion.fit.score,
        wins: r2.champion.fit.wins,
        novelty01: r2.champion.fit.novelty01,
        kills: r2.champion.fit.kills,
        damage: r2.champion.fit.damage,
        nodes: r2.champion.fit.nodes,
    });
    check('evolve is byte-identical', j1 === j2, `len ${j1.length} vs ${j2.length}`);
}

console.log(failures === 0 ? 'ALL BT CHECKS PASSED' : `${failures} BT CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
