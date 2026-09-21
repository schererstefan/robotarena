// Robot workshop scene: an in-browser starter editor with static sanity
// checks. User code is NEVER executed here — it is analyzed as text and
// downloaded as a .ts file. Editing uses a DOM textarea (real text input),
// styled to match the replay dialog.

import { Scene } from 'phaser';
import { playClick, unlockAudio } from '../audio';
import {
    checkDetailSuffix,
    COMMON,
    WORKSHOP,
    workshopDownloaded,
    workshopSummary,
} from '../strings';
import { COLORS, FONT_STACKS, FONTS } from '../theme';
import { copyText, downloadText } from '../ui';
import { checkRobotSource, suggestFilename, WORKSHOP_TEMPLATE, workshopPassed } from '../workshop';

export class WorkshopScene extends Scene {
    private overlay: HTMLDivElement | null = null;
    private area: HTMLTextAreaElement | null = null;
    private checksBox: HTMLDivElement | null = null;
    private summary: HTMLDivElement | null = null;
    private status: HTMLDivElement | null = null;

    constructor() {
        super('Workshop');
    }

    create(): void {
        this.overlay = null;
        this.area = null;
        this.checksBox = null;
        this.summary = null;
        this.status = null;
        this.add.text(512, 44, WORKSHOP.title, FONTS.title).setOrigin(0.5);
        this.add
            .text(512, 86, WORKSHOP.subtitle, FONTS.small)
            .setOrigin(0.5);
        this.buildOverlay();
        this.input.keyboard?.on('keydown-ESC', this.onEscapeKey);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown-ESC', this.onEscapeKey);
            this.closeOverlay();
        });
    }

    private onEscapeKey = (): void => {
        this.scene.start('Menu');
    };

    private buildOverlay(): void {
        const overlay = document.createElement('div');
        overlay.style.cssText =
            'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
            'background:rgba(6,8,11,0.92);z-index:1000;';
        const panel = document.createElement('div');
        panel.style.cssText =
            'background:#141a21;border:2px solid #2b3542;padding:20px 24px;width:880px;max-width:94vw;' +
            `max-height:92vh;overflow-y:auto;font-family:${FONT_STACKS.body};line-height:1.3;`;
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        this.overlay = overlay;

        const title = document.createElement('div');
        title.style.cssText = 'color:#e8edf2;font-size:20px;margin-bottom:4px;';
        title.textContent = WORKSHOP.title;
        panel.appendChild(title);
        const sub = document.createElement('div');
        sub.style.cssText = 'color:#9aa7b4;font-size:18px;margin-bottom:10px;';
        sub.textContent = WORKSHOP.panelSub;
        panel.appendChild(sub);

        const area = document.createElement('textarea');
        area.value = WORKSHOP_TEMPLATE;
        area.spellcheck = false;
        area.style.cssText =
            'width:100%;box-sizing:border-box;height:300px;background:#0b0e12;border:1px solid #2b3542;' +
            `color:#e8edf2;padding:12px;font-family:${FONT_STACKS.body};font-size:18px;line-height:1.4;` +
            'white-space:pre;tab-size:4;resize:vertical;';
        // Keep keystrokes (including ESC) inside the editor.
        area.addEventListener('keydown', (event) => event.stopPropagation());
        area.addEventListener('input', () => this.refresh());
        panel.appendChild(area);
        this.area = area;

        const summary = document.createElement('div');
        summary.style.cssText = 'font-size:18px;margin:10px 0 6px;';
        panel.appendChild(summary);
        this.summary = summary;

        const checksBox = document.createElement('div');
        checksBox.style.cssText = 'font-size:18px;margin-bottom:10px;';
        panel.appendChild(checksBox);
        this.checksBox = checksBox;

        const status = document.createElement('div');
        status.style.cssText = 'color:#9aa7b4;font-size:18px;min-height:24px;margin-bottom:8px;';
        panel.appendChild(status);
        this.status = status;

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;';
        panel.appendChild(row);
        this.domButton(row, WORKSHOP.download, true, () => {
            const source = this.area?.value ?? '';
            downloadText(suggestFilename(source), source);
            this.setStatus(workshopDownloaded(suggestFilename(source)));
        });
        this.domButton(row, WORKSHOP.copy, false, () => {
            const source = this.area?.value ?? '';
            void copyText(source).then((ok) => this.setStatus(ok ? WORKSHOP.copied : WORKSHOP.copyFailed));
        });
        this.domButton(row, WORKSHOP.reset, false, () => {
            if (this.area) this.area.value = WORKSHOP_TEMPLATE;
            this.setStatus(WORKSHOP.resetDone);
            this.refresh();
        });
        this.domButton(row, COMMON.menu, false, () => this.scene.start('Menu'));

        this.refresh();
        // Keyboard-first: land focus in the editor so typing starts at once.
        area.focus();
    }

    private domButton(parent: HTMLElement, label: string, accent: boolean, onClick: () => void): void {
        const button = document.createElement('button');
        button.textContent = label;
        button.style.cssText =
            `flex:1;background:${accent ? COLORS.panelHoverCss : COLORS.panelCss};` +
            `border:2px solid ${accent ? '#ffb340' : '#2b3542'};color:#e8edf2;padding:12px;` +
            'font-family:inherit;font-size:18px;cursor:pointer;';
        button.addEventListener('click', () => {
            unlockAudio();
            playClick();
            onClick();
        });
        parent.appendChild(button);
    }

    private setStatus(text: string): void {
        if (this.status) this.status.textContent = text;
    }

    private refresh(): void {
        if (!this.area || !this.checksBox || !this.summary) return;
        const source = this.area.value;
        const checks = checkRobotSource(source);
        const passed = checks.filter((check) => check.pass).length;
        const ok = workshopPassed(checks);
        this.summary.textContent = workshopSummary(suggestFilename(source), passed, checks.length);
        this.summary.style.color = ok ? COLORS.accentCss : COLORS.goldCss;
        this.checksBox.replaceChildren();
        for (const check of checks) {
            const row = document.createElement('div');
            row.style.cssText = 'margin:2px 0;';
            const tag = document.createElement('span');
            tag.textContent = check.pass ? WORKSHOP.passTag : WORKSHOP.failTag;
            tag.style.color = check.pass ? '#7de08a' : '#ff5d5d';
            row.appendChild(tag);
            const label = document.createElement('span');
            label.textContent = check.label;
            label.style.color = '#e8edf2';
            row.appendChild(label);
            if (check.detail !== '') {
                const detail = document.createElement('span');
                detail.textContent = checkDetailSuffix(check.detail);
                detail.style.color = '#9aa7b4';
                row.appendChild(detail);
            }
            this.checksBox.appendChild(row);
        }
    }

    private closeOverlay(): void {
        this.overlay?.remove();
        this.overlay = null;
        this.area = null;
        this.checksBox = null;
        this.summary = null;
        this.status = null;
    }
}
