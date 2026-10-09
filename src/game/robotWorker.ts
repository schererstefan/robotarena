// Sandboxed robot runtime: runs UNTRUSTED user-supplied robot source inside
// a Web Worker. This realm has no DOM, no page globals, and the network,
// storage, timer-string-eval, and code-generation APIs below are neutered
// before the first byte of user code loads. The worker speaks only the
// `robotSandboxProtocol` message shapes: sense snapshots in, Intents out.
// A throw inside user code is reported as a message — it never escapes.
//
// NOTE: this file is bundled as a worker chunk (`new Worker(new URL(...))`).
// It must stay free of Phaser, page UI, and anything outside sim/*, game
// strings, and the sandbox protocol.

import { sanitizeLoadout } from '../sim/skills';
import type { Intent, RobotController, SenseState } from '../sim/types';
import {
    dryRunSense,
    isRecord,
    looksLikeTypescript,
    rebuildSense,
    validIntent,
    validMeta,
    type HostToWorker,
    type SandboxSnapshot,
    type WorkerToHost,
} from './robotSandboxProtocol';
import {
    IMPORT_ERROR,
    importCreateThrew,
    importLoadFailed,
    importUpdateThrew,
} from './strings';

/** One match-time controller instance (per lineup slot using this robot). */
interface WorkerInstance {
    update: (sense: SenseState) => Intent;
    onSpawn: ((sense: SenseState) => void) | null;
    spawnFired: boolean;
}

/** Cap instances so stale matches cannot grow the map without bound. */
const MAX_INSTANCES = 16;

let userCreate: (() => RobotController) | null = null;
let loadFailed = false;
const instances = new Map<string, WorkerInstance>();
/** Spawns that arrived while the async load was still in flight. */
const earlySpawns: string[] = [];

function post(message: WorkerToHost): void {
    postMessage(message);
}

/** Block one global callable with an always-throwing stub. Best-effort. */
function blockGlobal(name: string): void {
    try {
        Object.defineProperty(globalThis, name, {
            value: (..._args: never[]): never => {
                throw new Error(`blocked API: ${name}`);
            },
            writable: true,
            configurable: true,
        });
    } catch {
        // Non-configurable in this realm: leave it (documented residual).
    }
}

/**
 * Neuter everything a well-behaved robot (pure sense→Intent, see
 * docs/ROBOT_API.md) never needs. Runs at worker startup, before any user
 * module loads, so user code can only ever observe the neutered realm —
 * including inside direct eval, which inherits this realm's globals.
 */
function neuterApis(): void {
    // Capture function prototypes BEFORE replacing the Function binding:
    // `(function(){}).constructor` (plus async/generator siblings) reaches
    // the original compiler even after the global is stubbed.
    const fnProtos: object[] = [];
    try {
        fnProtos.push(
            Object.getPrototypeOf(function () {}) as object,
            Object.getPrototypeOf(async function () {}) as object,
            Object.getPrototypeOf(function* () {}) as object,
            Object.getPrototypeOf(async function* () {}) as object,
        );
    } catch {
        // Prototypes unavailable: the global binding stub still stands.
    }
    // Network and off-thread exfiltration. importScripts is absent in
    // module workers per spec, but stub it anyway: if present and callable
    // it would load unvalidated code into this realm outside the protocol.
    for (const name of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'Worker', 'importScripts']) {
        blockGlobal(name);
    }
    // Storage: localStorage/sessionStorage do not exist in workers;
    // indexedDB and the Cache API do.
    for (const name of ['indexedDB', 'caches']) {
        blockGlobal(name);
    }
    // Code generation via the global binding (indirect eval, Function).
    // Direct eval() calls keep working but run in this neutered realm.
    for (const name of ['Function', 'eval']) {
        blockGlobal(name);
    }
    // Same for the inherited path: every function prototype's constructor
    // compiles code strings, so stub them all.
    for (const proto of fnProtos) {
        try {
            Object.defineProperty(proto, 'constructor', {
                value: (..._args: never[]): never => {
                    throw new Error('blocked API: Function constructor');
                },
                writable: true,
                configurable: true,
            });
        } catch {
            // Leave it (documented residual).
        }
    }
    // Beacon exfiltration. Plain assignment silently fails (the native
    // method is read-only), so shadow it with an own property instead.
    try {
        Object.defineProperty(globalThis.navigator as object, 'sendBeacon', {
            value: (..._args: never[]): never => {
                throw new Error('blocked API: sendBeacon');
            },
            writable: true,
            configurable: true,
        });
    } catch {
        // Navigator is non-extensible here: sendBeacon stays (documented residual).
    }
    // Timer string-eval (`setTimeout("code")`) is implicit eval: reject
    // string callbacks, delegate everything else untouched.
    for (const name of ['setTimeout', 'setInterval'] as const) {
        try {
            const raw = globalThis[name].bind(globalThis) as unknown as (
                ...args: unknown[]
            ) => number;
            const wrapped = (...args: unknown[]): number => {
                if (typeof args[0] === 'string') throw new Error(`blocked API: ${name} string`);
                return raw(...args);
            };
            Object.defineProperty(globalThis, name, {
                value: wrapped,
                writable: true,
                configurable: true,
            });
        } catch {
            // Leave it: string callbacks still run in the neutered realm.
        }
    }
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : IMPORT_ERROR.unknown;
}

function failLoad(dryRun: boolean, error: string): void {
    loadFailed = true;
    post({ type: dryRun ? 'validate-error' : 'fatal', error });
    // Slots queued during the failed load park instead of hanging.
    for (const instanceId of earlySpawns.splice(0, earlySpawns.length)) {
        post({ type: 'spawn-error', instanceId, error });
    }
}

