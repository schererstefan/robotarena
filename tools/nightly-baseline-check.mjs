#!/usr/bin/env node
// nightly-baseline-check: compare tonight's nightly failure set against the
// checked-in known-failure baseline (tools/nightly-baseline.json).
//
// Nightly (test:sim + verify:manifests) has pre-existing failures on main, so
// a plain red/green signal cannot tell a NEW regression (or a heal+new swap at
// the same count) from the known set. This comparator diffs the two logs
// against the baseline as multisets (order ignored, counts and duplicates
// matter):
//   - exact match on both logs -> WARNING + exit 0 (known failures only)
//   - any NEW or MISSING entry -> listing + exit 1
//   - missing/unreadable log or baseline -> error + exit 1 (never passes)
//
// Dependency-free (node: builtins only) so the baseline-check CI job can run
// it with plain `node` and no `npm ci`.
// Usage:
//   node tools/nightly-baseline-check.mjs [--soak <path>] [--manifests <path>] [--baseline <path>]
//   node tools/nightly-baseline-check.mjs --self-test
// Defaults: soak=nightly-soak.log, manifests=nightly-manifests.log (cwd),
// baseline=tools/nightly-baseline.json resolved relative to this script.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASELINE = join(SCRIPT_DIR, 'nightly-baseline.json');
const FIXTURE_DIR = join(SCRIPT_DIR, 'fixtures', 'nightly-baseline');

// --- parsing ---------------------------------------------------------------
// soak.ts check() prints `  FAIL <name>` plus ` -- <detail>` when detail is
// non-empty; passing checks print `  ok   <name>`. Key on the NAME only.
function parseSoakLog(text) {
    const names = [];
    for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*FAIL\s+(.*\S)\s*$/);
        if (!m) continue;
        let name = m[1].trim();
        const sep = name.indexOf(' -- ');
        if (sep !== -1) name = name.slice(0, sep).trimEnd();
        if (name) names.push(name);
    }
    return names;
}

// verify-manifest.ts fail() prints `  MISMATCH <message>` with no code id, so
// key on the full emitted message text after `MISMATCH `, trimmed.
function parseManifestLog(text) {
    const signatures = [];
    for (const line of text.split(/\r?\n/)) {
        const idx = line.indexOf('MISMATCH ');
        if (idx === -1) continue;
        const sig = line.slice(idx + 'MISMATCH '.length).trim();
        if (sig) signatures.push(sig);
    }
    return signatures;
}

// --- multiset diff -----------------------------------------------------------
// Counts matter: two copies in the baseline vs one in the log is one MISSING,
// and three vs two is one NEW. `added` keeps log order, `missing` keeps
// baseline first-appearance order (duplicates grouped).
function diffMultiset(actual, baseline) {
    const remaining = new Map();
    for (const item of baseline) remaining.set(item, (remaining.get(item) ?? 0) + 1);
    const added = [];
    for (const item of actual) {
        const n = remaining.get(item) ?? 0;
        if (n > 0) remaining.set(item, n - 1);
        else added.push(item);
    }
    const missing = [];
    for (const [item, n] of remaining) {
        for (let i = 0; i < n; i += 1) missing.push(item);
    }
    return { added, missing };
}

function compareSets(baseline, soakActual, manifestActual) {
    const soak = diffMultiset(soakActual, baseline.soakFailures);
    const manifests = diffMultiset(manifestActual, baseline.manifestMismatches);
    const ok =
        soak.added.length === 0 &&
        soak.missing.length === 0 &&
        manifests.added.length === 0 &&
        manifests.missing.length === 0;
    return { ok, soak, manifests };
}

// --- loading -----------------------------------------------------------------
function readTextFile(path, label) {
    try {
        return readFileSync(path, 'utf8');
    } catch (err) {
        throw new Error(`cannot read ${label} file '${path}': ${err instanceof Error ? err.message : String(err)}`);
    }
}

