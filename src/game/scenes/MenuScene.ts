// Main menu: mode select, per-slot robot picker with sprite previews,
// cosmetic skins, and per-slot skill loadouts (symmetric point budgets).

import { BlendModes, Scene } from 'phaser';
import { getRobot, ROBOTS } from '../../robots/registry';
import { modifierCodes, type ArenaId, type MatchModifiers } from '../../sim/constants';
import { decodeReplay } from '../../sim/replay';
import { loadoutCost, rankOf, SKILL_BUDGET, SKILL_DEFS, type SkillId, type SkillLoadout } from '../../sim/skills';
import { artRegistry, chassisKey, ensureArtTextures, skillIconKey, towerKey } from '../art';
import { isMuted, playClick, playConfirm, playError, startMenuAmbience, stopMusic, toggleMuted, unlockAudio } from '../audio';
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
import { COLORS, FONT_STACKS, FONTS } from '../theme';
import { isColorblind, isReducedMotion, setColorblind, setReducedMotion, teamColor } from '../accessibility';
import { displayRobotId, getImported, importRobotFromFile, importRobotFromUrl } from '../importRobot';
import { FocusNav, type NavTarget } from '../nav';
import { fetchOnlineBoard, type OnlineBoard } from '../onlineBoard';
import { loadShowcase } from '../showcase';
import {
    APP,
    arenaLabel,
    bracketedLabel,
    colorLabel,
    COMMON,
    cyclerLabel,
    dailyLabel,
    dailyRow,
    dailyWinnerName,
    EDITOR,
    editorPoints,
    editorSlotTitle,
    editorSubtitle,
    IMPORT_DIALOG,
    importDoneNotice,
    importSlotOption,
    LOADOUT_TOUR_STEPS,
    loadoutTourTitle,
    MENU,
    MOD_ROWS,
    MODS,
    modsButtonLabel,
    motionLabel,
    ONLINE,
    onlineRow,
    onlineSummary,
    rankText,
    REPLAY_DIALOG,
    replayUnknownRobot,
    robotByline,
    showcaseTickerLine,
    skillLine,
    skillsButtonLabel,
    soundLabel,
    STATS,
    statsAndMore,
    statsPct,
    statsRow,
    statsSummary,
    trailsLabel,
    TUTORIAL_PROMPT,
    type CopyStep,
} from '../strings';
import { markTutorialSeen, shouldShowTutorial, TUTORIAL_LINEUP, TUTORIAL_SEED } from '../tutorial';
import { addTouchHit, makeButton, makePanel, transition, type Button, type ButtonOpts } from '../ui';
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
    /**
     * Showcase battle (featured champion content). Excluded from history
     * like replay/pilot. `reel` steps a curated code list with NEXT/EXIT;
     * without it the battle is a single showcase watch or VS compare.
     */
    showcase?: { botId: string; reel?: { codes: string[]; index: number } };
    /**
     * Tournament bracket slot. The result settles into the stored bracket
     * on match end; results offer NEXT (auto-watch) and BRACKET. Recorded
     * in history like any bot-vs-bot battle.
     */
    tournament?: { round: number; index: number; label: string };
}

const CX = 512;
/** Max stats rows per overlay page (the panel fits 8 + daily + buttons). */
const STATS_ROWS = 8;

export class MenuScene extends Scene {
    private teamSize = 1;
    private lineupIds: string[] = ['hunter', 'orbiter'];
    private loadouts: SkillLoadout[] = [
        { ...getRobot('hunter')!.loadout },
        { ...getRobot('orbiter')!.loadout },
    ];
    private skins: SlotSkin[] = ['hunter', 'orbiter'].map((id, i) =>
        defaultSkin((getRobot(id)?.meta.name ?? id).toUpperCase(), i, (i < this.teamSize ? 0 : 1) as 0 | 1),
    );
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
    private colorButton!: { setLabel: (label: string) => void };
    private motionButton!: { setLabel: (label: string) => void };
    private dailyButton!: { setLabel: (label: string) => void };
    private dailyDot: Phaser.GameObjects.Arc | null = null;
    private nav!: FocusNav;
    private navBase: NavTarget[] = [];
    private navSlots: NavTarget[] = [];
    private showcaseButton: Button | null = null;
    private tickerTimer: ReturnType<typeof setInterval> | null = null;
    private statsTab: 'local' | 'online' = 'local';
    private onlineBoard: OnlineBoard | null = null;
    private onlineCached = false;
    private onlineTried = false;
    private onlineToken = 0;
    private replayOverlay: HTMLDivElement | null = null;
    private importOverlay: HTMLDivElement | null = null;
    private tourRequested = false;
    private tourMode: 'prompt' | 'tour' | 'none' = 'none';
    private tourObjects: Phaser.GameObjects.GameObject[] = [];
    private tourButtons: Button[] = [];
    private tourStep = 0;
    private tourTitle!: Phaser.GameObjects.Text;
    private tourBody!: Phaser.GameObjects.Text;
    private tourNext: Button | null = null;
    private artPreview: Phaser.GameObjects.Container | null = null;

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
        this.artPreview = null;
        this.navBase = [];
        this.navSlots = [];
        this.showcaseButton = null;
        this.statsTab = 'local';
        this.onlineBoard = null;
        this.onlineCached = false;
        this.onlineTried = false;
        this.onlineToken += 1;
        this.nav = new FocusNav(this);
        this.nav.onEscape = () => this.escapeOverlay();
        // Menu hero: quantized backdrop art (menu_backdrop, 128x96 baked
        // from docs/art-evidence/menu-backdrop-v1.webp) rendered at 8x for
        // full-bleed 1024x768, under a scrim for text legibility. Static in
        // all motion modes (no drift — the art carries the depth).
        const reduced = isReducedMotion();
        this.add.image(CX, 384, 'menu_backdrop').setScale(8).setDepth(-10);
        this.add.rectangle(CX, 384, 1024, 768, 0x06080b, 0.62).setDepth(-5);
        const titleObj = this.add.text(CX, 44, APP.title, FONTS.title).setOrigin(0.5);
        const logoL = this.add.image(CX - 285, 44, 'logo_bar').setScale(2);
        const logoR = this.add.image(CX + 285, 44, 'logo_bar').setScale(2);
        this.add
            .text(CX, 86, APP.tagline, FONTS.small)
            .setOrigin(0.5);
        // Staggered title pop, one-shot.
        if (!reduced) {
            for (const [obj, delay] of [[logoL, 0], [titleObj, 80], [logoR, 160]] as const) {
                obj.setScale(obj === titleObj ? 0.8 : 1.6);
                this.tweens.add({ targets: obj, scale: obj === titleObj ? 1 : 2, duration: 260, delay, ease: 'Back.easeOut' });
            }
        }
        // Menu title glow (static: kept in both motion modes when supported).
        try {
            titleObj.filters?.internal?.addGlow(0xffd23f, 2, 0);
        } catch {
            // Canvas: no per-object filters; the gold title stands alone.
        }

