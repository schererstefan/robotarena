// Imported (exhibition-only) robots: load a robot file or URL through a
// guarded dynamic import, validate its shape, and dry-run one pure update()
// call. Imports live in a session-only registry: they never touch ROBOTS
// (compact replay codes index into that array), never enter tournaments or
// leaderboards, and any failure rejects with a message instead of breaking
// the shell (validate shape, try/catch every boundary, timeout-free single
// synchronous dry-run call — no timers, no workers).

import { getRobot, ROBOTS, type RobotEntry } from '../robots/registry';
import { computeStats, sanitizeLoadout, type SkillLoadout } from '../sim/skills';
import { IDLE_INTENT, type RobotController, type RobotFactory, type RobotMeta, type SenseState } from '../sim/types';
import {
    checkFailureLine,
    IMPORT_ERROR,
    importBlockedApi,
    importCreateThrew,
    importFetchHttp,
    importLoadFailed,
    importUpdateThrew,
    importValueImports,
} from './strings';
import { checkRobotSource } from './workshop';

export interface ImportedRobot {
    meta: RobotMeta;
    loadout: SkillLoadout;
    create: RobotFactory;
}

export type ImportResult = { ok: true; id: string; robot: ImportedRobot } | { ok: false; error: string };

/** Registry ids are namespaced so they can never collide with ROBOTS ids. */
export const IMPORT_PREFIX = 'custom:';
const MAX_SOURCE_BYTES = 256 * 1024;

const registry = new Map<string, ImportedRobot>();

export function isImportedId(id: string): boolean {
    return id.startsWith(IMPORT_PREFIX);
}

export function getImported(id: string): ImportedRobot | undefined {
    return registry.get(id);
}

/** Builtin, imported, or the first builtin as a last resort (never throws). */
export function resolveLineupEntry(id: string): RobotEntry {
    return getRobot(id) ?? getImported(id) ?? ROBOTS[0]!;
}

