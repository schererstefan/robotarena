#!/usr/bin/env node
// Soak baseline-diff verdict: run the soak bundle and diff its failure
// lines against an expected file. Exit 0 iff the sorted `  FAIL ` line
// sets are identical (the Nightly baseline-diff protocol). The raw soak
// exit code is not the verdict: the soak currently exits 1 on main
// because the baselined failures reproduce. The esbuild bundle is built
// by the caller before this helper runs.
//
// Generalized: the sections and expected file come from env/args, with
// defaults that preserve the fast PR gate (test:sim:fast):
//   SOAK_SECTIONS       (default: determinism,brain,pinned-codes)
//   SOAK_EXPECTED_FILE  (default: .github/ci-expected-soak-fast.txt)
//   SOAK_LABEL          (optional log label; derived when unset)
// Args (--sections, --expected-file, --label) win over env; an empty
// SOAK_SECTIONS (env SOAK_SECTIONS='' or --sections=) runs the full
// soak (SOAK_SECTIONS is unset for the bundle, which means "all").
// Usage:
//   (defaults)                                       -> fast subset vs ci-expected-soak-fast.txt
//   SOAK_SECTIONS='' SOAK_EXPECTED_FILE=.github/nightly-expected-soak.txt node tools/soak-fast.mjs
//                                                      -> full soak vs nightly-expected-soak.txt
//   node tools/soak-fast.mjs --sections= --expected-file=.github/nightly-expected-soak.txt --label=test:sim
//                                                      -> same full-soak gate via args
import { spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = '/tmp/robotarena-soak.mjs';
const DEFAULT_SECTIONS = 'determinism,brain,pinned-codes';
const DEFAULT_EXPECTED_FILE = join(ROOT, '.github/ci-expected-soak-fast.txt');
const NIGHTLY_EXPECTED_FILE = join(ROOT, '.github/nightly-expected-soak.txt');
const DEFAULT_LABEL_FAST = 'test:sim:fast';
const DEFAULT_LABEL_FULL = 'test:sim';

function getArg(argv, names) {
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        for (const name of names) {
            if (arg === name) {
                const next = argv[i + 1];
                return next === undefined ? '' : next;
            }
            if (arg.startsWith(`${name}=`)) {
                return arg.slice(name.length + 1);
            }
        }
    }
    return undefined;
}

const argv = process.argv.slice(2);
const argSections = getArg(argv, ['--sections']);
const argExpected = getArg(argv, ['--expected-file', '--expected']);
const argLabel = getArg(argv, ['--label']);

const envSections = process.env.SOAK_SECTIONS;
const envExpected = process.env.SOAK_EXPECTED_FILE;
const envLabel = process.env.SOAK_LABEL ?? process.env.SOAK_FAST_LABEL;

const effectiveSections = argSections !== undefined ? argSections : envSections !== undefined ? envSections : DEFAULT_SECTIONS;

let effectiveExpectedFile = DEFAULT_EXPECTED_FILE;
if (argExpected !== undefined && argExpected !== '') {
    effectiveExpectedFile = isAbsolute(argExpected) ? argExpected : join(ROOT, argExpected);
} else if (envExpected !== undefined && envExpected !== '') {
    effectiveExpectedFile = isAbsolute(envExpected) ? envExpected : join(ROOT, envExpected);
}

let effectiveLabel = argLabel !== undefined ? argLabel : envLabel !== undefined ? envLabel : undefined;
if (effectiveLabel === undefined || effectiveLabel === '') {
    if (effectiveSections === DEFAULT_SECTIONS && effectiveExpectedFile === DEFAULT_EXPECTED_FILE) {
        effectiveLabel = DEFAULT_LABEL_FAST;
    } else if (effectiveSections === '' && effectiveExpectedFile === NIGHTLY_EXPECTED_FILE) {
        effectiveLabel = DEFAULT_LABEL_FULL;
    } else if (effectiveSections === '') {
        effectiveLabel = DEFAULT_LABEL_FULL;
    } else {
        effectiveLabel = DEFAULT_LABEL_FAST;
    }
}
const LABEL = effectiveLabel;
const EXPECTED_DISPLAY = relative(ROOT, effectiveExpectedFile) || effectiveExpectedFile;

