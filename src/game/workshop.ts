// Robot workshop: starter template + static sanity checks for user robot
// code. This module NEVER executes the code it inspects — checks are plain
// string analysis (structure regexes + denylisted-API scans over comments
// and string literals stripped out). Execution arrives nowhere in this app.

import { SKILL_DEFS } from '../sim/skills';
import {
    blockedImportDetail,
    commaList,
    FALLBACK_ROBOT_FILENAME,
    loadoutPointsDetail,
    missingDetail,
    tsFilename,
    unknownSkillDetail,
    WORKSHOP_CHECKS,
} from './strings';

/** Starter robot: the one-file shape from docs/ROBOT_API.md, ready to edit. */
export const WORKSHOP_TEMPLATE = `// MyBot: describe your strategy in one line.
// Starter template from the RobotArena workshop. Edit, download, and submit
// via pull request (see CONTRIBUTING.md). Rules: deterministic only — use
// sense.rand() for randomness, never Math.random or Date.now.

import type { SkillLoadout } from '../sim/skills';
import type { Intent, RobotController, RobotMeta, SenseState } from '../sim/types';

export const meta: RobotMeta = {
    id: 'mybot',
    name: 'MyBot',
    author: 'you',
    version: '1.0.0',
    description: 'Describe your strategy in one line.',
};

// Default skill build: 6 points max, same catalog as every slot.
export const loadout: SkillLoadout = { overdrive: 2, trigger: 2, plating: 2 };

// Every Intent field is optional: return only what you need. Beyond the
// basics below, the engine offers assists — strafe (lateral drive),
// moveMode: 1 + moveX/moveY (drive assist), aimMode: 1|2 + aimTarget
// (turret assist), fireMode: 1 (auto-fire on a locked assist), and radio
// (one team message per tick). See docs/ROBOT_API.md; the engine clamps
// every field, so partial returns like "fire: true" alone are complete.

export function create(): RobotController {
    // Per-match memory lives here, inside create() — never at module level.

    function update(sense: SenseState): Intent {
        const self = sense.self;
        const foe = sense.foes[0];
        if (foe === undefined) {
            // Blind: sweep the turret while advancing.
            return { throttle: 0.6, turn: 0, towerTurn: 0.8, fire: false, charge: false };
        }
        // Seen: aim the turret at the foe and snap-fire when roughly aimed.
        // Replace this stub with your strategy.
        const goal = Math.atan2(foe.y - self.y, foe.x - self.x);
        let diff = goal - self.tower;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const towerTurn = Math.max(-1, Math.min(1, diff * 3));
        return { throttle: 1, turn: 0, towerTurn, fire: Math.abs(diff) < 0.07, charge: false };
    }

    return { meta, loadout, update };
}
`;

export interface WorkshopCheck {
    id: string;
    label: string;
    pass: boolean;
    detail: string;
}

/** Strip comments and string literals so scans only see real code. */
function stripCode(source: string): string {
    let out = '';
    let i = 0;
    const n = source.length;
    let quote: string | null = null;
    while (i < n) {
        const ch = source[i];
        const next = i + 1 < n ? source[i + 1] : '';
        if (quote !== null) {
            if (ch === '\\') {
                i += 2;
                continue;
            }
            if (ch === quote) quote = null;
            i += 1;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch;
            i += 1;
            continue;
        }
        if (ch === '/' && next === '/') {
            while (i < n && source[i] !== '\n') i += 1;
            continue;
        }
        if (ch === '/' && next === '*') {
            i += 2;
            while (i < n && !(source[i] === '*' && i + 1 < n && source[i + 1] === '/')) i += 1;
            i += 2;
            continue;
        }
        out += ch;
        i += 1;
    }
    return out;
}

function tokenPresent(code: string, token: string): boolean {
    return new RegExp(`\\b${token.replace(/\./g, '\\.')}\\b`).test(code);
}

/** First meta id string: id: 'mybot' (double quotes accepted). */
export function extractMetaId(source: string): string | null {
    const match = /id\s*:\s*['"]([^'"]+)['"]/.exec(source);
    return match ? (match[1] as string) : null;
}

/** Download name from the draft's meta id, with a safe fallback. */
export function suggestFilename(source: string): string {
    const id = extractMetaId(source);
    if (id && /^[a-z0-9-]+$/.test(id)) return tsFilename(id);
    return FALLBACK_ROBOT_FILENAME;
}

interface LoadoutParse {
    found: boolean;
    total: number;
    unknown: string[];
}

/** Sum ranks in the `loadout = { ... }` literal; dynamic builds skip. */
function parseLoadout(source: string): LoadoutParse {
    const block = /loadout[^=]*=\s*\{([^}]*)\}/.exec(source);
    if (!block) return { found: false, total: 0, unknown: [] };
    const known = new Set<string>(SKILL_DEFS.map((def) => def.id));
    let total = 0;
    const unknown: string[] = [];
    const pairs = block[1] ?? '';
    for (const match of pairs.matchAll(/([A-Za-z_][\w]*)\s*:\s*(\d+)/g)) {
        const skill = match[1] as string;
        total += Number(match[2]);
        if (!known.has(skill) && !unknown.includes(skill)) unknown.push(skill);
    }
    return { found: true, total, unknown };
}

function importSpecifiers(source: string): string[] {
    const specs: string[] = [];
    for (const match of source.matchAll(/import\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g)) {
        specs.push(match[1] as string);
    }
    return specs;
}

