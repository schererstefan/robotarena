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
): Button {
    const bg = scene.add.rectangle(x, y, w, h, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(depth);
    const text = scene.add.text(x, y, label, FONTS.button).setOrigin(0.5).setDepth(depth);
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => {
        bg.setFillStyle(0x1d2530);
        bg.setStrokeStyle(2, COLORS.team[0]);
    });
    bg.on('pointerout', () => {
        bg.setFillStyle(COLORS.panel);
        bg.setStrokeStyle(2, COLORS.panelEdge);
    });
    bg.on('pointerdown', onClick);
    return {
        setLabel: (next: string) => text.setText(next),
        setEnabled: (enabled: boolean) => {
            if (enabled) {
                bg.setInteractive({ useHandCursor: true });
                text.setAlpha(1);
            } else {
                bg.disableInteractive();
                text.setAlpha(0.4);
            }
        },
        destroy: () => {
            bg.destroy();
            text.destroy();
        },
    };
}

export function makePanel(scene: Scene, x: number, y: number, w: number, h: number): void {
    scene.add.rectangle(x, y, w, h, 0x0b0e12).setStrokeStyle(4, 0x0b0e12);
    scene.add.rectangle(x, y, w - 8, h - 8, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge);
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
