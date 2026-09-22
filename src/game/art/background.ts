// Dark metal-plate tile floor for battle arenas (render-only — zero gameplay
// effect). Replaces the Calm-B seeded wash with large navy plates, staggered
// seams, corner rivets, a teal rim glow at the arena boundary, and a few
// extremely faint cyan specks.
//
// Determinism: every pixel of variation derives from seeded RNG (the sim
// mulberry32 via createRng, plus integer hashes) evaluated once per battle
// repaint. No Math.random / Date.now anywhere in this file. The plate grid
// geometry is fixed; only per-plate brightness, the accent wear plates, the
// speck layout/constellation, the tonal shift, and the glow strengths vary
// per seed — so a replay of the same seed paints byte-identically. Static:
// no animation, so replays stay trivially identical.
//
// Style contract: very dark overall (robots, pads, turrets, barriers and
// projectiles must pop). Specks stay extremely faint and tiny so they are
// never confused with powerup pads; the amber channel belongs to gameplay
// only (no warm floor lights). Colorblind-safe: landmarks and the
// shape-coded cues in art.ts floorOverlay are untouched — this file paints
// under them.
//
// art-qa note: this file holds no string pixel maps and no #rrggbb
// literals, so the map/charset/budget/hex scans have nothing to flag.

import { createRng } from '../../sim/rng';

/** Arena floor dims (px). Matches the composed floor_big texture. */
const FLOOR_W = 960;
const FLOOR_H = 640;

/** Plate grid: ~112px plates (brief: roughly 100-120px at 960x640). */
const PLATE_W = 120;
const PLATE_ROWS = 6;
const ROW_H = FLOOR_H / PLATE_ROWS;
/** Odd rows shift by half a plate (running-bond stagger, fixed). */
const STAGGER = PLATE_W / 2;
/** Rim glow band depth (px) inside the arena boundary. */
const RIM_DEPTH = 30;

