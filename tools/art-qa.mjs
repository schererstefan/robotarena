#!/usr/bin/env node
// art-qa: static checks over the procedural pixel art (plain node, no deps).
// Parses src/game/art/*.ts as text (string[] maps) and src/game/art.ts
// (PALETTE + bake determinism). Checks:
//   1. every map char exists in the art.ts palette ('.' = transparent)
//   2. no banned hexes in art.ts (pure #000000/#ffffff, purple family)
//   3. rectangular maps (equal row lengths)
//   4. per-sprite opaque color count within budget (<=16px: 6, <=32px: 10, else 16)
//   5. no Math.random in art.ts (bake must be pixel-identical every boot)
// Failures print as file:line. Exit non-zero on any failure.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ART_DIR = join(ROOT, 'src/game/art');
const ART_TS = join(ROOT, 'src/game/art.ts');

const failures = [];
const fail = (file, line, msg) => failures.push(`${relative(ROOT, file)}:${line}: ${msg}`);

// --- palette + hex scan of art.ts -------------------------------------------
const artSrc = readFileSync(ART_TS, 'utf8');
const artLines = artSrc.split('\n');

// PALETTE block: single-char keys with '#rrggbb' values.
const palette = new Map(); // ch -> { hex, line }
let inPalette = false;
artLines.forEach((text, i) => {
    if (/const PALETTE[^=]*=/.test(text)) inPalette = true;
    if (inPalette) {
        const m = text.match(/^\s*(\w):\s*'(#[0-9a-fA-F]{6})'/);
        if (m) palette.set(m[1], { hex: m[2].toLowerCase(), line: i + 1 });
        if (/^\s*\};/.test(text)) inPalette = false;
    }
});
if (palette.size === 0) fail(ART_TS, 1, 'could not parse PALETTE (expected char->hex entries)');

const hexToHsl = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
    return { h, s, l };
};

// Banned: pure black/white + purple family (hue 245-330, sat > 0.20).
// Slate-blue shadows (~205-225 deg) are explicitly allowed.
const isBannedHex = (hex) => {
    if (hex === '#000000' || hex === '#ffffff') return 'pure black/white is banned (use k/w)';
    const { h, s } = hexToHsl(hex);
    if (h >= 245 && h <= 330 && s > 0.2) return `purple family is banned (h=${h.toFixed(0)} s=${s.toFixed(2)})`;
    return null;
};

artLines.forEach((text, i) => {
    for (const m of text.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
        const reason = isBannedHex(m[0].toLowerCase());
        if (reason) fail(ART_TS, i + 1, `banned hex ${m[0]}: ${reason}`);
    }
    if (text.includes('Math.random')) fail(ART_TS, i + 1, 'Math.random in art.ts: bake must be deterministic (seeded PRNG only)');
});

// --- pixel-map extraction + checks ------------------------------------------
const ROW_RE = /^\s*'([^']*)',?\s*$/;
const CONST_RE = /export const (\w+)/;
const KEY_RE = /^\s*([A-Za-z0-9_]+):\s*\[$/;

// Color budget: <=16px: 6, <=32px: 10, <=64px (chassis): 16.
// (No larger maps exist; the final else holds the 64px ceiling.)
const budgetFor = (w, h) => {
    const m = Math.max(w, h);
    if (m <= 16) return 6;
    if (m <= 32) return 10;
    return 16;
};

let mapCount = 0;
for (const file of readdirSync(ART_DIR).filter((f) => f.endsWith('.ts')).sort()) {
    const path = join(ART_DIR, file);
    const lines = readFileSync(path, 'utf8').split('\n');
    let symbol = '(unknown)';
    let run = []; // { text, line }
    const flush = () => {
        if (run.length === 0) return;
        mapCount += 1;
        const startLine = run[0].line;
        const label = `${symbol} (${run.length}x${run[0].text.length})`;
        const widths = new Set(run.map((r) => r.text.length));
        if (widths.size > 1) {
            fail(path, startLine, `${label}: non-rectangular rows (widths ${[...widths].sort((a, b) => a - b).join(',')})`);
        }
        const colors = new Set();
        run.forEach((r) => {
            for (let x = 0; x < r.text.length; x += 1) {
                const ch = r.text[x];
                if (ch === '.') continue;
                if (!palette.has(ch)) {
                    fail(path, r.line, `${label}: unknown char '${ch}' (not in art.ts palette)`);
                    return;
                }
                colors.add(ch);
            }
        });
        const w = Math.max(...run.map((r) => r.text.length));
        const budget = budgetFor(w, run.length);
        if (colors.size > budget) {
            fail(
                path,
                startLine,
                `${label}: ${colors.size} colors [${[...colors].sort().join('')}] over budget ${budget} for ${w}x${run.length}`,
            );
        }
        run = [];
    };
    lines.forEach((text, i) => {
        const c = text.match(CONST_RE);
        if (c) symbol = c[1];
        const k = text.match(KEY_RE);
        if (k) symbol = k[1];
        const row = text.match(ROW_RE);
        // Every standalone quoted token is a map row: unknown chars are
        // reported by the charset check (art files hold only maps).
        if (row) run.push({ text: row[1], line: i + 1 });
        else flush();
    });
    flush();
}

// --- report ------------------------------------------------------------------
if (failures.length > 0) {
    for (const f of failures) console.error(f);
    console.error(`art-qa: FAIL ${failures.length} issue(s) in ${mapCount} maps (palette: ${palette.size} chars)`);
    process.exit(1);
}
console.log(`art-qa: clean — ${mapCount} maps, palette ${palette.size} chars [${[...palette.keys()].sort().join('')}]`);
