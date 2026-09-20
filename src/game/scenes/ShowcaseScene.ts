// Showcase scene: champion gallery (TournamentScene pattern) with a
// before/after compare overlay, featured-replay reels, base-vs-champion
// rematches, and an online-board tab. Driven by the static showcase
// manifest; shows an empty state (never dead UI) when none shipped.

import { Scene } from 'phaser';
import { getRobot } from '../../robots/registry';
import type { ArenaId } from '../../sim/constants';
import { decodeReplay } from '../../sim/replay';
import { loadoutCode, type SkillLoadout } from '../../sim/skills';
import { playClick, toggleMuted, unlockAudio } from '../audio';
import { CALLSIGNS, defaultSkin } from '../customize';
import { fetchOnlineBoard, type OnlineBoard } from '../onlineBoard';
import { loadShowcase, type ShowcaseChampion, type ShowcaseManifest } from '../showcase';
import {
    bracketedLabel,
    COMMON,
    ONLINE,
    onlineRow,
    onlineSummary,
    SHOWCASE,
    showcaseRateLine,
    showcaseRecord,
    showcaseReplayLine,
    statsAndMore,
    statsPct,
} from '../strings';
import { COLORS, FONTS } from '../theme';
import { makeButton, type Button } from '../ui';
import type { BattleRequest } from './MenuScene';

const CX = 512;
const CARD_W = 480;
const CARD_H = 130;
/** Board rows shown before the overflow marker (17 threats fit anyway). */
const BOARD_ROWS = 17;

export class ShowcaseScene extends Scene {
    private tab: 'gallery' | 'board' = 'gallery';
    private manifest: ShowcaseManifest | null = null;
    private manifestTried = false;
    private board: OnlineBoard | null = null;
    private boardCached = false;
    private boardTried = false;
    private boardToken = 0;
    private frameObjects: Phaser.GameObjects.GameObject[] = [];
    private tabObjects: Phaser.GameObjects.GameObject[] = [];
    private cardButtons: Button[] = [];
    private overlayObjects: Phaser.GameObjects.GameObject[] = [];
    private tabButtons: Button[] = [];
    private compareId: string | null = null;

    constructor() {
        super('Showcase');
    }

