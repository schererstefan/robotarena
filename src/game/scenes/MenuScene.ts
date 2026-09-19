// Main menu: mode select, per-slot robot picker with sprite previews,
// cosmetic skins, and per-slot skill loadouts (symmetric point budgets).

import { Scene } from 'phaser';
import { getRobot, ROBOTS } from '../../robots/registry';
import { decodeReplay } from '../../sim/replay';
import { loadoutCost, rankOf, SKILL_BUDGET, SKILL_DEFS, type SkillId, type SkillLoadout } from '../../sim/skills';
import { chassisKey, ensureArtTextures } from '../art';
import { isMuted, playClick, toggleMuted, unlockAudio } from '../audio';
import { clearHistory, loadHistory, winRates } from '../history';
import { COLORS, FONTS } from '../theme';
import { makeButton, makePanel } from '../ui';
import { CALLSIGNS, defaultSkin, FINISHES, PAINTS, randomSkin, type SlotSkin } from '../customize';

export interface BattleRequest {
    teamSize: number;
    lineupIds: string[];
    loadouts: SkillLoadout[];
    skins: SlotSkin[];
    trails: boolean;
    seed: number;
    /** True when this battle replays a shared code (HUD tag only). */
    replay?: boolean;
}

const CX = 512;

export class MenuScene extends Scene {
    private teamSize = 1;
    private lineupIds: string[] = ['hunter', 'orbiter'];
    private loadouts: SkillLoadout[] = [
        { ...getRobot('hunter')!.loadout },
        { ...getRobot('orbiter')!.loadout },
    ];
    private skins: SlotSkin[] = [defaultSkin('HUNTER', 0), defaultSkin('ORBITER', 1)];
    private trails = true;
    private slotObjects: Phaser.GameObjects.GameObject[] = [];
    private editorObjects: Phaser.GameObjects.GameObject[] = [];
    private statsObjects: Phaser.GameObjects.GameObject[] = [];
    private editorSlot = -1;
    private editorPoints!: Phaser.GameObjects.Text;
    private descText!: Phaser.GameObjects.Text;
    private modeButtons: Array<{ setLabel: (label: string) => void }> = [];
    private trailsButton!: { setLabel: (label: string) => void };
    private muteButton!: { setLabel: (label: string) => void };
    private replayOverlay: HTMLDivElement | null = null;

    constructor() {
        super('Menu');
    }