        [1, 2, 3].forEach((size, i) => {
            const btn = this.navButton(CX - 150 + i * 150, 136, 130, 42, '', () => this.setMode(size), 0, 44);
            this.modeButtons.push(btn);
        });
        this.refreshModeLabels();
        this.arenaButton = this.navButton(CX + 323, 136, 200, 42, '', () => this.cycleArena(), 0, 44);
        this.refreshArenaLabel();
        this.modsButton = this.navButton(CX - 350, 136, 200, 42, '', () => this.openMods(), 0, 44);
        this.refreshModsLabel();

        this.add.text(92, 176, MENU.headers.slot, FONTS.monoSmall).setOrigin(0, 0.5);
        this.add.text(208, 176, MENU.headers.callsign, FONTS.monoSmall).setOrigin(0, 0.5);
        this.add.text(392, 176, MENU.headers.robot, FONTS.monoSmall).setOrigin(0, 0.5);
        this.add.text(618, 176, MENU.headers.paint, FONTS.monoSmall).setOrigin(0, 0.5);
        this.add.text(694, 176, MENU.headers.finish, FONTS.monoSmall).setOrigin(0, 0.5);
        this.add.text(836, 176, MENU.headers.skills, FONTS.monoSmall).setOrigin(0, 0.5);
        this.rebuildSlots();

        makePanel(this, CX, 592, 880, 76);
        this.descText = this.add.text(CX - 420, 562, '', FONTS.body).setWordWrapWidth(840);
        this.showDescription(0);

