// Reusable battle screenshot capture (Phase 1, part B).
//
// Real 1280x960 in-game screenshots through the ?bgshot/CDP recipe both
// Phase-0 workers converged on: Chrome headless + remote debugging, navigate
// to ?bgshot=<seed>&arena=<arena>&bgtick=<n>&lineup=<a,b>, wait, then
// capture the FULL 1280x960 viewport (the game canvas is centered in it).
//
// Manifest JSON:
//   { "shots": [ { "file": "p1-01.png", "lineup": ["bt-p1-1102","hunter"],
//                  "arena": "blocks", "seed": 42, "bgtick": 150 } ] }
//
// Usage:
//   npx esbuild tools/capture.ts --bundle --platform=node --format=esm \
//       --outfile=/tmp/p1b/capture.mjs --log-level=warning \
//       --external:node:*
//   node /tmp/p1b/capture.mjs --manifest shots.json --outdir /private/tmp/newbrains-p1-shots \
//       --dist /private/tmp/p1b-wt/dist
//
// No npm dependencies: static server via node:http, CDP via the global
// WebSocket (Node 21+). Seeded/deterministic frames: BattleScene freezes the
// sim at bgtick under ?bgshot, so the same manifest always yields the same
// pixels (modulo font rasterization).

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

function arg(name: string, def: string): string {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < process.argv.length ? (process.argv[i + 1] as string) : def;
}

interface Shot {
    file: string;
    lineup: [string, string];
    arena: string;
    seed: number;
    bgtick: number;
}

const MIME: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.woff2': 'font/woff2',
    '.ico': 'image/x-icon',
};

function serveStatic(root: string, port: number): Promise<Server> {
    const server = createServer(async (req, res) => {
        try {
            let path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
            if (path === '/') path = '/index.html';
            let file = resolve(join(root, `.${path}`));
            if (!file.startsWith(resolve(root))) {
                res.writeHead(403);
                res.end();
                return;
            }
            if (!existsSync(file)) file = join(root, 'index.html');
            const data = await readFile(file);
            res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
            res.end(data);
        } catch {
            res.writeHead(500);
            res.end();
        }
    });
    return new Promise((resolveP) => server.listen(port, '127.0.0.1', () => resolveP(server)));
}

/** Minimal CDP client over a WebSocket. */
class CDP {
    private ws: WebSocket;
    private nextId = 1;
    private waiters = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>();
    private eventWaiters: Array<{ method: string; resolve: () => void }> = [];
    private opened: Promise<void>;

