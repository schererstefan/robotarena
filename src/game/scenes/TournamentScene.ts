// Tournament scene: single-elim bracket (4/8 bots) of bot-vs-bot matches.
// Each match plays out visibly in the Battle scene; the live bracket rides
// in the tournament session store across the transition. SIM REST settles
// the remaining matches headless for a quick result.

import { Scene } from 'phaser';
import { getRobot, ROBOTS } from '../../robots/registry';
import { Match } from '../../sim/engine';
import { loadoutCode } from '../../sim/skills';
import { unlockAudio, playClick, playHover, toggleMuted } from '../audio';
import { CALLSIGNS, defaultSkin } from '../customize';
import {
    bracketedLabel,
    bracketResultText,
    championLabel,
    COMMON,
    cyclerLabel,
    liveStatusText,
    TOURNAMENT,
    tourneySeedLabel,
} from '../strings';
import { COLORS, FONTS } from '../theme';
import {
    clearTournamentSession,
    initialRound,
    loadTournamentSession,
    nextRound,
    roundName,
    saveTournamentSession,
    tiebreakWinner,
    type BracketMatch,
} from '../tournament';
import { transition } from '../ui';
import type { BattleRequest } from './MenuScene';

const CX = 512;
const DEFAULT_8 = ['rusher', 'turret', 'orbiter', 'wanderer', 'hunter', 'rusher', 'turret', 'orbiter'];

interface LiveMatch {
    match: Match;
    round: number;
    index: number;
}

export class TournamentScene extends Scene {
    private size: 4 | 8 = 4;
    private entrants: string[] = [...DEFAULT_8.slice(0, 4)];
    private mode: 'setup' | 'running' | 'done' = 'setup';
    private rounds: BracketMatch[][] = [];
    private live: LiveMatch | null = null;
    private seedBase = 0;
    private matchCounter = 0;
    private setupObjects: Phaser.GameObjects.GameObject[] = [];
    private entrantObjects: Phaser.GameObjects.GameObject[] = [];
    private bracketObjects: Phaser.GameObjects.GameObject[] = [];
    private sizeButtons: Array<{ setLabel: (label: string) => void }> = [];
    private statusText: Phaser.GameObjects.Text | null = null;
    private autoWatch = false;
    private pendingAutoWatch = false;

    constructor() {
        super('Tournament');
    }

    init(data?: { autoWatch?: boolean }): void {
        this.autoWatch = data?.autoWatch === true;
    }