async function handleLoad(code: string, dryRun: boolean): Promise<void> {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    try {
        const module = (await import(/* @vite-ignore */ url)) as unknown;
        if (!isRecord(module) || typeof module['create'] !== 'function') {
            failLoad(dryRun, IMPORT_ERROR.noCreate);
            return;
        }
        const meta = validMeta(module['meta']);
        if (!meta) {
            failLoad(dryRun, IMPORT_ERROR.badMeta);
            return;
        }
        let loadout;
        try {
            loadout = sanitizeLoadout(module['loadout'] ?? {});
        } catch {
            failLoad(dryRun, IMPORT_ERROR.badLoadout);
            return;
        }
        let controller: RobotController;
        try {
            controller = (module['create'] as () => RobotController)();
        } catch (error) {
            failLoad(dryRun, importCreateThrew(messageOf(error)));
            return;
        }
        if (!isRecord(controller) || typeof controller['update'] !== 'function') {
            failLoad(dryRun, IMPORT_ERROR.noUpdate);
            return;
        }
        const update = controller['update'] as (sense: SenseState) => Intent;
        try {
            // Timeout-free pure call: one synchronous tick against synthetic
            // sense. A runaway dry run stalls this worker; the host's
            // validation timeout rejects the import instead of hanging a tab.
            const intent = update(dryRunSense());
            if (!validIntent(intent)) {
                failLoad(dryRun, IMPORT_ERROR.badIntent);
                return;
            }
        } catch (error) {
            failLoad(dryRun, importUpdateThrew(messageOf(error)));
            return;
        }
        if (dryRun) {
            post({ type: 'validate-ok', meta, loadout });
            return;
        }
        // Match worker: keep the factory for per-slot instances. The dry run
        // above already exercised one controller; match instances are fresh
        // create() calls, exactly like the page-realm path did.
        userCreate = module['create'] as () => RobotController;
        post({ type: 'ready' });
        for (const instanceId of earlySpawns.splice(0, earlySpawns.length)) {
            handleSpawn(instanceId);
        }
    } catch (error) {
        if (error instanceof SyntaxError && looksLikeTypescript(code)) {
            failLoad(dryRun, IMPORT_ERROR.typescript);
            return;
        }
        failLoad(dryRun, importLoadFailed(messageOf(error)));
    } finally {
        URL.revokeObjectURL(url);
    }
}

function handleSpawn(instanceId: string): void {
    // The host queues spawns until ready, but a transport may still deliver
    // one early while the dynamic import is in flight: hold it, don't drop
    // it — dropping would park a healthy slot forever.
    if (userCreate === null && !loadFailed) {
        if (!earlySpawns.includes(instanceId)) earlySpawns.push(instanceId);
        return;
    }
    if (userCreate === null) {
        post({ type: 'spawn-error', instanceId, error: IMPORT_ERROR.noCreate });
        return;
    }
    // LRU cap: a match spawns all its slots up front, so eviction only ever
    // drops instances from older matches, never a live one.
    if (instances.size >= MAX_INSTANCES) {
        const oldest = instances.keys().next();
        if (!oldest.done) instances.delete(oldest.value);
    }
    try {
        const controller = userCreate();
        const update = controller.update.bind(controller);
        const onSpawn =
            typeof controller.onSpawn === 'function' ? controller.onSpawn.bind(controller) : null;
        instances.set(instanceId, { update, onSpawn, spawnFired: false });
        post({ type: 'spawned', instanceId });
    } catch (error) {
        // A factory that passed the dry run but throws at match time parks
        // that slot instead of breaking battle setup.
        post({ type: 'spawn-error', instanceId, error: importCreateThrew(messageOf(error)) });
    }
}

function handleTick(instanceId: string, snapshot: SandboxSnapshot): void {
    const instance = instances.get(instanceId);
    if (!instance) return;
    let sense: SenseState;
    try {
        sense = rebuildSense(snapshot);
    } catch (error) {
        post({ type: 'intent-error', instanceId, error: importUpdateThrew(messageOf(error)) });
        return;
    }
    // Deferred spawn hook: the engine fires onSpawn at setup, before this
    // worker is reachable — run it once ahead of the first live tick.
    if (!instance.spawnFired) {
        instance.spawnFired = true;
        if (instance.onSpawn) {
            try {
                instance.onSpawn(sense);
            } catch {
                // Swallowed like the engine's own onSpawn guard: the robot
                // still plays, it just missed its setup tick.
            }
        }
    }
    try {
        const intent = instance.update(sense);
        post({ type: 'intent', instanceId, intent });
    } catch (error) {
        post({ type: 'intent-error', instanceId, error: importUpdateThrew(messageOf(error)) });
    }
}

neuterApis();

globalThis.addEventListener('message', (event: MessageEvent) => {
    const message = event.data as HostToWorker;
    try {
        switch (message.type) {
            case 'load':
                void handleLoad(message.code, message.dryRun);
                break;
            case 'spawn':
                handleSpawn(message.instanceId);
                break;
            case 'tick':
                handleTick(message.instanceId, message.snapshot);
                break;
            case 'dispose':
                instances.delete(message.instanceId);
                break;
        }
    } catch (error) {
        // The protocol never throws outward: a wedged handler parks the
        // robot on its held intent instead of killing the match loop.
        if (message.type === 'tick') {
            post({ type: 'intent-error', instanceId: message.instanceId, error: messageOf(error) });
        }
    }
});
