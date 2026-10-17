// Robot sandbox protocol: the ONLY bridge untrusted robot code may cross.
//
// Untrusted (user-supplied) robot source never executes in the page realm.
// It runs inside a Web Worker (`robotWorker.ts`) with no DOM, no page
// globals, and neutered network/storage APIs. The host (`sandboxedRobot.ts`)
// sends a structured-cloneable sense snapshot per tick and receives an
// actuator Intent back. This module holds the shared message shapes plus the
// pure, DOM-free helpers both sides use, so headless Node harnesses can
// import it too (it must never gain DOM/Worker/Phaser dependencies).

import { computeStats, sanitizeLoadout, type SkillLoadout } from '../sim/skills';
import { createRng } from '../sim/rng';
import { IDLE_INTENT, type Intent, type RobotMeta, type SenseState } from '../sim/types';

/** Material the worker needs to rebuild the exact per-tick rand stream. */
export interface SandboxRngMaterial {
    seed: number;
    robotId: number;
    tick: number;
}

/**
 * What crosses the worker boundary: every SenseState channel except the
 * `rand` closure (functions cannot be structured-cloned), plus the RNG
 * material to rebuild an identical stream inside the worker.
 */
export type SandboxSnapshot = Omit<SenseState, 'rand'> & { rng: SandboxRngMaterial };

/** Strip the `rand` closure and attach RNG material. Never aliases engine state. */
export function buildSnapshot(sense: SenseState, seed: number): SandboxSnapshot {
    const { rand: _rand, ...rest } = sense;
    void _rand;
    return {
        ...rest,
        rng: { seed, robotId: sense.self.id, tick: sense.tick },
    };
}

/**
 * Rebuild a live SenseState inside the worker. The RNG formula must match
 * `Match.sense()` in `src/sim/engine.ts` exactly: same (seed, robot, tick)
 * draws the same values as a page-realm controller would see.
 */
export function rebuildSense(snapshot: SandboxSnapshot): SenseState {
    const { rng, ...rest } = snapshot;
    return {
        ...rest,
        rand: createRng(
            (rng.seed ^ Math.imul(rng.robotId + 1, 2654435761) ^ Math.imul(rng.tick + 1, 40503)) >>> 0,
        ),
    };
}

/** Host→worker messages. */
export type HostToWorker =
    | { type: 'load'; code: string; dryRun: boolean }
    | { type: 'spawn'; instanceId: string }
    | { type: 'tick'; instanceId: string; snapshot: SandboxSnapshot }
    | { type: 'dispose'; instanceId: string };

/** Worker→host messages. */
export type WorkerToHost =
    | { type: 'validate-ok'; meta: RobotMeta; loadout: SkillLoadout }
    | { type: 'validate-error'; error: string }
    | { type: 'ready' }
    | { type: 'fatal'; error: string }
    | { type: 'spawned'; instanceId: string }
    | { type: 'spawn-error'; instanceId: string; error: string }
    | { type: 'intent'; instanceId: string; intent: Intent }
    | { type: 'intent-error'; instanceId: string; error: string };

/** Minimal transport over a real Web Worker (browser) or a test loopback. */
export interface SandboxTransport {
    postMessage(message: HostToWorker): void;
    onmessage: ((message: WorkerToHost) => void) | null;
    terminate(): void;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export function validMeta(raw: unknown): RobotMeta | null {
    if (!isRecord(raw)) return null;
    const fields: Array<keyof RobotMeta> = ['id', 'name', 'author', 'version', 'description'];
    for (const field of fields) {
        const value = raw[field];
        if (typeof value !== 'string' || value.length === 0 || value.length > 120) return null;
    }
    const meta = raw as unknown as RobotMeta;
    if (!/^[a-z0-9-]+$/.test(meta.id)) return null;
    return { id: meta.id, name: meta.name, author: meta.author, version: meta.version, description: meta.description };
}

export function validIntent(raw: unknown): raw is Intent {
    if (!isRecord(raw)) return false;
    // Every Intent field is optional-with-default: missing is fine, present
    // must be the right type (the engine clamps ranges downstream).
    for (const field of ['throttle', 'turn', 'towerTurn', 'strafe', 'moveX', 'moveY', 'moveMode', 'aimMode', 'aimTarget', 'fireMode']) {
        const value = raw[field];
        if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) return false;
    }
    for (const field of ['fire', 'charge', 'dash', 'emp', 'aimLead']) {
        const value = raw[field];
        if (value !== undefined && typeof value !== 'boolean') return false;
    }
    const radio = raw['radio'];
    if (radio !== undefined && radio !== null && typeof radio !== 'object') return false;
    return true;
}

/** Minimal synthetic sense for the one-call dry run (never live engine state). */
export function dryRunSense(): SenseState {
    return {
        tick: 0,
        time: 0,
        self: {
            id: 0,
            team: 0,
            x: 0,
            y: 0,
            heading: 0,
            tower: 0,
            speed: 0,
            health: 100,
            cooldown: 0,
            stats: computeStats({}),
            charge: 0,
            charged: false,
            dashCd: 0,
            empCd: 0,
            slowed: false,
            loadout: {},
            lastDamage: null,
            blocked: { ahead: 0 },
        },
        foes: [],
        allies: [],
        scout: [],
        shared: [],
        walls: { left: 0, right: 0, top: 0, bottom: 0 },
        rand: () => 0.5,
        inbox: [],
    };
}

/**
 * Leftover TypeScript after import-type stripping (annotations, interfaces,
 * return types). Upgrades a cryptic SyntaxError into an actionable message.
 */
export function looksLikeTypescript(code: string): boolean {
    return (
        /^\s*interface\s+\w+/m.test(code) ||
        /:\s*[A-Z][\w$]*(<[\w\s,[\]<>|&?.]+>)?\s*[=;,)]/.test(code) ||
        /\)\s*:\s*[\w$[\]<>|&?. ]+\s*\{/.test(code)
    );
}

/** Validate the shape/usability pieces both import paths need. Kept together. */
export function sanitizeImportedLoadout(raw: unknown): { ok: true; loadout: SkillLoadout } | { ok: false } {
    try {
        return { ok: true, loadout: sanitizeLoadout(raw ?? {}) };
    } catch {
        return { ok: false };
    }
}

/** The neutral command held while a worker reply is outstanding. */
export function idleIntent(): Intent {
    return { ...IDLE_INTENT };
}
