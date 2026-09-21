// Minimal UI helpers: buttons and panels drawn with rectangles + text.

import { Scene } from 'phaser';
import { isReducedMotion } from './accessibility';
import { playHover } from './audio';
import { COLORS, FONTS } from './theme';

/**
 * Overlay entrance: fade + rise over 150 ms. Objects are created at their
 * final position; this offsets them down and tweens back. Under reduced
 * motion it is a no-op (content simply appears at its final state).
 */
export function transition(scene: Scene, targets: Phaser.GameObjects.GameObject[], rise = 8): void {
    if (targets.length === 0 || isReducedMotion()) return;
    for (const target of targets) {
        const obj = target as unknown as { y: number; alpha: number };
        obj.y += rise;
        obj.alpha = 0;
    }
    scene.tweens.add({
        targets: targets as unknown as Array<{ y: number; alpha: number }>,
        y: `-=${rise}`,
        alpha: 1,
        duration: 150,
        ease: 'Quad.easeOut',
    });
}

export interface Button {
    setLabel: (label: string) => void;
    setEnabled: (enabled: boolean) => void;
    destroy: () => void;
}

/** Visual hierarchy: one primary per screen, danger for destructive, ghost for tertiary. */
export type ButtonTier = 'primary' | 'default' | 'danger' | 'ghost';

export interface ButtonOpts {
    tier?: ButtonTier;
    /** Optional container the button's game objects are added to (screen layers). */
    container?: Phaser.GameObjects.Container;
}

const TIER_STYLE: Record<ButtonTier, { fill: number; edge: number; hoverFill: number; hoverEdge: number; text: string }> = {
    primary: { fill: 0x3a2f12, edge: 0xffd23f, hoverFill: 0x4a3c16, hoverEdge: 0xffd23f, text: '#ffd23f' },
    default: { fill: COLORS.panel, edge: COLORS.panelEdge, hoverFill: COLORS.panelHover, hoverEdge: COLORS.team[0], text: COLORS.ink },
    danger: { fill: 0x33161a, edge: 0xff5d5d, hoverFill: 0x421b20, hoverEdge: 0xff5d5d, text: '#ff8a8a' },
    ghost: { fill: COLORS.panel, edge: 0x2b3542, hoverFill: COLORS.panelHover, hoverEdge: 0x7d8b9b, text: COLORS.dim },
};

