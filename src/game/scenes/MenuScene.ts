// Main menu: mode select, per-slot robot picker with sprite previews,
// cosmetic skins, and per-slot skill loadouts (symmetric point budgets).

import { Scene } from 'phaser';
import { getRobot, ROBOTS } from '../../robots/registry';
import { modifierCodes, type ArenaId, type MatchModifiers } from '../../sim/constants';
import { decodeReplay } from '../../sim/replay';
import { loadoutCost, rankOf, SKILL_BUDGET, SKILL_DEFS, type SkillId, type SkillLoadout } from '../../sim/skills';
import { chassisKey, ensureArtTextures, skillIconKey, towerKey } from '../art';
import { isMuted, playClick, toggleMuted, unlockAudio } from '../audio';
import {
    clearDailyBoard,
    clearHistory,
    dailyDateKey,
    dailyLineup,
    dailySeed,
    loadDailyBoard,
    loadHistory,
    winRates,
} from '../history';
import { COLORS, FONTS } from '../theme';
import { markTutorialSeen, shouldShowTutorial, TUTORIAL_LINEUP, TUTORIAL_SEED } from '../tutorial';
import { makeButton, makePanel, type Button } from '../ui';
import { CALLSIGNS, defaultSkin, FINISHES, PAINTS, randomSkin, type SlotSkin } from '../customize';

export interface BattleRequest {
    teamSize: number;
    lineupIds: string[];
    loadouts: SkillLoadout[];
    skins: SlotSkin[];
    trails: boolean;
    seed: number;
    arena: ArenaId;
    modifiers: MatchModifiers;
    /** True when this battle replays a shared code (HUD tag only). */
    replay?: boolean;
    /** Daily-challenge date key (YYYY-MM-DD) when this is the daily match. */
    daily?: string;
    /** True when the human pilots slot 0 (1v1 vs AI). Excluded from history. */
    pilot?: boolean;
    /** True for the scripted spectated tutorial battle. Excluded from history. */
    tutorial?: boolean;
}

const CX = 512;

/** Guided loadout-editor tour: shown over the open editor, slot 0. */
const LOADOUT_TOUR: Array<{ title: string; body: string }> = [
    {
        title: 'POINTS',
        body: 'Every slot gets the same 6-point budget. Spend it across the 9-skill catalog - anyone can run any legal build.',
    },
    {
        title: 'RANKS',
        body: 'Plus and minus set ranks per skill; green counts are active. Builds are public, shown as codes on results.',
    },
    {
        title: 'DONE',
        body: 'DONE locks the build. RANDOM rolls one, CLEAR empties it. Next: START BATTLE to run your builds.',
    },
];

export class MenuScene extends Scene {
    private teamSize = 1;
    private lineupIds: string[] = ['hunter', 'orbiter'];
    private loadouts: SkillLoadout[] = [
        { ...getRobot('hunter')!.loadout },
        { ...getRobot('orbiter')!.loadout },
    ];
    private skins: SlotSkin[] = [defaultSkin('HUNTER', 0), defaultSkin('ORBITER', 1)];
    private trails = true;
    private arena: ArenaId = 'open';
    private arenaButton!: { setLabel: (label: string) => void };
    private mods: MatchModifiers = {};
    private modsButton!: { setLabel: (label: string) => void };
    private modsObjects: Phaser.GameObjects.GameObject[] = [];
    private slotObjects: Phaser.GameObjects.GameObject[] = [];
    private editorObjects: Phaser.GameObjects.GameObject[] = [];
    private statsObjects: Phaser.GameObjects.GameObject[] = [];
    private editorSlot = -1;
    private editorPoints!: Phaser.GameObjects.Text;
    private descText!: Phaser.GameObjects.Text;
    private modeButtons: Array<{ setLabel: (label: string) => void }> = [];
    private trailsButton!: { setLabel: (label: string) => void };
    private muteButton!: { setLabel: (label: string) => void };
    private dailyButton!: { setLabel: (label: string) => void };
    private replayOverlay: HTMLDivElement | null = null;
    private tourRequested = false;
    private tourMode: 'prompt' | 'tour' | 'none' = 'none';
    private tourObjects: Phaser.GameObjects.GameObject[] = [];
    private tourButtons: Button[] = [];
    private tourStep = 0;
    private tourTitle!: Phaser.GameObjects.Text;
    private tourBody!: Phaser.GameObjects.Text;
    private tourNext: Button | null = null;

    constructor() {
        super('Menu');
    }

    init(data?: { tour?: boolean }): void {
        this.tourRequested = data?.tour === true;
    }