    create(): void {
        ensureArtTextures(this);
        // create() re-runs on every visit: drop references to destroyed objects.
        this.modeButtons = [];
        this.slotObjects = [];
        this.editorObjects = [];
        this.statsObjects = [];
        this.editorSlot = -1;
        this.add.text(CX, 44, 'ROBOTARENA', FONTS.title).setOrigin(0.5);
        this.add
            .text(CX, 86, 'same budget. same catalog. only the code differs.', FONTS.small)
            .setOrigin(0.5);

        [1, 2, 3].forEach((size, i) => {
            const btn = makeButton(this, CX - 150 + i * 150, 136, 130, 42, '', () => this.setMode(size));
            this.modeButtons.push(btn);
        });
        this.refreshModeLabels();

        this.add.text(92, 176, 'SLOT', FONTS.monoSmall).setOrigin(0, 0.5);
        this.add.text(208, 176, 'CALLSIGN', FONTS.monoSmall).setOrigin(0, 0.5);
        this.add.text(392, 176, 'ROBOT', FONTS.monoSmall).setOrigin(0, 0.5);
        this.add.text(618, 176, 'PAINT', FONTS.monoSmall).setOrigin(0, 0.5);
        this.add.text(694, 176, 'FINISH', FONTS.monoSmall).setOrigin(0, 0.5);
        this.add.text(836, 176, 'SKILLS', FONTS.monoSmall).setOrigin(0, 0.5);
        this.rebuildSlots();

        makePanel(this, CX, 592, 880, 76);
        this.descText = this.add.text(CX - 420, 562, '', FONTS.body).setWordWrapWidth(840);
        this.showDescription(0);

        makeButton(this, CX - 160, 684, 260, 50, 'RANDOMIZE SKINS', () => this.randomizeSkins());
        makeButton(this, CX + 160, 684, 260, 50, 'START BATTLE', () => this.startBattle());
        this.trailsButton = makeButton(this, CX - 215, 728, 200, 26, '', () => this.toggleTrails());
        this.muteButton = makeButton(this, CX, 728, 200, 26, '', () => this.toggleMute());
        makeButton(this, CX + 215, 728, 200, 26, 'WATCH REPLAY', () => this.openReplayDialog());
        makeButton(this, CX + 215, 754, 200, 24, 'STATS', () => this.openStats());
        this.refreshTrailsLabel();
        this.refreshMuteLabel();
        // First click creates/resumes the AudioContext (autoplay policy);
        // every click gets a UI blip.
        this.input.on('pointerdown', this.onAnyPointer);
        this.input.keyboard?.on('keydown-M', this.onMuteKey);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown-M', this.onMuteKey);
            this.closeReplayDialog();
        });
    }

    private onAnyPointer = (): void => {
        unlockAudio();
        playClick();
    };

    private onMuteKey = (): void => {
        // Typing in the replay-code input must not flip the mute toggle.
        if (document.activeElement instanceof HTMLInputElement) return;
        unlockAudio();
        this.toggleMute();
    };

    private toggleMute(): void {
        toggleMuted();
        this.refreshMuteLabel();
    }

    private refreshMuteLabel(): void {
        this.muteButton.setLabel(isMuted() ? 'SOUND: OFF (M)' : 'SOUND: ON (M)');
    }

    private setMode(size: number): void {
        this.teamSize = size;
        const defaults = ['hunter', 'orbiter', 'rusher', 'turret', 'wanderer', 'hunter'];
        const nextIds: string[] = [];
        const nextSkins: SlotSkin[] = [];
        const nextLoadouts: SkillLoadout[] = [];
        for (let i = 0; i < size * 2; i += 1) {
            const id = this.lineupIds[i] ?? (defaults[i] as string);
            nextIds.push(id);
            const entry = ROBOTS.find((r) => r.meta.id === id) ?? ROBOTS[0]!;
            nextSkins.push(this.skins[i] ?? defaultSkin(entry.meta.name.toUpperCase(), i));
            nextLoadouts.push(this.loadouts[i] ?? { ...entry.loadout });
        }
        this.lineupIds = nextIds;
        this.skins = nextSkins;
        this.loadouts = nextLoadouts;
        this.refreshModeLabels();
        this.rebuildSlots();
        this.showDescription(0);
    }

    private refreshModeLabels(): void {
        const labels = ['1 v 1', '2 v 2', '3 v 3'];
        this.modeButtons.forEach((btn, i) => {
            const active = i + 1 === this.teamSize;
            btn.setLabel(`${active ? '> ' : ''}${labels[i]}${active ? ' <' : ''}`);
        });
    }

    private refreshTrailsLabel(): void {
        this.trailsButton.setLabel(`TRAILS: ${this.trails ? 'ON' : 'OFF'}`);
    }

    private toggleTrails(): void {
        this.trails = !this.trails;
        this.refreshTrailsLabel();
    }

    private randomizeSkins(): void {
        this.skins = this.skins.map((skin) => randomSkin(skin.callsign));
        this.rebuildSlots();
    }

    private track<T extends Phaser.GameObjects.GameObject>(obj: T): T {
        this.slotObjects.push(obj);
        return obj;
    }

    private cycler(x: number, w: number, y: number, label: string, onClick: () => void, color = COLORS.ink): void {
        const bg = this.track(this.add.rectangle(x, y, w, 40, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge));
        const text = this.track(this.add.text(x, y, label, FONTS.buttonSmall).setOrigin(0.5));
        text.setColor(color);
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => bg.setStrokeStyle(2, COLORS.team[0]));
        bg.on('pointerout', () => bg.setStrokeStyle(2, COLORS.panelEdge));
        bg.on('pointerdown', onClick);
    }

    private rebuildSlots(): void {
        for (const obj of this.slotObjects) obj.destroy();
        this.slotObjects = [];

        const rows = this.teamSize * 2;
        const startY = rows <= 2 ? 252 : rows <= 4 ? 228 : 210;
        const step = rows <= 2 ? 84 : 64;
        for (let i = 0; i < rows; i += 1) {
            const y = startY + i * step;
            const team = (i < this.teamSize ? 0 : 1) as 0 | 1;
            const skin = this.skins[i] as SlotSkin;
            const id = this.lineupIds[i] as string;
            const entry = ROBOTS.find((r) => r.meta.id === id) ?? ROBOTS[0]!;
            const loadout = this.loadouts[i] as SkillLoadout;

            this.track(this.add.rectangle(100, y, 14, 14, COLORS.team[team]));
            const preview = this.track(this.add.image(152, y, chassisKey(id)).setScale(2));
            preview.setTint(COLORS.team[team]);

            this.cycler(285, 150, y, `${skin.callsign} >`, () => this.cycleCallsign(i), skin.paintCss);
            this.cycler(490, 200, y, `${entry.meta.name} >`, () => this.cycleRobot(i));

            const paintBg = this.track(this.add.rectangle(646, y, 56, 40, skin.paint).setStrokeStyle(2, 0x0b0e12));
            paintBg.setInteractive({ useHandCursor: true });
            paintBg.on('pointerdown', () => this.cyclePaint(i));

            this.cycler(748, 110, y, `${skin.finish} >`, () => this.cycleFinish(i));
            this.cycler(885, 100, y, `SKL ${loadoutCost(loadout)}`, () => this.openEditor(i), '#7de08a');
        }
    }

    private cycleCallsign(i: number): void {
        const skin = this.skins[i] as SlotSkin;
        const taken = new Set(this.skins.map((s, k) => (k === i ? '' : s.callsign)));
        let idx = CALLSIGNS.indexOf(skin.callsign);
        for (let n = 0; n < CALLSIGNS.length; n += 1) {
            idx = (idx + 1) % CALLSIGNS.length;
            const candidate = CALLSIGNS[idx] as string;
            if (!taken.has(candidate)) {
                this.skins[i] = { ...skin, callsign: candidate };
                break;
            }
        }
        this.rebuildSlots();
    }

    private cycleRobot(i: number): void {
        const current = this.lineupIds[i] as string;
        const idx = ROBOTS.findIndex((r) => r.meta.id === current);
        const next = ROBOTS[(idx + 1) % ROBOTS.length]!;
        this.lineupIds[i] = next.meta.id;
        this.rebuildSlots();
        this.showDescription(i);
    }

    private cyclePaint(i: number): void {
        const skin = this.skins[i] as SlotSkin;
        const idx = PAINTS.findIndex((p) => p.hex === skin.paint);
        const next = PAINTS[(idx + 1) % PAINTS.length]!;
        this.skins[i] = { ...skin, paint: next.hex, paintCss: next.css };
        this.rebuildSlots();
    }

    private cycleFinish(i: number): void {
        const skin = this.skins[i] as SlotSkin;
        const idx = FINISHES.indexOf(skin.finish);
        const next = FINISHES[(idx + 1) % FINISHES.length] as SlotSkin['finish'];
        this.skins[i] = { ...skin, finish: next };
        this.rebuildSlots();
    }

    // ---- Loadout editor overlay -------------------------------------------
    private trackEditor<T extends Phaser.GameObjects.GameObject>(obj: T): T {
        this.editorObjects.push(obj);
        return obj;
    }

    private openEditor(slot: number): void {
        this.closeEditor();
        this.editorSlot = slot;
        const id = this.lineupIds[slot] as string;
        const entry = ROBOTS.find((r) => r.meta.id === id) ?? ROBOTS[0]!;

        // Backdrop swallows clicks so menu controls beneath can't fire.
        this.trackEditor(this.add.rectangle(CX, 384, 1024, 768, 0x06080b, 0.85).setDepth(50).setInteractive());
        this.trackEditor(this.add.rectangle(CX, 384, 740, 560, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(50));
        this.trackEditor(this.add.text(CX, 140, `SLOT ${slot + 1} LOADOUT`, FONTS.heading).setOrigin(0.5).setDepth(50));
        this.trackEditor(this.add.text(CX, 166, `${entry.meta.name} - ${entry.meta.description}`, FONTS.small).setOrigin(0.5).setDepth(50));
        this.editorPoints = this.trackEditor(this.add.text(CX, 196, '', FONTS.mono).setOrigin(0.5).setDepth(50));
        this.refreshEditorRows();
    }

    private refreshEditorRows(): void {
        // Drop old rows but keep the overlay frame (first 5 objects).
        const frame = this.editorObjects.slice(0, 5);
        for (const obj of this.editorObjects.slice(5)) obj.destroy();
        this.editorObjects = frame;

        const slot = this.editorSlot;
        const loadout = this.loadouts[slot] as SkillLoadout;
        const spent = loadoutCost(loadout);
        this.editorPoints.setText(`POINTS  ${spent} / ${SKILL_BUDGET}`);
        this.editorPoints.setColor(spent >= SKILL_BUDGET ? '#ffd23f' : COLORS.ink);

        SKILL_DEFS.forEach((def, row) => {
            const y = 232 + row * 38;
            const rank = rankOf(loadout, def.id);
            this.trackEditor(this.add.text(180, y, `${def.code}  ${def.name}`, FONTS.buttonSmall).setOrigin(0, 0.5).setDepth(50));
            this.trackEditor(this.add.text(180, y + 14, def.desc, FONTS.monoSmall).setOrigin(0, 0.5).setDepth(50));
            const minus = this.trackEditor(this.add.rectangle(640, y + 4, 36, 30, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(50));
            this.trackEditor(this.add.text(640, y + 4, '-', FONTS.button).setOrigin(0.5).setDepth(50));
            minus.setInteractive({ useHandCursor: true });
            minus.on('pointerdown', () => this.bumpSkill(def.id, -1));
            const rankText = this.trackEditor(this.add.text(684, y + 4, `${rank}/${def.maxRank}`, FONTS.mono).setOrigin(0.5).setDepth(50));
            rankText.setColor(rank > 0 ? '#7de08a' : COLORS.dim);
            const plus = this.trackEditor(this.add.rectangle(740, y + 4, 36, 30, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(50));
            this.trackEditor(this.add.text(740, y + 4, '+', FONTS.button).setOrigin(0.5).setDepth(50));
            plus.setInteractive({ useHandCursor: true });
            plus.on('pointerdown', () => this.bumpSkill(def.id, 1));
        });

        const footer = 232 + SKILL_DEFS.length * 38 + 8;
        const random = this.trackEditor(this.add.rectangle(CX - 150, footer, 170, 40, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(50));
        this.trackEditor(this.add.text(CX - 150, footer, 'RANDOM', FONTS.buttonSmall).setOrigin(0.5).setDepth(50));
        random.setInteractive({ useHandCursor: true });
        random.on('pointerdown', () => this.randomLoadout());
        const clear = this.trackEditor(this.add.rectangle(CX + 20, footer, 130, 40, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(50));
        this.trackEditor(this.add.text(CX + 20, footer, 'CLEAR', FONTS.buttonSmall).setOrigin(0.5).setDepth(50));
        clear.setInteractive({ useHandCursor: true });
        clear.on('pointerdown', () => {
            this.loadouts[slot] = {};
            this.refreshEditorRows();
        });
        const done = this.trackEditor(this.add.rectangle(CX + 190, footer, 170, 40, COLORS.panel).setStrokeStyle(2, COLORS.team[0]).setDepth(50));
        this.trackEditor(this.add.text(CX + 190, footer, 'DONE', FONTS.buttonSmall).setOrigin(0.5).setDepth(50));
        done.setInteractive({ useHandCursor: true });
        done.on('pointerdown', () => {
            this.closeEditor();
            this.rebuildSlots();
        });
    }

    private bumpSkill(id: SkillId, delta: number): void {
        const loadout = { ...(this.loadouts[this.editorSlot] as SkillLoadout) };
        const def = SKILL_DEFS.find((d) => d.id === id)!;
        const rank = rankOf(loadout, id);
        if (delta > 0) {
            if (rank >= def.maxRank || loadoutCost(loadout) >= SKILL_BUDGET) return;
            loadout[id] = rank + 1;
        } else {
            if (rank <= 0) return;
            if (rank === 1) delete loadout[id];
            else loadout[id] = rank - 1;
        }
        this.loadouts[this.editorSlot] = loadout;
        this.refreshEditorRows();
    }

    private randomLoadout(): void {
        const loadout: SkillLoadout = {};
        let points = SKILL_BUDGET;
        const order = [...SKILL_DEFS].sort(() => Math.random() - 0.5);
        for (const def of order) {
            if (points <= 0) break;
            const take = Math.min(def.maxRank, points, 1 + ((Math.random() * def.maxRank) | 0));
            if (take > 0) {
                loadout[def.id] = take;
                points -= take;
            }
        }
        this.loadouts[this.editorSlot] = loadout;
        this.refreshEditorRows();
    }

    private closeEditor(): void {
        for (const obj of this.editorObjects) obj.destroy();
        this.editorObjects = [];
        this.editorSlot = -1;
    }

    private showDescription(i: number): void {
        const id = this.lineupIds[i] as string;
        const entry = ROBOTS.find((r) => r.meta.id === id) ?? ROBOTS[0]!;
        this.descText.setText(
            `${entry.meta.name} by ${entry.meta.author} v${entry.meta.version} — ${entry.meta.description}`,
        );
    }

    // ---- Watch-replay dialog (DOM overlay for real text input) ---------------
    private openReplayDialog(): void {
        if (this.replayOverlay) return;
        const overlay = document.createElement('div');
        overlay.style.cssText =
            'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
            'background:rgba(6,8,11,0.85);z-index:1000;';
        const panel = document.createElement('div');
        panel.style.cssText =
            'background:#141a21;border:2px solid #2b3542;padding:24px;width:440px;max-width:90vw;' +
            "font-family:Menlo,Consolas,'Courier New',monospace;";
        panel.innerHTML =
            '<div style="color:#e8edf2;font-size:14px;margin-bottom:12px;">WATCH REPLAY</div>' +
            '<div style="color:#9aa7b4;font-size:12px;margin-bottom:8px;">paste a replay code:</div>' +
            '<input type="text" spellcheck="false" placeholder="RA1.…" ' +
            'style="width:100%;box-sizing:border-box;background:#0b0e12;border:1px solid #2b3542;' +
            'color:#e8edf2;padding:8px;font-family:inherit;font-size:12px;" />' +
            '<div class="replay-error" style="color:#ff5d5d;font-size:12px;min-height:18px;margin-top:6px;"></div>' +
            '<div style="display:flex;gap:8px;margin-top:8px;">' +
            '<button class="replay-watch" style="flex:1;background:#1d2530;border:2px solid #ffb340;' +
            'color:#e8edf2;padding:10px;font-family:inherit;font-size:12px;cursor:pointer;">WATCH</button>' +
            '<button class="replay-cancel" style="flex:1;background:#141a21;border:2px solid #2b3542;' +
            'color:#9aa7b4;padding:10px;font-family:inherit;font-size:12px;cursor:pointer;">CANCEL</button>' +
            '</div>';
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        this.replayOverlay = overlay;

        const input = panel.querySelector('input');
        const error = panel.querySelector('.replay-error');
        const watch = panel.querySelector('.replay-watch');
        const cancel = panel.querySelector('.replay-cancel');
        if (!input || !error || !watch || !cancel) {
            this.closeReplayDialog();
            return;
        }
        const submit = (): void => {
            const data = decodeReplay(input.value);
            if (!data) {
                error.textContent = 'invalid replay code';
                return;
            }
            for (const id of data.lineupIds) {
                if (!getRobot(id)) {
                    error.textContent = `unknown robot in code: ${id}`;
                    return;
                }
            }
            this.closeReplayDialog();
            this.scene.start('Battle', {
                teamSize: data.teamSize,
                lineupIds: [...data.lineupIds],
                loadouts: data.loadouts.map((l) => ({ ...l })),
                skins: data.lineupIds.map((id, i) => defaultSkin(CALLSIGNS[i % CALLSIGNS.length] ?? id, i)),
                trails: this.trails,
                seed: data.seed,
                replay: true,
            } satisfies BattleRequest);
        };
        watch.addEventListener('click', submit);
        cancel.addEventListener('click', () => this.closeReplayDialog());
        overlay.addEventListener('pointerdown', (event) => {
            if (event.target === overlay) this.closeReplayDialog();
        });
        input.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key === 'Enter') submit();
            if (event.key === 'Escape') this.closeReplayDialog();
        });
        input.focus();
    }

    private closeReplayDialog(): void {
        this.replayOverlay?.remove();
        this.replayOverlay = null;
    }

    // ---- Match history + stats panel --------------------------------------
    private trackStats<T extends Phaser.GameObjects.GameObject>(obj: T): T {
        this.statsObjects.push(obj);
        return obj;
    }

    private openStats(): void {
        this.closeStats();
        // Backdrop swallows clicks so menu controls beneath can't fire.
        this.trackStats(this.add.rectangle(CX, 384, 1024, 768, 0x06080b, 0.85).setDepth(50).setInteractive());
        this.trackStats(this.add.rectangle(CX, 384, 560, 470, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(50));
        this.trackStats(this.add.text(CX, 178, 'MATCH HISTORY', FONTS.heading).setOrigin(0.5).setDepth(50));
        this.refreshStatsRows();
    }

    private refreshStatsRows(): void {
        // Drop old rows but keep the overlay frame (first 3 objects).
        const frame = this.statsObjects.slice(0, 3);
        for (const obj of this.statsObjects.slice(3)) obj.destroy();
        this.statsObjects = frame;

        const history = loadHistory();
        const draws = history.filter((r) => r.winner === -1).length;
        this.trackStats(
            this.add.text(CX, 208, `MATCHES ${history.length}   DRAWS ${draws}`, FONTS.mono).setOrigin(0.5).setDepth(50),
        );
        if (history.length === 0) {
            this.trackStats(
                this.add.text(CX, 300, 'no matches recorded yet - go battle!', FONTS.small).setOrigin(0.5).setDepth(50),
            );
        } else {
            const rows = winRates(ROBOTS.map((r) => r.meta.id)).sort(
                (a, b) => b.rate - a.rate || b.games - a.games,
            );
            rows.forEach((row, i) => {
                const y = 246 + i * 30;
                const entry = ROBOTS.find((r) => r.meta.id === row.id) ?? ROBOTS[0]!;
                const pct = row.games > 0 ? `${Math.round(row.rate * 100)}%` : '--';
                const name = this.trackStats(
                    this.add.text(CX - 220, y, entry.meta.name.toUpperCase(), FONTS.buttonSmall).setOrigin(0, 0.5).setDepth(50),
                );
                name.setColor(COLORS.ink);
                this.trackStats(
                    this.add.text(CX + 220, y, `${row.games}G ${row.wins}W ${row.draws}D ${pct}`, FONTS.mono).setOrigin(1, 0.5).setDepth(50),
                );
            });
        }

        const clear = this.trackStats(
            this.add.rectangle(CX - 120, 570, 170, 40, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(50),
        );
        this.trackStats(this.add.text(CX - 120, 570, 'CLEAR', FONTS.buttonSmall).setOrigin(0.5).setDepth(50));
        clear.setInteractive({ useHandCursor: true });
        clear.on('pointerdown', () => {
            clearHistory();
            this.refreshStatsRows();
        });
        const close = this.trackStats(
            this.add.rectangle(CX + 120, 570, 170, 40, COLORS.panel).setStrokeStyle(2, COLORS.team[0]).setDepth(50),
        );
        this.trackStats(this.add.text(CX + 120, 570, 'CLOSE', FONTS.buttonSmall).setOrigin(0.5).setDepth(50));
        close.setInteractive({ useHandCursor: true });
        close.on('pointerdown', () => this.closeStats());
    }

    private closeStats(): void {
        for (const obj of this.statsObjects) obj.destroy();
        this.statsObjects = [];
    }

    private startBattle(): void {
        this.scene.start('Battle', {
            teamSize: this.teamSize,
            lineupIds: [...this.lineupIds],
            loadouts: this.loadouts.map((l) => ({ ...l })),
            skins: this.skins.map((s) => ({ ...s })),
            trails: this.trails,
            seed: (Math.random() * 0x7fffffff) | 0,
        } satisfies BattleRequest);
    }
}