/** One accent wear plate: axis-snapped rect outline on the 960x640 floor. */
export interface BgPanel {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** One faint cyan floor speck: baked 2px core + faint halo, static. */
export interface BgLight {
    x: number;
    y: number;
    /** True for a teal-green tint, false for the usual ice-cyan tint. */
    warm: boolean;
}

/** Faint speck constellation near the arena middle (layout fixed per kind). */
export type BgCenterMark = 'ticks' | 'dots' | 'corners';

/** Seeded theme: tonal shift, wear plates, speck placement, edge glow. */
export interface BgTheme {
    top: string;
    bottom: string;
    panels: BgPanel[];
    lights: BgLight[];
    centerMark: BgCenterMark;
    /** Teal rim-glow strength (0.10-0.22); geometry never moves. */
    edgeGlow: number;
    /** Radial vignette strength (0.38-0.52); geometry never moves. */
    vignette: number;
}

/** Deterministic [0,1) hash of one integer (vignette/edge jitter). */
export function hashSeed01(n: number): number {
    let h = (Math.imul(n | 0, 374761393) + 0x9e3779b9) | 0;
    h = (h ^ (h >>> 13)) | 0;
    h = Math.imul(h, 1274126177);
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
}

/** Theme for a match seed. Draw order is fixed (base -> plates -> tonal ->
 * wear plates -> specks -> constellation -> vignette -> rim) so identical
 * seeds compose identically. */
export function bgThemeForSeed(seed: number): BgTheme {
    const rng = createRng((seed ^ 0x51ab3f) >>> 0);
    // Three dark navy tonal variants (alpha <= 0.10: quiet floor).
    const gradients: Array<[string, string]> = [
        ['rgba(22,32,50,0.08)', 'rgba(4,6,9,0.10)'],
        ['rgba(18,28,48,0.10)', 'rgba(5,7,11,0.08)'],
        ['rgba(26,34,52,0.07)', 'rgba(4,6,10,0.10)'],
    ];
    const pair = gradients[Math.floor(rng() * gradients.length)] as [string, string];
    // 3-6 accent wear plates, kept clear of the center emblem (r ~120).
    const panels: BgPanel[] = [];
    const panelN = 3 + Math.floor(rng() * 4);
    let guard = 0;
    while (panels.length < panelN && guard < 40) {
        guard += 1;
        const w = 120 + Math.floor(rng() * 200);
        const h = 90 + Math.floor(rng() * 160);
        const x = Math.round(40 + rng() * (960 - 80 - w));
        const y = Math.round(40 + rng() * (640 - 80 - h));
        // Keep accents off the SD emblem so decor never fights the landmark.
        const cx = Math.max(x, Math.min(480, x + w));
        const cy = Math.max(y, Math.min(320, y + h));
        if ((cx - 480) * (cx - 480) + (cy - 320) * (cy - 320) < 130 * 130) continue;
        panels.push({ x, y, w, h });
    }
    // 3-6 sparse faint specks, well separated, off the emblem.
    const lights: BgLight[] = [];
    const lightN = 3 + Math.floor(rng() * 4);
    guard = 0;
    while (lights.length < lightN && guard < 60) {
        guard += 1;
        const x = Math.round(70 + rng() * 820);
        const y = Math.round(70 + rng() * 500);
        if ((x - 480) * (x - 480) + (y - 320) * (y - 320) < 130 * 130) continue;
        let crowded = false;
        for (const l of lights) {
            if (Math.abs(l.x - x) + Math.abs(l.y - y) < 150) {
                crowded = true;
                break;
            }
        }
        if (crowded) continue;
        lights.push({ x, y, warm: rng() < 0.25 });
    }
    const marks: BgCenterMark[] = ['ticks', 'dots', 'corners'];
    const centerMark = marks[Math.floor(rng() * marks.length)] as BgCenterMark;
    return {
        top: pair[0],
        bottom: pair[1],
        panels,
        lights,
        centerMark,
        edgeGlow: 0.1 + hashSeed01(seed ^ 0x3d5a77) * 0.12,
        vignette: 0.38 + hashSeed01(seed ^ 0x77aa11) * 0.14,
    };
}

/** Full 960x640 seeded pass: navy base, plate grid, tonal shift, wear
 * plates, specks, constellation, vignette, teal rim. Opaque: covers the
 * legacy 16px tile layer beneath with the plate floor. */
export function paintBackground(context: CanvasRenderingContext2D, seed: number): void {
    const theme = bgThemeForSeed(seed);
    // Near-black navy base (opaque cover over the legacy tile bake).
    context.fillStyle = 'rgb(10,14,22)';
    context.fillRect(0, 0, FLOOR_W, FLOOR_H);
    paintPlates(context, seed);
    const grad = context.createLinearGradient(0, 0, 0, FLOOR_H);
    grad.addColorStop(0, theme.top);
    grad.addColorStop(1, theme.bottom);
    context.fillStyle = grad;
    context.fillRect(0, 0, FLOOR_W, FLOOR_H);
    paintWearPlates(context, theme.panels);
    paintSpecks(context, theme.lights);
    paintConstellation(context, theme.centerMark);
    paintVignette(context, theme.vignette);
    paintRimGlow(context, theme.edgeGlow);
}

/** Plate shade ramp: dark navy steps around the base (subtle variation). */
const PLATE_SHADES = ['rgb(16,22,34)', 'rgb(19,26,40)', 'rgb(14,19,30)', 'rgb(22,30,45)'];

/** Staggered plate grid with per-plate brightness, seams, and rivets.
 * Fixed geometry; brightness draws come from a seeded stream in fixed
 * row-major order, so the layout is byte-identical per seed. */
function paintPlates(context: CanvasRenderingContext2D, seed: number): void {
    const rng = createRng((seed ^ 0x2a7f1c) >>> 0);
    for (let row = 0; row < PLATE_ROWS; row += 1) {
        const y0 = row * ROW_H;
        const off = row % 2 === 1 ? STAGGER : 0;
        for (let x = -PLATE_W; x < FLOOR_W + PLATE_W; x += PLATE_W) {
            const x0 = x + off;
            // Per-plate brightness: one seeded draw per plate, fixed order.
            const shade = PLATE_SHADES[Math.floor(rng() * PLATE_SHADES.length)] as string;
            context.fillStyle = shade;
            context.fillRect(x0, y0, PLATE_W, ROW_H);
            // Seam: dark 1px slot + faint lower highlight lip.
            context.strokeStyle = 'rgba(2,4,7,0.85)';
            context.lineWidth = 1;
            context.strokeRect(x0 + 0.5, y0 + 0.5, PLATE_W, ROW_H);
            context.strokeStyle = 'rgba(150,190,230,0.06)';
            context.beginPath();
            context.moveTo(x0 + 0.5, y0 + ROW_H + 1.5);
            context.lineTo(x0 + PLATE_W + 0.5, y0 + ROW_H + 1.5);
            context.moveTo(x0 + PLATE_W + 1.5, y0 + 0.5);
            context.lineTo(x0 + PLATE_W + 1.5, y0 + ROW_H + 0.5);
            context.stroke();
            // Corner rivets: dark pit + top-left catchlight, inset 6px.
            for (const [rx, ry] of [
                [x0 + 6, y0 + 6],
                [x0 + PLATE_W - 7, y0 + 6],
                [x0 + 6, y0 + ROW_H - 7],
                [x0 + PLATE_W - 7, y0 + ROW_H - 7],
            ] as const) {
                context.fillStyle = 'rgba(2,4,7,0.9)';
                context.fillRect(rx, ry, 2, 2);
                context.fillStyle = 'rgba(160,200,240,0.16)';
                context.fillRect(rx, ry, 1, 1);
            }
        }
    }
}

/** Accent wear plates: a whisper-lighter inset + one scuff scratch. Quiet
 * enough to read as floor wear, never as gameplay info. */
function paintWearPlates(context: CanvasRenderingContext2D, panels: BgPanel[]): void {
    for (const p of panels) {
        context.fillStyle = 'rgba(120,160,200,0.045)';
        context.fillRect(p.x, p.y, p.w, p.h);
        context.strokeStyle = 'rgba(120,160,200,0.05)';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(p.x + 8.5, p.y + p.h - 12.5);
        context.lineTo(p.x + p.w - 14.5, p.y + 10.5);
        context.stroke();
    }
}

/** Extremely faint cyan specks: 2px core + soft halo, static (no motion).
 * Tiny and dim by design — decoration only, never pad-like. */
function paintSpecks(context: CanvasRenderingContext2D, lights: BgLight[]): void {
    for (const l of lights) {
        const core = l.warm ? '150,255,235' : '150,220,255';
        context.fillStyle = `rgba(${core},0.05)`;
        context.fillRect(l.x - 4, l.y - 4, 9, 9);
        context.fillStyle = `rgba(${core},0.30)`;
        context.fillRect(l.x - 1, l.y - 1, 2, 2);
    }
}

/** Faint speck constellation near the arena middle (no rings or emblems —
 * the SD emblem in floorOverlay owns the center). Positions fixed per
 * kind; the kind varies per seed. */
function paintConstellation(context: CanvasRenderingContext2D, mark: BgCenterMark): void {
    const pts: Array<[number, number]> = [];
    if (mark === 'ticks') {
        for (let t = 0; t < 6; t += 1) {
            const a = (t / 6) * Math.PI * 2 + 0.26;
            pts.push([Math.round(480 + Math.cos(a) * 92), Math.round(320 + Math.sin(a) * 92)]);
        }
    } else if (mark === 'dots') {
        for (let t = 0; t < 8; t += 1) {
            const a = (t / 8) * Math.PI * 2;
            const r = 84 + ((t * 37) % 12);
            pts.push([Math.round(480 + Math.cos(a) * r), Math.round(320 + Math.sin(a) * r)]);
        }
    } else {
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
            pts.push([480 + sx * 92, 320 + sy * 92]);
        }
    }
    for (const [x, y] of pts) {
        context.fillStyle = 'rgba(150,220,255,0.05)';
        context.fillRect(x - 4, y - 4, 9, 9);
        context.fillStyle = 'rgba(150,220,255,0.28)';
        context.fillRect(x - 1, y - 1, 2, 2);
    }
}