/** Sprite id for menus/battles: imports reuse a generic scout look. */
export function displayRobotId(id: string): string {
    // Hillclimb variants (e.g. hunter-hc1) share base chassis art:
    // the registry only bakes the 8 base chassis, so map -hcN -> base.
    const base = id.replace(/-hc\d+$/, "");
    if (getRobot(base) !== undefined) return base;
    return getRobot(id) !== undefined ? id : 'wanderer';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function validMeta(raw: unknown): RobotMeta | null {
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

function validIntent(raw: unknown): boolean {
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
function dryRunSense(): SenseState {
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
 * Strip type-only imports (the workshop template's `import type` lines) so a
 * dependency-free module can load from a blob URL. Value imports cannot be
 * resolved safely from a blob, so they are rejected with a clear error.
 */
export function prepareModuleSource(source: string): { ok: true; code: string } | { ok: false; error: string } {
    if (source.length > MAX_SOURCE_BYTES) return { ok: false, error: IMPORT_ERROR.tooLarge };
    const code = source
        .split('\n')
        .filter((line) => !/^\s*import\s+type\b/.test(line))
        .join('\n');
    if (/\bimport\s*\(/.test(code)) return { ok: false, error: IMPORT_ERROR.dynamicImport };
    const valueImport = /^\s*import\s+(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/m.exec(code);
    if (valueImport) {
        return { ok: false, error: importValueImports(valueImport[1] ?? IMPORT_ERROR.unknown) };
    }
    return { ok: true, code };
}

/** Safety pre-scan: the workshop's nondeterminism/IO/host checks must pass. */
function safetyError(source: string): string | null {
    const wanted = new Set(['no-nondeterminism', 'no-io', 'no-host']);
    for (const check of checkRobotSource(source)) {
        if (wanted.has(check.id) && !check.pass) {
            return checkFailureLine(check.label, check.detail);
        }
    }
    return null;
}

/**
 * Validate a dynamically imported module and register it. Every boundary is
 * guarded: bad shapes reject, create() and the single dry-run update() run
 * inside try/catch, and the stored factory wraps update() so a per-tick
 * throw degrades to an idle intent (mirroring the engine's own guard).
 */
export function validateAndRegister(module: unknown): ImportResult {
    if (!isRecord(module) || typeof module['create'] !== 'function') {
        return { ok: false, error: IMPORT_ERROR.noCreate };
    }
    const meta = validMeta(module['meta']);
    if (!meta) {
        return { ok: false, error: IMPORT_ERROR.badMeta };
    }
    let loadout: SkillLoadout = {};
    try {
        loadout = sanitizeLoadout(module['loadout'] ?? {});
    } catch {
        return { ok: false, error: IMPORT_ERROR.badLoadout };
    }
    let controller: RobotController;
    try {
        controller = (module['create'] as RobotFactory)();
    } catch (error) {
        return { ok: false, error: importCreateThrew(error instanceof Error ? error.message : IMPORT_ERROR.unknown) };
    }
    if (!isRecord(controller) || typeof controller['update'] !== 'function') {
        return { ok: false, error: IMPORT_ERROR.noUpdate };
    }
    const update = controller['update'] as RobotController['update'];
    try {
        // Timeout-free pure call: one synchronous tick against synthetic sense.
        const intent = update(dryRunSense());
        if (!validIntent(intent)) return { ok: false, error: IMPORT_ERROR.badIntent };
    } catch (error) {
        return { ok: false, error: importUpdateThrew(error instanceof Error ? error.message : IMPORT_ERROR.unknown) };
    }
    const create: RobotFactory = () => {
        let inner: RobotController;
        try {
            inner = (module['create'] as RobotFactory)();
        } catch {
            // A factory that passed the dry run but throws at match time
            // degrades to a parked robot instead of breaking battle setup.
            return { meta, loadout: { ...loadout }, update: () => ({ ...IDLE_INTENT }) };
        }
        const innerUpdate = inner.update.bind(inner);
        return {
            ...inner,
            meta,
            loadout: { ...loadout },
            update: (sense: SenseState) => {
                try {
                    const intent = innerUpdate(sense);
                    return validIntent(intent) ? intent : { ...IDLE_INTENT };
                } catch {
                    return { ...IDLE_INTENT };
                }
            },
        };
    };
    let id = `${IMPORT_PREFIX}${meta.id}`;
    for (let n = 2; registry.has(id); n += 1) id = `${IMPORT_PREFIX}${meta.id}-${n}`;
    const robot: ImportedRobot = { meta, loadout, create };
    registry.set(id, robot);
    return { ok: true, id, robot };
}

/**
 * Leftover TypeScript after import-type stripping (annotations, interfaces,
 * return types). Runs only on the blob-import failure path, so plain
 * JavaScript never reaches it — a match upgrades a cryptic SyntaxError into
 * an actionable message.
 */
export function looksLikeTypescript(code: string): boolean {
    return (
        /^\s*interface\s+\w+/m.test(code) ||
        /:\s*[A-Z][\w$]*(<[\w\s,[\]<>|&?.]+>)?\s*[=;,)]/.test(code) ||
        /\)\s*:\s*[\w$[\]<>|&?. ]+\s*\{/.test(code)
    );
}

/** Guarded dynamic import of prepared source via a blob module URL. */
async function importPrepared(code: string): Promise<ImportResult> {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    try {
        const module = (await import(/* @vite-ignore */ url)) as unknown;
        return validateAndRegister(module);
    } catch (error) {
        if (error instanceof SyntaxError && looksLikeTypescript(code)) {
            return { ok: false, error: IMPORT_ERROR.typescript };
        }
        const message = error instanceof Error ? error.message : IMPORT_ERROR.unknown;
        return { ok: false, error: importLoadFailed(message) };
    } finally {
        URL.revokeObjectURL(url);
    }
}

export async function importRobotFromText(source: string): Promise<ImportResult> {
    const blocked = safetyError(source);
    if (blocked !== null) return { ok: false, error: importBlockedApi(blocked) };
    const prepared = prepareModuleSource(source);
    if (!prepared.ok) return prepared;
    return importPrepared(prepared.code);
}

export async function importRobotFromFile(file: File): Promise<ImportResult> {
    let source: string;
    try {
        source = await file.text();
    } catch {
        return { ok: false, error: IMPORT_ERROR.readFailed };
    }
    return importRobotFromText(source);
}

export async function importRobotFromUrl(url: string): Promise<ImportResult> {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return { ok: false, error: IMPORT_ERROR.badUrl };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, error: IMPORT_ERROR.badProtocol };
    }
    let source: string;
    try {
        const response = await fetch(parsed.toString());
        if (!response.ok) return { ok: false, error: importFetchHttp(response.status) };
        source = await response.text();
    } catch {
        return { ok: false, error: IMPORT_ERROR.fetchFailed };
    }
    return importRobotFromText(source);
}

/**
 * Phase 1B capture hook (worktree-only): register a session-only robot for
 * the ?bgshot capture harness. Backed by the imported-robot registry —
 * never touches ROBOTS.
 */
export function registerCaptureRobot(id: string, robot: ImportedRobot): void {
    if (!id.startsWith(IMPORT_PREFIX)) throw new Error('capture robot id must use the custom: prefix');
    registry.set(id, robot);
}