function loadBaseline(path) {
    let raw;
    try {
        raw = readFileSync(path, 'utf8');
    } catch (err) {
        throw new Error(`cannot read baseline file '${path}': ${err instanceof Error ? err.message : String(err)}`);
    }
    let data;
    try {
        data = JSON.parse(raw);
    } catch (err) {
        throw new Error(`cannot parse baseline file '${path}' as JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.soakFailures) || !Array.isArray(data.manifestMismatches)) {
        throw new Error(`baseline file '${path}' must be an object with 'soakFailures' and 'manifestMismatches' arrays`);
    }
    for (const [key, value] of [['soakFailures', data.soakFailures], ['manifestMismatches', data.manifestMismatches]]) {
        if (!value.every((v) => typeof v === 'string')) {
            throw new Error(`baseline file '${path}': '${key}' must contain only strings`);
        }
    }
    return { soakFailures: data.soakFailures, manifestMismatches: data.manifestMismatches };
}

// Load baseline + both logs and compare. Throws on any missing/unreadable
// file so callers can report it and exit 1 (never silently pass).
function checkPaths({ soakPath, manifestsPath, baselinePath }) {
    const baseline = loadBaseline(baselinePath);
    const soakActual = parseSoakLog(readTextFile(soakPath, 'soak log'));
    const manifestActual = parseManifestLog(readTextFile(manifestsPath, 'manifests log'));
    const result = compareSets(baseline, soakActual, manifestActual);
    return { baseline, soakActual, manifestActual, ...result };
}

function printDiffSection(title, actualCount, baselineCount, diff, newLabel, missingLabel) {
    console.log(`${title}: ${actualCount} actual, ${baselineCount} baseline`);
    for (const item of diff.added) console.log(`  NEW ${newLabel}: ${item}`);
    for (const item of diff.missing) console.log(`  MISSING ${missingLabel}: ${item}`);
    if (diff.added.length === 0 && diff.missing.length === 0) console.log('  (matches baseline)');
}

// --- CLI ---------------------------------------------------------------------
function printUsage() {
    console.log('Usage: node tools/nightly-baseline-check.mjs [--soak <path>] [--manifests <path>] [--baseline <path>]');
    console.log('       node tools/nightly-baseline-check.mjs --self-test');
    console.log('Defaults: --soak nightly-soak.log --manifests nightly-manifests.log');
    console.log('          --baseline tools/nightly-baseline.json (resolved relative to this script)');
}

function parseArgs(argv) {
    const args = {
        soak: 'nightly-soak.log',
        manifests: 'nightly-manifests.log',
        baseline: DEFAULT_BASELINE,
        selfTest: false,
        help: false,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        // Support both `--flag value` and `--flag=value`.
        const eq = arg.indexOf('=');
        const flag = eq !== -1 && arg.startsWith('--') ? arg.slice(0, eq) : arg;
        const inline = eq !== -1 && arg.startsWith('--') ? arg.slice(eq + 1) : undefined;
        const value = () => {
            if (inline !== undefined) {
                if (inline === '') throw new Error(`missing value for ${flag}`);
                return inline;
            }
            if (i + 1 >= argv.length) throw new Error(`missing value for ${flag}`);
            i += 1;
            return argv[i];
        };
        if (flag === '--self-test' && inline === undefined) args.selfTest = true;
        else if ((flag === '--help' || flag === '-h') && inline === undefined) args.help = true;
        else if (flag === '--soak') args.soak = value();
        else if (flag === '--manifests') args.manifests = value();
        else if (flag === '--baseline') args.baseline = value();
        else throw new Error(`unknown argument: ${arg}`);
    }
    return args;
}

function runCheck(args) {
    let result;
    try {
        result = checkPaths({ soakPath: args.soak, manifestsPath: args.manifests, baselinePath: args.baseline });
    } catch (err) {
        console.error(`nightly-baseline-check: ERROR: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
    const { baseline, soakActual, manifestActual, ok, soak, manifests } = result;
    if (ok) {
        console.log(
            `WARNING: nightly matches the known-failure baseline ` +
                `(${baseline.soakFailures.length} soak FAIL, ${baseline.manifestMismatches.length} manifest MISMATCH).`,
        );
        console.log('These are the pre-existing failures recorded in tools/nightly-baseline.json — not a clean pass.');
        return 0;
    }
    console.log('nightly-baseline-check: nightly failure set differs from tools/nightly-baseline.json');
    printDiffSection('Soak (test:sim)', soakActual.length, baseline.soakFailures.length, soak, 'soak failure', 'soak failure');
    printDiffSection(
        'Manifests (verify:manifests)',
        manifestActual.length,
        baseline.manifestMismatches.length,
        manifests,
        'manifest mismatch',
        'manifest mismatch',
    );
    console.log('A NEW entry is a regression; a MISSING entry means a known failure healed — update the baseline deliberately if that is intended.');
    return 1;
}

// --- self-test -----------------------------------------------------------------
// Exercises the real parsers + multiset comparison against the fixture logs
// under tools/fixtures/nightly-baseline/. exact must pass; any one-extra or
// one-missing variant (soak or manifests) must fail.
function runSelfTest() {
    const scenarios = [
        { name: 'exact-match', soak: 'soak-exact.log', manifests: 'manifests-exact.log', expectPass: true },
        { name: 'one-extra-failure (soak)', soak: 'soak-extra.log', manifests: 'manifests-exact.log', expectPass: false },
        { name: 'one-missing-failure (soak)', soak: 'soak-missing.log', manifests: 'manifests-exact.log', expectPass: false },
        { name: 'one-extra-mismatch (manifests)', soak: 'soak-exact.log', manifests: 'manifests-extra.log', expectPass: false },
        { name: 'one-missing-mismatch (manifests)', soak: 'soak-exact.log', manifests: 'manifests-missing.log', expectPass: false },
    ];
    let allOk = true;
    for (const scenario of scenarios) {
        let result;
        try {
            result = checkPaths({
                soakPath: join(FIXTURE_DIR, scenario.soak),
                manifestsPath: join(FIXTURE_DIR, scenario.manifests),
                baselinePath: DEFAULT_BASELINE,
            });
        } catch (err) {
            allOk = false;
            console.log(
                `self-test ${scenario.name}: FAIL (expected ${scenario.expectPass ? 'pass' : 'fail'}, got error: ` +
                    `${err instanceof Error ? err.message : String(err)})`,
            );
            continue;
        }
        const gotPass = result.ok;
        const pass = gotPass === scenario.expectPass;
        if (!pass) allOk = false;
        console.log(
            `self-test ${scenario.name}: ${pass ? 'ok' : 'FAIL'} ` +
                `(expected ${scenario.expectPass ? 'pass' : 'fail'}, got ${gotPass ? 'pass' : 'fail'}: ` +
                `${result.soakActual.length} soak, ${result.manifestActual.length} manifest; ` +
                `NEW soak=${result.soak.added.length} MISSING soak=${result.soak.missing.length} ` +
                `NEW manifest=${result.manifests.added.length} MISSING manifest=${result.manifests.missing.length})`,
        );
        // Show the diff that drives each expected-fail verdict.
        for (const item of result.soak.added) console.log(`  NEW soak failure: ${item}`);
        for (const item of result.soak.missing) console.log(`  MISSING soak failure: ${item}`);
        for (const item of result.manifests.added) console.log(`  NEW manifest mismatch: ${item}`);
        for (const item of result.manifests.missing) console.log(`  MISSING manifest mismatch: ${item}`);
    }
    if (allOk) console.log('self-test: all scenarios passed');
    else console.error('self-test: FAILURES');
    return allOk ? 0 : 1;
}

function main(argv) {
    let args;
    try {
        args = parseArgs(argv);
    } catch (err) {
        console.error(`nightly-baseline-check: ERROR: ${err instanceof Error ? err.message : String(err)}`);
        printUsage();
        return 1;
    }
    if (args.help) {
        printUsage();
        return 0;
    }
    if (args.selfTest) return runSelfTest();
    return runCheck(args);
}

process.exitCode = main(process.argv.slice(2));