    create(): void {
        this.size = 4;
        this.entrants = [...DEFAULT_8.slice(0, 4)];
        this.mode = 'setup';
        this.rounds = [];
        this.live = null;
        this.seedBase = 0;
        this.matchCounter = 0;
        this.setupObjects = [];
        this.entrantObjects = [];
        this.bracketObjects = [];
        this.sizeButtons = [];
        this.statusText = null;
        this.pendingAutoWatch = false;
        if (!this.resumeSession()) {
            this.buildSetup();
        }
        this.input.on('pointerdown', this.onAnyPointer);
        this.input.keyboard?.on('keydown-M', this.onMuteKey);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown-M', this.onMuteKey);
        });
    }

    update(): void {
        // NEXT auto-watches from the results screen: launch one frame after
        // the bracket rebuild so the scene transition happens outside create.
        if (this.pendingAutoWatch) {
            this.pendingAutoWatch = false;
            if (this.mode === 'running') this.watchPending();
        }
    }

    private onAnyPointer = (): void => {
        unlockAudio();
        playClick();
    };

    private onMuteKey = (): void => {
        unlockAudio();
        toggleMuted();
    };

    // ---- Setup ------------------------------------------------------------
    private trackSetup<T extends Phaser.GameObjects.GameObject>(obj: T): T {
        this.setupObjects.push(obj);
        return obj;
    }

    private buildSetup(): void {
        this.trackSetup(this.add.text(CX, 84, TOURNAMENT.title, FONTS.title).setOrigin(0.5));
        this.trackSetup(
            this.add.text(CX, 124, TOURNAMENT.subtitle, FONTS.small).setOrigin(0.5),
        );
        ([4, 8] as const).forEach((size, i) => {
            const btn = this.trackSetupButton(CX - 110 + i * 220, 172, () => this.setSize(size));
            this.sizeButtons.push(btn);
        });
        this.refreshSizeLabels();
        this.rebuildEntrants();

        this.setupButton(CX - 160, 700, 260, 50, TOURNAMENT.run, () => this.startTournament());
        this.setupButton(CX + 160, 700, 260, 50, COMMON.menu, () => this.scene.start('Menu'));
    }

    private trackSetupButton(x: number, y: number, onClick: () => void): { setLabel: (label: string) => void } {
        const bg = this.trackSetup(this.add.rectangle(x, y, 200, 42, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge));
        const text = this.trackSetup(this.add.text(x, y, '', FONTS.button).setOrigin(0.5));
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => {
            bg.setStrokeStyle(2, COLORS.team[0]);
            playHover();
        });
        bg.on('pointerout', () => bg.setStrokeStyle(2, COLORS.panelEdge));
        bg.on('pointerdown', onClick);
        return { setLabel: (label: string) => text.setText(label) };
    }

    private setupButton(x: number, y: number, w: number, h: number, label: string, onClick: () => void): void {
        const bg = this.trackSetup(this.add.rectangle(x, y, w, h, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge));
        this.trackSetup(this.add.text(x, y, label, FONTS.button).setOrigin(0.5));
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => {
            bg.setStrokeStyle(2, COLORS.team[0]);
            playHover();
        });
        bg.on('pointerout', () => bg.setStrokeStyle(2, COLORS.panelEdge));
        bg.on('pointerdown', onClick);
    }

    private refreshSizeLabels(): void {
        this.sizeButtons.forEach((btn, i) => {
            btn.setLabel(bracketedLabel(TOURNAMENT.sizeLabels[i] as string, (i === 0 ? 4 : 8) === this.size));
        });
    }

    private setSize(size: 4 | 8): void {
        this.size = size;
        const next: string[] = [];
        for (let i = 0; i < size; i += 1) {
            next.push(this.entrants[i] ?? (DEFAULT_8[i] as string));
        }
        this.entrants = next;
        this.refreshSizeLabels();
        this.rebuildEntrants();
    }

    private trackEntrant<T extends Phaser.GameObjects.GameObject>(obj: T): T {
        this.entrantObjects.push(obj);
        return obj;
    }

    private rebuildEntrants(): void {
        for (const obj of this.entrantObjects) obj.destroy();
        this.entrantObjects = [];
        const startY = this.size === 4 ? 266 : 220;
        const step = this.size === 4 ? 64 : 56;
        this.entrants.forEach((id, i) => {
            const y = startY + i * step;
            const entry = getRobot(id) ?? ROBOTS[0]!;
            this.trackEntrant(this.add.text(250, y, tourneySeedLabel(i), FONTS.monoSmall).setOrigin(0, 0.5));
            const bg = this.trackEntrant(this.add.rectangle(CX + 40, y, 300, 44, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge));
            const text = this.trackEntrant(this.add.text(CX + 40, y, cyclerLabel(entry.meta.name), FONTS.buttonSmall).setOrigin(0.5));
            text.setColor(COLORS.ink);
            bg.setInteractive({ useHandCursor: true });
            bg.on('pointerover', () => {
                bg.setStrokeStyle(2, COLORS.team[0]);
                playHover();
            });
            bg.on('pointerout', () => bg.setStrokeStyle(2, COLORS.panelEdge));
            bg.on('pointerdown', () => this.cycleEntrant(i));
            this.trackEntrant(this.add.text(770, y, loadoutCode(entry.loadout), FONTS.monoSmall).setOrigin(0, 0.5));
        });
    }

    private cycleEntrant(i: number): void {
        const current = this.entrants[i] as string;
        const idx = ROBOTS.findIndex((r) => r.meta.id === current);
        const next = ROBOTS[(idx + 1) % ROBOTS.length]!;
        this.entrants[i] = next.meta.id;
        this.rebuildEntrants();
    }

    private clearSetup(): void {
        for (const obj of this.setupObjects) obj.destroy();
        for (const obj of this.entrantObjects) obj.destroy();
        this.setupObjects = [];
        this.entrantObjects = [];
        this.sizeButtons = [];
    }

    // ---- Bracket run ------------------------------------------------------
    /** Restore a live bracket after a watched battle (or menu detour). */
    private resumeSession(): boolean {
        const stored = loadTournamentSession();
        if (!stored) return false;
        this.size = stored.size;
        this.entrants = [...stored.entrants];
        this.rounds = stored.rounds;
        this.seedBase = stored.seedBase;
        this.matchCounter = stored.matchCounter;
        this.mode = 'running';
        this.live = null;
        this.ensureNextRound();
        if (!this.pendingSlot()) {
            this.mode = 'done';
            clearTournamentSession();
        } else {
            this.pendingAutoWatch = this.autoWatch;
        }
        this.rebuildBracket();
        return true;
    }

    private saveSession(): void {
        saveTournamentSession({
            size: this.size,
            entrants: [...this.entrants],
            rounds: this.rounds,
            seedBase: this.seedBase,
            matchCounter: this.matchCounter,
        });
    }

    /** Total rounds for the bracket size (labels stay put as rounds fill). */
    private totalRounds(): number {
        return this.size === 8 ? 3 : 2;
    }

    /** First unsettled slot across existing rounds (rounds fill in order). */
    private pendingSlot(): { round: number; index: number } | null {
        for (let r = 0; r < this.rounds.length; r += 1) {
            const round = this.rounds[r] as BracketMatch[];
            const index = round.findIndex((m) => !m.winner);
            if (index >= 0) return { round: r, index };
        }
        return null;
    }

    /** Pair the next round once the last one settles (watch path). */
    private ensureNextRound(): void {
        const last = this.rounds[this.rounds.length - 1];
        if (!last || last.length === 0 || !last.every((m) => m.winner)) return;
        const next = nextRound(last);
        if (next) {
            this.rounds.push(next);
            this.saveSession();
        }
    }

    /** Deterministic bracket seed: FNV-1a over the entrant ids (no Math.random/wall-clock). */
    private hashEntrants(ids: string[]): number {
        let h = 0x811c9dc5;
        const s = ids.join('|');
        for (let i = 0; i < s.length; i += 1) {
            h ^= s.charCodeAt(i);
            h = (h * 0x01000193) >>> 0;
        }
        return h >>> 0;
    }

    private startTournament(): void {
        this.clearSetup();
        this.mode = 'running';
        this.seedBase = this.hashEntrants(this.entrants);
        this.matchCounter = 0;
        this.rounds = [initialRound([...this.entrants])];
        this.saveSession();
        this.watchPending();
    }

    /** Launch the next unsettled match visibly in the Battle scene. */
    private watchPending(): void {
        const slot = this.pendingSlot();
        if (!slot || this.mode !== 'running') return;
        const match = (this.rounds[slot.round] as BracketMatch[])[slot.index] as BracketMatch;
        const round = this.rounds[slot.round] as BracketMatch[];
        const lineupIds = [match.a, match.b];
        const seed = (this.seedBase + this.matchCounter * 0x9e3779b9) >>> 0;
        this.matchCounter += 1;
        this.saveSession();
        this.scene.start('Battle', {
            teamSize: 1,
            lineupIds,
            loadouts: lineupIds.map((id) => ({ ...(getRobot(id)?.loadout ?? {}) })),
            skins: lineupIds.map((id, i) => defaultSkin(CALLSIGNS[i % CALLSIGNS.length] ?? id, i, (i < 1 ? 0 : 1) as 0 | 1)),
            trails: true,
            seed,
            arena: 'open',
            modifiers: {},
            tournament: {
                round: slot.round,
                index: slot.index,
                label: `${roundName(slot.round, this.totalRounds())} ${slot.index + 1}/${round.length}`,
            },
        } satisfies BattleRequest);
    }

    /** Settle every remaining match headless (keeps the old instant path). */
    private simRest(): void {
        const slot = this.pendingSlot();
        if (!slot || this.mode !== 'running') return;
        this.startMatch(slot.round, slot.index);
        while (this.mode === 'running' && this.live) {
            this.live.match.runToEnd();
            this.settleLive();
        }
    }

    private startMatch(round: number, index: number): void {
        const slot = (this.rounds[round] as BracketMatch[])[index] as BracketMatch;
        const entryA = getRobot(slot.a) ?? ROBOTS[0]!;
        const entryB = getRobot(slot.b) ?? ROBOTS[0]!;
        const seed = (this.seedBase + this.matchCounter * 0x9e3779b9) >>> 0;
        this.matchCounter += 1;
        this.live = {
            match: new Match(
                [
                    { team: 0, controller: entryA.create(), loadout: { ...entryA.loadout } },
                    { team: 1, controller: entryB.create(), loadout: { ...entryB.loadout } },
                ],
                seed,
            ),
            round,
            index,
        };
    }

    private settleLive(): void {
        const live = this.live;
        if (!live) return;
        const slot = (this.rounds[live.round] as BracketMatch[])[live.index] as BracketMatch;
        const result = live.match.result;
        if (result.winner === 0) {
            slot.winner = slot.a;
        } else if (result.winner === 1) {
            slot.winner = slot.b;
        } else {
            slot.winner = tiebreakWinner(live.match.robotSnapshots, slot.a, slot.b);
            slot.draw = true;
        }
        slot.ticks = result.tick;
        this.live = null;
        const round = this.rounds[live.round] as BracketMatch[];
        const nextIndex = round.findIndex((m) => !m.winner);
        if (nextIndex >= 0) {
            this.startMatch(live.round, nextIndex);
        } else {
            const next = nextRound(round);
            if (next) {
                this.rounds.push(next);
                this.startMatch(this.rounds.length - 1, 0);
            } else {
                this.mode = 'done';
                clearTournamentSession();
            }
        }
        this.rebuildBracket();
    }

    private liveStatus(tick: number): string {
        const live = this.live;
        if (!live) return '';
        const round = this.rounds[live.round] as BracketMatch[];
        return liveStatusText(roundName(live.round, this.totalRounds()), live.index, round.length, tick);
    }

    private champion(): string | null {
        const final = this.rounds[this.rounds.length - 1];
        if (!final || final.length !== 1) return null;
        return (final[0] as BracketMatch).winner;
    }

    // ---- Bracket render ---------------------------------------------------
    private trackBracket<T extends Phaser.GameObjects.GameObject>(obj: T): T {
        this.bracketObjects.push(obj);
        return obj;
    }

    private bracketButton(x: number, y: number, w: number, h: number, label: string, onClick: () => void): void {
        const bg = this.trackBracket(this.add.rectangle(x, y, w, h, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge));
        this.trackBracket(this.add.text(x, y, label, FONTS.button).setOrigin(0.5));
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => {
            bg.setStrokeStyle(2, COLORS.team[0]);
            playHover();
        });
        bg.on('pointerout', () => bg.setStrokeStyle(2, COLORS.panelEdge));
        bg.on('pointerdown', onClick);
    }

    private nameOf(id: string): string {
        return (getRobot(id)?.meta.name ?? id).toUpperCase();
    }

    private rebuildBracket(): void {
        for (const obj of this.bracketObjects) obj.destroy();
        this.bracketObjects = [];

        this.trackBracket(this.add.text(CX, 34, TOURNAMENT.title, FONTS.heading).setOrigin(0.5));
        this.statusText = this.trackBracket(this.add.text(CX, 64, '', FONTS.monoSmall).setOrigin(0.5));
        if (this.mode === 'running' && this.live) {
            this.statusText.setText(this.liveStatus(this.live.match.result.tick));
        }

        const columns = this.size === 8 ? [180, 512, 834] : [280, 744];
        const boxW = this.size === 8 ? 220 : 240;
        const boxH = 92;
        const positions: Array<Array<{ x: number; y: number }>> = this.roundPositions();
        const g = this.trackBracket(this.add.graphics());

        this.rounds.forEach((round, r) => {
            const x = columns[r] as number;
            this.trackBracket(this.add.text(x, 108, roundName(r, this.totalRounds()), FONTS.monoSmall).setOrigin(0.5));
            round.forEach((slot, i) => {
                const pos = (positions[r] as Array<{ x: number; y: number }>)[i] as { x: number; y: number };
                const isLive = this.live !== null && this.live.round === r && this.live.index === i;
                const edge = isLive ? COLORS.team[0] : COLORS.panelEdge;
                this.trackBracket(this.add.rectangle(pos.x, pos.y, boxW, boxH, COLORS.panel).setStrokeStyle(2, edge));
                const colorA = slot.winner === null ? COLORS.ink : slot.winner === slot.a ? COLORS.goldCss : COLORS.faint;
                const colorB = slot.winner === null ? COLORS.ink : slot.winner === slot.b ? COLORS.goldCss : COLORS.faint;
                const textA = this.trackBracket(
                    this.add.text(pos.x - boxW / 2 + 12, pos.y - 26, this.nameOf(slot.a), FONTS.buttonSmall).setOrigin(0, 0.5),
                );
                textA.setColor(colorA);
                const textB = this.trackBracket(
                    this.add.text(pos.x - boxW / 2 + 12, pos.y, this.nameOf(slot.b), FONTS.buttonSmall).setOrigin(0, 0.5),
                );
                textB.setColor(colorB);
                const result = bracketResultText(
                    slot.winner !== null,
                    slot.ticks,
                    slot.draw,
                    isLive,
                    this.live?.match.result.tick ?? 0,
                );
                this.trackBracket(this.add.text(pos.x - boxW / 2 + 12, pos.y + 26, result, FONTS.monoSmall).setOrigin(0, 0.5));
            });
        });

        // Connectors feed winners right into the next round.
        g.lineStyle(2, COLORS.panelEdge, 1);
        for (let r = 0; r + 1 < positions.length; r += 1) {
            const src = positions[r] as Array<{ x: number; y: number }>;
            const dst = positions[r + 1] as Array<{ x: number; y: number }>;
            dst.forEach((target, i) => {
                const upper = src[i * 2] as { x: number; y: number };
                const lower = src[i * 2 + 1] as { x: number; y: number };
                const x0 = upper.x + boxW / 2;
                const x1 = target.x - boxW / 2;
                const midX = (x0 + x1) / 2;
                g.lineBetween(x0, upper.y, midX, upper.y);
                g.lineBetween(x0, lower.y, midX, lower.y);
                g.lineBetween(midX, upper.y, midX, lower.y);
                g.lineBetween(midX, target.y, x1, target.y);
            });
        }

        if (this.mode === 'done') {
            const champ = this.champion();
            const label = this.trackBracket(
                this.add.text(CX, 678, championLabel(champ ? this.nameOf(champ) : null), FONTS.heading).setOrigin(0.5),
            );
            label.setColor(COLORS.goldCss);
            transition(this, [label]);
            this.bracketButton(CX - 240, 726, 200, 36, TOURNAMENT.runAgain, () => this.startTournament());
            this.bracketButton(CX, 726, 200, 36, TOURNAMENT.lineup, () => {
                for (const obj of this.bracketObjects) obj.destroy();
                this.bracketObjects = [];
                this.mode = 'setup';
                this.buildSetup();
            });
            this.bracketButton(CX + 240, 726, 200, 36, COMMON.menu, () => this.scene.start('Menu'));
        } else if (this.pendingSlot()) {
            this.bracketButton(CX - 240, 726, 200, 36, TOURNAMENT.watchNext, () => this.watchPending());
            this.bracketButton(CX, 726, 200, 36, TOURNAMENT.simRest, () => this.simRest());
            this.bracketButton(CX + 240, 726, 200, 36, COMMON.menu, () => this.scene.start('Menu'));
        } else {
            this.bracketButton(CX, 726, 200, 36, COMMON.menu, () => this.scene.start('Menu'));
        }
    }

    private roundPositions(): Array<Array<{ x: number; y: number }>> {
        if (this.size === 8) {
            return [
                [190, 330, 470, 610].map((y) => ({ x: 180, y })),
                [260, 540].map((y) => ({ x: 512, y })),
                [{ x: 834, y: 400 }],
            ];
        }
        return [
            [260, 540].map((y) => ({ x: 280, y })),
            [{ x: 744, y: 400 }],
        ];
    }
}
