// League scene: Season 1 standings, fighter cards (each with its full
// readable behavior tree — "read a fighter's mind"), rivalry matchups,
// highlights, and RA1 replay watching.
//
// RENDER-ONLY. Every label, record, tree and replay code comes from
// data/league/season1.json (plus the telemetry companion); nothing is
// hardcoded. No sim state, no randomness — scrolling and tweens only.

import * as Phaser from 'phaser';
import { Scene } from 'phaser';
import { isReducedMotion } from '../accessibility';
import { playClick, playHover, toggleMuted, unlockAudio } from '../audio';
import { MenuBanner } from '../banner';
import { COLORS, FONTS } from '../theme';
import { makeButton } from '../ui';
import { FocusNav, type NavTarget } from '../nav';
import { COMMON, LEAGUE } from '../strings';
import {
    ensureLeagueFighters,
    fighterById,
    fighterName,
    fighterStats,
    headToHead,
    matchesOf,
    resultFor,
    rivalryOf,
    season,
    standingOf,
    telemByMatch,
    watchLeagueReplay,
    wldLine,
    type LeagueMatch,
} from '../league';
import menuVistaUrl from '../../../docs/art-evidence/menu-backdrop-vista.webp?url';

const CX = 512;
const VIEW_X = 62;
const VIEW_W = 900;
const VIEW_Y = 186;
const VIEW_H = 506;

type Tab = 'standings' | 'fighters' | 'rivalries' | 'highlights';
type Detail = { kind: 'fighter'; id: string } | { kind: 'matchup'; a: string; b: string } | null;

/** Clamp-free scrollable viewport: wheel + drag, masked to the panel. */
class ScrollView {
    readonly view: Phaser.GameObjects.Container;
    private readonly y0: number;
    private readonly h: number;
    private sy = 0;
    private maxSy = 0;
    /** Fired when a wheel/drag scroll actually moves the view. */
    onScroll: (() => void) | null = null;

    constructor(scene: Scene, x: number, y: number, w: number, h: number) {
        this.y0 = y;
        this.h = h;
        this.view = scene.add.container(x, y).setDepth(2);
        // WebGL-safe clipping: GeometryMask.setMask is a deliberate no-op in
        // Phaser 4 WebGL, so opaque curtains color-matched to the rendered
        // panel (#0a0f15) hide scrolled content above/below the viewport.
        const curtain = 0x0a0f15;
        scene.add.rectangle(x + w / 2, y / 2, w, y, curtain).setDepth(2.5);
        scene.add.rectangle(x + w / 2, y + h + (768 - y - h) / 2, w, 768 - y - h, curtain).setDepth(2.5);
        // Drag zone sits behind the content so buttons keep priority.
        const zone = scene.add.zone(x + w / 2, y + h / 2, w, h).setInteractive().setDepth(1);
        let dragging = false;
        let lastY = 0;
        zone.on('pointerdown', (p: Phaser.Input.Pointer) => {
            dragging = true;
            lastY = p.y;
        });
        scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
            if (dragging && p.isDown) {
                this.scrollBy(lastY - p.y);
                lastY = p.y;
            }
        });
        scene.input.on('pointerup', () => {
            dragging = false;
        });
        scene.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
            this.scrollBy(dy * 0.6);
        });
    }

    setContentHeight(px: number): void {
        this.maxSy = Math.max(0, px - this.h);
        this.sy = Math.min(this.sy, this.maxSy);
        this.apply();
    }

    reset(): void {
        this.sy = 0;
        this.maxSy = 0;
        this.apply();
    }

    scrollBy(dy: number): void {
        const next = Phaser.Math.Clamp(this.sy + dy, 0, this.maxSy);
        if (next !== this.sy) {
            this.sy = next;
            this.apply();
            this.onScroll?.();
        }
    }

    get scrollY(): number {
        return this.sy;
    }

    /** Scroll just enough to bring a content rect (local coords) into view. */
    ensureVisible(localY: number, h: number): void {
        const pad = 28;
        let next = this.sy;
        if (localY - pad < this.sy) {
            next = Math.max(0, localY - pad);
        } else if (localY + h + pad > this.sy + this.h) {
            next = Math.min(this.maxSy, localY + h + pad - this.h);
        }
        if (next !== this.sy) {
            this.sy = next;
            this.apply();
        }
    }

    private apply(): void {
        this.view.y = this.y0 - this.sy;
    }
}

