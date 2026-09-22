#!/usr/bin/env node
// art/res-compare-64-96 DEMO ONLY — 64-vs-96 native pixel-map comparison.
// Zero dependencies (pure node). Paints TWO robots (brawler, rusher), each
// natively re-authored at 64x64 and 96x96 via code primitives (NOT upscales),
// then emits one labeled contact sheet PNG per robot to
// /private/tmp/rescompare64-96-shots/. Nothing here is imported by the game;
// the production build ignores this directory.
//
// Layout mirrors the game's east-facing top-down chassis so the comparison
// is apples-to-apples. Display sizes use INTEGER nearest-neighbor scales so
// neither resolution gets shimmer bias: 64*3 = 96*2 = 192 (~180px row),
// 64*6 = 96*4 = 384 (~360px headroom row).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = '/private/tmp/rescompare64-96-shots';

// ---------------------------------------------------------------- utils ---
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mul = (c, f) => [clamp255(c[0] * f), clamp255(c[1] * f), clamp255(c[2] * f)];
const mix = (a, b, t) => [clamp255(a[0] + (b[0] - a[0]) * t), clamp255(a[1] + (b[1] - a[1]) * t), clamp255(a[2] + (b[2] - a[2]) * t)];

// ------------------------------------------------- read-only game palette ---
// Same palette chars as src/game/art.ts (parsed as text, never imported).
function parsePalette(src) {
    const pal = new Map();
    let on = false;
    for (const line of src.split('\n')) {
        if (/const PALETTE[^=]*=/.test(line)) on = true;
        if (on) {
            const m = line.match(/^\s*(\w):\s*'(#[0-9a-fA-F]{6})'/);
            if (m) pal.set(m[1], hex(m[2]));
            if (/^\s*\};/.test(line)) on = false;
        }
    }
    if (pal.size === 0) throw new Error('palette parse failed');
    return pal;
}
const PAL = parsePalette(readFileSync(join(ROOT, 'src/game/art.ts'), 'utf8'));

// ------------------------------------------------------------- PNG writer ---
const CRC_T = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
    }
    return t;
})();
function crc(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cc]);
}
function writePNG(path, w, h, rgba) {
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (w * 4 + 1)] = 0;
        Buffer.from(rgba.subarray(y * w * 4, (y + 1) * w * 4)).copy(raw, y * (w * 4 + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 6;
    const png = Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
    ]);
    writeFileSync(path, png);
}

// ------------------------------------------------------------------ raster ---
class Pix {
    constructor(n) { this.n = n; this.b = new Uint8ClampedArray(n * n * 4).fill(0); }
    px(x, y, c, a = 255) {
        x |= 0; y |= 0;
        if (x < 0 || y < 0 || x >= this.n || y >= this.n) return;
        const i = (y * this.n + x) * 4;
        if (a >= 255) { this.b[i] = c[0]; this.b[i + 1] = c[1]; this.b[i + 2] = c[2]; this.b[i + 3] = 255; }
        else {
            const t = a / 255, u = 1 - t;
            this.b[i] = clamp255(c[0] * t + this.b[i] * u);
            this.b[i + 1] = clamp255(c[1] * t + this.b[i + 1] * u);
            this.b[i + 2] = clamp255(c[2] * t + this.b[i + 2] * u);
            this.b[i + 3] = 255;
        }
    }
    rect(x0, y0, x1, y1, c, a = 255) {
        for (let y = Math.max(0, y0 | 0); y < Math.min(this.n, Math.ceil(y1)); y++)
            for (let x = Math.max(0, x0 | 0); x < Math.min(this.n, Math.ceil(x1)); x++)
                this.px(x, y, c, a);
    }
    outline(x0, y0, x1, y1, w, c) {
        x0 |= 0; y0 |= 0; x1 = Math.ceil(x1); y1 = Math.ceil(y1);
        this.rect(x0, y0, x1, y0 + w, c); this.rect(x0, y1 - w, x1, y1, c);
        this.rect(x0, y0, x0 + w, y1, c); this.rect(x1 - w, y0, x1, y1, c);
    }
    disc(cx, cy, r, c, a = 255) {
        for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
            for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
                if ((x - cx + 0.5) ** 2 + (y - cy + 0.5) ** 2 <= r * r) this.px(x, y, c, a);
    }
    ring(cx, cy, r, w, c) {
        for (let y = Math.floor(cy - r - w); y <= Math.ceil(cy + r + w); y++)
            for (let x = Math.floor(cx - r - w); x <= Math.ceil(cx + r + w); x++) {
                const d = Math.sqrt((x - cx + 0.5) ** 2 + (y - cy + 0.5) ** 2);
                if (d <= r && d > r - w) this.px(x, y, c);
            }
    }
}
function shades(base) {
    const W = PAL.get('w');
    return {
        base, hi: mix(base, W, 0.30), hi2: mix(base, W, 0.55),
        lo: mul(base, 0.72), lo2: mul(base, 0.48),
    };
}
// Drop shadow: dark offset copy under every opaque pixel, sprite pasted over.
function withShadow(p, dx, dy) {
    const N = p.n, q = new Pix(N);
    const SH = [4, 6, 11];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (p.b[(y * N + x) * 4 + 3] > 128) q.px(x + dx, y + dy, SH, 150);
    }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const i = (y * N + x) * 4;
        if (p.b[i + 3] > 128) { q.b[i] = p.b[i]; q.b[i + 1] = p.b[i + 1]; q.b[i + 2] = p.b[i + 2]; q.b[i + 3] = 255; }
    }
    return q;
}

