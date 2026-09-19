// Minimal UI helpers: buttons and panels drawn with rectangles + text.

import { Scene } from 'phaser';
import { COLORS, FONTS } from './theme';

export interface Button {
    setLabel: (label: string) => void;
    setEnabled: (enabled: boolean) => void;
    destroy: () => void;
}

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
): Button {
    const bg = scene.add.rectangle(x, y, w, h, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(depth);
    const text = scene.add.text(x, y, label, FONTS.button).setOrigin(0.5).setDepth(depth);
    // Touch: pad small buttons up to minTouch with an invisible hit rect on
    // top (same depth, created later). Only use where neighbors leave room —
    // overlapping hit rects would misroute taps to the topmost control.
    let hit: Phaser.GameObjects.Rectangle | null = null;
    if (minTouch > 0 && (w < minTouch || h < minTouch)) {
        hit = scene.add.rectangle(x, y, Math.max(w, minTouch), Math.max(h, minTouch), 0xffffff, 0).setDepth(depth);
    }
    const showHover = (): void => {
        bg.setFillStyle(0x1d2530);
        bg.setStrokeStyle(2, COLORS.team[0]);
    };
    const hideHover = (): void => {
        bg.setFillStyle(COLORS.panel);
        bg.setStrokeStyle(2, COLORS.panelEdge);
    };
    const interactives: Phaser.GameObjects.Rectangle[] = hit ? [bg, hit] : [bg];
    for (const target of interactives) {
        target.setInteractive({ useHandCursor: true });
        target.on('pointerover', showHover);
        target.on('pointerout', hideHover);
        target.on('pointerdown', onClick);
    }
    return {
        setLabel: (next: string) => text.setText(next),
        setEnabled: (enabled: boolean) => {
            for (const target of interactives) {
                if (enabled) target.setInteractive({ useHandCursor: true });
                else target.disableInteractive();
            }
            text.setAlpha(enabled ? 1 : 0.4);
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
    const hit = scene.add.rectangle(x, y, w, h, 0xffffff, 0).setDepth(depth);
    hit.setInteractive({ useHandCursor: true });
    hit.on('pointerdown', onClick);
    return hit;
}

export function makePanel(scene: Scene, x: number, y: number, w: number, h: number): void {
    scene.add.rectangle(x, y, w, h, 0x0b0e12).setStrokeStyle(4, 0x0b0e12);
    scene.add.rectangle(x, y, w - 8, h - 8, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge);
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
