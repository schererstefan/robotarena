// Keyboard menu navigation: a linear focus ring over registered canvas
// controls. Tab / arrows move, Enter / Space activates, Escape closes the
// top overlay. The ring hides on pointer input and reappears on key input.

import { Scene } from 'phaser';

export interface NavTarget {
    x: number;
    y: number;
    w: number;
    h: number;
    activate: () => void;
}

export class FocusNav {
    onEscape: (() => void) | null = null;
    private readonly g: Phaser.GameObjects.Graphics;
    private targets: NavTarget[] = [];
    private index = -1;

    constructor(scene: Scene, depth = 100) {
        this.g = scene.add.graphics().setDepth(depth).setVisible(false);
    }

    setTargets(targets: NavTarget[]): void {
        this.targets = targets;
        this.index = targets.length > 0 ? 0 : -1;
        this.draw();
    }

    /** Swap targets but keep the focus position (clamped): for list rebuilds. */
    replaceTargets(targets: NavTarget[]): void {
        this.targets = targets;
        if (targets.length === 0) this.index = -1;
        else if (this.index < 0) this.index = 0;
        else this.index = Math.min(this.index, targets.length - 1);
        this.draw();
    }

    reset(): void {
        this.index = this.targets.length > 0 ? 0 : -1;
        this.draw();
    }

    get count(): number {
        return this.targets.length;
    }

    move(dir: 1 | -1): void {
        if (this.targets.length === 0) return;
        this.index = (this.index + dir + this.targets.length) % this.targets.length;
        this.draw();
    }

    activate(): void {
        this.targets[this.index]?.activate();
    }

    hideRing(): void {
        this.g.setVisible(false);
    }

    /** Returns true when the key was consumed. */
    handleKey(event: KeyboardEvent): boolean {
        if (event.code === 'Escape') {
            if (this.onEscape) {
                this.onEscape();
                return true;
            }
            return false;
        }
        if (this.targets.length === 0) return false;
        switch (event.code) {
            case 'Tab':
                this.move(event.shiftKey ? -1 : 1);
                event.preventDefault();
                return true;
            case 'ArrowDown':
            case 'ArrowRight':
                this.move(1);
                event.preventDefault();
                return true;
            case 'ArrowUp':
            case 'ArrowLeft':
                this.move(-1);
                event.preventDefault();
                return true;
            case 'Enter':
            case 'Space':
                this.activate();
                event.preventDefault();
                return true;
            default:
                return false;
        }
    }

    private draw(): void {
        const target = this.targets[this.index];
        if (!target) {
            this.g.setVisible(false);
            return;
        }
        this.g.clear();
        this.g.lineStyle(2, 0xffd23f, 1);
        this.g.strokeRect(target.x - target.w / 2 - 3, target.y - target.h / 2 - 3, target.w + 6, target.h + 6);
        this.g.setVisible(true);
    }
}
