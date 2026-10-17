// Host side of the robot sandbox: spawns the worker, validates imports in
// it, and drives match-time controllers with last-command-held semantics.
//
// The engine still calls `update(sense)` synchronously every tick. Instead
// of awaiting the worker (impossible in a synchronous step), each call ships
// the latest sense snapshot fire-and-forget (at most one request in flight
// per robot — newer snapshots wait, so a wedged worker's queue never grows)
// and returns the last intent the worker produced, or the neutral intent
// until the first reply. Per-tick worker errors park the robot on the
// neutral intent, mirroring the engine's own throw→idle guard.

import type { SkillLoadout } from '../sim/skills';
import type { Intent, RobotController, RobotMeta, SenseState } from '../sim/types';
import {
    buildSnapshot,
    idleIntent,
    validIntent,
    type SandboxSnapshot,
    type SandboxTransport,
    type WorkerToHost,
} from './robotSandboxProtocol';
import { IMPORT_ERROR, importLoadFailed } from './strings';

/** How long an import validation may run before the import is rejected. */
export const SANDBOX_VALIDATE_TIMEOUT_MS = 5000;

type TransportFactory = () => SandboxTransport;

function defaultBrowserTransport(): SandboxTransport {
    const worker = new Worker(new URL('./robotWorker.ts', import.meta.url), { type: 'module' });
    let handler: ((message: WorkerToHost) => void) | null = null;
    worker.onmessage = (event: MessageEvent) => {
        const current = handler;
        if (current !== null) current(event.data as WorkerToHost);
    };
    worker.onerror = () => {
        // A worker-level failure (script blocked, crash) has no protocol
        // shape to route; validation relies on its timeout, match robots
        // stay parked on the neutral intent they already hold.
    };
    return {
        postMessage: (message) => worker.postMessage(message),
        get onmessage() {
            return handler;
        },
        set onmessage(next: ((message: WorkerToHost) => void) | null) {
            handler = next;
        },
        terminate: () => worker.terminate(),
    };
}

let transportFactory: TransportFactory = defaultBrowserTransport;

/** Tests inject a loopback transport; the browser always uses Workers. */
export function setSandboxTransportFactory(factory: TransportFactory): void {
    transportFactory = factory;
}

export function resetSandboxTransportFactory(): void {
    transportFactory = defaultBrowserTransport;
}

/**
 * Validate user source inside a worker: load, shape-check, and dry-run one
 * pure update() call there. The page realm never executes the code. Rejects
 * with the same UI-facing message the old page-realm path produced.
 */
export function validateRobotSourceInWorker(
    code: string,
    timeoutMs = SANDBOX_VALIDATE_TIMEOUT_MS,
): Promise<{ meta: RobotMeta; loadout: SkillLoadout }> {
    return new Promise((resolve, reject) => {
        let transport: SandboxTransport;
        try {
            transport = transportFactory();
        } catch (error) {
            reject(new Error(importLoadFailed(error instanceof Error ? error.message : IMPORT_ERROR.unknown)));
            return;
        }
        let settled = false;
        const cleanup = (): void => {
            settled = true;
            globalThis.clearTimeout(timer);
            transport.onmessage = null;
            try {
                transport.terminate();
            } catch {
                // Termination is best-effort cleanup.
            }
        };
        const timer = globalThis.setTimeout(() => {
            if (settled) return;
            cleanup();
            reject(new Error(importLoadFailed('validation timed out')));
        }, timeoutMs);
        transport.onmessage = (message) => {
            if (settled) return;
            if (message.type === 'validate-ok') {
                const result = { meta: message.meta, loadout: message.loadout };
                cleanup();
                resolve(result);
            } else if (message.type === 'validate-error') {
                cleanup();
                reject(new Error(message.error));
            }
            // Other shapes (stale match-worker traffic) are ignored.
        };
        try {
            transport.postMessage({ type: 'load', code, dryRun: true });
        } catch (error) {
            cleanup();
            reject(new Error(importLoadFailed(error instanceof Error ? error.message : IMPORT_ERROR.unknown)));
        }
    });
}

/** One imported robot's shared worker + per-slot instance sequence. */
export interface SandboxHandle {
    meta: RobotMeta;
    loadout: SkillLoadout;
    source: string;
    transport: SandboxTransport | null;
    loadPosted: boolean;
    /** Set once the worker finishes loading: later slots start live. */
    ready: boolean;
    /** Set when the worker reports a fatal load failure: all slots park. */
    failed: boolean;
    nextInstance: number;
    /** Spawns queued while the worker is still loading (sent on ready). */
    pendingSpawns: string[];
}