// ------------------------------------------- NATIVE re-authored pixel maps ---
// Each resolution is authored with its own proportions + detail budget:
//   64 = clean game-sprite read: bold shapes, minimal seams, no bolts.
//   96 = crisper edges + a bit more shape detail (bolts, seams, skirt,
//          barrel bands, rim light). Deliberately NO wear/speckle clutter.
// East-facing top-down, matching the game's chassis convention.

// Brawler: red treaded tank, central turret dome, SHORT cannon east,
// amber lens + amber hull sidelights.
function paintBrawler(N) {
    const hiDetail = N >= 96;
    const p = new Pix(N);
    const K = PAL.get('k'), D = PAL.get('d'), M = PAL.get('m'), L = PAL.get('l');
    const T = PAL.get('t'), C = PAL.get('c'), W = PAL.get('w');
    const H = shades(PAL.get('r'));

    // --- treads: north + south bands ---
    const tH = Math.round(N * (N <= 64 ? 0.20 : 0.185));
    const tx0 = Math.round(N * 0.08), tx1 = Math.round(N * 0.72);
    for (const ty0 of [Math.round(N * 0.08), Math.round(N * (N <= 64 ? 0.72 : 0.735))]) {
        const ty1 = ty0 + tH;
        p.rect(tx0, ty0, tx1, ty1, D);
        p.outline(tx0, ty0, tx1, ty1, 1, K);
        const linkW = N <= 64 ? 4 : 6; // native link pitch per resolution
        for (let x = tx0 + linkW; x < tx1 - 1; x += linkW)
            p.rect(x, ty0 + 1, x + 1, ty1 - 1, K);
        if (hiDetail) { // pad top-light + bottom shade per link cell
            for (let x = tx0 + 2; x < tx1 - 2; x += linkW) {
                p.rect(x, ty0 + 1, x + linkW - 1, ty0 + 2, M);
                p.rect(x, ty1 - 2, x + linkW - 1, ty1 - 1, K);
            }
        }
        // road wheels: native count per resolution (3 vs 4)
        const nW = N <= 64 ? 3 : 4;
        const wr = tH * 0.30;
        for (let i = 0; i < nW; i++) {
            const cx = tx0 + ((tx1 - tx0) * (i + 0.5)) / nW, cy = (ty0 + ty1) / 2;
            p.disc(cx, cy, wr + 1, K);
            p.disc(cx, cy, wr, M);
            p.disc(cx, cy - wr * 0.25, wr * 0.72, L);
            p.disc(cx, cy, wr * 0.38, D);
            p.ring(cx, cy, wr * 0.38, 1, K);
            if (hiDetail) p.px(Math.round(cx), Math.round(cy), L); // hub pin
            else p.px(Math.round(cx - wr * 0.12), Math.round(cy - wr * 0.45), C);
        }
    }

    // --- hull: red armored block ---
    const hx0 = Math.round(N * 0.12), hx1 = Math.round(N * 0.80);
    const hy0 = Math.round(N * 0.30), hy1 = Math.round(N * 0.70);
    p.rect(hx0, hy0, hx1, hy1, H.base);
    const rows = hy1 - hy0; // vertical light falloff: light from north
    for (let y = hy0; y < hy1; y++) {
        const t = (y - hy0) / rows;
        const c = t < 0.25 ? H.hi : t > 0.78 ? H.lo2 : t > 0.6 ? H.lo : H.base;
        for (let x = hx0; x < hx1; x++) {
            const i = (y * N + x) * 4;
            if (p.b[i + 3] === 255 && p.b[i] === H.base[0] && p.b[i + 1] === H.base[1] && p.b[i + 2] === H.base[2]) {
                p.b[i] = c[0]; p.b[i + 1] = c[1]; p.b[i + 2] = c[2];
            }
        }
    }
    p.outline(hx0, hy0, hx1, hy1, 1, K);
    // panel seams: one center seam at 64, two + cross seam at 96
    if (N <= 64) {
        p.rect(Math.round(N * 0.44), hy0 + 1, Math.round(N * 0.44) + 1, hy1 - 1, H.lo2);
    } else {
        for (const x of [Math.round(N * 0.30), Math.round(N * 0.62)])
            p.rect(x, hy0 + 1, x + 1, hy1 - 1, H.lo2);
        p.rect(hx0 + 1, Math.round(N * 0.60), hx1 - 1, Math.round(N * 0.60) + 1, H.lo2);
        p.rect(hx0 + 1, hy0, hx1 - 1, hy0 + 1, H.hi2); // north rim light
        for (const bx of [hx0 + 3, Math.round(N * 0.30) - 4, Math.round(N * 0.30) + 3, Math.round(N * 0.62) - 4, Math.round(N * 0.62) + 3, hx1 - 5])
            for (const by of [hy0 + 3, hy1 - 5]) { p.rect(bx, by, bx + 2, by + 2, L); p.px(bx, by, K); }
        p.rect(hx0 + 1, hy1 - 4, hx1 - 1, hy1 - 2, D); // side skirt stripe
    }

    // --- amber hull sidelights (front-east corners) ---
    const sl = N <= 64 ? 2 : 3;
    for (const sy of [hy0 + 2, hy1 - 2 - sl]) {
        const sx = hx1 - 2 - sl;
        p.rect(sx - 1, sy - 1, sx + sl + 1, sy + sl + 1, K);
        p.rect(sx, sy, sx + sl, sy + sl, T);
        p.px(sx, sy, mix(T, W, 0.6));
    }

    // --- turret dome (central) + amber lens ---
    // Dome sits west of the cannon root so the lens stays fully visible.
    const dcx = N * (N <= 64 ? 0.355 : 0.345), dcy = N * 0.50;
    const dr = N * (N <= 64 ? 0.115 : 0.125);
    p.disc(dcx, dcy, dr + 1, K);
    p.disc(dcx, dcy, dr, H.base);
    p.disc(dcx, dcy - dr * 0.22, dr * 0.78, H.hi);
    p.disc(dcx, dcy - dr * 0.35, dr * 0.5, H.hi2);
    if (hiDetail) p.ring(dcx, dcy, dr * 0.62, 1, H.lo2);
    const lw = N <= 64 ? 5 : 8, lh = N <= 64 ? 4 : 6;
    const lx = Math.round(dcx - lw / 2), ly = Math.round(dcy - lh / 2);
    p.rect(lx - 1, ly - 1, lx + lw + 1, ly + lh + 1, K);
    for (let y = 0; y < lh; y++)
        p.rect(lx, ly + y, lx + lw, ly + y + 1, y < lh / 2 ? mix(T, W, 0.35) : y >= lh - 1 ? mul(T, 0.6) : T);
    p.rect(lx + 1, ly + 1, lx + (N <= 64 ? 2 : 3), ly + 2, C); // glint
    if (hiDetail) p.px(lx + lw - 2, ly + lh - 2, W);

    // --- SHORT cannon east ---
    const chh = N <= 64 ? 3 : 4; // half-height
    const cy0 = Math.round(dcy - chh), cy1 = Math.round(dcy + chh);
    const cbx0 = Math.round(dcx + dr * 0.55), cbx1 = Math.round(N * (N <= 64 ? 0.90 : 0.88));
    p.rect(cbx0, cy0, cbx1, cy1, M);
    p.rect(cbx0, cy0, cbx1, cy0 + 1, L);
    p.rect(cbx0, cy1 - 1, cbx1, cy1, K);
    if (hiDetail) { // barrel band rings
        for (const bx of [cbx0 + 8, cbx0 + 18]) p.rect(bx, cy0, bx + 2, cy1, D);
    }
    const mbw = N <= 64 ? 4 : 6; // muzzle brake block
    p.rect(cbx1 - mbw, cy0 - 1, cbx1, cy1 + 1, D);
    p.outline(cbx1 - mbw, cy0 - 1, cbx1, cy1 + 1, 1, K);
    if (hiDetail) p.rect(cbx1 - mbw + 2, cy0, cbx1 - mbw + 3, cy1, K);
    p.rect(cbx1 - 1, cy0 + 1, cbx1, cy1 - 1, K); // bore
    void W;
    return withShadow(p, 1, 2);
}

