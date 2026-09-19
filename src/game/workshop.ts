// Robot workshop: starter template + static sanity checks for user robot
// code. This module NEVER executes the code it inspects — checks are plain
// string analysis (structure regexes + denylisted-API scans over comments
// and string literals stripped out). Execution arrives nowhere in this app.

import { SKILL_DEFS } from '../sim/skills';

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
    if (id && /^[a-z0-9-]+$/.test(id)) return `${id}.ts`;
    return 'my-robot.ts';
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
        label: 'exports a meta object (id, name, author, version, description)',
        pass: metaExport && missingKeys.length === 0,
        detail: !metaExport ? 'no exported meta found' : missingKeys.map((k) => `missing ${k}`).join(', '),
    });

    const id = extractMetaId(source);
    checks.push({
        id: 'meta-id',
        label: 'meta id is lowercase (letters, digits, dashes)',
        pass: id !== null && /^[a-z0-9-]+$/.test(id),
        detail: id === null ? 'no meta id string found' : id,
    });

    checks.push({
        id: 'loadout-export',
        label: 'exports a default loadout',
        pass: /export\s+(const|let|var)\s+loadout\b/.test(source),
        detail: '',
    });

    const parsed = parseLoadout(source);
    checks.push({
        id: 'loadout-budget',
        label: 'loadout fits the 6-point budget',
        pass: !parsed.found || parsed.total <= 6,
        detail: !parsed.found ? 'dynamic loadout — budget not checked' : `${parsed.total} / 6 points`,
    });
    checks.push({
        id: 'loadout-skills',
        label: 'loadout uses known skill ids',
        pass: parsed.unknown.length === 0,
        detail: !parsed.found ? 'dynamic loadout — skills not checked' : parsed.unknown.map((s) => `unknown ${s}`).join(', '),
    });

    checks.push({
        id: 'create-export',
        label: 'exports a create() factory',
        pass: /export\s+function\s+create\b/.test(source) || /export\s+(const|let|var)\s+create\s*=/.test(source),
        detail: '',
    });

    const intentFields = ['throttle', 'turn', 'towerTurn', 'fire', 'charge'];
    const missingFields = intentFields.filter((field) => !tokenPresent(code, field));
    checks.push({
        id: 'intent-shape',
        label: 'update returns an Intent (throttle/turn/towerTurn/fire/charge)',
        pass: missingFields.length === 0,
        detail: missingFields.map((f) => `missing ${f}`).join(', '),
    });

    const badImports = importSpecifiers(source).filter(
        (spec) => !spec.startsWith('../sim/') && !spec.startsWith('./common'),
    );
    checks.push({
        id: 'imports',
        label: 'imports only sim helpers (../sim/*, ./common)',
        pass: badImports.length === 0,
        detail: badImports.map((spec) => `blocked ${spec}`).join(', '),
    });

    const time = offenders(code, BANNED_TIME);
    checks.push({
        id: 'no-nondeterminism',
        label: 'no random/time APIs (use sense.rand())',
        pass: time.length === 0,
        detail: time.join(', '),
    });
    const io = offenders(code, BANNED_IO);
    checks.push({
        id: 'no-io',
        label: 'no network or storage APIs',
        pass: io.length === 0,
        detail: io.join(', '),
    });
    const host = offenders(code, BANNED_HOST);
    const dynamicImport = /\bimport\s*\(/.test(code);
    checks.push({
        id: 'no-host',
        label: 'no DOM or code-escape APIs',
        pass: host.length === 0 && !dynamicImport,
        detail: [...host, ...(dynamicImport ? ['import('] : [])].join(', '),
    });

    return checks;
}

/** True when every check passes. */
export function workshopPassed(checks: WorkshopCheck[]): boolean {
    return checks.every((check) => check.pass);
}
