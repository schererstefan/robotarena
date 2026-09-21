// Calm minimal arena backgrounds (render-only — zero gameplay effect).
//
// Every match paints a slightly different floor, but a replay of the same
// seed paints byte-identically: all streams derive from the match seed via
// the sim mulberry32 (no Math.random / Date.now anywhere in this file).
// Tile grain mixes through integer hashes in art.ts; everything here is a
// pure function of the seed evaluated once per battle repaint.
//
// Style direction (chosen): very dark blue-black metal, barely visible
// panel seams, a few sparse dim floor lights, faint center-mark variants,
// thin border-wall glow. No motifs, no nebula/stardust, no animated dust —
// when in doubt detail was removed so robots, pads, turrets and projectiles
// pop. Decor only, never gameplay info (colorblind-safe: landmarks and the
// shape-coded cues in art.ts floorOverlay are untouched).
//
// art-qa note: this file holds no string pixel maps and no #rrggbb
// literals, so the map/charset/budget/hex scans have nothing to flag.

import { createRng } from '../../sim/rng';

/** One panel seam: axis-snapped 1px rect outline on the 960x640 floor. */
export interface BgPanel {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** One dim floor light: baked 2px core + faint halo, static (no motion). */
export interface BgLight {
    x: number;
    y: number;
    /** True for a rare warm service-light, false for the usual cool one. */
    warm: boolean;
}

/** Faint decor ring around the SD emblem (geometry fixed, style varies). */
export type BgCenterMark = 'ticks' | 'dots' | 'corners';

/** Seeded theme: tonal shift, panel layout, light placement, edge glow. */
export interface BgTheme {
    top: string;
    bottom: string;
    panels: BgPanel[];
    lights: BgLight[];
    centerMark: BgCenterMark;
    /** Thin inner border-wall glow alpha (0.10-0.22, cool blue). */
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

/** Theme for a match seed. Draw order is fixed (tonal -> panels -> lights
 * -> center mark) so identical seeds compose identically. */
export function bgThemeForSeed(seed: number): BgTheme {
    const rng = createRng((seed ^ 0x51ab3f) >>> 0);
    // Three dark blue-black tonal variants (alpha <= 0.10: quiet floor).
    const gradients: Array<[string, string]> = [
        ['rgba(20,30,46,0.08)', 'rgba(5,7,10,0.10)'],
        ['rgba(16,26,44,0.10)', 'rgba(6,8,12,0.08)'],
        ['rgba(24,32,48,0.07)', 'rgba(5,7,11,0.10)'],
    ];
    const pair = gradients[Math.floor(rng() * gradients.length)] as [string, string];
    // 3-6 large panel seams, kept clear of the center emblem (r ~120).
    const panels: BgPanel[] = [];
    const panelN = 3 + Math.floor(rng() * 4);
    let guard = 0;
    while (panels.length < panelN && guard < 40) {
        guard += 1;
        const w = 120 + Math.floor(rng() * 200);
        const h = 90 + Math.floor(rng() * 160);
        const x = Math.round(40 + rng() * (960 - 80 - w));
        const y = Math.round(40 + rng() * (640 - 80 - h));
        // Keep seams off the SD emblem so decor never fights the landmark.
        const cx = Math.max(x, Math.min(480, x + w));
        const cy = Math.max(y, Math.min(320, y + h));
        if ((cx - 480) * (cx - 480) + (cy - 320) * (cy - 320) < 130 * 130) continue;
        panels.push({ x, y, w, h });
    }
    // 3-6 sparse dim floor lights, well separated, off the emblem.
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

/** Full 960x640 seeded pass: tonal shift, panel seams, floor lights, mark. */
export function paintBackground(context: CanvasRenderingContext2D, seed: number): void {
    const theme = bgThemeForSeed(seed);
    const grad = context.createLinearGradient(0, 0, 0, 640);
    grad.addColorStop(0, theme.top);
    grad.addColorStop(1, theme.bottom);
    context.fillStyle = grad;
    context.fillRect(0, 0, 960, 640);
    paintPanels(context, theme.panels);
    paintLights(context, theme.lights);
    paintCenterMark(context, theme.centerMark);
}

/** Barely-visible panel seams: dark 1px slot + faint lower highlight lip. */
function paintPanels(context: CanvasRenderingContext2D, panels: BgPanel[]): void {
    for (const p of panels) {
        context.strokeStyle = 'rgba(5,7,10,0.55)';
        context.lineWidth = 1;
        context.strokeRect(p.x + 0.5, p.y + 0.5, p.w, p.h);
        context.strokeStyle = 'rgba(150,190,230,0.05)';
        context.beginPath();
        context.moveTo(p.x + 0.5, p.y + p.h + 1.5);
        context.lineTo(p.x + p.w + 0.5, p.y + p.h + 1.5);
        context.moveTo(p.x + p.w + 1.5, p.y + 0.5);
        context.lineTo(p.x + p.w + 1.5, p.y + p.h + 0.5);
        context.stroke();
    }
}

/** Sparse dim floor lights: 2px core + faint static halo (baked, no motion). */
function paintLights(context: CanvasRenderingContext2D, lights: BgLight[]): void {
    for (const l of lights) {
        const core = l.warm ? '255,200,130' : '190,215,240';
        context.fillStyle = `rgba(${core},0.06)`;
        context.fillRect(l.x - 4, l.y - 4, 9, 9);
        context.fillStyle = `rgba(${core},0.32)`;
        context.fillRect(l.x - 1, l.y - 1, 2, 2);
    }
}

/** Faint decor around the SD emblem (r 84-96; the emblem itself is fixed). */
function paintCenterMark(context: CanvasRenderingContext2D, mark: BgCenterMark): void {
    context.strokeStyle = 'rgba(190,215,240,0.07)';
    context.fillStyle = 'rgba(190,215,240,0.07)';
    context.lineWidth = 1;
    if (mark === 'ticks') {
        for (let t = 0; t < 12; t += 1) {
            const a = (t / 12) * Math.PI * 2;
            const x0 = Math.round(480 + Math.cos(a) * 88) + 0.5;
            const y0 = Math.round(320 + Math.sin(a) * 88) + 0.5;
            const x1 = Math.round(480 + Math.cos(a) * 96) + 0.5;
            const y1 = Math.round(320 + Math.sin(a) * 96) + 0.5;
            context.beginPath();
            context.moveTo(x0, y0);
            context.lineTo(x1, y1);
            context.stroke();
        }
    } else if (mark === 'dots') {
        for (let t = 0; t < 16; t += 1) {
            const a = (t / 16) * Math.PI * 2;
            context.fillRect(Math.round(480 + Math.cos(a) * 92), Math.round(320 + Math.sin(a) * 92), 2, 2);
        }
    } else {
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
            const x = 480 + sx * 92;
            const y = 320 + sy * 92;
            context.beginPath();
            context.moveTo(x - sx * 10 + 0.5, y + 0.5);
            context.lineTo(x + 0.5, y + 0.5);
            context.lineTo(x + 0.5, y - sy * 10 + 0.5);
            context.stroke();
        }
    }
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
