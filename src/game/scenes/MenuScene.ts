// Main menu: mode select, per-slot robot picker with sprite previews,
// cosmetic skins, and per-slot skill loadouts (symmetric point budgets).

import { BlendModes, Scene } from 'phaser';
import { getRobot, ROBOTS } from '../../robots/registry';
import { modifierCodes, type ArenaId, type MatchModifiers } from '../../sim/constants';
import { decodeReplay } from '../../sim/replay';
import { loadoutCost, rankOf, SKILL_BUDGET, SKILL_DEFS, type SkillId, type SkillLoadout } from '../../sim/skills';
import { artRegistry, chassisKey, ensureArtTextures, skillIconKey, towerKey } from '../art';
import { isMuted, playClick, playConfirm, playError, playHover, startMenuAmbience, stopMusic, toggleMuted, unlockAudio } from '../audio';
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
    /** Two-screen menu: 'home' is the clean text list, 'setup' the battle config. */
    private screen: 'home' | 'setup' = 'home';
    private homeLayer!: Phaser.GameObjects.Container;
    private setupLayer!: Phaser.GameObjects.Container;
    private navHome: NavTarget[] = [];
    private navFooterFlow: NavTarget[] = [];
    private navFooterSettings: NavTarget[] = [];
    private footerFlow: Phaser.GameObjects.GameObject[] = [];
    private showcaseAvailable = false;
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
        this.teamSize = 1;
        this.lineupIds = [...this.lineupIds.slice(0, 2)];
        this.loadouts = [...this.loadouts.slice(0, 2)];
        this.skins = [...this.skins.slice(0, 2)];
        this.arena = 'open';
        this.mods = {};
        this.editorSlot = -1;
        this.modeButtons = [];
        this.navBase = [];
        this.navHome = [];
        this.navSlots = [];
        this.navFooterFlow = [];
        this.navFooterSettings = [];
        this.footerFlow = [];
        this.showcaseAvailable = false;
        this.tickerTimer = null;
        this.onlineBoard = null;
        this.onlineCached = false;
        this.onlineTried = false;
        this.onlineToken = 0;
        this.tourMode = 'none';
        this.tourStep = 0;
        const reduced = isReducedMotion();
        this.nav = new FocusNav(this);
        this.nav.onEscape = () => this.escapeOverlay();

        // Pixel-art menu backdrop, full-bleed behind every control. Each
        // screen layer carries its own scrim so the art stays visible.
        this.add.image(CX, 384, 'menu_backdrop').setScale(8).setDepth(-10);
        // TEMP experiment: lift the dark quantized backdrop with an ADD copy.
        this.add.image(CX, 384, 'menu_backdrop').setScale(8).setDepth(-9).setBlendMode(BlendModes.ADD).setAlpha(0.35);
        this.homeLayer = this.add.container(0, 0).setDepth(0);
        this.setupLayer = this.add.container(0, 0).setDepth(0);

        this.buildHome(reduced);
        this.buildSetup();
        this.showScreen('home');

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

        // Return from a battle with the loadout tour requested: the tour
        // needs the setup screen, so switch before opening the editor.
        const startTour = this.tourRequested;
        this.tourRequested = false;
        if (startTour) {
            this.showScreen('setup');
            this.openEditor(0);
            this.startLoadoutTour();
        } else if (shouldShowTutorial()) {
            this.showTutorialPrompt();
        }
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

    /** navButton variant for setup-screen controls: same targets, inside the setup layer. */
    private setupButton(
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
        return this.navButton(x, y, w, h, label, onClick, depth, minTouch, { ...opts, container: this.setupLayer });
    }

    /** Switch between the home list and the battle-setup screen. */
    private showScreen(next: 'home' | 'setup'): void {
        this.screen = next;
        this.homeLayer.setVisible(next === 'home');
        this.setupLayer.setVisible(next === 'setup');
        this.restoreNav();
    }

    /**
     * Text menu item in the style of the reference: no button box, just
     * letterspaced text with a gold diamond marker on hover. Keyboard focus
     * uses the shared nav ring.
     */
    private homeItem(x: number, y: number, label: string, onClick: () => void, primary = false): void {
        const rest = primary ? COLORS.goldCss : COLORS.ink;
        const text = this.add.text(x, y, label, { ...FONTS.heading, letterSpacing: 6, color: rest }).setOrigin(0, 0.5);
        text.setShadow(0, 2, '#000', 5, true, true);
        const marker = this.add.rectangle(x - 22, y, 9, 9, COLORS.gold).setRotation(Math.PI / 4).setAlpha(0);
        const w = text.width + 56;
        const hit = this.add.rectangle(x + text.width / 2, y, w, 48, 0xffffff, 0);
        this.homeLayer.add([marker, text, hit]);
        const setHover = (on: boolean): void => {
            marker.setAlpha(on ? 1 : 0);
            text.setColor(on ? COLORS.whiteCss : rest);
            if (on) playHover();
        };
        hit.setInteractive({ useHandCursor: true });
        hit.on('pointerover', () => setHover(true));
        hit.on('pointerout', () => setHover(false));
        hit.on('pointerdown', () => {
            unlockAudio();
            playClick();
            onClick();
        });
        this.navHome.push({ x: x + w / 2 - 28, y, w, h: 42, activate: onClick });
    }

    /** Centered row of tiny footer text links. */
    private linkRow(
        y: number,
        defs: Array<{ label: string; onClick: () => void; keep?: (h: { setLabel: (label: string) => void }) => void }>,
        owned: Phaser.GameObjects.GameObject[],
        targets: NavTarget[],
    ): Array<{ cx: number; text: Phaser.GameObjects.Text }> {
        const gap = 34;
        const texts = defs.map((def) => {
            const text = this.add.text(0, 0, def.label, { ...FONTS.small, fontSize: '18px' }).setOrigin(0.5).setAlpha(0.9);
            this.homeLayer.add(text);
            owned.push(text);
            return { def, text, w: text.width + 26 };
        });
        const total = texts.reduce((sum, t) => sum + t.w, 0) + gap * (texts.length - 1);
        let x = CX - total / 2;
        const out: Array<{ cx: number; text: Phaser.GameObjects.Text }> = [];
        for (const t of texts) {
            const cx = x + t.w / 2;
            t.text.setPosition(cx, y);
            const hit = this.add.rectangle(cx, y, t.w, 40, 0xffffff, 0).setInteractive({ useHandCursor: true });
            this.homeLayer.add(hit);
            owned.push(hit);
            hit.on('pointerover', () => {
                t.text.setAlpha(1).setColor(COLORS.whiteCss);
                playHover();
            });
            hit.on('pointerout', () => {
                t.text.setAlpha(0.9).setColor(COLORS.dim);
            });
            hit.on('pointerdown', () => {
                unlockAudio();
                playClick();
                t.def.onClick();
            });
            targets.push({ x: cx, y, w: t.w, h: 28, activate: t.def.onClick });
            t.def.keep?.({ setLabel: (label: string) => t.text.setText(label) });
            out.push({ cx, text: t.text });
            x += t.w + gap;
        }
        return out;
    }

    /** Footer flow row; rebuilt when the showcase manifest arrives. */
    private layoutFooterRow1(): void {
        for (const obj of this.footerFlow) obj.destroy();
        this.footerFlow = [];
        this.navFooterFlow = [];
        if (this.dailyDot) {
            this.dailyDot.destroy();
            this.dailyDot = null;
        }
        const done = loadDailyBoard().some((entry) => entry.date === dailyDateKey());
        const defs: Array<{ label: string; onClick: () => void; keep?: (h: { setLabel: (label: string) => void }) => void }> = [
            { label: dailyLabel(done), onClick: () => this.startDaily(), keep: (h) => { this.dailyButton = h; } },
            { label: MENU.tourney, onClick: () => this.scene.start('Tournament') },
            { label: MENU.stats, onClick: () => this.openStats() },
            { label: MENU.workshop, onClick: () => this.scene.start('Workshop') },
            { label: MENU.tutorial, onClick: () => this.startTutorial() },
            { label: MENU.import, onClick: () => this.openImportDialog() },
        ];
        if (this.showcaseAvailable) defs.push({ label: MENU.showcase, onClick: () => this.scene.start('Showcase') });
        const entries = this.linkRow(688, defs, this.footerFlow, this.navFooterFlow);
        const first = entries[0];
        if (first && !done) {
            this.dailyDot = this.add.circle(first.cx + first.text.width / 2 + 12, 688, 5, COLORS.gold);
            this.homeLayer.add(this.dailyDot);
            this.footerFlow.push(this.dailyDot);
        }
        this.refreshDailyLabel();
    }

    /** Clean home screen: backdrop hero, letterspaced title, a few text options. */
    private buildHome(reduced: boolean): void {
        const L = this.homeLayer;
        // Light scrim: the backdrop stays the hero of this screen.
        L.add(this.add.rectangle(CX, 384, 1024, 768, 0x06080b, 0.18));

        // Title lockup, letterspaced like the reference, tagline beneath.
        const titleObj = this.add.text(CX, 104, APP.title, { ...FONTS.title, letterSpacing: 12 }).setOrigin(0.5);
        titleObj.setColor(COLORS.goldCss).setShadow(0, 3, '#000', 6, true, true);
        const logoL = this.add.image(CX - 310, 104, 'logo_bar').setScale(2);
        const logoR = this.add.image(CX + 310, 104, 'logo_bar').setScale(2);
        L.add([logoL, titleObj, logoR]);
        L.add(this.add.text(CX, 154, APP.tagline, FONTS.small).setOrigin(0.5));
        if (!reduced) {
            titleObj.setScale(0.92);
            logoL.setScale(1.84);
            logoR.setScale(1.84);
            this.tweens.add({ targets: titleObj, scale: 1, duration: 260, ease: 'Back.easeOut' });
            this.tweens.add({ targets: [logoL, logoR], scale: 2, duration: 260, ease: 'Back.easeOut' });
        }

        // The few options, centered like the reference.
        const mx = CX - 150;
        this.homeItem(mx, 302, MENU.startBattle, () => this.startBattle(), true);
        this.homeItem(mx, 360, MENU.battleSetup, () => this.showScreen('setup'));
        this.homeItem(mx, 418, MENU.pilot, () => this.startPilot());
        this.homeItem(mx, 476, MENU.watchReplay, () => this.openReplayDialog());
        this.homeItem(mx, 534, 'TOURNAMENT', () => this.scene.start('Tournament'));

        // Slim footer: flow links first, settings second.
        this.layoutFooterRow1();
        this.linkRow(
            720,
            [
                { label: soundLabel(isMuted()), onClick: () => this.toggleMute(), keep: (h) => { this.muteButton = h; } },
                { label: trailsLabel(this.trails), onClick: () => this.toggleTrails(), keep: (h) => { this.trailsButton = h; } },
                { label: colorLabel(isColorblind()), onClick: () => this.toggleColorblind(), keep: (h) => { this.colorButton = h; } },
                { label: motionLabel(isReducedMotion()), onClick: () => this.toggleMotion(), keep: (h) => { this.motionButton = h; } },
            ],
            [],
            this.navFooterSettings,
        );
    }

    /** Battle configuration screen: the old menu's working half, decluttered. */
    private buildSetup(): void {
        const L = this.setupLayer;
        // Heavier scrim: dense controls need the legibility.
        L.add(this.add.rectangle(CX, 384, 1024, 768, 0x06080b, 0.45));

        this.setupButton(84, 40, 110, 34, MENU.back, () => this.showScreen('home'), 0, 40, { tier: 'ghost' });
        L.add(this.add.text(CX, 40, MENU.battleSetup, FONTS.heading).setOrigin(0.5));

        // Mode controls.
        const modeDefs = [
            { label: MENU.modeLabels[0] ?? '1 v 1', size: 1 },
            { label: MENU.modeLabels[1] ?? '2 v 2', size: 2 },
            { label: MENU.modeLabels[2] ?? '3 v 3', size: 3 },
        ] as const;
        modeDefs.forEach((def, i) => {
            const btn = this.setupButton(CX - 220 + i * 220, 104, 200, 44, '', () => this.setMode(def.size));
            this.modeButtons.push(btn);
        });
        this.refreshModeLabels();

        // Arena + modifiers pickers.
        this.arenaButton = this.setupButton(CX - 170, 164, 320, 44, '', () => this.cycleArena());
        this.refreshArenaLabel();
        this.modsButton = this.setupButton(CX + 170, 164, 320, 44, '', () => this.openMods());
        this.refreshModsLabel();

        // Column headers for the slot table.
        const headers: Array<[number, string]> = [
            [100, MENU.headers.slot],
            [285, MENU.headers.callsign],
            [490, MENU.headers.robot],
            [646, MENU.headers.paint],
            [748, MENU.headers.finish],
            [885, MENU.headers.skills],
        ];
        for (const [x, label] of headers) L.add(this.add.text(x, 208, label, FONTS.monoSmall).setOrigin(0.5));

        this.rebuildSlots();

        // Robot description panel.
        L.add(makePanel(this, CX, 596, 880, 76));
        this.descText = this.add.text(CX - 424, 570, '', FONTS.small).setOrigin(0, 0);
        this.descText.setWordWrapWidth(848);
        L.add(this.descText);
        this.showDescription(0);

        // Bottom row: skins, battle, pilot.
        this.setupButton(CX - 290, 692, 270, 50, MENU.randomizeSkins, () => this.randomizeSkins(), 0, 0, { tier: 'ghost' });
        this.setupButton(CX, 692, 270, 50, MENU.startBattle, () => this.startBattle(), 0, 0, { tier: 'primary' });
        this.setupButton(CX + 290, 692, 270, 50, MENU.pilot, () => this.startPilot(), 0, 0, { tier: 'ghost' });
    }

    private overlayOpen(): boolean {
        return this.editorSlot >= 0 || this.statsObjects.length > 0 || this.modsObjects.length > 0 || this.tourMode !== 'none';
    }

    private restoreNav(): void {
        if (this.overlayOpen()) return;
        this.nav.replaceTargets(
            this.screen === 'home'
                ? [...this.navHome, ...this.navFooterFlow, ...this.navFooterSettings]
                : [...this.navBase, ...this.navSlots],
        );
    }

    // ---- Champion showcase entry + marquee ticker --------------------------
    private maybeAddShowcase(): void {
        if (this.showcaseAvailable) return;
        this.showcaseAvailable = true;
        this.layoutFooterRow1();
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
            return;
        }
        // On the setup screen, Escape backs out to the home list.
        if (this.screen === 'setup') this.showScreen('home');
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
        this.setupLayer.add(obj);
        return obj;
    }

    private cycler(x: number, w: number, y: number, label: string, onClick: () => void, color = COLORS.ink): void {
        this.navSlots.push({ x, y, w, h: 44, activate: onClick });
        const bg = this.track(this.add.rectangle(x, y, w, 44, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge));
        const text = this.track(this.add.text(x, y, label, FONTS.buttonSmall).setOrigin(0.5));
        text.setColor(color);
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => {
            bg.setStrokeStyle(2, COLORS.team[0]);
            playHover();
        });
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
        // Row 0 must clear the 16px headers at y=208 (bottom edge 216):
        // sprites are 32px tall, cyclers 44px. The 6-row step shrinks so
        // the last row still clears the description panel at y=558.
        const startY = rows <= 2 ? 252 : 240;
        const step = rows <= 2 ? 84 : rows <= 4 ? 64 : 58;
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
            // Finish preview, exactly as the battle renders it: Ring circle
            // (radius ROBOT_RADIUS + 6) or Stripe bar; Solid adds nothing.
            const sway: Phaser.GameObjects.GameObject[] = [preview, previewTower, previewHub];
            if (skin.finish === 'Ring') {
                const previewRing = this.track(this.add.graphics());
                previewRing.lineStyle(2, skin.paint, 0.85);
                previewRing.strokeCircle(152, y, 20);
                sway.push(previewRing);
            } else if (skin.finish === 'Stripe') {
                sway.push(this.track(this.add.rectangle(152, y, 26, 5, skin.paint)));
            }
            // Idle life: gentle preview sway via tween (no new MenuScene
            // update loop; frozen under reduced motion).
            if (!isReducedMotion()) {
                this.tweens.add({
                    targets: sway,
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
            this.cycler(885, 100, y, `${skillsButtonLabel(loadoutCost(loadout))}/${SKILL_BUDGET}`, () => this.openEditor(i), '#7de08a');
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
            this.trackEditor(addTouchHit(this, 640, y + 4, 52, 40, () => this.bumpSkill(def.id, -1), 50));
            targets.push({ x: 640, y: y + 4, w: 36, h: 30, activate: () => this.bumpSkill(def.id, -1) });
            const rankLabel = this.trackEditor(this.add.text(684, y + 4, rankText(rank, def.maxRank), FONTS.mono).setOrigin(0.5).setDepth(50));
            rankLabel.setColor(rank > 0 ? '#7de08a' : COLORS.dim);
            const plus = this.trackEditor(this.add.rectangle(740, y + 4, 36, 30, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(50));
            this.trackEditor(this.add.text(740, y + 4, COMMON.plus, FONTS.button).setOrigin(0.5).setDepth(50));
            plus.setInteractive({ useHandCursor: true });
            plus.on('pointerdown', () => this.bumpSkill(def.id, 1));
            this.trackEditor(addTouchHit(this, 740, y + 4, 52, 40, () => this.bumpSkill(def.id, 1), 50));
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
        this.trackTour(this.add.rectangle(CX, 384, 1024, 768, 0x06080b, 0.45).setDepth(60).setInteractive());
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
        // Escape from anywhere in the dialog (WATCH/CANCEL buttons included —
        // the input handler below stops propagation, so this never double-fires).
        overlay.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                this.closeReplayDialog();
            }
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
        // Escape from anywhere in the dialog (file input, slot select, and
        // buttons have no key handler of their own; keydown bubbles here).
        overlay.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                this.closeImportDialog();
            }
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
                // Keep the data even when the overlay closed mid-fetch; the
                // guards below only skip the re-render, so reopening ONLINE
                // shows the board instead of "unavailable" for the session.
                this.onlineBoard = result.board;
                this.onlineCached = result.cached;
                if (!this.scene.isActive('Menu')) return;
                if (token !== this.onlineToken || this.statsTab !== 'online' || this.statsObjects.length === 0) return;
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
        const toggle = (key: keyof MatchModifiers, on: boolean): void => {
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
            this.add.rectangle(CX, 550, 170, 40, COLORS.panel).setStrokeStyle(2, COLORS.team[0]).setDepth(50),
        );
        this.trackMods(this.add.text(CX, 550, COMMON.done, FONTS.buttonSmall).setOrigin(0.5).setDepth(50));
        done.setInteractive({ useHandCursor: true });
        done.on('pointerdown', () => this.closeMods());
        targets.push({ x: CX, y: 550, w: 170, h: 40, activate: () => this.closeMods() });
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