export function createSandboxHandle(meta: RobotMeta, loadout: SkillLoadout, source: string): SandboxHandle {
    return {
        meta, loadout, source, transport: null, loadPosted: false, ready: false, failed: false, nextInstance: 0,
        pendingSpawns: [],
    };
}

function ensureHandleTransport(handle: SandboxHandle): SandboxTransport | null {
    if (handle.transport !== null) return handle.transport;
    try {
        const transport = transportFactory();
        handle.transport = transport;
        return transport;
    } catch {
        return null;
    }
}

/**
 * Build the per-slot controller the engine drives. Spawning the worker is
 * synchronous (the constructor returns immediately); until the worker is
 * ready and the first intent arrives, the slot holds the neutral intent.
 */
export function createSandboxedController(handle: SandboxHandle): RobotController {
    const meta = { ...handle.meta };
    const loadout = { ...handle.loadout };
    const instanceId = `i${handle.nextInstance++}`;
    let seed = 0;
    let held: Intent = idleIntent();
    let pending: SandboxSnapshot | null = null;
    let inFlight = false;
    let live = handle.ready;
    let parked = handle.failed;

    const transport = ensureHandleTransport(handle);

    const postSpawn = (id: string): void => {
        if (transport === null) {
            parked = true;
            return;
        }
        try {
            transport.postMessage({ type: 'spawn', instanceId: id });
        } catch {
            parked = true;
        }
    };

    const route = (message: WorkerToHost): void => {
        if (message.type === 'ready' || message.type === 'spawned') {
            handle.ready = true;
            live = true;
            // Spawns precede ticks: the worker handles messages in order, so
            // a tick posted here can never overtake its slot's spawn.
            const queued = handle.pendingSpawns.splice(0, handle.pendingSpawns.length);
            for (const id of queued) postSpawn(id);
            flush();
        } else if (message.type === 'fatal') {
            handle.failed = true;
            parked = true;
        } else if (message.type === 'spawn-error') {
            if (message.instanceId === instanceId) parked = true;
        } else if (message.type === 'intent') {
            if (message.instanceId !== instanceId) return;
            held = validIntent(message.intent) ? message.intent : idleIntent();
            inFlight = false;
            flush();
        } else if (message.type === 'intent-error') {
            if (message.instanceId !== instanceId) return;
            // A throwing tick parks on neutral until the next good reply,
            // mirroring the engine's throw→idle guard for page-realm robots.
            held = idleIntent();
            inFlight = false;
            flush();
        }
        // validate-* traffic never reaches a match transport; ignore it.
    };

    const flush = (): void => {
        if (!live || parked || inFlight || pending === null || transport === null) return;
        const snapshot = pending;
        pending = null;
        inFlight = true;
        try {
            transport.postMessage({ type: 'tick', instanceId, snapshot });
        } catch {
            inFlight = false;
            held = idleIntent();
        }
    };

    if (transport !== null) {
        const prev = transport.onmessage;
        transport.onmessage = (message) => {
            try {
                prev?.(message);
            } catch {
                // One slot's stale handler must not break another's routing.
            }
            route(message);
        };
        if (!handle.loadPosted) {
            handle.loadPosted = true;
            try {
                transport.postMessage({ type: 'load', code: handle.source, dryRun: false });
            } catch {
                parked = true;
            }
        }
        // The worker loads asynchronously: queue the spawn until it signals
        // ready (sent ahead of any tick in route() above). Slots created
        // after ready spawn immediately.
        if (!parked) {
            if (handle.ready) postSpawn(instanceId);
            else handle.pendingSpawns.push(instanceId);
        }
    } else {
        parked = true;
    }

    const controller: RobotController = {
        meta,
        loadout,
        update: (sense: SenseState): Intent => {
            if (parked || transport === null) return idleIntent();
            let snapshot: SandboxSnapshot;
            try {
                snapshot = buildSnapshot(sense, seed);
            } catch {
                return idleIntent();
            }
            if (!live || inFlight) {
                pending = snapshot;
                return { ...held };
            }
            pending = snapshot;
            flush();
            return { ...held };
        },
    };
    // The engine calls this at match setup when present (see Match). It is
    // NOT part of the robot contract in sim/types: built-in controllers
    // simply lack the method and behave exactly as before.
    const withSeed = controller as RobotController & { setMatchSeed: (matchSeed: number) => void };
    withSeed.setMatchSeed = (matchSeed: number): void => {
        seed = matchSeed;
    };
    return controller;
}