    constructor(url: string) {
        this.ws = new WebSocket(url);
        this.opened = new Promise((resolve, reject) => {
            this.ws.addEventListener('open', () => resolve(), { once: true });
            this.ws.addEventListener('error', () => reject(new Error('CDP websocket error')), { once: true });
        });
        this.ws.addEventListener('message', (ev) => {
            const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string }; method?: string };
            if (msg.id !== undefined) {
                const w = this.waiters.get(msg.id);
                if (w) {
                    this.waiters.delete(msg.id);
                    if (msg.error) w.reject(new Error(msg.error.message));
                    else w.resolve(msg.result);
                }
            } else if (msg.method) {
                for (const ew of this.eventWaiters.splice(0)) {
                    if (ew.method === msg.method) ew.resolve();
                    else this.eventWaiters.push(ew);
                }
            }
        });
    }

    async ready(): Promise<void> {
        await this.opened;
    }

    send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.waiters.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    waitForEvent(method: string, timeoutMs: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs);
            this.eventWaiters.push({
                method,
                resolve: () => {
                    clearTimeout(timer);
                    resolve();
                },
            });
        });
    }

    async evaluate(expression: string): Promise<unknown> {
        const r = (await this.send('Runtime.evaluate', { expression, returnByValue: true })) as {
            result?: { value?: unknown };
            exceptionDetails?: unknown;
        };
        if (r.exceptionDetails) throw new Error(`evaluate failed: ${expression}`);
        return r.result?.value;
    }

    close(): void {
        this.ws.close();
    }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
    const manifestPath = arg('manifest', '');
    const outdir = arg('outdir', join(tmpdir(), 'p1b-shots'));
    const dist = arg('dist', '');
    const chrome = arg('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    const cdpPort = Number(arg('cdp-port', '9333'));
    const httpPort = Number(arg('http-port', '8901'));
    const settleMs = Number(arg('settle', '4500'));
    const viewport = arg('viewport', '1280x960');
    if (!manifestPath || !dist) throw new Error('usage: --manifest <json> --dist <dir> [--outdir ...]');

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { shots: Shot[] };
    await mkdir(outdir, { recursive: true });

    const server = await serveStatic(dist, httpPort);
    console.log(`[capture] serving ${dist} on :${httpPort}`);

    const profile = join(tmpdir(), `p1b-chrome-${process.pid}`);
    await mkdir(profile, { recursive: true });
    const chromeProc: ChildProcess = spawn(
        chrome,
        [
            '--headless=new',
            `--remote-debugging-port=${cdpPort}`,
            '--no-first-run',
            '--no-default-browser-check',
            `--user-data-dir=${profile}`,
            `--window-size=${viewport.replace('x', ',')}`,
            '--disable-dev-shm-usage',
            'about:blank',
        ],
        { stdio: 'ignore' },
    );
    console.log(`[capture] chrome launched (pid ${chromeProc.pid})`);

    let cdp: CDP | null = null;
    try {
        // wait for the debugger endpoint
        let targets: Array<{ type: string; webSocketDebuggerUrl: string }> = [];
        for (let i = 0; i < 60; i += 1) {
            try {
                const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
                targets = (await res.json()) as typeof targets;
                const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
                if (page) break;
            } catch {
                /* retry */
            }
            await sleep(500);
        }
        const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (!page) throw new Error('no debuggable page target');
        cdp = new CDP(page.webSocketDebuggerUrl);
        await cdp.ready();
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');

        const [vw, vh] = viewport.split('x').map(Number);
        // Force the layout viewport regardless of window-chrome parsing:
        // with deviceScaleFactor 1 the screenshot is exactly vw x vh px.
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: vw,
            height: vh,
            deviceScaleFactor: 1,
            mobile: false,
        });
        for (const shot of manifest.shots) {
            const url =
                `http://127.0.0.1:${httpPort}/?bgshot=${shot.seed}&arena=${shot.arena}` +
                `&bgtick=${shot.bgtick}&lineup=${shot.lineup.join(',')}`;
            console.log(`[capture] ${shot.file}: ${url}`);
            const navWait = cdp.waitForEvent('Page.loadEventFired', 30000);
            await cdp.send('Page.navigate', { url });
            await navWait;
            // wait for the Phaser canvas, then let the frozen frame settle
            let canvas = false;
            for (let i = 0; i < 60; i += 1) {
                canvas = (await cdp.evaluate(`!!document.querySelector('canvas')`)) === true;
                if (canvas) break;
                await sleep(500);
            }
            if (!canvas) throw new Error(`no canvas for ${shot.file}`);
            await sleep(settleMs);
            // Full-viewport capture at the window size (1280x960): the game
            // canvas is centered in the page, so this is a real 1280x960
            // frame of the game, not an upscale of the canvas element.
            const data = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data: string };
            const outPath = join(outdir, shot.file);
            const { writeFile } = await import('node:fs/promises');
            await writeFile(outPath, Buffer.from(data.data, 'base64'));
            console.log(`[capture] wrote ${outPath}`);
        }
    } finally {
        cdp?.close();
        chromeProc.kill();
        server.close();
    }
}

main().catch((e) => {
    console.error(`[capture] FATAL: ${(e as Error).message}`);
    process.exit(1);
});