const BANNED_TIME = ['Math.random', 'Date.now', 'performance.now', 'setTimeout', 'setInterval', 'requestAnimationFrame'];
const BANNED_IO = ['fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB'];
const BANNED_HOST = [
    'document',
    'window',
    'globalThis',
    'navigator',
    'location',
    'eval',
    'Function',
    'require',
    'process',
    'alert',
    'confirm',
    'prompt',
    'Worker',
];

function offenders(code: string, names: string[]): string[] {
    return names.filter((name) => tokenPresent(code, name));
}

/** Run every static sanity check over a robot draft. Never executes it. */
export function checkRobotSource(source: string): WorkshopCheck[] {
    const code = stripCode(source);
    const checks: WorkshopCheck[] = [];

    const metaExport = /export\s+(const|let|var)\s+meta\b/.test(source);
    const metaKeys = ['id', 'name', 'author', 'version', 'description'];
    const missingKeys = metaKeys.filter((key) => !new RegExp(`\\b${key}\\s*:`).test(source));
    checks.push({
        id: 'meta-shape',
        label: WORKSHOP_CHECKS.metaShape.label,
        pass: metaExport && missingKeys.length === 0,
        detail: !metaExport ? WORKSHOP_CHECKS.metaShape.noMeta : missingDetail(missingKeys),
    });

    const id = extractMetaId(source);
    checks.push({
        id: 'meta-id',
        label: WORKSHOP_CHECKS.metaId.label,
        pass: id !== null && /^[a-z0-9-]+$/.test(id),
        detail: id === null ? WORKSHOP_CHECKS.metaId.noId : id,
    });

    checks.push({
        id: 'loadout-export',
        label: WORKSHOP_CHECKS.loadoutExport.label,
        pass: /export\s+(const|let|var)\s+loadout\b/.test(source),
        detail: '',
    });

    const parsed = parseLoadout(source);
    checks.push({
        id: 'loadout-budget',
        label: WORKSHOP_CHECKS.loadoutBudget.label,
        pass: !parsed.found || parsed.total <= 6,
        detail: !parsed.found ? WORKSHOP_CHECKS.loadoutBudget.dynamic : loadoutPointsDetail(parsed.total),
    });
    checks.push({
        id: 'loadout-skills',
        label: WORKSHOP_CHECKS.loadoutSkills.label,
        pass: parsed.unknown.length === 0,
        detail: !parsed.found ? WORKSHOP_CHECKS.loadoutSkills.dynamic : unknownSkillDetail(parsed.unknown),
    });

    checks.push({
        id: 'create-export',
        label: WORKSHOP_CHECKS.createExport.label,
        pass: /export\s+function\s+create\b/.test(source) || /export\s+(const|let|var)\s+create\s*=/.test(source),
        detail: '',
    });

    // Intent fields are optional-with-default, so a partial return like
    // `{ fire: true }` is legal. What fails is an UNKNOWN field inside a
    // returned object literal that otherwise looks like an Intent (it names
    // at least one known field) — almost always a typo'd key.
    const knownIntent = new Set([
        'throttle', 'turn', 'towerTurn', 'fire', 'charge', 'dash', 'emp',
        'strafe', 'moveX', 'moveY', 'moveMode', 'aimMode', 'aimTarget', 'aimLead', 'fireMode', 'radio',
    ]);
    const unknownIntent: string[] = [];
    for (const literal of code.matchAll(/return\s*\{([^}]*)\}/g)) {
        const keys = new Set<string>();
        for (const part of (literal[1] ?? '').split(',')) {
            const key = /^\s*([A-Za-z_]\w*)\s*(?::|$)/.exec(part)?.[1];
            if (key) keys.add(key);
        }
        if (![...keys].some((key) => knownIntent.has(key))) continue;
        for (const key of keys) {
            if (!knownIntent.has(key) && !unknownIntent.includes(key)) unknownIntent.push(key);
        }
    }
    checks.push({
        id: 'intent-shape',
        label: WORKSHOP_CHECKS.intentShape.label,
        pass: unknownIntent.length === 0,
        detail: unknownSkillDetail(unknownIntent),
    });

    const badImports = importSpecifiers(source).filter(
        (spec) => !spec.startsWith('../sim/') && !spec.startsWith('./common'),
    );
    checks.push({
        id: 'imports',
        label: WORKSHOP_CHECKS.imports.label,
        pass: badImports.length === 0,
        detail: blockedImportDetail(badImports),
    });

    const time = offenders(code, BANNED_TIME);
    checks.push({
        id: 'no-nondeterminism',
        label: WORKSHOP_CHECKS.noNondeterminism.label,
        pass: time.length === 0,
        detail: commaList(time),
    });
    const io = offenders(code, BANNED_IO);
    checks.push({
        id: 'no-io',
        label: WORKSHOP_CHECKS.noIo.label,
        pass: io.length === 0,
        detail: commaList(io),
    });
    const host = offenders(code, BANNED_HOST);
    const dynamicImport = /\bimport\s*\(/.test(code);
    checks.push({
        id: 'no-host',
        label: WORKSHOP_CHECKS.noHost.label,
        pass: host.length === 0 && !dynamicImport,
        detail: commaList([...host, ...(dynamicImport ? [WORKSHOP_CHECKS.noHost.dynamicImportToken] : [])]),
    });

    return checks;
}

/** True when every check passes. */
export function workshopPassed(checks: WorkshopCheck[]): boolean {
    return checks.every((check) => check.pass);
}