// Rusher: orange hammer-bot. REAL hammer silhouette, top-down east-facing:
// a slim haft trailing WEST (dark grip + orange pommel counterweight) and a
// big armored hammer HEAD to the EAST with a steel striking face at the far
// east edge + amber ocular lens. Head is ~4x the haft height: unmistakable.
function paintRusher(N) {
    const hiDetail = N >= 96;
    const p = new Pix(N);
    const K = PAL.get('k'), D = PAL.get('d'), M = PAL.get('m'), L = PAL.get('l');
    const T = PAL.get('t'), C = PAL.get('c'), W = PAL.get('w');
    const H = shades(PAL.get('o'));

    // --- haft (west): slim dark bar ---
    const hx0 = Math.round(N * 0.12), hx1 = Math.round(N * 0.62);
    const hh = N <= 64 ? 9 : 13;
    const hy0 = Math.round(N * 0.5 - hh / 2), hy1 = hy0 + hh;
    p.rect(hx0, hy0, hx1, hy1, D);
    p.outline(hx0, hy0, hx1, hy1, 1, K);
    p.rect(hx0, hy0, hx1, hy0 + 1, M); // top highlight
    // amber grip section with wrap bands
    const gx0 = Math.round(N * (N <= 64 ? 0.28 : 0.30)), gx1 = Math.round(N * (N <= 64 ? 0.44 : 0.46));
    p.rect(gx0, hy0, gx1, hy1, T);
    p.rect(gx0, hy0, gx0 + 1, hy1, K); p.rect(gx1 - 1, hy0, gx1, hy1, K);
    for (let x = gx0 + 3; x < gx1 - 1; x += 3) p.rect(x, hy0, x + 1, hy1, mul(T, 0.65));
    p.rect(hx0 + 3, hy0, hx0 + 5, hy1, M); // collar band
    if (hiDetail) { // haft grain lines fore + aft of grip
        for (let y = hy0 + 3; y < hy1 - 1; y += 3) {
            p.rect(hx0 + 6, y, gx0 - 2, y + 1, M);
            p.rect(gx1 + 2, y, hx1 - 6, y + 1, M);
        }
        p.rect(hx1 - 5, hy0, hx1 - 3, hy1, L); // socket ring where haft meets head
    }

    // --- pommel counterweight (far west): orange block taller than haft ---
    const px0 = Math.round(N * 0.04), px1 = Math.round(N * 0.12);
    const ph = hh + (N <= 64 ? 6 : 10);
    const py0 = Math.round(N * 0.5 - ph / 2), py1 = py0 + ph;
    p.rect(px0, py0, px1, py1, H.base);
    p.outline(px0, py0, px1, py1, 1, K);
    p.rect(px0, py0, px1, py0 + 1, H.hi);
    p.rect(px0, py1 - 2, px1, py1 - 1, H.lo);
    if (hiDetail) p.rect(px0 + 2, Math.round(N * 0.5) - 1, px1 - 2, Math.round(N * 0.5) + 1, H.lo2);

    // --- hammer HEAD (east): tall armored orange block ---
    const ex0 = Math.round(N * (N <= 64 ? 0.60 : 0.58)), ex1 = Math.round(N * (N <= 64 ? 0.94 : 0.95));
    const ey0 = Math.round(N * 0.18), ey1 = Math.round(N * 0.82);
    p.rect(ex0, ey0, ex1, ey1, H.base);
    const rows = ey1 - ey0; // light from north
    for (let y = ey0; y < ey1; y++) {
        const t = (y - ey0) / rows;
        const c = t < 0.2 ? H.hi : t > 0.85 ? H.lo2 : t > 0.65 ? H.lo : H.base;
        for (let x = ex0; x < ex1; x++) {
            const i = (y * N + x) * 4;
            if (p.b[i + 3] === 255 && p.b[i] === H.base[0] && p.b[i + 1] === H.base[1] && p.b[i + 2] === H.base[2]) {
                p.b[i] = c[0]; p.b[i + 1] = c[1]; p.b[i + 2] = c[2];
            }
        }
    }
    p.outline(ex0, ey0, ex1, ey1, 1, K);
    // top face plate
    const fy1 = ey0 + (N <= 64 ? 6 : 10);
    p.rect(ex0 + 1, ey0 + 1, ex1 - 1, fy1, mix(H.base, W, 0.16));
    p.rect(ex0 + 1, fy1 - 1, ex1 - 1, fy1, K);
    if (hiDetail) p.rect(ex0 + 1, ey0 + 1, ex1 - 1, ey0 + 2, H.hi2);
    // ocular amber lens on dark bed (upper-middle face)
    const lw = N <= 64 ? 5 : 8, lh = N <= 64 ? 4 : 6;
    const lx = Math.round(N * (N <= 64 ? 0.68 : 0.66)), ly = Math.round(N * 0.30);
    p.rect(lx - 1, ly - 1, lx + lw + 1, ly + lh + 1, K);
    for (let y = 0; y < lh; y++)
        p.rect(lx, ly + y, lx + lw, ly + y + 1, y < lh / 2 ? mix(T, W, 0.4) : mul(T, 0.7));
    p.rect(lx + 1, ly + 1, lx + (N <= 64 ? 2 : 3), ly + 2, C);
    // panel seam: single at 64, seam + bolts + skirt at 96
    const seamX = Math.round(N * 0.78);
    if (N <= 64) {
        p.rect(seamX, fy1 + 2, seamX + 1, ey1 - 1, H.lo2);
    } else {
        p.rect(seamX, fy1 + 2, seamX + 1, ey1 - 1, H.lo2);
        for (const [bx, by] of [[ex0 + 4, fy1 + 4], [seamX - 6, fy1 + 4], [ex0 + 4, ey1 - 6], [seamX - 6, ey1 - 6]]) {
            p.rect(bx, by, bx + 2, by + 2, L); p.px(bx, by, K);
        }
        p.rect(ex0 + 1, ey1 - 4, seamX, ey1 - 2, D); // lower skirt shade
    }
    // --- steel striking face (far east) + amber inlay stripe ---
    // Wide enough to read as a distinct steel cap, not an edge highlight.
    const sx0 = Math.round(N * (N <= 64 ? 0.825 : 0.83)), fw = ex1 - sx0;
    p.rect(sx0, ey0, ex1, ey1, M);
    p.outline(sx0, ey0, ex1, ey1, 1, K);
    p.rect(sx0, ey0, sx0 + 1, ey1, L); // leading highlight
    p.rect(ex1 - 2, ey0 + 1, ex1 - 1, ey1 - 1, K); // trailing edge shade
    const iw = Math.max(2, Math.round(fw * 0.40));
    const ix = sx0 + ((fw - iw) >> 1);
    p.rect(ix, ey0 + (N <= 64 ? 4 : 6), ix + iw, ey1 - (N <= 64 ? 4 : 6), T);
    p.rect(ix, ey0 + (N <= 64 ? 4 : 6), ix + 1, ey1 - (N <= 64 ? 4 : 6), K);
    if (hiDetail) { // face bolts top/bottom of inlay
        for (const by of [ey0 + 5, ey1 - 7]) {
            p.rect(ix - 1, by, ix + iw + 1, by + 2, D);
            p.outline(ix - 1, by, ix + iw + 1, by + 2, 1, K);
        }
    }
    return withShadow(p, 1, 2);
}

