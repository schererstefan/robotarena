// Tournament scene: single-elim bracket (4/8 bots) of bot-vs-bot matches.
// Matches run headless in the client with a capped tick budget per frame so
// the UI stays responsive; the bracket redraws as each match settles.

import { Scene } from 'phaser';
import { getRobot, ROBOTS } from '../../robots/registry';
import { Match } from '../../sim/engine';
import { loadoutCode } from '../../sim/skills';
import { unlockAudio, playClick, toggleMuted } from '../audio';
import { COLORS, FONTS } from '../theme';
import { initialRound, nextRound, roundName, tiebreakWinner, type BracketMatch } from '../tournament';

const CX = 512;
/** Headless sim budget per frame: a full 8-bot bracket settles in seconds. */
const TICKS_PER_FRAME = 300;
const DEFAULT_8 = ['rusher', 'turret', 'orbiter', 'wanderer', 'hunter', 'rusher', 'turret', 'orbiter'];
const SIZE_LABEL = ['4 BOTS', '8 BOTS'];

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

    constructor() {
        super('Tournament');
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
        this.buildSetup();
        this.input.on('pointerdown', this.onAnyPointer);
        this.input.keyboard?.on('keydown-M', this.onMuteKey);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown-M', this.onMuteKey);
        });
    }

    update(): void {
        if (this.mode !== 'running' || !this.live) return;
        let steps = 0;
        while (steps < TICKS_PER_FRAME && !this.live.match.result.over) {
            this.live.match.step();
            steps += 1;
        }
        if (this.live.match.result.over) {
            this.settleLive();
        } else {
            this.statusText?.setText(this.liveStatus(this.live.match.result.tick));
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
        this.trackSetup(this.add.text(CX, 44, 'TOURNAMENT', FONTS.title).setOrigin(0.5));
        this.trackSetup(
            this.add.text(CX, 86, 'single elimination - bots only, headless sim', FONTS.small).setOrigin(0.5),
        );
        ([4, 8] as const).forEach((size, i) => {
            const btn = this.trackSetupButton(CX - 110 + i * 220, 136, () => this.setSize(size));
            this.sizeButtons.push(btn);
        });
        this.refreshSizeLabels();
        this.rebuildEntrants();

        this.setupButton(CX - 160, 700, 260, 50, 'RUN TOURNAMENT', () => this.startTournament());
        this.setupButton(CX + 160, 700, 260, 50, 'MENU', () => this.scene.start('Menu'));
    }

    private trackSetupButton(x: number, y: number, onClick: () => void): { setLabel: (label: string) => void } {
        const bg = this.trackSetup(this.add.rectangle(x, y, 200, 42, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge));
        const text = this.trackSetup(this.add.text(x, y, '', FONTS.button).setOrigin(0.5));
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => bg.setStrokeStyle(2, COLORS.team[0]));
        bg.on('pointerout', () => bg.setStrokeStyle(2, COLORS.panelEdge));
        bg.on('pointerdown', onClick);
        return { setLabel: (label: string) => text.setText(label) };
    }

    private setupButton(x: number, y: number, w: number, h: number, label: string, onClick: () => void): void {
        const bg = this.trackSetup(this.add.rectangle(x, y, w, h, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge));
        this.trackSetup(this.add.text(x, y, label, FONTS.button).setOrigin(0.5));
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => bg.setStrokeStyle(2, COLORS.team[0]));
        bg.on('pointerout', () => bg.setStrokeStyle(2, COLORS.panelEdge));
        bg.on('pointerdown', onClick);
    }

    private refreshSizeLabels(): void {
        this.sizeButtons.forEach((btn, i) => {
            const active = (i === 0 ? 4 : 8) === this.size;
            const label = SIZE_LABEL[i] as string;
            btn.setLabel(`${active ? '> ' : ''}${label}${active ? ' <' : ''}`);
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
        const startY = this.size === 4 ? 250 : 196;
        const step = this.size === 4 ? 64 : 56;
        this.entrants.forEach((id, i) => {
            const y = startY + i * step;
            const entry = getRobot(id) ?? ROBOTS[0]!;
            this.trackEntrant(this.add.text(250, y, `SEED ${i + 1}`, FONTS.monoSmall).setOrigin(0, 0.5));
            const bg = this.trackEntrant(this.add.rectangle(CX + 40, y, 300, 44, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge));
            const text = this.trackEntrant(this.add.text(CX + 40, y, `${entry.meta.name} >`, FONTS.buttonSmall).setOrigin(0.5));
            text.setColor(COLORS.ink);
            bg.setInteractive({ useHandCursor: true });
            bg.on('pointerover', () => bg.setStrokeStyle(2, COLORS.team[0]));
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
    private startTournament(): void {
        this.clearSetup();
        this.mode = 'running';
        this.seedBase = (Math.random() * 0x7fffffff) | 0;
        this.matchCounter = 0;
        this.rounds = [initialRound([...this.entrants])];
        this.startMatch(0, 0);
        this.rebuildBracket();
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
            }
        }
        this.rebuildBracket();
    }

    private liveStatus(tick: number): string {
        const live = this.live;
        if (!live) return '';
        const round = this.rounds[live.round] as BracketMatch[];
        return `${roundName(live.round, this.rounds.length)} - MATCH ${live.index + 1}/${round.length} - TICK ${tick}`;
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
        bg.on('pointerover', () => bg.setStrokeStyle(2, COLORS.team[0]));
        bg.on('pointerout', () => bg.setStrokeStyle(2, COLORS.panelEdge));
        bg.on('pointerdown', onClick);
    }

    private nameOf(id: string): string {
        return (getRobot(id)?.meta.name ?? id).toUpperCase();
    }

    private rebuildBracket(): void {
        for (const obj of this.bracketObjects) obj.destroy();
        this.bracketObjects = [];

        this.trackBracket(this.add.text(CX, 34, 'TOURNAMENT', FONTS.heading).setOrigin(0.5));
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
            this.trackBracket(this.add.text(x, 108, roundName(r, this.rounds.length), FONTS.monoSmall).setOrigin(0.5));
            round.forEach((slot, i) => {
                const pos = (positions[r] as Array<{ x: number; y: number }>)[i] as { x: number; y: number };
                const isLive = this.live !== null && this.live.round === r && this.live.index === i;
                const edge = isLive ? COLORS.team[0] : COLORS.panelEdge;
                this.trackBracket(this.add.rectangle(pos.x, pos.y, boxW, boxH, COLORS.panel).setStrokeStyle(2, edge));
                const colorA = slot.winner === null ? COLORS.ink : slot.winner === slot.a ? '#ffd23f' : '#5d6a78';
                const colorB = slot.winner === null ? COLORS.ink : slot.winner === slot.b ? '#ffd23f' : '#5d6a78';
                const textA = this.trackBracket(
                    this.add.text(pos.x - boxW / 2 + 12, pos.y - 26, this.nameOf(slot.a), FONTS.buttonSmall).setOrigin(0, 0.5),
                );
                textA.setColor(colorA);
                const textB = this.trackBracket(
                    this.add.text(pos.x - boxW / 2 + 12, pos.y, this.nameOf(slot.b), FONTS.buttonSmall).setOrigin(0, 0.5),
                );
                textB.setColor(colorB);
                const result = slot.winner
                    ? `${(slot.ticks / 60).toFixed(1)}s${slot.draw ? ' TB' : ''}`
                    : isLive
                      ? `LIVE ${this.live?.match.result.tick ?? 0}`
                      : 'vs';
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
                this.add.text(CX, 678, champ ? `CHAMPION: ${this.nameOf(champ)}` : 'NO CHAMPION', FONTS.heading).setOrigin(0.5),
            );
            label.setColor('#ffd23f');
            this.bracketButton(CX - 240, 726, 200, 36, 'RUN AGAIN', () => this.startTournament());
            this.bracketButton(CX, 726, 200, 36, 'LINEUP', () => {
                for (const obj of this.bracketObjects) obj.destroy();
                this.bracketObjects = [];
                this.mode = 'setup';
                this.buildSetup();
            });
            this.bracketButton(CX + 240, 726, 200, 36, 'MENU', () => this.scene.start('Menu'));
        } else {
            this.bracketButton(CX, 726, 200, 36, 'MENU', () => this.scene.start('Menu'));
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