    create(): void {
        this.tab = 'gallery';
        this.manifest = null;
        this.manifestTried = false;
        this.board = null;
        this.boardCached = false;
        this.boardTried = false;
        this.boardToken += 1;
        this.frameObjects = [];
        this.tabObjects = [];
        this.cardButtons = [];
        this.overlayObjects = [];
        this.tabButtons = [];
        this.compareId = null;
        this.buildFrame();
        this.renderTab();
        void loadShowcase().then((manifest) => {
            this.manifest = manifest;
            this.manifestTried = true;
            if (this.compareId === null) this.renderTab();
        });
        this.input.on('pointerdown', this.onAnyPointer);
        this.input.keyboard?.on('keydown-M', this.onMuteKey);
        this.input.keyboard?.on('keydown-ESC', this.onEscapeKey);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown-M', this.onMuteKey);
            this.input.keyboard?.off('keydown-ESC', this.onEscapeKey);
        });
    }

    private onAnyPointer = (): void => {
        unlockAudio();
        playClick();
    };

    private onMuteKey = (): void => {
        unlockAudio();
        toggleMuted();
    };

    private onEscapeKey = (): void => {
        if (this.compareId !== null) this.closeCompare();
        else this.scene.start('Menu');
    };

    // ---- Frame + tabs -----------------------------------------------------
    private trackFrame<T extends Phaser.GameObjects.GameObject>(obj: T): T {
        this.frameObjects.push(obj);
        return obj;
    }

    private trackTab<T extends Phaser.GameObjects.GameObject>(obj: T): T {
        this.tabObjects.push(obj);
        return obj;
    }

    private buildFrame(): void {
        this.trackFrame(this.add.text(CX, 40, SHOWCASE.title, FONTS.title).setOrigin(0.5));
        this.trackFrame(this.add.text(CX, 82, SHOWCASE.subtitle, FONTS.small).setOrigin(0.5));
        const gallery = makeButton(this, CX - 120, 124, 200, 36, '', () => this.setTab('gallery'));
        const board = makeButton(this, CX + 120, 124, 200, 36, '', () => this.setTab('board'));
        this.tabButtons = [gallery, board];
        this.refreshTabLabels();
        makeButton(this, CX, 740, 200, 36, COMMON.menu, () => this.scene.start('Menu'));
    }

    private refreshTabLabels(): void {
        this.tabButtons[0]?.setLabel(bracketedLabel(SHOWCASE.galleryTab, this.tab === 'gallery'));
        this.tabButtons[1]?.setLabel(bracketedLabel(SHOWCASE.boardTab, this.tab === 'board'));
    }

    private setTab(tab: 'gallery' | 'board'): void {
        if (this.tab === tab) return;
        this.tab = tab;
        this.closeCompare();
        this.refreshTabLabels();
        this.renderTab();
    }

    private clearTab(): void {
        for (const obj of this.tabObjects) obj.destroy();
        this.tabObjects = [];
        for (const btn of this.cardButtons) btn.destroy();
        this.cardButtons = [];
    }

    private renderTab(): void {
        this.clearTab();
        if (this.tab === 'gallery') this.renderGallery();
        else this.renderBoard();
    }

    // ---- Gallery ----------------------------------------------------------
    private renderGallery(): void {
        if (!this.manifestTried) return;
        const manifest = this.manifest;
        if (!manifest || manifest.champions.length === 0) {
            this.trackTab(this.add.text(CX, 400, SHOWCASE.noData, FONTS.body).setOrigin(0.5));
            return;
        }
        manifest.champions.forEach((champ, i) => {
            const col = i % 2;
            const row = Math.floor(i / 2);
            const x = col === 0 ? CX - 256 : CX + 256;
            const y = 225 + row * 140;
            this.renderCard(champ, x, y);
        });
    }

    private renderCard(champ: ShowcaseChampion, x: number, y: number): void {
        const entry = getRobot(champ.botId);
        const name = (entry?.meta.name ?? champ.botId).toUpperCase();
        this.trackTab(this.add.rectangle(x, y, CARD_W, CARD_H, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge));
        this.trackTab(this.add.text(x - 225, y - 48, name, FONTS.heading).setOrigin(0, 0.5));
        const rate = this.trackTab(
            this.add.text(x - 225, y - 22, showcaseRateLine(champ.stats.before.winRate, champ.stats.after.winRate), FONTS.mono).setOrigin(0, 0.5),
        );
        rate.setColor(COLORS.goldCss);
        const boardLine = champ.board ? onlineRow(champ.board.elo, champ.board.wins, champ.board.losses, champ.board.draws) : SHOWCASE.unrated;
        this.trackTab(this.add.text(x - 225, y + 2, boardLine, FONTS.monoSmall).setOrigin(0, 0.5));
        const by = y + 40;
        this.cardButtons.push(
            makeButton(this, x - 150, by, 150, 30, SHOWCASE.watchReel, () => this.watchReel(champ)),
            makeButton(this, x + 10, by, 170, 30, SHOWCASE.versus, () => this.watchVersus(champ)),
            makeButton(this, x + 160, by, 110, 30, SHOWCASE.compare, () => this.openCompare(champ.botId)),
        );
    }

    // ---- Compare overlay --------------------------------------------------
    private openCompare(botId: string): void {
        const champ = this.manifest?.champions.find((c) => c.botId === botId);
        if (!champ) return;
        this.closeCompare();
        this.compareId = botId;
        const track = <T extends Phaser.GameObjects.GameObject>(obj: T): T => {
            this.overlayObjects.push(obj);
            return obj;
        };
        track(this.add.rectangle(CX, 384, 1024, 768, 0x06080b, 0.85).setDepth(50).setInteractive());
        track(this.add.rectangle(CX, 384, 760, 600, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(50));
        const entry = getRobot(champ.botId);
        track(this.add.text(CX, 118, (entry?.meta.name ?? champ.botId).toUpperCase(), FONTS.heading).setOrigin(0.5).setDepth(50));
        // Before/after columns.
        const cols: Array<{ title: string; loadout: SkillLoadout; wins: number; losses: number; draws: number; games: number; winRate: number; x: number }> = [
            { title: SHOWCASE.beforeTitle, loadout: champ.seedLoadout, ...champ.stats.before, x: CX - 185 },
            { title: SHOWCASE.afterTitle, loadout: champ.champLoadout, ...champ.stats.after, x: CX + 185 },
        ];
        for (const col of cols) {
            track(this.add.text(col.x, 158, col.title, FONTS.buttonSmall).setOrigin(0.5).setDepth(50));
            track(
                this.add
                    .text(col.x, 184, `${SHOWCASE.buildLabel}: ${loadoutCode(col.loadout)}`, FONTS.monoSmall)
                    .setOrigin(0.5)
                    .setDepth(50),
            );
            track(
                this.add
                    .text(col.x, 206, `${SHOWCASE.recordLabel}: ${showcaseRecord(col.wins, col.losses, col.draws, col.games)}`, FONTS.monoSmall)
                    .setOrigin(0.5)
                    .setDepth(50),
            );
            const rate = track(this.add.text(col.x, 230, statsPct(col.games, col.winRate), FONTS.mono).setOrigin(0.5).setDepth(50));
            rate.setColor(COLORS.goldCss);
        }
        // Featured replays.
        track(this.add.text(CX, 272, SHOWCASE.replaysTitle, FONTS.buttonSmall).setOrigin(0.5).setDepth(50));
        champ.featuredReplays.forEach((rep, i) => {
            const y = 300 + i * 30;
            const bg = track(this.add.rectangle(CX, y, 680, 26, COLORS.panel).setStrokeStyle(1, COLORS.panelEdge).setDepth(50));
            track(this.add.text(CX - 325, y, showcaseReplayLine(rep.label, rep.outcome), FONTS.monoSmall).setOrigin(0, 0.5).setDepth(50));
            bg.setInteractive({ useHandCursor: true });
            bg.on('pointerover', () => bg.setStrokeStyle(1, COLORS.team[0]));
            bg.on('pointerout', () => bg.setStrokeStyle(1, COLORS.panelEdge));
            bg.on('pointerdown', () => this.watchCode(rep.code, champ.botId));
        });
        const listEnd = 300 + champ.featuredReplays.length * 30;
        const mkOverlay = (x: number, label: string, onClick: () => void): void => {
            const bg = track(this.add.rectangle(x, listEnd + 44, 200, 40, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(50));
            track(this.add.text(x, listEnd + 44, label, FONTS.button).setOrigin(0.5).setDepth(50));
            bg.setInteractive({ useHandCursor: true });
            bg.on('pointerover', () => bg.setStrokeStyle(2, COLORS.team[0]));
            bg.on('pointerout', () => bg.setStrokeStyle(2, COLORS.panelEdge));
            bg.on('pointerdown', onClick);
        };
        mkOverlay(CX - 220, SHOWCASE.watchReel, () => this.watchReel(champ));
        mkOverlay(CX, SHOWCASE.versus, () => this.watchVersus(champ));
        mkOverlay(CX + 220, SHOWCASE.close, () => this.closeCompare());
    }

    private closeCompare(): void {
        for (const obj of this.overlayObjects) obj.destroy();
        this.overlayObjects = [];
        this.compareId = null;
    }

    // ---- Board tab --------------------------------------------------------
    private renderBoard(): void {
        if (!this.boardTried) {
            this.boardTried = true;
            const token = ++this.boardToken;
            this.trackTab(this.add.text(CX, 400, ONLINE.loading, FONTS.body).setOrigin(0.5));
            void fetchOnlineBoard().then((result) => {
                if (token !== this.boardToken || this.tab !== 'board') return;
                this.board = result.board;
                this.boardCached = result.cached;
                this.renderTab();
            });
            return;
        }
        const board = this.board;
        if (!board) {
            this.trackTab(this.add.text(CX, 400, ONLINE.unavailable, FONTS.body).setOrigin(0.5));
            return;
        }
        const rows = [...board.entries].sort((a, b) => b.elo - a.elo || (a.botId < b.botId ? -1 : 1));
        this.trackTab(this.add.text(CX, 168, onlineSummary(board.season, rows.length), FONTS.mono).setOrigin(0.5));
        if (this.boardCached) {
            this.trackTab(this.add.text(CX, 190, ONLINE.cachedNote, FONTS.monoSmall).setOrigin(0.5));
        }
        if (rows.length === 0) {
            this.trackTab(this.add.text(CX, 400, ONLINE.empty, FONTS.body).setOrigin(0.5));
            return;
        }
        const shown = rows.slice(0, BOARD_ROWS);
        shown.forEach((row, i) => {
            const y = 216 + i * 26;
            const name = (getRobot(row.botId)?.meta.name ?? row.botId).toUpperCase();
            const rank = `${i + 1}. ${name}`;
            const nameText = this.trackTab(this.add.text(CX - 330, y, rank, FONTS.buttonSmall).setOrigin(0, 0.5));
            nameText.setColor(COLORS.ink);
            this.trackTab(this.add.text(CX + 180, y, onlineRow(row.elo, row.wins, row.losses, row.draws), FONTS.mono).setOrigin(1, 0.5));
            if (row.showcaseCode !== '') {
                const bg = this.trackTab(this.add.rectangle(CX + 250, y, 110, 22, COLORS.panel).setStrokeStyle(1, COLORS.panelEdge));
                this.trackTab(this.add.text(CX + 250, y, ONLINE.watch, FONTS.buttonSmall).setOrigin(0.5));
                bg.setInteractive({ useHandCursor: true });
                bg.on('pointerover', () => bg.setStrokeStyle(1, COLORS.team[0]));
                bg.on('pointerout', () => bg.setStrokeStyle(1, COLORS.panelEdge));
                bg.on('pointerdown', () => this.watchCode(row.showcaseCode, row.botId));
            }
        });
        if (rows.length > shown.length) {
            this.trackTab(this.add.text(CX, 216 + shown.length * 26, statsAndMore(rows.length - shown.length), FONTS.monoSmall).setOrigin(0.5));
        }
    }

    // ---- Launchers --------------------------------------------------------
    private skinsFor(count: number, teamSize: number): BattleRequest['skins'] {
        return Array.from({ length: count }, (_, i) => defaultSkin(CALLSIGNS[i % CALLSIGNS.length] as string, i, (i < teamSize ? 0 : 1) as 0 | 1));
    }

    /** Single featured-code watch (showcase battle, EXIT returns here). */
    private watchCode(code: string, botId: string): void {
        const data = decodeReplay(code);
        if (!data) return;
        for (const id of data.lineupIds) {
            if (!getRobot(id)) return;
        }
        this.scene.start('Battle', {
            teamSize: data.teamSize,
            lineupIds: [...data.lineupIds],
            loadouts: data.loadouts.map((l) => ({ ...l })),
            skins: this.skinsFor(data.lineupIds.length, data.teamSize),
            trails: true,
            seed: data.seed,
            arena: (data.arena ?? 'open') as ArenaId,
            modifiers: data.modifiers ?? {},
            showcase: { botId },
        } satisfies BattleRequest);
    }

    /** Reel watch: steps every featured code with NEXT/EXIT + auto-advance. */
    private watchReel(champ: ShowcaseChampion): void {
        const first = champ.featuredReplays[0];
        if (!first) return;
        const data = decodeReplay(first.code);
        if (!data) return;
        for (const id of data.lineupIds) {
            if (!getRobot(id)) return;
        }
        this.scene.start('Battle', {
            teamSize: data.teamSize,
            lineupIds: [...data.lineupIds],
            loadouts: data.loadouts.map((l) => ({ ...l })),
            skins: this.skinsFor(data.lineupIds.length, data.teamSize),
            trails: true,
            seed: data.seed,
            arena: (data.arena ?? 'open') as ArenaId,
            modifiers: data.modifiers ?? {},
            showcase: { botId: champ.botId, reel: { codes: champ.featuredReplays.map((r) => r.code), index: 0 } },
        } satisfies BattleRequest);
    }

    /**
     * VS battle: the base archetype on its seed loadout against the champion
     * on its tuned loadout. An explicit two-loadout request — no modifier.
     */
    private watchVersus(champ: ShowcaseChampion): void {
        if (!getRobot(champ.baseBot) || !getRobot(champ.botId)) return;
        this.scene.start('Battle', {
            teamSize: 1,
            lineupIds: [champ.baseBot, champ.botId],
            loadouts: [{ ...champ.seedLoadout }, { ...champ.champLoadout }],
            skins: this.skinsFor(2, 1),
            trails: true,
            seed: (Math.random() * 0x7fffffff) | 0,
            arena: 'open',
            modifiers: {},
            showcase: { botId: champ.botId },
        } satisfies BattleRequest);
    }
}