    create(): void {
        ensureArtTextures(this);
        // create() re-runs on every visit: drop references to destroyed objects.
        this.modeButtons = [];
        this.slotObjects = [];
        this.editorObjects = [];
        this.statsObjects = [];
        this.modsObjects = [];
        this.editorSlot = -1;
        this.tourMode = 'none';
        this.tourObjects = [];
        this.tourButtons = [];
        this.tourStep = 0;
        this.tourNext = null;
        this.add.text(CX, 44, 'ROBOTARENA', FONTS.title).setOrigin(0.5);
        this.add.image(CX - 285, 44, 'logo_bar').setScale(2);
        this.add.image(CX + 285, 44, 'logo_bar').setScale(2);
        this.add
            .text(CX, 86, 'same budget. same catalog. only the code differs.', FONTS.small)
            .setOrigin(0.5);

        [1, 2, 3].forEach((size, i) => {
            const btn = makeButton(this, CX - 150 + i * 150, 136, 130, 42, '', () => this.setMode(size));
            this.modeButtons.push(btn);
        });
        this.refreshModeLabels();
        this.arenaButton = makeButton(this, CX + 323, 136, 200, 42, '', () => this.cycleArena());
        this.refreshArenaLabel();
        this.modsButton = makeButton(this, CX - 350, 136, 200, 42, '', () => this.openMods());
        this.refreshModsLabel();

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

        makeButton(this, CX - 290, 684, 270, 50, 'RANDOMIZE SKINS', () => this.randomizeSkins());
        makeButton(this, CX, 684, 270, 50, 'START BATTLE', () => this.startBattle());
        makeButton(this, CX + 290, 684, 270, 50, 'PILOT 1V1', () => this.startPilot());
        this.trailsButton = makeButton(this, CX - 215, 728, 200, 26, '', () => this.toggleTrails());
        this.muteButton = makeButton(this, CX, 728, 200, 26, '', () => this.toggleMute());
        makeButton(this, CX + 215, 728, 200, 26, 'WATCH REPLAY', () => this.openReplayDialog());
        this.dailyButton = makeButton(this, CX - 340, 754, 150, 24, '', () => this.startDaily());
        makeButton(this, CX - 170, 754, 150, 24, 'TOURNEY', () => this.scene.start('Tournament'));
        makeButton(this, CX, 754, 150, 24, 'STATS', () => this.openStats());
        makeButton(this, CX + 170, 754, 150, 24, 'WORKSHOP', () => this.scene.start('Workshop'));
        makeButton(this, CX + 340, 754, 150, 24, 'TUTORIAL', () => this.startTutorial());
        this.refreshTrailsLabel();
        this.refreshMuteLabel();
        this.refreshDailyLabel();
        // Tutorial routing: the battle half hands off to the loadout tour;
        // first-run visits get the prompt instead.
        const startTour = this.tourRequested;
        this.tourRequested = false;
        if (startTour) {
            this.openEditor(0);
            this.startLoadoutTour();
        } else if (shouldShowTutorial()) {
            this.showTutorialPrompt();
        }
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

    private refreshDailyLabel(): void {
        const done = loadDailyBoard().some((entry) => entry.date === dailyDateKey());
        this.dailyButton.setLabel(done ? 'DAILY (DONE)' : 'DAILY');
    }

    /** Daily seeded challenge: fixed matchup, date-derived seed. */
    private startDaily(): void {
        const date = dailyDateKey();
        const lineupIds = dailyLineup();
        this.scene.start('Battle', {
            teamSize: 1,
            lineupIds: [...lineupIds],
            loadouts: lineupIds.map((id) => ({ ...(getRobot(id)?.loadout ?? {}) })),
            skins: lineupIds.map((id, i) => defaultSkin(CALLSIGNS[i % CALLSIGNS.length] ?? id, i)),
            trails: this.trails,
            seed: dailySeed(date),
            arena: 'open',
            modifiers: {},
            daily: date,
        } satisfies BattleRequest);
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

    private cycleArena(): void {
        this.arena = this.arena === 'open' ? 'blocks' : 'open';
        this.refreshArenaLabel();
    }

    private refreshArenaLabel(): void {
        this.arenaButton.setLabel(`ARENA: ${this.arena.toUpperCase()}`);
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
            // Live paint preview: tower + hub exactly as the battle renders them.
            const previewTower = this.track(this.add.image(152, y, towerKey(id)).setScale(2));
            previewTower.setTint(skin.paint).setRotation(-0.5);
            const previewHub = this.track(this.add.image(152, y, 'hub').setScale(2));
            previewHub.setTint(skin.paint);

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
            const y = 226 + row * 30;
            const rank = rankOf(loadout, def.id);
            this.trackEditor(this.add.image(152, y + 4, skillIconKey(def.id)).setScale(2).setDepth(50));
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

        const footer = 226 + SKILL_DEFS.length * 30 + 8;
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
        // A manual DONE mid-tour finishes the tour too.
        if (this.tourMode === 'tour') {
            markTutorialSeen();
            this.clearTour();
        }
    }

    // ---- Onboarding tutorial: first-run prompt + loadout-editor tour ------
    private trackTour<T extends Phaser.GameObjects.GameObject>(obj: T): T {
        this.tourObjects.push(obj);
        return obj;
    }

    private clearTour(): void {
        for (const obj of this.tourObjects) obj.destroy();
        this.tourObjects = [];
        for (const button of this.tourButtons) button.destroy();
        this.tourButtons = [];
        this.tourMode = 'none';
        this.tourNext = null;
    }

    private showTutorialPrompt(): void {
        this.clearTour();
        this.tourMode = 'prompt';
        this.trackTour(this.add.rectangle(CX, 384, 1024, 768, 0x06080b, 0.85).setDepth(60).setInteractive());
        this.trackTour(this.add.rectangle(CX, 384, 460, 220, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(60));
        this.trackTour(this.add.text(CX, 320, 'NEW HERE?', FONTS.heading).setOrigin(0.5).setDepth(60));
        this.trackTour(
            this.add.text(CX, 352, 'Play the 60-second tutorial: a spectated battle,', FONTS.small).setOrigin(0.5).setDepth(60),
        );
        this.trackTour(
            this.add.text(CX, 370, 'then a guided tour of the loadout editor.', FONTS.small).setOrigin(0.5).setDepth(60),
        );
        this.tourButtons.push(
            makeButton(this, CX - 110, 440, 200, 40, 'PLAY TUTORIAL', () => {
                this.clearTour();
                this.startTutorial();
            }, 60),
        );
        this.tourButtons.push(
            makeButton(this, CX + 110, 440, 200, 40, 'SKIP', () => {
                markTutorialSeen();
                this.clearTour();
            }, 60),
        );
    }

    /** Scripted spectated 1v1: fixed seed and matchup, coach marks on top. */
    private startTutorial(): void {
        const lineupIds = [...TUTORIAL_LINEUP];
        this.scene.start('Battle', {
            teamSize: 1,
            lineupIds,
            loadouts: lineupIds.map((id) => ({ ...(getRobot(id)?.loadout ?? {}) })),
            skins: lineupIds.map((id, i) => defaultSkin(CALLSIGNS[i % CALLSIGNS.length] ?? id, i)),
            trails: this.trails,
            seed: TUTORIAL_SEED,
            arena: 'open',
            modifiers: {},
            tutorial: true,
        } satisfies BattleRequest);
    }

    private startLoadoutTour(): void {
        this.clearTour();
        this.tourMode = 'tour';
        this.tourStep = 0;
        // Panel sits below the editor footer, inside the editor frame.
        this.trackTour(this.add.rectangle(CX, 632, 700, 52, 0x0b0e12).setStrokeStyle(2, COLORS.team[0]).setDepth(60));
        this.tourTitle = this.trackTour(this.add.text(180, 612, '', FONTS.monoSmall).setOrigin(0, 0.5).setDepth(60));
        this.tourBody = this.trackTour(this.add.text(180, 624, '', FONTS.small).setOrigin(0, 0).setDepth(60));
        this.tourBody.setWordWrapWidth(430);
        this.tourNext = makeButton(this, 668, 632, 120, 36, '', () => this.nextTourStep(), 60);
        this.tourButtons.push(this.tourNext);
        this.tourButtons.push(makeButton(this, 796, 632, 90, 36, 'SKIP', () => this.finishTour(), 60));
        this.refreshTourStep();
    }

    private refreshTourStep(): void {
        const step = LOADOUT_TOUR[this.tourStep] as { title: string; body: string };
        this.tourTitle.setText(`LOADOUT TOUR ${this.tourStep + 1}/${LOADOUT_TOUR.length} - ${step.title}`);
        this.tourBody.setText(step.body);
        this.tourNext?.setLabel(this.tourStep === LOADOUT_TOUR.length - 1 ? 'FINISH' : 'NEXT');
    }

    private nextTourStep(): void {
        if (this.tourStep >= LOADOUT_TOUR.length - 1) {
            this.finishTour();
            return;
        }
        this.tourStep += 1;
        this.refreshTourStep();
    }

    private finishTour(): void {
        markTutorialSeen();
        this.closeEditor();
        this.rebuildSlots();
        this.clearTour();
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
            '<input type="text" spellcheck="false" placeholder="RA2-XXXX-…" ' +
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
                arena: data.arena ?? 'open',
                modifiers: data.modifiers ?? {},
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
        this.trackStats(this.add.rectangle(CX, 384, 560, 600, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(50));
        this.trackStats(this.add.text(CX, 118, 'MATCH HISTORY', FONTS.heading).setOrigin(0.5).setDepth(50));
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
            this.add.text(CX, 148, `MATCHES ${history.length}   DRAWS ${draws}`, FONTS.mono).setOrigin(0.5).setDepth(50),
        );
        const rows = winRates(ROBOTS.map((r) => r.meta.id)).sort(
            (a, b) => b.rate - a.rate || b.games - a.games,
        );
        if (history.length === 0) {
            this.trackStats(
                this.add.text(CX, 196, 'no matches recorded yet - go battle!', FONTS.small).setOrigin(0.5).setDepth(50),
            );
        } else {
            rows.forEach((row, i) => {
                const y = 182 + i * 26;
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

        const dailyY = 182 + Math.max(rows.length, 1) * 26 + 22;
        this.trackStats(
            this.add.text(CX, dailyY, 'DAILY BEST (LAST 5)', FONTS.buttonSmall).setOrigin(0.5).setDepth(50),
        );
        const board = loadDailyBoard().slice(0, 5);
        if (board.length === 0) {
            this.trackStats(
                this.add.text(CX, dailyY + 26, 'no daily results yet - play the daily!', FONTS.small).setOrigin(0.5).setDepth(50),
            );
        } else {
            board.forEach((entry, i) => {
                const y = dailyY + 26 + i * 24;
                const outcome =
                    entry.winner === -1
                        ? 'DRAW'
                        : `${(ROBOTS.find((r) => r.meta.id === entry.lineupIds[entry.winner])?.meta.name ?? 'team').toUpperCase()} WINS`;
                const second = Math.floor(entry.ticks / 60);
                const time = `${Math.floor(second / 60)}:${(second % 60).toString().padStart(2, '0')}`;
                this.trackStats(
                    this.add.text(CX, y, `${entry.date.slice(5)}  ${outcome}  ${time}`, FONTS.monoSmall).setOrigin(0.5).setDepth(50),
                );
            });
        }

        const clear = this.trackStats(
            this.add.rectangle(CX - 120, 630, 170, 40, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(50),
        );
        this.trackStats(this.add.text(CX - 120, 630, 'CLEAR', FONTS.buttonSmall).setOrigin(0.5).setDepth(50));
        clear.setInteractive({ useHandCursor: true });
        clear.on('pointerdown', () => {
            clearHistory();
            clearDailyBoard();
            this.refreshStatsRows();
        });
        const close = this.trackStats(
            this.add.rectangle(CX + 120, 630, 170, 40, COLORS.panel).setStrokeStyle(2, COLORS.team[0]).setDepth(50),
        );
        this.trackStats(this.add.text(CX + 120, 630, 'CLOSE', FONTS.buttonSmall).setOrigin(0.5).setDepth(50));
        close.setInteractive({ useHandCursor: true });
        close.on('pointerdown', () => this.closeStats());
    }

    private closeStats(): void {
        for (const obj of this.statsObjects) obj.destroy();
        this.statsObjects = [];
    }

    // ---- Exhibition modifiers overlay ------------------------------------
    private trackMods<T extends Phaser.GameObjects.GameObject>(obj: T): T {
        this.modsObjects.push(obj);
        return obj;
    }

    private refreshModsLabel(): void {
        const codes = modifierCodes(this.mods);
        this.modsButton.setLabel(codes.length === 0 ? 'MODS: OFF' : `MODS: ${codes.join('+')}`);
    }

    private openMods(): void {
        this.closeMods();
        // Backdrop swallows clicks so menu controls beneath can't fire.
        this.trackMods(this.add.rectangle(CX, 384, 1024, 768, 0x06080b, 0.85).setDepth(50).setInteractive());
        this.trackMods(this.add.rectangle(CX, 384, 560, 420, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(50));
        this.trackMods(this.add.text(CX, 208, 'EXHIBITION MODIFIERS', FONTS.heading).setOrigin(0.5).setDepth(50));
        this.trackMods(
            this.add.text(CX, 236, 'exhibition matches never touch stats', FONTS.small).setOrigin(0.5).setDepth(50),
        );
        this.refreshModsRows();
    }

    private refreshModsRows(): void {
        // Drop old rows but keep the overlay frame (first 4 objects).
        const frame = this.modsObjects.slice(0, 4);
        for (const obj of this.modsObjects.slice(4)) obj.destroy();
        this.modsObjects = frame;

        const rows: Array<{ key: 'doubleDamage' | 'hardcoreFog' | 'mirror'; name: string; desc: string }> = [
            { key: 'doubleDamage', name: 'DOUBLE DAMAGE', desc: 'every shot deals double damage' },
            { key: 'hardcoreFog', name: 'HARDCORE FOG', desc: 'sensor range halved for every robot' },
            { key: 'mirror', name: 'MIRROR MODE', desc: 'team 2 mirrors team 1 robots + builds' },
        ];
        rows.forEach((row, i) => {
            const y = 292 + i * 64;
            const on = this.mods[row.key] === true;
            const bg = this.trackMods(
                this.add.rectangle(CX, y, 480, 52, COLORS.panel).setStrokeStyle(2, on ? COLORS.team[0] : COLORS.panelEdge).setDepth(50),
            );
            const name = this.trackMods(this.add.text(CX - 220, y - 10, row.name, FONTS.buttonSmall).setOrigin(0, 0.5).setDepth(50));
            name.setColor(on ? '#7de08a' : COLORS.ink);
            this.trackMods(this.add.text(CX - 220, y + 12, row.desc, FONTS.small).setOrigin(0, 0.5).setDepth(50));
            const state = this.trackMods(this.add.text(CX + 220, y, on ? 'ON' : 'OFF', FONTS.button).setOrigin(1, 0.5).setDepth(50));
            state.setColor(on ? '#7de08a' : COLORS.dim);
            bg.setInteractive({ useHandCursor: true });
            bg.on('pointerdown', () => {
                const next = { ...this.mods };
                if (on) delete next[row.key];
                else next[row.key] = true;
                this.mods = next;
                this.refreshModsLabel();
                this.refreshModsRows();
            });
        });

        const done = this.trackMods(
            this.add.rectangle(CX, 520, 170, 40, COLORS.panel).setStrokeStyle(2, COLORS.team[0]).setDepth(50),
        );
        this.trackMods(this.add.text(CX, 520, 'DONE', FONTS.buttonSmall).setOrigin(0.5).setDepth(50));
        done.setInteractive({ useHandCursor: true });
        done.on('pointerdown', () => this.closeMods());
    }

    private closeMods(): void {
        for (const obj of this.modsObjects) obj.destroy();
        this.modsObjects = [];
    }

    /** Mirror mode: team 2 runs team 1's robots and builds (skins stay put). */
    private mirroredLineup(ids: string[], loadouts: SkillLoadout[]): { lineupIds: string[]; loadouts: SkillLoadout[] } {
        if (this.mods.mirror !== true) {
            return { lineupIds: [...ids], loadouts: loadouts.map((l) => ({ ...l })) };
        }
        const half = ids.length / 2;
        return {
            lineupIds: ids.map((id, i) => (i < half ? id : (ids[i - half] as string))),
            loadouts: loadouts.map((l, i) => ({ ...(i < half ? l : (loadouts[i - half] as SkillLoadout)) })),
        };
    }

    private startBattle(): void {
        const mirrored = this.mirroredLineup(this.lineupIds, this.loadouts);
        this.scene.start('Battle', {
            teamSize: this.teamSize,
            lineupIds: mirrored.lineupIds,
            loadouts: mirrored.loadouts,
            skins: this.skins.map((s) => ({ ...s })),
            trails: this.trails,
            seed: (Math.random() * 0x7fffffff) | 0,
            arena: this.arena,
            modifiers: { ...this.mods },
        } satisfies BattleRequest);
    }

    /** Pilot mode: drive slot 0's robot 1v1 against the slot 1 AI. */
    private startPilot(): void {
        const mirrored = this.mirroredLineup(
            [this.lineupIds[0] as string, this.lineupIds[1] as string],
            [{ ...(this.loadouts[0] ?? {}) }, { ...(this.loadouts[1] ?? {}) }],
        );
        this.scene.start('Battle', {
            teamSize: 1,
            lineupIds: mirrored.lineupIds,
            loadouts: mirrored.loadouts,
            skins: [{ ...(this.skins[0] as SlotSkin) }, { ...(this.skins[1] as SlotSkin) }],
            trails: this.trails,
            seed: (Math.random() * 0x7fffffff) | 0,
            arena: this.arena,
            modifiers: { ...this.mods },
            pilot: true,
        } satisfies BattleRequest);
    }
}
