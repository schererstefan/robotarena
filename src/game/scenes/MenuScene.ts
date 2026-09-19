// Main menu: mode select, per-slot robot picker with sprite previews,
// cosmetic skins, and per-slot skill loadouts (symmetric point budgets).

import { Scene } from 'phaser';
import { getRobot, ROBOTS } from '../../robots/registry';
import { loadoutCost, rankOf, SKILL_BUDGET, SKILL_DEFS, type SkillId, type SkillLoadout } from '../../sim/skills';
import { chassisKey, ensureArtTextures } from '../art';
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
    private editorSlot = -1;
    private editorPoints!: Phaser.GameObjects.Text;
    private descText!: Phaser.GameObjects.Text;
    private modeButtons: Array<{ setLabel: (label: string) => void }> = [];
    private trailsButton!: { setLabel: (label: string) => void };

    constructor() {
        super('Menu');
    }

    create(): void {
        ensureArtTextures(this);
        // create() re-runs on every visit: drop references to destroyed objects.
        this.modeButtons = [];
        this.slotObjects = [];
        this.editorObjects = [];
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
        this.trailsButton = makeButton(this, CX, 736, 220, 30, '', () => this.toggleTrails());
        this.refreshTrailsLabel();
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
        const idx = CALLSIGNS.indexOf(skin.callsign);
        const next = CALLSIGNS[(idx + 1) % CALLSIGNS.length] as string;
        this.skins[i] = { ...skin, callsign: next };
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