// 5x7 block font (uppercase + digits + - . / + space + parens) for labels.
const FONT = {
    A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
    D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.###.'],
    H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
    J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
    K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
    O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
    R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
    W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
    X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
    Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
    0: ['.###.', '#..##', '#.#.#', '#.#.#', '##..#', '#...#', '.###.'],
    1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '#####'],
    2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
    4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
    5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    6: ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
    7: ['#####', '....#', '...#.', '..#..', '..#..', '..#..', '..#..'],
    8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
    9: ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
    ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
    '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
    '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
    '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
    '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
    '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
    ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
};
function textW(s, sc) { return s.length * 6 * sc - sc; }
function drawText(buf, W, H, s, x, y, sc, c) {
    s = s.toUpperCase();
    for (let i = 0; i < s.length; i++) {
        const g = FONT[s[i]] || FONT[' '];
        for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) {
            if (g[r][q] !== '#') continue;
            const x0 = x + (i * 6 + q) * sc, y0 = y + r * sc;
            for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) {
                const xx = x0 + dx, yy = y0 + dy;
                if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
                const o = (yy * W + xx) * 4;
                buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = 255;
            }
        }
    }
}

// -------------------------------------------- contact sheet (floor + rows) ---
const FLOOR = [19, 25, 41], SEAM = [9, 12, 21], RIVET = [48, 61, 88];
function paintFloor(buf, W, H) {
    for (let i = 0; i < W * H; i++) { buf[i * 4] = FLOOR[0]; buf[i * 4 + 1] = FLOOR[1]; buf[i * 4 + 2] = FLOOR[2]; buf[i * 4 + 3] = 255; }
    const pw = 220, ph = 150;
    const plateVal = (a, b) => ((a * 73856093) ^ (b * 19349663)) >>> 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const row = Math.floor(y / ph), off = (row % 2) * (pw / 2);
        const col = Math.floor((x + off) / pw);
        const lx = (x + off) - col * pw, ly = y - row * ph;
        const o = (y * W + x) * 4;
        if (lx < 2 || ly < 2) { buf[o] = SEAM[0]; buf[o + 1] = SEAM[1]; buf[o + 2] = SEAM[2]; continue; }
        const j = (plateVal(col, row) % 7) - 3;
        buf[o] = clamp255(FLOOR[0] + j); buf[o + 1] = clamp255(FLOOR[1] + j); buf[o + 2] = clamp255(FLOOR[2] + j + 2);
        const nx = Math.min(lx, pw - 1 - lx), ny = Math.min(ly, ph - 1 - ly);
        if (nx < 8 && ny < 8 && ((lx - 6) ** 2 + (ly - 6) ** 2 <= 9 || (pw - 1 - lx - 6) ** 2 + (ly - 6) ** 2 <= 9 ||
            (lx - 6) ** 2 + (ph - 1 - ly - 6) ** 2 <= 9 || (pw - 1 - lx - 6) ** 2 + (ph - 1 - ly - 6) ** 2 <= 9)) {
            buf[o] = RIVET[0]; buf[o + 1] = RIVET[1]; buf[o + 2] = RIVET[2];
        }
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { // vignette
        const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2);
        const f = 1 - 0.32 * Math.min(1, (dx * dx + dy * dy) / 2);
        const o = (y * W + x) * 4;
        buf[o] = clamp255(buf[o] * f); buf[o + 1] = clamp255(buf[o + 1] * f); buf[o + 2] = clamp255(buf[o + 2] * f);
    }
}
// Nearest-neighbor blit of a (possibly transparent) Pix into the sheet.
function blitNearest(sheet, W, H, img, dx, dy, D) {
    const N = img.n;
    for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
        const sx = Math.min(N - 1, (x * N / D) | 0), sy = Math.min(N - 1, (y * N / D) | 0);
        const si = (sy * N + sx) * 4;
        if (img.b[si + 3] < 128) continue;
        const xx = dx + x, yy = dy + y;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const o = (yy * W + xx) * 4;
        const a = img.b[si + 3] / 255;
        sheet[o] = clamp255(img.b[si] * a + sheet[o] * (1 - a));
        sheet[o + 1] = clamp255(img.b[si + 1] * a + sheet[o + 1] * (1 - a));
        sheet[o + 2] = clamp255(img.b[si + 2] * a + sheet[o + 2] * (1 - a));
    }
}
const INK = [207, 214, 228], DIM = [130, 140, 160], CHIP = [10, 14, 24];
function chipText(sheet, W, H, s, cx, y, sc, color) {
    const w = textW(s, sc), x = Math.round(cx - w / 2);
    for (let yy = y - 4; yy < y + 7 * sc + 4; yy++)
        for (let xx = x - 8; xx < x + w + 8; xx++) {
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            const o = (yy * W + xx) * 4;
            sheet[o] = CHIP[0]; sheet[o + 1] = CHIP[1]; sheet[o + 2] = CHIP[2];
        }
    drawText(sheet, W, H, s, x, y, sc, color);
}
function buildSheet(robot, paint) {
    const name = robot.toUpperCase();
    const pad = 30, gap = 26, d1 = 192, d2 = 384;
    const W = pad * 2 + d2 * 2 + gap;
    const yTitle = 26, ySub = yTitle + 44;
    const yR1 = ySub + 40, yC1 = yR1 + 30, yCap1 = yC1 + d1 + 12;
    const yR2 = yCap1 + 56, yC2 = yR2 + 30, yCap2 = yC2 + d2 + 12;
    const yFoot = yCap2 + 56, H = yFoot + 40;
    const sheet = new Uint8ClampedArray(W * H * 4);
    paintFloor(sheet, W, H);
    const xL = pad, xR = pad + d2 + gap; // 384-wide columns
    const cL = xL + d2 / 2, cR = xR + d2 / 2;
    drawText(sheet, W, H, `${name} - 64 VS 96 NATIVE PIXEL MAPS`, pad, yTitle, 3, INK);
    drawText(sheet, W, H, `INTEGER NEAREST-NEIGHBOR DISPLAY - 64X3 / 96X2 - DARK ARENA FLOOR`, pad, ySub, 2, DIM);
    const img64 = paint(64), img96 = paint(96);
    drawText(sheet, W, H, `ROW 1X - DISPLAY 192PX (GAME SIZE)`, pad, yR1, 2, DIM);
    blitNearest(sheet, W, H, img64, Math.round(cL - d1 / 2), yC1, d1);
    blitNearest(sheet, W, H, img96, Math.round(cR - d1 / 2), yC1, d1);
    chipText(sheet, W, H, '64 NATIVE', cL, yCap1, 3, INK);
    chipText(sheet, W, H, '96 NATIVE', cR, yCap1, 3, INK);
    drawText(sheet, W, H, `ROW 2X HEADROOM - DISPLAY 384PX`, pad, yR2, 2, DIM);
    blitNearest(sheet, W, H, img64, xL, yC2, d2);
    blitNearest(sheet, W, H, img96, xR, yC2, d2);
    chipText(sheet, W, H, '64 NATIVE (2X)', cL, yCap2, 3, INK);
    chipText(sheet, W, H, '96 NATIVE (2X)', cR, yCap2, 3, INK);
    drawText(sheet, W, H, `EAST-FACING TOP-DOWN - NATIVE MAPS, NO UPSCALE - DEMO ONLY`, pad, yFoot, 2, DIM);
    return { sheet, W, H };
}
function nonFloorCount(sheet, W, H) {
    let c = 0;
    for (let i = 0; i < W * H; i += 3) {
        const o = i * 4;
        if (Math.abs(sheet[o] - FLOOR[0]) + Math.abs(sheet[o + 1] - FLOOR[1]) + Math.abs(sheet[o + 2] - FLOOR[2]) > 36) c++;
    }
    return c;
}
function main() {
    mkdirSync(OUT, { recursive: true });
    const jobs = [['brawler', paintBrawler], ['rusher', paintRusher]];
    for (const [robot, paint] of jobs) {
        const t = Date.now();
        const { sheet, W, H } = buildSheet(robot, paint);
        const path = join(OUT, `${robot}-64-vs-96.png`);
        writePNG(path, W, H, sheet);
        const live = nonFloorCount(sheet, W, H);
        console.log(`${robot}: ${path} ${W}x${H} nonfloor=${live} ${(Date.now() - t) / 1000}s`);
        if (live < 20000) throw new Error(`${robot}: sheet looks blank (nonfloor=${live})`);
    }
}
main();