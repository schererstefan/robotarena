// Imported (exhibition-only) robots: load a robot file or URL string,
// validate it inside a Web Worker sandbox (never executed in the page
// realm), and register a worker-hosted controller. Imports live in a
// session-only registry: they never touch ROBOTS (compact replay codes
// index into that array), never enter tournaments or leaderboards, and any
// failure rejects with a message instead of breaking the shell.

import { getRobot, ROBOTS, type RobotEntry } from '../robots/registry';
import type { SkillLoadout } from '../sim/skills';
import type { RobotFactory, RobotMeta } from '../sim/types';
import { createSandboxHandle, createSandboxedController, validateRobotSourceInWorker } from './sandboxedRobot';
import {
    checkFailureLine,
    IMPORT_ERROR,
    importBlockedApi,
    importFetchHttp,
    importValueImports,
} from './strings';
import { checkRobotSource } from './workshop';

export interface ImportedRobot {
    meta: RobotMeta;
    loadout: SkillLoadout;
    create: RobotFactory;
    /** Base-chassis sprite id for session robots (e.g. league fighters); must be a registry id. */
    displayId?: string;
    /**
     * Provenance: true for string-derived user imports (their bytes only
     * ever execute inside the worker sandbox), false for trusted in-repo
     * factory registrations (league/capture bridges, which close over
     * reviewed code and never touch user strings).
     */
    sandboxed: boolean;
    /** Original user source (sandboxed entries only; replayed to match workers). */
    source?: string;
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
    // Session robots (e.g. league fighters) can pin a base chassis sprite.
    const imported = getImported(id);
    if (imported?.displayId !== undefined && getRobot(imported.displayId) !== undefined) {
        return imported.displayId;
    }
    // Hillclimb variants (e.g. hunter-hc1) share base chassis art:
    // the registry only bakes the 8 base chassis, so map -hcN -> base.
    const base = id.replace(/-hc\d+$/, "");
    if (getRobot(base) !== undefined) return base;
    return getRobot(id) !== undefined ? id : 'wanderer';
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
 * Register user source validated inside the worker sandbox. The stored
 * factory never executes user bytes in the page realm: every controller it
 * creates is worker-hosted (see sandboxedRobot.ts).
 */
function registerSandboxedRobot(meta: RobotMeta, loadout: SkillLoadout, source: string): ImportResult {
    const handle = createSandboxHandle(meta, loadout, source);
    const create: RobotFactory = () => createSandboxedController(handle);
    let id = `${IMPORT_PREFIX}${meta.id}`;
    for (let n = 2; registry.has(id); n += 1) id = `${IMPORT_PREFIX}${meta.id}-${n}`;
    const robot: ImportedRobot = { meta, loadout, create, sandboxed: true, source };
    registry.set(id, robot);
    return { ok: true, id, robot };
}

/**
 * Register a session-only robot under a fully-qualified id (must start
 * with `custom:`). Used by the League view for its curated fighters.
 * Idempotent: re-registering an existing id is a no-op.
 */
export function registerSessionRobot(id: string, robot: ImportedRobot): void {
    if (!id.startsWith(IMPORT_PREFIX)) throw new Error(`session robot id must start with ${IMPORT_PREFIX}`);
    if (!registry.has(id)) registry.set(id, robot);
}

export async function importRobotFromText(source: string): Promise<ImportResult> {
    // Defense in depth only: the worker sandbox is the security boundary,
    // this static scan just fails fast with a clear message.
    const blocked = safetyError(source);
    if (blocked !== null) return { ok: false, error: importBlockedApi(blocked) };
    const prepared = prepareModuleSource(source);
    if (!prepared.ok) return prepared;
    // The page realm never executes this code: validation (load, shape
    // checks, dry-run update) happens inside the worker. The worker maps
    // failures (including leftover TypeScript) to the same UI messages.
    let validated: { meta: RobotMeta; loadout: SkillLoadout };
    try {
        validated = await validateRobotSourceInWorker(prepared.code);
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : IMPORT_ERROR.unknown };
    }
    return registerSandboxedRobot(validated.meta, validated.loadout, prepared.code);
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