/** Soft radial vignette: darker toward the edges (strength varies per seed,
 * geometry never moves). */
function paintVignette(context: CanvasRenderingContext2D, strength: number): void {
    const grad = context.createRadialGradient(480, 320, 280, 480, 320, 620);
    grad.addColorStop(0, 'rgba(5,7,10,0)');
    grad.addColorStop(1, `rgba(5,7,10,${strength.toFixed(3)})`);
    context.fillStyle = grad;
    context.fillRect(0, 0, FLOOR_W, FLOOR_H);
}

/** Teal rim frame at the arena boundary: soft inner glow band + one
 * brighter line just inside the overlay border. Strength varies per seed
 * (edgeGlow 0.10-0.22); geometry never moves. */
function paintRimGlow(context: CanvasRenderingContext2D, edgeGlow: number): void {
    const peak = edgeGlow + 0.14;
    const band = (x0: number, y0: number, x1: number, y1: number, horizontal: boolean): void => {
        const grad = horizontal
            ? context.createLinearGradient(0, y0, 0, y1)
            : context.createLinearGradient(x0, 0, x1, 0);
        grad.addColorStop(0, `rgba(64,220,235,${peak.toFixed(3)})`);
        grad.addColorStop(1, 'rgba(64,220,235,0)');
        context.fillStyle = grad;
        context.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    };
    band(0, 0, 0, RIM_DEPTH, true);
    band(0, FLOOR_H, 0, FLOOR_H - RIM_DEPTH, true);
    band(0, 0, RIM_DEPTH, 0, false);
    band(FLOOR_W, 0, FLOOR_W - RIM_DEPTH, 0, false);
    // Brighter inner line (sits just inside the overlay's 2px border).
    context.strokeStyle = `rgba(110,225,245,${(0.38 + edgeGlow).toFixed(3)})`;
    context.lineWidth = 2;
    context.strokeRect(6, 6, FLOOR_W - 12, FLOOR_H - 12);
}

/**
 * Uniform cover-fit magnification: canvas dims over source dims, aspect
 * preserved (overflow crops). Pure helper so the soak suite can pin the
 * menu-hero scaling contract without booting Phaser.
 */
export function coverScale(srcW: number, srcH: number, canvasW: number, canvasH: number): number {
    if (srcW <= 0 || srcH <= 0 || canvasW <= 0 || canvasH <= 0) return 1;
    return Math.max(canvasW / srcW, canvasH / srcH);
}
