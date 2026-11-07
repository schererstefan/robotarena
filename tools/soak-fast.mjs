#!/usr/bin/env node
// test:sim:fast verdict: run the gated soak subset, diff its failure
// lines against .github/ci-expected-soak-fast.txt. Exit 0 iff the
// sorted `  FAIL ` line sets are identical (the Nightly baseline-diff
// protocol, applied to a fast PR subset). The raw subset exit code is
// not the verdict: the subset currently exits 1 on main because the
// baselined failures reproduce. The esbuild bundle is built by the
// package.json script before this helper runs.
import { spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = '/tmp/robotarena-soak.mjs';
const EXPECTED_FILE = join(ROOT, '.github/ci-expected-soak-fast.txt');
const SECTIONS = 'determinism,brain,pinned-codes';

const started = performance.now();
const run = spawnSync(process.execPath, [BUNDLE], {
    env: { ...process.env, SOAK_SECTIONS: SECTIONS },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
});
const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
process.stdout.write(output);
if (output.length > 0 && !output.endsWith('\n')) process.stdout.write('\n');
const elapsed = ((performance.now() - started) / 1000).toFixed(2);

if (run.error) {
    console.error(`test:sim:fast: failed to run soak bundle ${BUNDLE}: ${run.error.message}`);
    console.error('Run via `npm run test:sim:fast` so the bundle is built first.');
    console.log(`test:sim:fast wall time: ${elapsed}s`);
    process.exit(1);
}
if (run.status !== 0 && run.status !== 1) {
    console.error(`test:sim:fast: soak subset exited unexpectedly (status ${run.status}, signal ${run.signal})`);
    console.log(`test:sim:fast wall time: ${elapsed}s`);
    process.exit(1);
}

const failLines = (text) =>
    text
        .split('\n')
        .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
        .filter((line) => line.startsWith('  FAIL '));
const byteOrder = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

const actual = failLines(output).sort(byteOrder);
const expected = failLines(readFileSync(EXPECTED_FILE, 'utf8')).sort(byteOrder);

if (actual.length === expected.length && actual.every((line, i) => line === expected[i])) {
    console.log('baseline unchanged: test:sim:fast failures match .github/ci-expected-soak-fast.txt');
    console.log(`test:sim:fast wall time: ${elapsed}s`);
    process.exit(0);
}

const stamp = process.pid;
const expectedPath = join(tmpdir(), `robotarena-soak-fast-expected-${stamp}.txt`);
const actualPath = join(tmpdir(), `robotarena-soak-fast-actual-${stamp}.txt`);
writeFileSync(expectedPath, expected.length > 0 ? `${expected.join('\n')}\n` : '');
writeFileSync(actualPath, actual.length > 0 ? `${actual.join('\n')}\n` : '');
const diff = spawnSync('diff', ['-u', expectedPath, actualPath], { encoding: 'utf8' });
if (diff.stdout) process.stdout.write(diff.stdout);
else {
    console.log('--- expected (.github/ci-expected-soak-fast.txt)');
    for (const line of expected) console.log(line);
    console.log('+++ actual (test:sim:fast run)');
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
console.log('baseline changed: test:sim:fast failures differ from .github/ci-expected-soak-fast.txt');
console.log("In the diff above, '-' lines are expected-only (disappeared or changed) and '+' lines are actual-only (new or changed).");
console.log('If this change is intentional, update .github/ci-expected-soak-fast.txt in the same PR and explain it there.');
console.log(`test:sim:fast wall time: ${elapsed}s`);
process.exit(1);