        // Single centered primary START; tertiary actions drop to ghost.
        this.navButton(CX - 290, 684, 270, 50, MENU.randomizeSkins, () => this.randomizeSkins(), 0, 0, { tier: 'ghost' });
        this.navButton(CX, 684, 270, 50, MENU.startBattle, () => this.startBattle(), 0, 0, { tier: 'primary' });
        this.navButton(CX + 290, 684, 270, 50, MENU.pilot, () => this.startPilot(), 0, 0, { tier: 'ghost' });
        // START shine sweep (Phaser 4.2 ships no Shine controller, so a
        // tweened highlight bar stands in): 4 s cycle, static under reduced
        // motion (hidden — the primary tier carries the emphasis instead).
        if (!isReducedMotion()) {
            const shine = this.add.rectangle(CX - 135, 684, 26, 46, 0xffffff, 0).setDepth(1).setBlendMode(BlendModes.ADD);
            this.tweens.add({ targets: shine, x: CX + 135, duration: 900, delay: 1200, ease: 'Quad.easeInOut', repeat: -1, repeatDelay: 3100 });
            this.tweens.add({ targets: shine, alpha: 0.22, duration: 450, delay: 1200, yoyo: true, repeat: -1, repeatDelay: 3550, ease: 'Sine.easeInOut' });
        }
        this.trailsButton = this.navButton(CX - 350, 728, 140, 26, '', () => this.toggleTrails());
        this.muteButton = this.navButton(CX - 210, 728, 140, 26, '', () => this.toggleMute());
        this.navButton(CX - 70, 728, 140, 26, MENU.watchReplay, () => this.openReplayDialog());
        this.colorButton = this.navButton(CX + 70, 728, 140, 26, '', () => this.toggleColorblind());
        this.motionButton = this.navButton(CX + 210, 728, 140, 26, '', () => this.toggleMotion());
        // SHOWCASE lands in the last slot once the manifest resolves — and
        // stays hidden (with the ticker silent) when no manifest shipped.
        void loadShowcase().then((manifest) => {
            if (!manifest || manifest.champions.length === 0) return;
            if (!this.scene.isActive('Menu')) return;
            this.maybeAddShowcase();
            this.startTicker(
                manifest.champions.map((champ) =>
                    showcaseTickerLine(
                        getRobot(champ.botId)?.meta.name ?? champ.botId,
                        champ.stats.before.winRate,
                        champ.stats.after.winRate,
                    ),
                ),
            );
        });
        this.dailyButton = this.navButton(CX - 362, 754, 130, 24, '', () => this.startDaily());
        // DAILY gold dot: today's challenge is still unplayed.
        this.dailyDot = this.add.circle(CX - 362 - 73, 754, 5, COLORS.gold);
        this.navButton(CX - 218, 754, 130, 24, MENU.tourney, () => this.scene.start('Tournament'));
        this.navButton(CX - 74, 754, 130, 24, MENU.stats, () => this.openStats());
        this.navButton(CX + 74, 754, 130, 24, MENU.workshop, () => this.scene.start('Workshop'));
        this.navButton(CX + 218, 754, 130, 24, MENU.import, () => this.openImportDialog());
        this.navButton(CX + 362, 754, 130, 24, MENU.tutorial, () => this.startTutorial());
        this.refreshTrailsLabel();
        this.refreshMuteLabel();
        this.refreshColorLabel();
        this.refreshMotionLabel();
        this.refreshDailyLabel();
        this.restoreNav();
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
        this.input.keyboard?.on('keydown', this.onNavKey);
        this.input.keyboard?.on('keydown-G', this.onDebugArtKey);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown-M', this.onMuteKey);
            this.input.keyboard?.off('keydown', this.onNavKey);
            this.input.keyboard?.off('keydown-G', this.onDebugArtKey);
            this.closeReplayDialog();
            this.closeImportDialog();
            this.stopTicker();
            stopMusic();
        });
        startMenuAmbience();
    }

    private onAnyPointer = (): void => {
        unlockAudio();
        playClick();
        this.nav.hideRing();
    };

    private onNavKey = (event: KeyboardEvent): void => {
        // Typing in a DOM dialog must not drive canvas focus.
        const active = document.activeElement;
        if (active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement) {
            return;
        }
        this.nav.handleKey(event);
    };

    /** Hidden G key: toggle the 4x art-atlas preview grid (dev only). */
    private onDebugArtKey = (): void => {
        const active = document.activeElement;
        if (active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement) {
            return;
        }
        if (this.artPreview) {
            this.artPreview.destroy(true);
            this.artPreview = null;
            return;
        }
        const keys = artRegistry().map((entry) => entry.key);
        const panel = this.add.container(0, 0).setDepth(200);
        panel.add(this.add.rectangle(CX, 384, 1000, 720, 0x0b0e12, 0.96));
        const perRow = 9;
        keys.forEach((key, i) => {
            const col = i % perRow;
            const row = Math.floor(i / perRow);
            const x = 92 + col * 96;
            const y = 78 + row * 104;
            panel.add(this.add.image(x, y, key).setScale(4));
            panel.add(this.add.text(x, y + 44, key, FONTS.monoSmall).setOrigin(0.5, 0));
        });
        this.artPreview = panel;
    };

    // ---- Keyboard navigation ----------------------------------------------
    /** makeButton plus a keyboard-focus target at the same bounds. */
    private navButton(
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
        this.navBase.push({ x, y, w, h, activate: onClick });
        return makeButton(this, x, y, w, h, label, onClick, depth, minTouch, opts);
    }

    private overlayOpen(): boolean {
        return this.editorSlot >= 0 || this.statsObjects.length > 0 || this.modsObjects.length > 0 || this.tourMode !== 'none';
    }

    private restoreNav(): void {
        if (!this.overlayOpen()) this.nav.replaceTargets([...this.navBase, ...this.navSlots]);
    }

    // ---- Champion showcase entry + marquee ticker --------------------------
    private maybeAddShowcase(): void {
        if (this.showcaseButton) return;
        this.showcaseButton = this.navButton(CX + 350, 728, 140, 26, MENU.showcase, () => this.scene.start('Showcase'));
        this.restoreNav();
    }

    /** Cycle champion headlines through the page marquee under the canvas. */
    private startTicker(lines: string[]): void {
        this.stopTicker();
        if (lines.length === 0) return;
        const el = document.getElementById('marquee');
        if (!el) return;
        // Reduced motion: static first headline, no auto-updating rotation.
        if (isReducedMotion()) {
            el.textContent = `${APP.marquee} - ${lines[0] as string}`;
            return;
        }
        let i = 0;
        const tick = (): void => {
            el.textContent = `${APP.marquee} - ${lines[i % lines.length] as string}`;
            i += 1;
        };
        tick();
        this.tickerTimer = setInterval(tick, 4000);
    }

    private stopTicker(): void {
        if (this.tickerTimer !== null) {
            clearInterval(this.tickerTimer);
            this.tickerTimer = null;
        }
        const el = document.getElementById('marquee');
        if (el) el.textContent = APP.marquee;
    }

    private escapeOverlay(): void {
        if (this.tourMode === 'prompt') {
            markTutorialSeen();
            this.clearTour();
            return;
        }
        if (this.editorSlot >= 0) {
            this.closeEditor();
            this.rebuildSlots();
            return;
        }
        if (this.statsObjects.length > 0) {
            this.closeStats();
            return;
        }
        if (this.modsObjects.length > 0) {
            this.closeMods();
        }
    }

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

    private toggleColorblind(): void {
        setColorblind(!isColorblind());
        this.refreshColorLabel();
        this.rebuildSlots();
    }

    private refreshColorLabel(): void {
        this.colorButton.setLabel(colorLabel(isColorblind()));
    }

    private toggleMotion(): void {
        setReducedMotion(!isReducedMotion());
        this.refreshMotionLabel();
    }

    private refreshMotionLabel(): void {
        this.motionButton.setLabel(motionLabel(isReducedMotion()));
    }

    private refreshMuteLabel(): void {
        this.muteButton.setLabel(soundLabel(isMuted()));
    }

    private refreshDailyLabel(): void {
        const done = loadDailyBoard().some((entry) => entry.date === dailyDateKey());
        this.dailyButton.setLabel(dailyLabel(done));
        this.dailyDot?.setVisible(!done);
    }

    /** Daily seeded challenge: fixed matchup, date-derived seed. */
    private startDaily(): void {
        const date = dailyDateKey();
        const lineupIds = dailyLineup();
        this.scene.start('Battle', {
            teamSize: 1,
            lineupIds: [...lineupIds],
            loadouts: lineupIds.map((id) => ({ ...(getRobot(id)?.loadout ?? {}) })),
            skins: lineupIds.map((id, i) => defaultSkin(CALLSIGNS[i % CALLSIGNS.length] ?? id, i, (i < 1 ? 0 : 1) as 0 | 1)),
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
            nextSkins.push(this.skins[i] ?? defaultSkin(entry.meta.name.toUpperCase(), i, (i < size ? 0 : 1) as 0 | 1));
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
        this.modeButtons.forEach((btn, i) => {
            btn.setLabel(bracketedLabel(MENU.modeLabels[i] as string, i + 1 === this.teamSize));
        });
    }

    private cycleArena(): void {
        this.arena = this.arena === 'open' ? 'blocks' : 'open';
        this.refreshArenaLabel();
    }

    private refreshArenaLabel(): void {
        this.arenaButton.setLabel(arenaLabel(this.arena));
    }

    private refreshTrailsLabel(): void {
        this.trailsButton.setLabel(trailsLabel(this.trails));
    }

    private toggleTrails(): void {
        this.trails = !this.trails;
        this.refreshTrailsLabel();
    }

    private randomizeSkins(): void {
        this.skins = this.skins.map((skin, i) => randomSkin(skin.callsign, (i < this.teamSize ? 0 : 1) as 0 | 1));
        this.rebuildSlots();
    }

    private track<T extends Phaser.GameObjects.GameObject>(obj: T): T {
        this.slotObjects.push(obj);
        return obj;
    }

    private cycler(x: number, w: number, y: number, label: string, onClick: () => void, color = COLORS.ink): void {
        this.navSlots.push({ x, y, w, h: 44, activate: onClick });
        const bg = this.track(this.add.rectangle(x, y, w, 44, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge));
        const text = this.track(this.add.text(x, y, label, FONTS.buttonSmall).setOrigin(0.5));
        text.setColor(color);
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => bg.setStrokeStyle(2, COLORS.team[0]));
        bg.on('pointerout', () => bg.setStrokeStyle(2, COLORS.panelEdge));
        bg.on('pointerdown', onClick);
    }

    private rebuildSlots(): void {
        for (const obj of this.slotObjects) {
            this.tweens.killTweensOf(obj);
            obj.destroy();
        }
        this.slotObjects = [];
        this.navSlots = [];

        const rows = this.teamSize * 2;
        const startY = rows <= 2 ? 252 : rows <= 4 ? 228 : 210;
        const step = rows <= 2 ? 84 : 64;
        for (let i = 0; i < rows; i += 1) {
            const y = startY + i * step;
            const team = (i < this.teamSize ? 0 : 1) as 0 | 1;
            const skin = this.skins[i] as SlotSkin;
            const id = this.lineupIds[i] as string;
            const entry = getRobot(id) ?? getImported(id) ?? ROBOTS[0]!;
            const loadout = this.loadouts[i] as SkillLoadout;
            const spriteId = displayRobotId(id);

            this.track(this.add.rectangle(100, y, 14, 14, teamColor(team)));
            const preview = this.track(this.add.image(152, y, chassisKey(spriteId)).setScale(2));
            preview.setTint(teamColor(team));
            // Live paint preview: tower + hub exactly as the battle renders them.
            const previewTower = this.track(this.add.image(152, y, towerKey(spriteId)).setScale(2));
            previewTower.setTint(skin.paint).setRotation(-0.5);
            const previewHub = this.track(this.add.image(152, y, 'hub').setScale(2));
            previewHub.setTint(skin.paint);
            // Idle life: gentle preview sway via tween (no new MenuScene
            // update loop; frozen under reduced motion).
            if (!isReducedMotion()) {
                this.tweens.add({
                    targets: [preview, previewTower, previewHub],
                    y: y + 3,
                    duration: 900 + i * 70,
                    yoyo: true,
                    repeat: -1,
                    ease: 'Sine.easeInOut',
                });
            }

            this.cycler(285, 150, y, cyclerLabel(skin.callsign), () => this.cycleCallsign(i), skin.paintCss);
            this.cycler(490, 200, y, cyclerLabel(entry.meta.name), () => this.cycleRobot(i));

            const paintBg = this.track(this.add.rectangle(646, y, 56, 44, skin.paint).setStrokeStyle(2, 0x0b0e12));
            paintBg.setInteractive({ useHandCursor: true });
            paintBg.on('pointerdown', () => this.cyclePaint(i));
            this.navSlots.push({ x: 646, y, w: 56, h: 44, activate: () => this.cyclePaint(i) });

            this.cycler(748, 110, y, cyclerLabel(skin.finish), () => this.cycleFinish(i));
            this.cycler(885, 100, y, skillsButtonLabel(loadoutCost(loadout)), () => this.openEditor(i), '#7de08a');
        }
        this.restoreNav();
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
        const frame = [
            this.trackEditor(this.add.rectangle(CX, 384, 740, 560, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(50)),
            this.trackEditor(this.add.text(CX, 140, editorSlotTitle(slot), FONTS.heading).setOrigin(0.5).setDepth(50)),
            this.trackEditor(this.add.text(CX, 166, editorSubtitle(entry.meta.name, entry.meta.description), FONTS.small).setOrigin(0.5).setDepth(50)),
        ];
        this.editorPoints = this.trackEditor(this.add.text(CX, 196, '', FONTS.mono).setOrigin(0.5).setDepth(50));
        transition(this, [...frame, this.editorPoints]);
        this.refreshEditorRows();
        this.nav.reset();
    }

    private refreshEditorRows(): void {
        // Drop old rows but keep the overlay frame (first 5 objects).
        const frame = this.editorObjects.slice(0, 5);
        for (const obj of this.editorObjects.slice(5)) obj.destroy();
        this.editorObjects = frame;

        const slot = this.editorSlot;
        const loadout = this.loadouts[slot] as SkillLoadout;
        const spent = loadoutCost(loadout);
        this.editorPoints.setText(editorPoints(spent));
        this.editorPoints.setColor(spent >= SKILL_BUDGET ? COLORS.goldCss : COLORS.ink);

        const targets: NavTarget[] = [];
        SKILL_DEFS.forEach((def, row) => {
            const y = 226 + row * 30;
            const rank = rankOf(loadout, def.id);
            this.trackEditor(this.add.image(152, y + 4, skillIconKey(def.id)).setScale(2).setDepth(50));
            this.trackEditor(this.add.text(180, y, skillLine(def.code, def.name), FONTS.buttonSmall).setOrigin(0, 0.5).setDepth(50));
            this.trackEditor(this.add.text(180, y + 14, def.desc, FONTS.monoSmall).setOrigin(0, 0.5).setDepth(50));
            const minus = this.trackEditor(this.add.rectangle(640, y + 4, 36, 30, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(50));
            this.trackEditor(this.add.text(640, y + 4, COMMON.minus, FONTS.button).setOrigin(0.5).setDepth(50));
            minus.setInteractive({ useHandCursor: true });
            minus.on('pointerdown', () => this.bumpSkill(def.id, -1));
            this.trackEditor(addTouchHit(this, 640, y + 4, 52, 36, () => this.bumpSkill(def.id, -1), 50));
            targets.push({ x: 640, y: y + 4, w: 36, h: 30, activate: () => this.bumpSkill(def.id, -1) });
            const rankLabel = this.trackEditor(this.add.text(684, y + 4, rankText(rank, def.maxRank), FONTS.mono).setOrigin(0.5).setDepth(50));
            rankLabel.setColor(rank > 0 ? '#7de08a' : COLORS.dim);
            const plus = this.trackEditor(this.add.rectangle(740, y + 4, 36, 30, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(50));
            this.trackEditor(this.add.text(740, y + 4, COMMON.plus, FONTS.button).setOrigin(0.5).setDepth(50));
            plus.setInteractive({ useHandCursor: true });
            plus.on('pointerdown', () => this.bumpSkill(def.id, 1));
            this.trackEditor(addTouchHit(this, 740, y + 4, 52, 36, () => this.bumpSkill(def.id, 1), 50));
            targets.push({ x: 740, y: y + 4, w: 36, h: 30, activate: () => this.bumpSkill(def.id, 1) });
        });

        const footer = 226 + SKILL_DEFS.length * 30 + 8;
        const random = this.trackEditor(this.add.rectangle(CX - 150, footer, 170, 40, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(50));
        this.trackEditor(this.add.text(CX - 150, footer, EDITOR.random, FONTS.buttonSmall).setOrigin(0.5).setDepth(50));
        random.setInteractive({ useHandCursor: true });
        random.on('pointerdown', () => this.randomLoadout());
        targets.push({ x: CX - 150, y: footer, w: 170, h: 40, activate: () => this.randomLoadout() });
        const clear = this.trackEditor(this.add.rectangle(CX + 20, footer, 130, 40, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(50));
        this.trackEditor(this.add.text(CX + 20, footer, COMMON.clear, FONTS.buttonSmall).setOrigin(0.5).setDepth(50));
        clear.setInteractive({ useHandCursor: true });
        clear.on('pointerdown', () => {
            this.loadouts[slot] = {};
            this.refreshEditorRows();
        });
        targets.push({
            x: CX + 20,
            y: footer,
            w: 130,
            h: 40,
            activate: () => {
                this.loadouts[slot] = {};
                this.refreshEditorRows();
            },
        });
        const done = this.trackEditor(this.add.rectangle(CX + 190, footer, 170, 40, COLORS.panel).setStrokeStyle(2, COLORS.team[0]).setDepth(50));
        this.trackEditor(this.add.text(CX + 190, footer, COMMON.done, FONTS.buttonSmall).setOrigin(0.5).setDepth(50));
        done.setInteractive({ useHandCursor: true });
        done.on('pointerdown', () => {
            this.closeEditor();
            this.rebuildSlots();
        });
        targets.push({
            x: CX + 190,
            y: footer,
            w: 170,
            h: 40,
            activate: () => {
                this.closeEditor();
                this.rebuildSlots();
            },
        });
        if (this.tourMode === 'tour') {
            targets.push(
                { x: 668, y: 632, w: 120, h: 36, activate: () => this.nextTourStep() },
                { x: 796, y: 632, w: 90, h: 36, activate: () => this.finishTour() },
            );
        }
        this.nav.replaceTargets(targets);
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
        this.restoreNav();
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
        this.restoreNav();
    }

    private showTutorialPrompt(): void {
        this.clearTour();
        this.tourMode = 'prompt';
        this.trackTour(this.add.rectangle(CX, 384, 1024, 768, 0x06080b, 0.85).setDepth(60).setInteractive());
        transition(this, [
            this.trackTour(this.add.rectangle(CX, 384, 460, 220, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(60)),
            this.trackTour(this.add.text(CX, 320, TUTORIAL_PROMPT.title, FONTS.heading).setOrigin(0.5).setDepth(60)),
            this.trackTour(this.add.text(CX, 352, TUTORIAL_PROMPT.line1, FONTS.small).setOrigin(0.5).setDepth(60)),
            this.trackTour(this.add.text(CX, 370, TUTORIAL_PROMPT.line2, FONTS.small).setOrigin(0.5).setDepth(60)),
        ]);
        this.tourButtons.push(
            makeButton(this, CX - 110, 440, 200, 40, TUTORIAL_PROMPT.play, () => {
                this.clearTour();
                this.startTutorial();
            }, 60),
        );
        this.tourButtons.push(
            makeButton(this, CX + 110, 440, 200, 40, COMMON.skip, () => {
                markTutorialSeen();
                this.clearTour();
            }, 60),
        );
        this.nav.setTargets([
            {
                x: CX - 110,
                y: 440,
                w: 200,
                h: 40,
                activate: () => {
                    this.clearTour();
                    this.startTutorial();
                },
            },
            {
                x: CX + 110,
                y: 440,
                w: 200,
                h: 40,
                activate: () => {
                    markTutorialSeen();
                    this.clearTour();
                },
            },
        ]);
    }

    /** Scripted spectated 1v1: fixed seed and matchup, coach marks on top. */
    private startTutorial(): void {
        const lineupIds = [...TUTORIAL_LINEUP];
        this.scene.start('Battle', {
            teamSize: 1,
            lineupIds,
            loadouts: lineupIds.map((id) => ({ ...(getRobot(id)?.loadout ?? {}) })),
            skins: lineupIds.map((id, i) => defaultSkin(CALLSIGNS[i % CALLSIGNS.length] ?? id, i, (i < 1 ? 0 : 1) as 0 | 1)),
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
        this.tourButtons.push(makeButton(this, 796, 632, 90, 36, COMMON.skip, () => this.finishTour(), 60));
        this.refreshTourStep();
        // Pick up the tour NEXT/SKIP buttons in the editor focus list.
        if (this.editorSlot >= 0) this.refreshEditorRows();
    }

    private refreshTourStep(): void {
        const step = LOADOUT_TOUR_STEPS[this.tourStep] as CopyStep;
        this.tourTitle.setText(loadoutTourTitle(this.tourStep, LOADOUT_TOUR_STEPS.length, step.title));
        this.tourBody.setText(step.body);
        this.tourNext?.setLabel(this.tourStep === LOADOUT_TOUR_STEPS.length - 1 ? COMMON.finish : COMMON.next);
    }

    private nextTourStep(): void {
        if (this.tourStep >= LOADOUT_TOUR_STEPS.length - 1) {
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
        const entry = getRobot(id) ?? getImported(id) ?? ROBOTS[0]!;
        this.descText.setText(
            robotByline(entry.meta.name, entry.meta.author, entry.meta.version, entry.meta.description),
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
            `font-family:${FONT_STACKS.body};line-height:1.3;`;
        panel.innerHTML =
            `<div style="color:#e8edf2;font-size:20px;margin-bottom:12px;">${REPLAY_DIALOG.title}</div>` +
            `<div style="color:#9aa7b4;font-size:18px;margin-bottom:8px;">${REPLAY_DIALOG.prompt}</div>` +
            `<input type="text" spellcheck="false" placeholder="${REPLAY_DIALOG.placeholder}" ` +
            'style="width:100%;box-sizing:border-box;background:#0b0e12;border:1px solid #2b3542;' +
            'color:#e8edf2;padding:8px;font-family:inherit;font-size:18px;" />' +
            '<div class="replay-error" style="color:#ff5d5d;font-size:18px;min-height:24px;margin-top:6px;"></div>' +
            '<div style="display:flex;gap:8px;margin-top:8px;">' +
            `<button class="replay-watch" style="flex:1;background:${COLORS.panelHoverCss};border:2px solid #ffb340;` +
            `color:#e8edf2;padding:12px;font-family:inherit;font-size:18px;cursor:pointer;">${REPLAY_DIALOG.watch}</button>` +
            '<button class="replay-cancel" style="flex:1;background:#141a21;border:2px solid #2b3542;' +
            `color:#9aa7b4;padding:12px;font-family:inherit;font-size:18px;cursor:pointer;">${COMMON.cancel}</button>` +
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
                error.textContent = REPLAY_DIALOG.invalidCode;
                playError();
                return;
            }
            for (const id of data.lineupIds) {
                if (!getRobot(id)) {
                    error.textContent = replayUnknownRobot(id);
                    playError();
                    return;
                }
            }
            playConfirm();
            this.closeReplayDialog();
            this.scene.start('Battle', {
                teamSize: data.teamSize,
                lineupIds: [...data.lineupIds],
                loadouts: data.loadouts.map((l) => ({ ...l })),
                skins: data.lineupIds.map((id, i) => defaultSkin(CALLSIGNS[i % CALLSIGNS.length] ?? id, i, (i < data.teamSize ? 0 : 1) as 0 | 1)),
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

    // ---- Import robot dialog (exhibition only) ------------------------------
    private openImportDialog(): void {
        if (this.importOverlay) return;
        const overlay = document.createElement('div');
        overlay.style.cssText =
            'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
            'background:rgba(6,8,11,0.85);z-index:1000;';
        const panel = document.createElement('div');
        panel.style.cssText =
            'background:#141a21;border:2px solid #2b3542;padding:24px;width:460px;max-width:90vw;' +
            `font-family:${FONT_STACKS.body};line-height:1.3;`;
        const slotOptions = this.lineupIds
            .map((id, i) => {
                const name = getRobot(id)?.meta.name ?? IMPORT_DIALOG.unknownName;
                return `<option value="${i}">${importSlotOption(i, i < this.teamSize ? 1 : 2, name)}</option>`;
            })
            .join('');
        panel.innerHTML =
            `<div style="color:#e8edf2;font-size:20px;margin-bottom:4px;">${IMPORT_DIALOG.title}</div>` +
            `<div style="color:${COLORS.goldCss};font-size:18px;margin-bottom:12px;">${IMPORT_DIALOG.warning}</div>` +
            `<div style="color:#9aa7b4;font-size:18px;margin-bottom:8px;">${IMPORT_DIALOG.fileLabel}</div>` +
            '<input type="file" accept=".js,.mjs" class="import-file" ' +
            'style="width:100%;box-sizing:border-box;color:#e8edf2;font-family:inherit;font-size:18px;margin-bottom:8px;" />' +
            `<div style="color:#9aa7b4;font-size:18px;margin-bottom:8px;">${IMPORT_DIALOG.urlLabel}</div>` +
            `<input type="text" spellcheck="false" placeholder="${IMPORT_DIALOG.urlPlaceholder}" class="import-url" ` +
            'style="width:100%;box-sizing:border-box;background:#0b0e12;border:1px solid #2b3542;' +
            'color:#e8edf2;padding:8px;font-family:inherit;font-size:18px;margin-bottom:8px;" />' +
            `<div style="color:#9aa7b4;font-size:18px;margin-bottom:8px;">${IMPORT_DIALOG.slotLabel}</div>` +
            `<select class="import-slot" style="width:100%;box-sizing:border-box;background:#0b0e12;border:1px solid #2b3542;` +
            'color:#e8edf2;padding:8px;font-family:inherit;font-size:18px;margin-bottom:8px;">' +
            `${slotOptions}</select>` +
            '<div class="import-status" style="color:#ff5d5d;font-size:18px;min-height:24px;margin-top:6px;"></div>' +
            '<div style="display:flex;gap:8px;margin-top:8px;">' +
            `<button class="import-go" style="flex:1;background:${COLORS.panelHoverCss};border:2px solid #ffb340;` +
            `color:#e8edf2;padding:12px;font-family:inherit;font-size:18px;cursor:pointer;">${IMPORT_DIALOG.import}</button>` +
            '<button class="import-cancel" style="flex:1;background:#141a21;border:2px solid #2b3542;' +
            `color:#9aa7b4;padding:12px;font-family:inherit;font-size:18px;cursor:pointer;">${COMMON.cancel}</button>` +
            '</div>';
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        this.importOverlay = overlay;

        const fileInput = panel.querySelector('.import-file') as HTMLInputElement | null;
        const urlInput = panel.querySelector('.import-url') as HTMLInputElement | null;
        const slotSelect = panel.querySelector('.import-slot') as HTMLSelectElement | null;
        const status = panel.querySelector('.import-status') as HTMLDivElement | null;
        const go = panel.querySelector('.import-go') as HTMLButtonElement | null;
        const cancel = panel.querySelector('.import-cancel') as HTMLButtonElement | null;
        if (!fileInput || !urlInput || !slotSelect || !status || !go || !cancel) {
            this.closeImportDialog();
            return;
        }
        const submit = (): void => {
            const slot = Math.max(0, Math.min(this.lineupIds.length - 1, Number(slotSelect.value)));
            const file = fileInput.files?.[0] ?? null;
            const url = urlInput.value.trim();
            if (!file && url === '') {
                status.textContent = IMPORT_DIALOG.noSource;
                playError();
                return;
            }
            status.style.color = '#9aa7b4';
            status.textContent = IMPORT_DIALOG.loading;
            go.disabled = true;
            const done = file !== null ? importRobotFromFile(file) : importRobotFromUrl(url);
            void done.then((result) => {
                go.disabled = false;
                if (!result.ok) {
                    status.style.color = '#ff5d5d';
                    status.textContent = result.error;
                    playError();
                    return;
                }
                this.lineupIds[slot] = result.id;
                this.loadouts[slot] = { ...result.robot.loadout };
                this.rebuildSlots();
                this.showDescription(slot);
                status.style.color = '#7de08a';
                status.textContent = importDoneNotice(result.robot.meta.name, slot);
                playConfirm();
                this.time.delayedCall(900, () => this.closeImportDialog());
            });
        };
        go.addEventListener('click', submit);
        cancel.addEventListener('click', () => this.closeImportDialog());
        overlay.addEventListener('pointerdown', (event) => {
            if (event.target === overlay) this.closeImportDialog();
        });
        urlInput.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key === 'Enter') submit();
            if (event.key === 'Escape') this.closeImportDialog();
        });
        urlInput.focus();
    }

    private closeImportDialog(): void {
        this.importOverlay?.remove();
        this.importOverlay = null;
    }

    // ---- Match history + stats panel --------------------------------------
    private trackStats<T extends Phaser.GameObjects.GameObject>(obj: T): T {
        this.statsObjects.push(obj);
        return obj;
    }

    private openStats(): void {
        this.closeStats();
        this.statsTab = 'local';
        // Backdrop swallows clicks so menu controls beneath can't fire.
        this.trackStats(this.add.rectangle(CX, 384, 1024, 768, 0x06080b, 0.85).setDepth(50).setInteractive());
        this.trackStats(this.add.rectangle(CX, 384, 560, 600, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(50));
        this.trackStats(this.add.text(CX, 118, STATS.title, FONTS.heading).setOrigin(0.5).setDepth(50));
        this.refreshStatsRows();
        this.nav.reset();
    }

    private setStatsTab(tab: 'local' | 'online'): void {
        if (this.statsTab === tab) return;
        this.statsTab = tab;
        this.refreshStatsRows();
    }

    private refreshStatsRows(): void {
        // Drop old rows but keep the overlay frame (first 3 objects).
        const frame = this.statsObjects.slice(0, 3);
        for (const obj of this.statsObjects.slice(3)) obj.destroy();
        this.statsObjects = frame;
        const targets: NavTarget[] = [];
        const tabs: Array<{ tab: 'local' | 'online'; label: string; x: number }> = [
            { tab: 'local', label: STATS.localTab, x: CX - 90 },
            { tab: 'online', label: STATS.onlineTab, x: CX + 90 },
        ];
        for (const t of tabs) {
            const active = this.statsTab === t.tab;
            const bg = this.trackStats(
                this.add.rectangle(t.x, 150, 160, 30, COLORS.panel).setStrokeStyle(2, active ? COLORS.team[0] : COLORS.panelEdge).setDepth(50),
            );
            this.trackStats(this.add.text(t.x, 150, bracketedLabel(t.label, active), FONTS.buttonSmall).setOrigin(0.5).setDepth(50));
            bg.setInteractive({ useHandCursor: true });
            bg.on('pointerdown', () => this.setStatsTab(t.tab));
            targets.push({ x: t.x, y: 150, w: 160, h: 30, activate: () => this.setStatsTab(t.tab) });
        }
        if (this.statsTab === 'local') this.renderLocalStats(targets);
        else this.renderOnlineStats(targets);
        this.nav.replaceTargets(targets);
    }

    private renderLocalStats(targets: NavTarget[]): void {
        const history = loadHistory();
        const draws = history.filter((r) => r.winner === -1).length;
        this.trackStats(
            this.add.text(CX, 180, statsSummary(history.length, draws), FONTS.mono).setOrigin(0.5).setDepth(50),
        );
        const rows = winRates(ROBOTS.map((r) => r.meta.id)).sort(
            (a, b) => b.rate - a.rate || b.games - a.games,
        );
        if (history.length === 0) {
            this.trackStats(
                this.add.text(CX, 220, STATS.empty, FONTS.small).setOrigin(0.5).setDepth(50),
            );
        } else {
            const shown = rows.slice(0, STATS_ROWS);
            shown.forEach((row, i) => {
                const y = 206 + i * 26;
                const entry = ROBOTS.find((r) => r.meta.id === row.id) ?? ROBOTS[0]!;
                const name = this.trackStats(
                    this.add.text(CX - 220, y, entry.meta.name.toUpperCase(), FONTS.buttonSmall).setOrigin(0, 0.5).setDepth(50),
                );
                name.setColor(COLORS.ink);
                this.trackStats(
                    this.add.text(CX + 220, y, statsRow(row.games, row.wins, row.draws, statsPct(row.games, row.rate)), FONTS.mono).setOrigin(1, 0.5).setDepth(50),
                );
            });
            if (rows.length > shown.length) {
                this.trackStats(
                    this.add.text(CX, 206 + shown.length * 26, statsAndMore(rows.length - shown.length), FONTS.monoSmall).setOrigin(0.5).setDepth(50),
                );
            }
        }

        const rowCount = history.length === 0 ? 1 : Math.min(rows.length, STATS_ROWS) + (rows.length > STATS_ROWS ? 1 : 0);
        const dailyY = 206 + rowCount * 26 + 22;
        this.trackStats(
            this.add.text(CX, dailyY, STATS.dailyTitle, FONTS.buttonSmall).setOrigin(0.5).setDepth(50),
        );
        const board = loadDailyBoard().slice(0, 5);
        if (board.length === 0) {
            this.trackStats(
                this.add.text(CX, dailyY + 26, STATS.dailyEmpty, FONTS.small).setOrigin(0.5).setDepth(50),
            );
        } else {
            board.forEach((entry, i) => {
                const y = dailyY + 26 + i * 24;
                const outcome =
                    entry.winner === -1
                        ? STATS.draw
                        : dailyWinnerName((ROBOTS.find((r) => r.meta.id === entry.lineupIds[entry.winner])?.meta.name ?? STATS.unknownTeam).toUpperCase());
                this.trackStats(
                    this.add.text(CX, y, dailyRow(entry.date, outcome, entry.ticks), FONTS.monoSmall).setOrigin(0.5).setDepth(50),
                );
            });
        }

        const clear = this.trackStats(
            this.add.rectangle(CX - 120, 630, 170, 40, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(50),
        );
        this.trackStats(this.add.text(CX - 120, 630, COMMON.clear, FONTS.buttonSmall).setOrigin(0.5).setDepth(50));
        clear.setInteractive({ useHandCursor: true });
        clear.on('pointerdown', () => {
            clearHistory();
            clearDailyBoard();
            this.refreshStatsRows();
        });
        const close = this.trackStats(
            this.add.rectangle(CX + 120, 630, 170, 40, COLORS.panel).setStrokeStyle(2, COLORS.team[0]).setDepth(50),
        );
        this.trackStats(this.add.text(CX + 120, 630, COMMON.close, FONTS.buttonSmall).setOrigin(0.5).setDepth(50));
        close.setInteractive({ useHandCursor: true });
        close.on('pointerdown', () => this.closeStats());
        targets.push(
            {
                x: CX - 120,
                y: 630,
                w: 170,
                h: 40,
                activate: () => {
                    clearHistory();
                    clearDailyBoard();
                    this.refreshStatsRows();
                },
            },
            { x: CX + 120, y: 630, w: 170, h: 40, activate: () => this.closeStats() },
        );
    }

    private renderOnlineStats(targets: NavTarget[]): void {
        if (!this.onlineTried) {
            this.onlineTried = true;
            const token = ++this.onlineToken;
            this.trackStats(this.add.text(CX, 220, ONLINE.loading, FONTS.small).setOrigin(0.5).setDepth(50));
            void fetchOnlineBoard().then((result) => {
                if (!this.scene.isActive('Menu')) return;
                if (token !== this.onlineToken || this.statsTab !== 'online' || this.statsObjects.length === 0) return;
                this.onlineBoard = result.board;
                this.onlineCached = result.cached;
                this.refreshStatsRows();
            });
        } else if (!this.onlineBoard) {
            this.trackStats(this.add.text(CX, 220, ONLINE.unavailable, FONTS.small).setOrigin(0.5).setDepth(50));
        } else {
            const rows = [...this.onlineBoard.entries].sort((a, b) => b.elo - a.elo || (a.botId < b.botId ? -1 : 1));
            this.trackStats(
                this.add.text(CX, 180, onlineSummary(this.onlineBoard.season, rows.length), FONTS.mono).setOrigin(0.5).setDepth(50),
            );
            let y0 = 206;
            if (this.onlineCached) {
                this.trackStats(this.add.text(CX, 200, ONLINE.cachedNote, FONTS.monoSmall).setOrigin(0.5).setDepth(50));
                y0 = 224;
            }
            if (rows.length === 0) {
                this.trackStats(this.add.text(CX, y0 + 14, ONLINE.empty, FONTS.small).setOrigin(0.5).setDepth(50));
            } else {
                const shown = rows.slice(0, STATS_ROWS);
                shown.forEach((row, i) => {
                    const y = y0 + i * 26;
                    const name = (ROBOTS.find((r) => r.meta.id === row.botId)?.meta.name ?? row.botId).toUpperCase();
                    const nameText = this.trackStats(
                        this.add.text(CX - 240, y, name, FONTS.buttonSmall).setOrigin(0, 0.5).setDepth(50),
                    );
                    nameText.setColor(COLORS.ink);
                    this.trackStats(
                        this.add.text(CX + 120, y, onlineRow(row.elo, row.wins, row.losses, row.draws), FONTS.mono).setOrigin(1, 0.5).setDepth(50),
                    );
                    if (row.showcaseCode !== '') {
                        const bg = this.trackStats(
                            this.add.rectangle(CX + 185, y, 100, 22, COLORS.panel).setStrokeStyle(1, COLORS.panelEdge).setDepth(50),
                        );
                        this.trackStats(this.add.text(CX + 185, y, ONLINE.watch, FONTS.buttonSmall).setOrigin(0.5).setDepth(50));
                        bg.setInteractive({ useHandCursor: true });
                        bg.on('pointerdown', () => this.watchOnlineCode(row.showcaseCode));
                        targets.push({ x: CX + 185, y, w: 100, h: 22, activate: () => this.watchOnlineCode(row.showcaseCode) });
                    }
                });
                if (rows.length > shown.length) {
                    this.trackStats(
                        this.add.text(CX, y0 + shown.length * 26, statsAndMore(rows.length - shown.length), FONTS.monoSmall).setOrigin(0.5).setDepth(50),
                    );
                }
            }
        }
        // CLOSE only: CLEAR would clear LOCAL data while viewing ONLINE.
        const close = this.trackStats(
            this.add.rectangle(CX, 630, 170, 40, COLORS.panel).setStrokeStyle(2, COLORS.team[0]).setDepth(50),
        );
        this.trackStats(this.add.text(CX, 630, COMMON.close, FONTS.buttonSmall).setOrigin(0.5).setDepth(50));
        close.setInteractive({ useHandCursor: true });
        close.on('pointerdown', () => this.closeStats());
        targets.push({ x: CX, y: 630, w: 170, h: 40, activate: () => this.closeStats() });
    }

    /** Watch-per-code: rated board rows play back through the replay flow. */
    private watchOnlineCode(code: string): void {
        const data = decodeReplay(code);
        if (!data) return;
        for (const id of data.lineupIds) {
            if (!getRobot(id)) return;
        }
        this.scene.start('Battle', {
            teamSize: data.teamSize,
            lineupIds: [...data.lineupIds],
            loadouts: data.loadouts.map((l) => ({ ...l })),
            skins: data.lineupIds.map((id, i) => defaultSkin(CALLSIGNS[i % CALLSIGNS.length] ?? id, i, (i < data.teamSize ? 0 : 1) as 0 | 1)),
            trails: this.trails,
            seed: data.seed,
            arena: data.arena ?? 'open',
            modifiers: data.modifiers ?? {},
            replay: true,
        } satisfies BattleRequest);
    }

    private closeStats(): void {
        for (const obj of this.statsObjects) obj.destroy();
        this.statsObjects = [];
        this.restoreNav();
    }

    // ---- Exhibition modifiers overlay ------------------------------------
    private trackMods<T extends Phaser.GameObjects.GameObject>(obj: T): T {
        this.modsObjects.push(obj);
        return obj;
    }

    private refreshModsLabel(): void {
        this.modsButton.setLabel(modsButtonLabel(modifierCodes(this.mods)));
    }

    private openMods(): void {
        this.closeMods();
        // Backdrop swallows clicks so menu controls beneath can't fire.
        this.trackMods(this.add.rectangle(CX, 384, 1024, 768, 0x06080b, 0.85).setDepth(50).setInteractive());
        this.trackMods(this.add.rectangle(CX, 384, 560, 420, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(50));
        this.trackMods(this.add.text(CX, 208, MODS.title, FONTS.heading).setOrigin(0.5).setDepth(50));
        this.trackMods(
            this.add.text(CX, 236, MODS.subtitle, FONTS.small).setOrigin(0.5).setDepth(50),
        );
        this.refreshModsRows();
        this.nav.reset();
    }

    private refreshModsRows(): void {
        // Drop old rows but keep the overlay frame (first 4 objects).
        const frame = this.modsObjects.slice(0, 4);
        for (const obj of this.modsObjects.slice(4)) obj.destroy();
        this.modsObjects = frame;

        const targets: NavTarget[] = [];
        const toggle = (key: 'doubleDamage' | 'hardcoreFog' | 'mirror', on: boolean): void => {
            const next = { ...this.mods };
            if (on) delete next[key];
            else next[key] = true;
            this.mods = next;
            this.refreshModsLabel();
            this.refreshModsRows();
        };
        MOD_ROWS.forEach((row, i) => {
            const y = 292 + i * 64;
            const on = this.mods[row.key] === true;
            const bg = this.trackMods(
                this.add.rectangle(CX, y, 480, 52, COLORS.panel).setStrokeStyle(2, on ? COLORS.team[0] : COLORS.panelEdge).setDepth(50),
            );
            const name = this.trackMods(this.add.text(CX - 220, y - 10, row.name, FONTS.buttonSmall).setOrigin(0, 0.5).setDepth(50));
            name.setColor(on ? '#7de08a' : COLORS.ink);
            this.trackMods(this.add.text(CX - 220, y + 12, row.desc, FONTS.small).setOrigin(0, 0.5).setDepth(50));
            const state = this.trackMods(this.add.text(CX + 220, y, on ? COMMON.on : COMMON.off, FONTS.button).setOrigin(1, 0.5).setDepth(50));
            state.setColor(on ? '#7de08a' : COLORS.dim);
            bg.setInteractive({ useHandCursor: true });
            bg.on('pointerdown', () => toggle(row.key, on));
            targets.push({ x: CX, y, w: 480, h: 52, activate: () => toggle(row.key, on) });
        });

        const done = this.trackMods(
            this.add.rectangle(CX, 520, 170, 40, COLORS.panel).setStrokeStyle(2, COLORS.team[0]).setDepth(50),
        );
        this.trackMods(this.add.text(CX, 520, COMMON.done, FONTS.buttonSmall).setOrigin(0.5).setDepth(50));
        done.setInteractive({ useHandCursor: true });
        done.on('pointerdown', () => this.closeMods());
        targets.push({ x: CX, y: 520, w: 170, h: 40, activate: () => this.closeMods() });
        this.nav.replaceTargets(targets);
    }

    private closeMods(): void {
        for (const obj of this.modsObjects) obj.destroy();
        this.modsObjects = [];
        this.restoreNav();
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