export function makeButton(
    scene: Scene,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    onClick: () => void,
    depth = 0,
    minTouch = 0,
    opts?: ButtonOpts,
): Button {
    const tier = opts?.tier ?? 'default';
    const style = TIER_STYLE[tier];
    const bg = scene.add.rectangle(x, y, w, h, style.fill).setStrokeStyle(2, style.edge).setDepth(depth);
    const layer = opts?.container ?? null;
    if (tier === 'ghost') bg.setFillStyle(style.fill, 0.25);
    const text = scene.add.text(x, y, label, FONTS.button).setOrigin(0.5).setDepth(depth);
    if (layer) layer.add([bg, text]);
    text.setColor(style.text);
    // Touch: pad small buttons up to minTouch with an invisible hit rect on
    // top (same depth, created later). Only use where neighbors leave room —
    // overlapping hit rects would misroute taps to the topmost control.
    let hit: Phaser.GameObjects.Rectangle | null = null;
    if (minTouch > 0 && (w < minTouch || h < minTouch)) {
        hit = scene.add.rectangle(x, y, Math.max(w, minTouch), Math.max(h, minTouch), COLORS.white, 0).setDepth(depth);
        if (layer) layer.add(hit);
    }
    const showHover = (): void => {
        bg.setFillStyle(style.hoverFill, tier === 'ghost' ? 0.6 : 1);
        bg.setStrokeStyle(2, style.hoverEdge);
        playHover();
    };
    const hideHover = (): void => {
        bg.setFillStyle(style.fill, tier === 'ghost' ? 0.25 : 1);
        bg.setStrokeStyle(2, style.edge);
    };
    // Press state: instant down-tint dip (kept under reduced motion — it is
    // state, not animation) + an 80 ms 0.96→1 scale punch (motion-gated).
    const reduced = isReducedMotion();
    const press = (): void => {
        bg.setFillStyle(COLORS.press);
        bg.setStrokeStyle(2, style.hoverEdge);
        if (!reduced) {
            scene.tweens.killTweensOf([bg, text]);
            bg.setScale(0.96);
            text.setScale(0.96);
        }
    };
    const release = (): void => {
        showHover();
        if (reduced) return;
        scene.tweens.add({ targets: [bg, text], scale: 1, duration: 80, ease: 'Quad.easeOut' });
    };
    const interactives: Phaser.GameObjects.Rectangle[] = hit ? [bg, hit] : [bg];
    for (const target of interactives) {
        target.setInteractive({ useHandCursor: true });
        target.on('pointerover', showHover);
        target.on('pointerout', () => {
            hideHover();
            bg.setScale(1);
            text.setScale(1);
        });
        target.on('pointerdown', () => {
            press();
            onClick();
        });
        target.on('pointerup', release);
    }
    return {
        setLabel: (next: string) => text.setText(next),
        setEnabled: (enabled: boolean) => {
            for (const target of interactives) {
                if (enabled) target.setInteractive({ useHandCursor: true });
                else target.disableInteractive();
            }
            text.setAlpha(enabled ? 1 : 0.4);
            if (!enabled) {
                // Disabled fill: sunk below every tier's resting fill.
                bg.setFillStyle(COLORS.press, 1);
                bg.setStrokeStyle(2, COLORS.panelEdge);
                bg.setScale(1);
                text.setScale(1);
            } else {
                hideHover();
            }
        },
        destroy: () => {
            bg.destroy();
            text.destroy();
            hit?.destroy();
        },
    };
}

/** Invisible touch hit rect for bespoke controls (editor +/- rows). */
export function addTouchHit(
    scene: Scene,
    x: number,
    y: number,
    w: number,
    h: number,
    onClick: () => void,
    depth = 0,
): Phaser.GameObjects.Rectangle {
    const hit = scene.add.rectangle(x, y, w, h, COLORS.white, 0).setDepth(depth);
    hit.setInteractive({ useHandCursor: true });
    hit.on('pointerdown', onClick);
    return hit;
}

export function makePanel(scene: Scene, x: number, y: number, w: number, h: number, title?: string): Phaser.GameObjects.GameObject[] {
    const out: Phaser.GameObjects.GameObject[] = [
        scene.add.rectangle(x, y, w, h, 0x0b0e12).setStrokeStyle(4, 0x0b0e12),
        scene.add.rectangle(x, y, w - 8, h - 8, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge),
        // Top highlight + header bar + reclaimed panel_tile corner chrome.
        scene.add.rectangle(x, y - h / 2 + 6, w - 12, 2, COLORS.white, 0.07),
    ];
    if (title !== undefined) {
        out.push(
            scene.add.rectangle(x, y - h / 2 + 18, w - 12, 22, COLORS.panelHover).setStrokeStyle(1, COLORS.panelEdge),
            scene.add.text(x, y - h / 2 + 18, title, FONTS.monoSmall).setOrigin(0.5),
        );
    }
    if (scene.textures.exists('panel_tile')) {
        const cx = w / 2 - 14;
        const cy = h / 2 - 14;
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
            out.push(scene.add.image(x + sx * cx, y + sy * cy, 'panel_tile').setScale(0.5).setFlipX(sx > 0).setFlipY(sy > 0));
        }
    }
    return out;
}

/** Best-effort clipboard copy with a legacy execCommand fallback. */
export function copyText(text: string): Promise<boolean> {
    if (navigator.clipboard?.writeText !== undefined) {
        return navigator.clipboard.writeText(text).then(
            () => true,
            () => false,
        );
    }
    try {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return Promise.resolve(ok);
    } catch {
        return Promise.resolve(false);
    }
}

/** Trigger a browser download of a text file (used for robot export). */
export function downloadText(filename: string, content: string): void {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
