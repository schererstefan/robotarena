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

/**
 * Strip comments and string literals so scans only see real code.
 *
 * Template-literal literal text stays hidden, but code inside `${...}`
 * interpolations stays visible (recursively, including nested templates).
 * Regex literals are hidden whole so a `//` inside one is not mistaken for
 * a comment start.
 */
function stripCode(source: string): string {
    let out = '';
    let i = 0;
    const n = source.length;

    // Template/interpolation stack. Empty means top-level code.
    // A 'template' frame skips literal text until ` or ${. An 'interp'
    // frame is code until its matching } (depth counts nested braces).
    type Frame = { kind: 'template' } | { kind: 'interp'; depth: number };
    const stack: Frame[] = [];

    // Previous significant token (for regex-vs-division). lastWord is the
    // trailing identifier/keyword; lastSig is the last non-space code char
    // not inside a stripped string/comment/regex/template-text. A value
    // (string/regex/template/number) marks lastSig as ')' so a following
    // `/` reads as division.
    let lastWord = '';
    let lastSig = '';

    const REGEX_KEYWORDS = new Set([
        'return',
        'typeof',
        'case',
        'delete',
        'void',
        'in',
        'instanceof',
        'throw',
        'new',
        'yield',
        'await',
        'of',
        'else',
        'do',
    ]);
    // After one of these a `/` starts an expression, so it can be a regex.
    const REGEX_OPS = new Set([
        '(',
        ',',
        '=',
        ':',
        ';',
        '!',
        '&',
        '|',
        '?',
        '{',
        '}',
        '[',
        '+',
        '-',
        '*',
        '/',
        '%',
        '<',
        '>',
        '^',
        '~',
    ]);

    const top = (): Frame | undefined => stack[stack.length - 1];
    const inTemplate = (): boolean => top()?.kind === 'template';

    function regexAllowed(): boolean {
        if (lastWord !== '' && REGEX_KEYWORDS.has(lastWord)) return true;
        if (lastSig === '') return true;
        return REGEX_OPS.has(lastSig);
    }

    function markValue(): void {
        lastWord = '';
        lastSig = ')';
    }

    function emitWord(word: string): void {
        out += word;
        lastWord = word;
        lastSig = word[word.length - 1] as string;
    }

    function emitChar(ch: string): void {
        out += ch;
        lastWord = '';
        lastSig = ch;
    }

    const isWordStart = (c: string): boolean =>
        (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_' || c === '$';
    const isWordChar = (c: string): boolean => isWordStart(c) || (c >= '0' && c <= '9');
    const isDigit = (c: string): boolean => c >= '0' && c <= '9';
    const isSpace = (c: string): boolean =>
        c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';

    /** True when the token before the current position is a value (not an
     * operator/keyword), so a following `++`/`--` is postfix. */
    function prevIsValue(): boolean {
        if (lastWord !== '') return !REGEX_KEYWORDS.has(lastWord);
        if (lastSig === ')' || lastSig === ']') return true;
        if (lastSig !== '' && (isWordChar(lastSig) || isDigit(lastSig))) return true;
        return false;
    }

    // Try to skip a regex literal at index `start` (source[start] === '/').
    // Returns the index just past the flags on success, null when the
    // literal is unterminated (caller then treats `/` as division code).
    function regexEnd(start: number): number | null {
        let j = start + 1;
        let inClass = false;
        while (j < n) {
            const c = source[j] as string;
            if (c === '\\') {
                j += 2;
                continue;
            }
            if (c === '\n') return null;
            if (c === '[' && !inClass) {
                inClass = true;
                j += 1;
                // A `]` first in the class (after an optional `^`) is a
                // literal, not the close.
                if (source[j] === '^') j += 1;
                if (source[j] === ']') j += 1;
                continue;
            }
            if (c === ']' && inClass) {
                inClass = false;
                j += 1;
                continue;
            }
            if (c === '/' && !inClass) {
                j += 1;
                while (j < n && 'gimsuyd'.includes(source[j] as string)) j += 1;
                return j;
            }
            j += 1;
        }
        return null;
    }

    while (i < n) {
        const ch = source[i] as string;
        const next = i + 1 < n ? (source[i + 1] as string) : '';

        if (inTemplate()) {
            if (ch === '\\') {
                i += 2;
                continue;
            }
            if (ch === '`') {
                stack.pop();
                i += 1;
                markValue();
                continue;
            }
            if (ch === '$' && next === '{') {
                stack.push({ kind: 'interp', depth: 0 });
                i += 2;
                // Fresh expression inside the interpolation.
                lastWord = '';
                lastSig = '';
                continue;
            }
            i += 1;
            continue;
        }

        // Code mode (top-level, or inside a template interpolation).
        if (ch === '`') {
            stack.push({ kind: 'template' });
            i += 1;
            continue;
        }
        if (ch === '"' || ch === "'") {
            i += 1;
            while (i < n) {
                const c = source[i] as string;
                if (c === '\\') {
                    i += 2;
                    continue;
                }
                if (c === ch) {
                    i += 1;
                    break;
                }
                i += 1;
            }
            markValue();
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
        if (ch === '/') {
            if (regexAllowed()) {
                const end = regexEnd(i);
                if (end !== null) {
                    i = end;
                    markValue();
                    continue;
                }
            }
            emitChar(ch);
            i += 1;
            continue;
        }
        if (isSpace(ch)) {
            out += ch;
            i += 1;
            continue;
        }
        if (isWordStart(ch)) {
            const start = i;
            i += 1;
            while (i < n && isWordChar(source[i] as string)) i += 1;
            emitWord(source.slice(start, i));
            continue;
        }
        if (isDigit(ch)) {
            const start = i;
            i += 1;
            while (i < n) {
                const c = source[i] as string;
                if (isDigit(c) || c === '.' || c === '_' || c === 'x' || c === 'X') i += 1;
                else break;
            }
            out += source.slice(start, i);
            lastWord = '';
            lastSig = source[i - 1] as string;
            continue;
        }
        if ((ch === '+' || ch === '-') && next === ch) {
            const postfix = prevIsValue();
            out += ch + ch;
            lastWord = '';
            // Postfix `++`/`--` ends a value; prefix starts an expression.
            lastSig = postfix ? ')' : ch;
            i += 2;
            continue;
        }
        if (ch === '{') {
            const frame = top();
            if (frame?.kind === 'interp') frame.depth += 1;
            emitChar(ch);
            i += 1;
            continue;
        }
        if (ch === '}') {
            const frame = top();
            if (frame?.kind === 'interp') {
                if (frame.depth > 0) {
                    frame.depth -= 1;
                    emitChar(ch);
                } else {
                    // Closing delimiter: resume the enclosing template text.
                    stack.pop();
                }
                i += 1;
                continue;
            }
            emitChar(ch);
            i += 1;
            continue;
        }
        emitChar(ch);
        i += 1;
    }
    return out;
}

function tokenPresent(code: string, token: string): boolean {
    return new RegExp(`\\b${token.replace(/\./g, '\\.')}\\b`).test(code);
}

/**
 * File-level heuristic for the `self` host global.
 *
 * `self` is the documented game-API idiom (`const self = sense.self;` plus
 * later `self.y` uses, and direct `sense.self.*` property reads). A bare
 * `self` reference is `window.self`, while a property access (`sense.self`)
 * can never be the global.
 *
 * Limitation: this is a file-level heuristic. A file that declares `self`
 * inside one nested function while using the bare global at module level
 * could slip through. Accepted because the scanner is heuristic, the other
 * host globals (`globalThis`, `window`, `top`, `parent`, `frames`,
 * `constructor`, `document`) remain blocked, and banning the token outright
 * breaks the repo's own template and bundled robots.
 */
function hasLocalSelfBinding(code: string): boolean {
    if (/\b(?:const|let|var)\s+self\b/.test(code)) return true;
    if (/\bfunction\s+self\b/.test(code)) return true;
    if (/\bfunction\s*(?:\w+\s*)?\([^)]*\bself\b/.test(code)) return true;
    if (/\bcatch\s*\(\s*self\b/.test(code)) return true;
    // A parenthesized group only counts as a parameter list when it is
    // arrow-function params (`(self) =>`, `(x, self) =>`) or a method
    // definition (`name(self) { ... }`, with an optional `: ReturnType`).
    // A call like `foo(self)` or a parenthesized value like `(self).foo`
    // must not count — those are bare uses of the global.
    if (/\(\s*self\b[^)]*\)\s*=>/.test(code)) return true;
    if (/\(\s*[^)]*,\s*self\b[^)]*\)\s*=>/.test(code)) return true;
    if (/\b(?!if\b|while\b|for\b|switch\b|catch\b)\w+\s*\(\s*self\b[^)]*\)\s*(?::\s*[^,{]*)?\s*\{/.test(code)) return true;
    if (/\b(?!if\b|while\b|for\b|switch\b|catch\b)\w+\s*\(\s*[^)]*,\s*self\b[^)]*\)\s*(?::\s*[^,{]*)?\s*\{/.test(code)) return true;
    if (/(^|[^\w$.])self\s*=>/.test(code)) return true;
    return false;
}

function isBareSelfGlobal(code: string): boolean {
    if (hasLocalSelfBinding(code)) return false;
    const re = /\bself\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
        const idx = m.index;
        if (idx > 0 && code[idx - 1] === '.') continue;
        // Property/type name definition `self:` (e.g. `interface RoleSense { self: ... }`
        // or `shouldBank(self: ...)`) is not a reference to window.self.
        const after = code.slice(idx + 'self'.length).trimStart();
        if (after.startsWith(':')) {
            continue;
        }
        return true;
    }
    return false;
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
    'self',
    'top',
    'parent',
    'frames',
    'constructor',
];

function offenders(code: string, names: string[]): string[] {
    return names.filter((name) => {
        if (name === 'self') return isBareSelfGlobal(code);
        return tokenPresent(code, name);
    });
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
    for (const m of code.matchAll(/return\s*\{/g)) {
        // Top-level keys only: brace-count past nested literals so an inline
        // radio object doesn't read as unknown Intent keys (strings and
        // comments are already stripped).
        let depth = 1;
        let i = (m.index ?? 0) + m[0].length;
        let top = '';
        while (i < code.length && depth > 0) {
            const ch = code[i] as string;
            i += 1;
            if (ch === '{') depth += 1;
            else if (ch === '}') depth -= 1;
            else if (depth === 1) top += ch;
        }
        const keys = new Set<string>();
        for (const part of top.split(',')) {
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
        (spec) => !spec.startsWith('../sim/') && !spec.startsWith('./common') && !spec.startsWith('./comms'),
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