const started = performance.now();
// Empty sections = full soak: unset SOAK_SECTIONS for the bundle so
// tools/soak.ts runs every section (a null filter means "all").
const childEnv = { ...process.env };
if (effectiveSections === '') {
    delete childEnv.SOAK_SECTIONS;
} else {
    childEnv.SOAK_SECTIONS = effectiveSections;
}
const run = spawnSync(process.execPath, [BUNDLE], {
    env: childEnv,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
});
const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
process.stdout.write(output);
if (output.length > 0 && !output.endsWith('\n')) process.stdout.write('\n');
const elapsed = ((performance.now() - started) / 1000).toFixed(2);

if (run.error) {
    console.error(`${LABEL}: failed to run soak bundle ${BUNDLE}: ${run.error.message}`);
    console.error('Run via the package.json script (or `npm run test:sim:fast`) so the bundle is built first.');
    console.log(`${LABEL} wall time: ${elapsed}s`);
    process.exit(1);
}
if (run.status !== 0 && run.status !== 1) {
    console.error(`${LABEL}: soak exited unexpectedly (status ${run.status}, signal ${run.signal})`);
    console.log(`${LABEL} wall time: ${elapsed}s`);
    process.exit(1);
}

const failLines = (text) =>
    text
        .split('\n')
        .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
        .filter((line) => line.startsWith('  FAIL '));
const byteOrder = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

const actual = failLines(output).sort(byteOrder);
let expectedText;
try {
    expectedText = readFileSync(effectiveExpectedFile, 'utf8');
} catch (err) {
    console.error(`${LABEL}: cannot read expected file ${EXPECTED_DISPLAY} (${effectiveExpectedFile}): ${err.message}`);
    console.log(`${LABEL} wall time: ${elapsed}s`);
    process.exit(1);
}
const expected = failLines(expectedText).sort(byteOrder);

if (actual.length === expected.length && actual.every((line, i) => line === expected[i])) {
    console.log(`baseline unchanged: ${LABEL} failures match ${EXPECTED_DISPLAY}`);
    console.log(`${LABEL} wall time: ${elapsed}s`);
    process.exit(0);
}

const stamp = process.pid;
const expectedPath = join(tmpdir(), `robotarena-soak-expected-${stamp}.txt`);
const actualPath = join(tmpdir(), `robotarena-soak-actual-${stamp}.txt`);
writeFileSync(expectedPath, expected.length > 0 ? `${expected.join('\n')}\n` : '');
writeFileSync(actualPath, actual.length > 0 ? `${actual.join('\n')}\n` : '');
const diff = spawnSync('diff', ['-u', expectedPath, actualPath], { encoding: 'utf8' });
if (diff.stdout) process.stdout.write(diff.stdout);
else {
    console.log(`--- expected (${EXPECTED_DISPLAY})`);
    for (const line of expected) console.log(line);
    console.log(`+++ actual (${LABEL} run)`);
    for (const line of actual) console.log(line);
}
try {
    unlinkSync(expectedPath);
} catch {
    // Temp-file cleanup is best-effort.
}
try {
    unlinkSync(actualPath);
} catch {
    // Temp-file cleanup is best-effort.
}
console.log(`baseline changed: ${LABEL} failures differ from ${EXPECTED_DISPLAY}`);
console.log("In the diff above, '-' lines are expected-only (disappeared or changed) and '+' lines are actual-only (new or changed).");
console.log(`If this change is intentional, update ${EXPECTED_DISPLAY} in the same PR and explain it there.`);
console.log(`${LABEL} wall time: ${elapsed}s`);
process.exit(1);