function fmt(n: number): string {
    return n.toLocaleString('en-US');
}

export class LeagueScene extends Scene {
    private tab: Tab = 'standings';
    private detail: Detail = null;
    private banner: MenuBanner | null = null;
    private scroller!: ScrollView;
    private nav!: FocusNav;
    private errorText!: Phaser.GameObjects.Text;
    private errorTimer: Phaser.Time.TimerEvent | null = null;

    constructor() {
        super('League');
    }

    preload(): void {
        this.load.image('menu_vista', menuVistaUrl);
    }

    create(): void {
        ensureLeagueFighters();
        this.tab = 'standings';
        this.detail = null;
        const reduced = isReducedMotion();
        this.nav = new FocusNav(this);
        this.nav.onEscape = () => this.onEscape();

        // Same night-arena vista as the menu, with a heavier scrim so the
        // data tables stay legible.
        if (this.textures.exists('menu_vista')) {
            const frame = this.textures.get('menu_vista').get();
            const s = frame.width > 0 ? Math.max(1024 / frame.width, 768 / frame.height) : 1;
            this.add.image(CX, 384, 'menu_vista').setScale(s).setDepth(-10);
        } else {
            this.add.rectangle(CX, 384, 1024, 768, 0x06080b).setDepth(-10);
        }
        this.add.rectangle(CX, 384, 1024, 768, 0x06080b, 0.45).setDepth(-9);

        // Extruded-gold title treatment, matching the menu banner.
        this.banner = new MenuBanner(this, this.add.container(0, 0).setDepth(3), CX, 62, reduced, LEAGUE.title);
        this.add.text(CX, 128, LEAGUE.subtitle, { ...FONTS.monoSmall, color: COLORS.goldCss }).setOrigin(0.5).setDepth(3);

        // Viewport panel.
        this.add.rectangle(CX, VIEW_Y + VIEW_H / 2, VIEW_W + 24, VIEW_H + 24, 0x0b0e12, 0.78).setDepth(0);
        this.add
            .rectangle(CX, VIEW_Y + VIEW_H / 2, VIEW_W + 24, VIEW_H + 24)
            .setStrokeStyle(2, COLORS.panelEdge)
            .setDepth(3);
        this.scroller = new ScrollView(this, VIEW_X, VIEW_Y, VIEW_W, VIEW_H);
        // Keyboard focus scrolls the view; the ring draws at the true
        // on-screen position.
        this.nav.getRingOffset = () => this.scroller.scrollY;
        this.nav.onMove = (t) => this.scroller.ensureVisible(t.y - VIEW_Y, t.h);
        // Mouse users take over from the keyboard: a manual scroll means the
        // focus ring no longer points at anything meaningful.
        this.scroller.onScroll = () => this.nav.hideRing();

        // Bottom strip: back to menu + transient error line.
        makeButton(this, 80, 732, 110, 36, COMMON.menu, () => this.scene.start('Menu'), 3, 44, { tier: 'ghost' });
        this.errorText = this.add
            .text(CX + 80, 732, '', { ...FONTS.monoSmall, color: COLORS.dangerCss })
            .setOrigin(0.5)
            .setDepth(3);

        this.input.keyboard?.on('keydown', this.onNavKey);
        this.input.keyboard?.on('keydown-M', this.onMuteKey);
        this.input.on('pointerdown', this.onAnyPointer);
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            this.input.keyboard?.off('keydown', this.onNavKey);
            this.input.keyboard?.off('keydown-M', this.onMuteKey);
        });

        this.render();
    }

    update(time: number): void {
        this.banner?.update(time);
    }

    private onNavKey = (event: KeyboardEvent): void => {
        const active = document.activeElement;
        if (active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement) {
            return;
        }
        this.nav.handleKey(event);
    };

    private onMuteKey = (): void => {
        unlockAudio();
        toggleMuted();
    };

    private onAnyPointer = (): void => {
        unlockAudio();
        playClick();
        this.nav.hideRing();
    };

    private onEscape(): void {
        if (this.detail !== null) {
            this.detail = null;
            this.render();
            return;
        }
        this.scene.start('Menu');
    }

    private showError(msg: string): void {
        this.errorText.setText(msg);
        this.errorTimer?.remove();
        this.errorTimer = this.time.delayedCall(3200, () => this.errorText.setText(''));
    }

    private onWatch(code: string): void {
        unlockAudio();
        playClick();
        const err = watchLeagueReplay(this.scene, code);
        if (err) {
            this.showError(err);
        }
    }

    // ---- Rendering ------------------------------------------------------

    private render(): void {
        this.scroller.view.removeAll(true);
        this.scroller.reset();
        const navTargets: NavTarget[] = [];
        let contentH = 0;
        if (this.detail?.kind === 'fighter') contentH = this.buildFighterDetail(this.detail.id, navTargets);
        else if (this.detail?.kind === 'matchup') contentH = this.buildMatchup(this.detail.a, this.detail.b, navTargets);
        else if (this.tab === 'standings') contentH = this.buildStandings(navTargets);
        else if (this.tab === 'fighters') contentH = this.buildFighters(navTargets);
        else if (this.tab === 'rivalries') contentH = this.buildRivalries(navTargets);
        else contentH = this.buildHighlights(navTargets);
        this.scroller.setContentHeight(contentH);
        this.nav.setTargets(navTargets);
    }

    private get c(): Phaser.GameObjects.Container {
        return this.scroller.view;
    }

    /** Tab links row; returns its height (also used as the detail header pad). */
    private buildTabs(navTargets: NavTarget[]): number {
        const tabs: Array<[Tab, string]> = [
            ['standings', LEAGUE.standings],
            ['fighters', LEAGUE.fighters],
            ['rivalries', LEAGUE.rivalries],
            ['highlights', LEAGUE.highlights],
        ];
        const y = 18;
        const centers = [162, 387, 612, 837];
        tabs.forEach(([key, label], i) => {
            const x = centers[i] as number;
            const active = this.detail === null && this.tab === key;
            const text = this.add
                .text(x, y, label, {
                    ...FONTS.heading,
                    color: active ? COLORS.goldCss : COLORS.faint,
                    fontSize: '14px',
                    letterSpacing: 4,
                })
                .setOrigin(0.5);
            if (active) {
                const bar = this.add.rectangle(x, y + 20, text.width + 24, 3, COLORS.gold);
                this.c.add(bar);
            }
            const hit = this.add.zone(x, y, text.width + 48, 40).setInteractive({ useHandCursor: true });
            const go = (): void => {
                unlockAudio();
                playClick();
                this.tab = key;
                this.detail = null;
                this.render();
            };
            hit.on('pointerover', () => {
                if (!active) text.setColor(COLORS.whiteCss);
                playHover();
            });
            hit.on('pointerout', () => {
                if (!active) text.setColor(COLORS.faint);
            });
            hit.on('pointerdown', go);
            this.c.add([text, hit]);
            navTargets.push({ x: VIEW_X + x, y: VIEW_Y + y, w: text.width + 48, h: 40, activate: go });
            if (i < tabs.length - 1) {
                const dia = this.add.rectangle(x + 112, y, 8, 8, COLORS.gold).setRotation(Math.PI / 4).setAlpha(0.6);
                const core = this.add.rectangle(x + 112, y, 3, 3, 0x35d0ff).setRotation(Math.PI / 4);
                this.c.add([dia, core]);
            }
        });
        return 52;
    }

    private standings(): { rank: number; id: string; name: string; w: number; l: number; d: number; elo: number }[] {
        return season.standings.map((s) => ({
            rank: s.rank,
            id: s.fighter,
            name: fighterName(s.fighter),
            w: s.wins,
            l: s.losses,
            d: s.draws,
            elo: s.elo,
        }));
    }

    private buildStandings(navTargets: NavTarget[]): number {
        let y = this.buildTabs(navTargets);
        const head = (x: number, label: string, origin: 0 | 1 = 0) =>
            this.c.add(this.add.text(x, y, label, { ...FONTS.monoSmall, color: COLORS.faint }).setOrigin(origin, 0.5));
        head(24, LEAGUE.colRank);
        head(84, LEAGUE.colFighter);
        head(560, LEAGUE.colW);
        head(640, LEAGUE.colL);
        head(720, LEAGUE.colD);
        head(876, LEAGUE.colElo, 1);
        y += 30;
        this.c.add(this.add.rectangle(VIEW_W / 2, y - 12, VIEW_W - 32, 1, COLORS.panelEdge));
        for (const row of this.standings()) {
            const cy = y + 16;
            const hot = this.add.rectangle(VIEW_W / 2, cy, VIEW_W - 16, 30, COLORS.panelHover, 0).setDepth(0);
            const rankColor = row.rank <= 3 ? COLORS.goldCss : COLORS.ink;
            const nameColor = row.rank <= 3 ? COLORS.goldCss : COLORS.whiteCss;
            const objs = [
                hot,
                this.add.text(24, cy, `${row.rank}`, { ...FONTS.mono, color: rankColor }).setOrigin(0, 0.5),
                this.add.text(84, cy, row.name.toUpperCase(), { ...FONTS.mono, color: nameColor }).setOrigin(0, 0.5),
                this.add.text(560, cy, `${row.w}`, FONTS.mono).setOrigin(0, 0.5),
                this.add.text(640, cy, `${row.l}`, FONTS.mono).setOrigin(0, 0.5),
                this.add.text(720, cy, `${row.d}`, FONTS.mono).setOrigin(0, 0.5),
                this.add.text(876, cy, `${row.elo}`, { ...FONTS.mono, color: COLORS.goldCss }).setOrigin(1, 0.5),
            ];
            const hit = this.add.zone(VIEW_W / 2, cy, VIEW_W - 16, 30).setInteractive({ useHandCursor: true });
            const id = row.id;
            const go = (): void => {
                unlockAudio();
                playClick();
                this.detail = { kind: 'fighter', id };
                this.render();
            };
            hit.on('pointerover', () => hot.setAlpha(0.9));
            hit.on('pointerout', () => hot.setAlpha(0));
            hit.on('pointerdown', go);
            this.c.add([...objs, hit]);
            navTargets.push({
                x: VIEW_X + VIEW_W / 2,
                y: VIEW_Y + cy,
                w: VIEW_W - 16,
                h: 30,
                activate: go,
            });
            y += 32;
        }
        return y + 12;
    }

    private buildFighters(navTargets: NavTarget[]): number {
        let y = this.buildTabs(navTargets);
        for (const s of season.standings) {
            const f = fighterById(s.fighter);
            if (!f) continue;
            const cy = y + 34;
            const bg = this.add.rectangle(VIEW_W / 2, cy, VIEW_W - 16, 64, COLORS.panel, 0.9).setStrokeStyle(1, COLORS.panelEdge);
            const hot = this.add.rectangle(VIEW_W / 2, cy, VIEW_W - 16, 64, COLORS.panelHover, 0);
            const nameColor = s.rank <= 3 ? COLORS.goldCss : COLORS.whiteCss;
            const objs = [
                bg,
                hot,
                this.add.text(28, cy - 14, f.name.toUpperCase(), { ...FONTS.heading, color: nameColor }).setOrigin(0, 0.5),
                this.add.text(28, cy + 14, f.id, { ...FONTS.monoSmall, color: COLORS.faint }).setOrigin(0, 0.5),
                this.add.text(560, cy, wldLine(s), FONTS.mono).setOrigin(0, 0.5),
                this.add.text(700, cy, `${s.elo} ELO`, { ...FONTS.mono, color: COLORS.goldCss }).setOrigin(0, 0.5),
                this.add.text(872, cy, `#${s.rank}`, { ...FONTS.monoSmall, color: COLORS.faint }).setOrigin(1, 0.5),
            ];
            const hit = this.add.zone(VIEW_W / 2, cy, VIEW_W - 16, 64).setInteractive({ useHandCursor: true });
            const id = f.id;
            const go = (): void => {
                unlockAudio();
                playClick();
                this.detail = { kind: 'fighter', id };
                this.render();
            };
            hit.on('pointerover', () => {
                hot.setAlpha(0.9);
                playHover();
            });
            hit.on('pointerout', () => hot.setAlpha(0));
            hit.on('pointerdown', go);
            this.c.add([...objs, hit]);
            navTargets.push({
                x: VIEW_X + VIEW_W / 2,
                y: VIEW_Y + cy,
                w: VIEW_W - 16,
                h: 64,
                activate: go,
            });
            y += 72;
        }
        return y + 8;
    }

    private buildRivalries(navTargets: NavTarget[]): number {
        let y = this.buildTabs(navTargets);
        for (const r of season.rivalries) {
            const a = fighterName(r.a);
            const b = fighterName(r.b);
            const note = this.add.text(28, 0, r.note, { ...FONTS.small, color: COLORS.dim });
            note.setWordWrapWidth(VIEW_W - 220);
            const noteH = note.height;
            const cardH = Math.max(108, noteH + 64);
            const cy = y + cardH / 2;
            const bg = this.add.rectangle(VIEW_W / 2, cy, VIEW_W - 16, cardH, COLORS.panel, 0.9).setStrokeStyle(1, COLORS.panelEdge);
            note.setY(cy - cardH / 2 + 44);
            const title = this.add
                .text(28, cy - cardH / 2 + 18, `${a.toUpperCase()}  vs  ${b.toUpperCase()}`, {
                    ...FONTS.heading,
                    color: COLORS.goldCss,
                })
                .setOrigin(0, 0.5);
            const rec = this.add
                .text(VIEW_W - 196, cy - cardH / 2 + 18, r.record, { ...FONTS.mono, color: COLORS.ink })
                .setOrigin(0, 0.5);
            const goMatchup = (): void => {
                unlockAudio();
                playClick();
                this.detail = { kind: 'matchup', a: r.a, b: r.b };
                this.render();
            };
            makeButton(this, VIEW_W - 96, cy, 120, 36, LEAGUE.viewMatchup, goMatchup, 3, 44, { container: this.c });
            this.c.add([bg, title, rec, note]);
            navTargets.push({
                x: VIEW_X + (VIEW_W - 96),
                y: VIEW_Y + cy,
                w: 120,
                h: 36,
                activate: goMatchup,
            });
            y += cardH + 12;
        }
        return y + 8;
    }

    private buildHighlights(navTargets: NavTarget[]): number {
        let y = this.buildTabs(navTargets);
        for (const h of season.highlights) {
            const note = this.add.text(28, 0, h.note, { ...FONTS.small, color: COLORS.dim });
            note.setWordWrapWidth(VIEW_W - 220);
            const cardH = Math.max(116, note.height + 72);
            const cy = y + cardH / 2;
            const bg = this.add.rectangle(VIEW_W / 2, cy, VIEW_W - 16, cardH, COLORS.panel, 0.9).setStrokeStyle(1, COLORS.panelEdge);
            note.setY(cy - cardH / 2 + 52);
            const title = this.add
                .text(28, cy - cardH / 2 + 22, h.title.toUpperCase(), { ...FONTS.heading, color: COLORS.goldCss })
                .setOrigin(0, 0.5);
            const mid = this.add
                .text(28, cy + cardH / 2 - 20, h.match.toUpperCase(), { ...FONTS.monoSmall, color: COLORS.faint })
                .setOrigin(0, 0.5);
            const replay = h.replay;
            const goWatch = (): void => this.onWatch(replay);
            makeButton(this, VIEW_W - 96, cy, 120, 36, LEAGUE.watch, goWatch, 3, 44, {
                tier: 'primary',
                container: this.c,
            });
            this.c.add([bg, title, note, mid]);
            navTargets.push({
                x: VIEW_X + (VIEW_W - 96),
                y: VIEW_Y + cy,
                w: 120,
                h: 36,
                activate: goWatch,
            });
            y += cardH + 12;
        }
        return y + 8;
    }

    // ---- Fighter detail: "read a fighter's mind" --------------------------

    private backButton(y: number, navTargets: NavTarget[]): void {
        const go = (): void => {
            unlockAudio();
            playClick();
            this.detail = null;
            this.render();
        };
        makeButton(this, 76, y, 110, 32, LEAGUE.back, go, 3, 44, { tier: 'ghost', container: this.c });
        navTargets.push({ x: VIEW_X + 76, y: VIEW_Y + y, w: 110, h: 32, activate: go });
    }

    private buildFighterDetail(id: string, navTargets: NavTarget[]): number {
        const f = fighterById(id);
        const s = standingOf(id);
        if (!f || !s) return 60;
        const stats = fighterStats(id);
        let y = 8;
        this.backButton(y + 16, navTargets);
        y += 56;
        const nameColor = s.rank <= 3 ? COLORS.goldCss : COLORS.whiteCss;
        this.c.add(
            this.add.text(28, y, f.name.toUpperCase(), { ...FONTS.title, fontSize: '24px', color: nameColor }).setOrigin(0, 0),
        );
        y += 44;
        this.c.add(
            this.add.text(
                28,
                y,
                `#${s.rank}  |  ${wldLine(s)}  |  ${s.elo} ELO  |  ${f.id}`,
                { ...FONTS.mono, color: COLORS.dim },
            ).setOrigin(0, 0),
        );
        y += 34;
        this.c.add(
            this.add.text(
                28,
                y,
                `KOS ${stats.kos}   AVG TICKS ${fmt(stats.avgTicks)}   AVG DMG ${stats.avgDmg}   SUDDEN DEATHS ${stats.suddenDeaths}   COMEBACKS ${stats.comebacks}`,
                { ...FONTS.monoSmall, color: COLORS.goldCss },
            ).setOrigin(0, 0),
        );
        y += 36;
        this.c.add(this.add.rectangle(VIEW_W / 2, y, VIEW_W - 32, 1, COLORS.panelEdge));
        y += 18;
        this.c.add(
            this.add.text(28, y, LEAGUE.readMind, { ...FONTS.heading, color: COLORS.goldCss, fontSize: '14px' }).setOrigin(0, 0),
        );
        y += 30;
        const treeText = this.add.text(28, y, f.tree, { ...FONTS.mono, color: COLORS.ink }).setOrigin(0, 0);
        this.c.add(treeText);
        y += Math.ceil(treeText.height) + 20;
        this.c.add(this.add.rectangle(VIEW_W / 2, y, VIEW_W - 32, 1, COLORS.panelEdge));
        y += 18;
        this.c.add(
            this.add.text(28, y, `${LEAGUE.matches} (${stats.matches})`, {
                ...FONTS.heading,
                color: COLORS.goldCss,
                fontSize: '14px',
            }).setOrigin(0, 0),
        );
        y += 34;
        for (const m of matchesOf(id)) {
            const opp = m.a === id ? m.b : m.a;
            const res = resultFor(m, id);
            const t = telemByMatch.get(m.id);
            const cy = y + 17;
            const resColor = res === 'W' ? COLORS.accentCss : res === 'L' ? COLORS.dangerCss : COLORS.dim;
            const detail = t
                ? `${t.arena}  |  ${fmt(t.ticks)} ticks${t.suddenDeath ? '  |  SUDDEN DEATH' : ''}  |  margin ${t.hpMargin}`
                : m.id.toUpperCase();
            const objs = [
                this.add.text(28, cy, `vs ${fighterName(opp).toUpperCase()}`, FONTS.mono).setOrigin(0, 0.5),
                this.add.text(300, cy, res, { ...FONTS.mono, color: resColor }).setOrigin(0, 0.5),
                this.add.text(340, cy, detail, { ...FONTS.monoSmall, color: COLORS.faint }).setOrigin(0, 0.5),
            ];
            const replay = m.replay;
            const goWatch = (): void => this.onWatch(replay);
            makeButton(this, VIEW_W - 76, cy, 96, 28, LEAGUE.watch, goWatch, 3, 44, {
                container: this.c,
            });
            this.c.add(objs);
            navTargets.push({
                x: VIEW_X + (VIEW_W - 76),
                y: VIEW_Y + cy,
                w: 96,
                h: 28,
                activate: goWatch,
            });
            y += 36;
        }
        return y + 12;
    }

    // ---- Matchup: head-to-head of a rivalry --------------------------------

    private buildMatchup(a: string, b: string, navTargets: NavTarget[]): number {
        let y = 8;
        this.backButton(y + 16, navTargets);
        y += 56;
        const r = rivalryOf(a, b);
        this.c.add(
            this.add.text(28, y, `${fighterName(a).toUpperCase()}  vs  ${fighterName(b).toUpperCase()}`, {
                ...FONTS.title,
                fontSize: '22px',
                color: COLORS.goldCss,
            }).setOrigin(0, 0),
        );
        y += 44;
        if (r) {
            this.c.add(
                this.add.text(28, y, `SEASON SPLIT ${r.record}`, { ...FONTS.mono, color: COLORS.dim }).setOrigin(0, 0),
            );
            y += 30;
            const note = this.add.text(28, y, r.note, { ...FONTS.small, color: COLORS.dim }).setOrigin(0, 0);
            note.setWordWrapWidth(VIEW_W - 56);
            this.c.add(note);
            y += Math.ceil(note.height) + 20;
        }
        const legs = headToHead(a, b);
        legs.forEach((m: LeagueMatch, i: number) => {
            const t = telemByMatch.get(m.id);
            const cardH = 104;
            const cy = y + cardH / 2;
            const bg = this.add.rectangle(VIEW_W / 2, cy, VIEW_W - 16, cardH, COLORS.panel, 0.9).setStrokeStyle(1, COLORS.panelEdge);
            const winner = fighterName(m.winner).toUpperCase();
            const loser = fighterName(m.winner === m.a ? m.b : m.a).toUpperCase();
            const meta = t
                ? `${t.arena}  |  ${fmt(t.ticks)} ticks${t.suddenDeath ? '  |  SUDDEN DEATH' : ''}  |  margin ${t.hpMargin} HP`
                : m.id.toUpperCase();
            const title = this.add
                .text(28, cy - 26, `${i === 0 ? LEAGUE.leg1 : LEAGUE.leg2}  ·  ${m.id.toUpperCase()}`, {
                    ...FONTS.monoSmall,
                    color: COLORS.faint,
                })
                .setOrigin(0, 0.5);
            const line = this.add
                .text(28, cy + 4, `${winner}  def.  ${loser}`, { ...FONTS.heading, color: COLORS.goldCss })
                .setOrigin(0, 0.5);
            const sub = this.add.text(28, cy + 30, meta, { ...FONTS.monoSmall, color: COLORS.dim }).setOrigin(0, 0.5);
            const replay = m.replay;
            const goWatch = (): void => this.onWatch(replay);
            makeButton(this, VIEW_W - 96, cy, 120, 36, LEAGUE.watch, goWatch, 3, 44, {
                tier: 'primary',
                container: this.c,
            });
            this.c.add([bg, title, line, sub]);
            navTargets.push({
                x: VIEW_X + (VIEW_W - 96),
                y: VIEW_Y + cy,
                w: 120,
                h: 36,
                activate: goWatch,
            });
            y += cardH + 12;
        });
        return y + 8;
    }
}
