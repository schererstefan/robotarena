// Battle scene: owns the Match, steps the fixed-tick sim, renders the
// arena procedurally, and shows results with per-robot source export.

import { Scene } from 'phaser';
import { ARENA_HEIGHT, ARENA_WIDTH, DT, ROBOT_RADIUS, SENSOR_FOV, SENSOR_RANGE } from '../../sim/constants';
import { Match, type LineupEntry } from '../../sim/engine';
import { ROBOTS } from '../../robots/registry';
import { ROBOT_SOURCES } from '../../robots/sources';
import { COLORS, FONTS } from '../theme';
import { downloadText, makeButton } from '../ui';
import type { SlotSkin } from '../customize';
import type { BattleRequest } from './MenuScene';

const AX = 32;
const AY = 72;

export class BattleScene extends Scene {
    private request!: BattleRequest;
    private match!: Match;
    private gfx!: Phaser.GameObjects.Graphics;
    private nameTexts: Phaser.GameObjects.Text[] = [];
    private hudText!: Phaser.GameObjects.Text;
    private acc = 0;
    private paused = false;
    private speed = 1;
    private speedButton!: { setLabel: (label: string) => void };
    private pauseButton!: { setLabel: (label: string) => void };
    private resultsShown = false;
    private trails: Array<Array<{ x: number; y: number }>> = [];

    constructor() {
        super('Battle');
    }

    init(data: BattleRequest): void {
        this.request = data;
        this.acc = 0;
        this.paused = false;
        this.speed = 1;
        this.resultsShown = false;
        this.nameTexts = [];
        this.trails = [];
    }

    create(): void {
        const lineups: LineupEntry[] = this.request.lineupIds.map((id, i) => {
            const entry = ROBOTS.find((r) => r.meta.id === id) ?? ROBOTS[0]!;
            return { team: (i < this.request.teamSize ? 0 : 1) as 0 | 1, controller: entry.create() };
        });
        this.match = new Match(lineups, this.request.seed);

        this.gfx = this.add.graphics();
        this.match.robotSnapshots.forEach((_snap, i) => {
            const skin = this.request.skins[i] as SlotSkin;
            const text = this.add.text(0, 0, skin.callsign, FONTS.monoSmall).setOrigin(0.5);
            this.nameTexts.push(text);
            this.trails.push([]);
        });
        this.hudText = this.add.text(AX, 20, '', FONTS.mono).setOrigin(0, 0.5);

        this.pauseButton = makeButton(this, 760, 740, 120, 36, 'Pause', () => this.togglePause());
        this.speedButton = makeButton(this, 890, 740, 100, 36, '1x', () => this.cycleSpeed());
        makeButton(this, 134, 740, 120, 36, 'Menu', () => this.scene.start('Menu'));
        this.add
            .text(512, 740, `seed ${this.request.seed}`, FONTS.monoSmall)
            .setOrigin(0.5);
        this.input.keyboard?.on('keydown-SPACE', () => this.togglePause());

        this.draw();
    }

    update(_time: number, delta: number): void {
        void _time;
        if (!this.paused && !this.match.result.over) {
            this.acc += Math.min(delta / 1000, 0.1) * this.speed;
            let steps = 0;
            while (this.acc >= DT && steps < 12 && !this.match.result.over) {
                this.match.step();
                this.acc -= DT;
                steps += 1;
            }
            if (steps === 12) this.acc = 0;
        }
        if (this.request.trails && this.match.result.tick % 3 === 0 && !this.match.result.over) {
            this.match.robotSnapshots.forEach((s, i) => {
                const trail = this.trails[i] as Array<{ x: number; y: number }>;
                if (s.alive) {
                    trail.push({ x: s.x, y: s.y });
                    if (trail.length > 18) trail.shift();
                } else if (trail.length > 0) {
                    trail.shift();
                }
            });
        }
        this.draw();
        if (this.match.result.over && !this.resultsShown) {
            this.resultsShown = true;
            this.showResults();
        }
    }

    private togglePause(): void {
        if (this.match.result.over) return;
        this.paused = !this.paused;
        this.pauseButton.setLabel(this.paused ? 'Resume' : 'Pause');
    }

    private cycleSpeed(): void {
        this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1;
        this.speedButton.setLabel(`${this.speed}x`);
    }

    private draw(): void {
        const g = this.gfx;
        g.clear();
        // Floor + grid + border.
        g.fillStyle(COLORS.arenaFloor, 1);
        g.fillRect(AX, AY, ARENA_WIDTH, ARENA_HEIGHT);
        g.lineStyle(1, COLORS.arenaGrid, 1);
        for (let x = 80; x < ARENA_WIDTH; x += 80) g.lineBetween(AX + x, AY, AX + x, AY + ARENA_HEIGHT);
        for (let y = 80; y < ARENA_HEIGHT; y += 80) g.lineBetween(AX, AY + y, AX + ARENA_WIDTH, AY + y);
        g.lineStyle(2, COLORS.arenaEdge, 1);
        g.strokeRect(AX, AY, ARENA_WIDTH, ARENA_HEIGHT);

        const snaps = this.match.robotSnapshots;
        // Motion trails (cosmetic).
        if (this.request.trails) {
            snaps.forEach((_ignored, i) => {
                const skin = this.request.skins[i] as SlotSkin;
                const trail = this.trails[i] as Array<{ x: number; y: number }>;
                trail.forEach((point, k) => {
                    const frac = (k + 1) / trail.length;
                    g.fillStyle(skin.paint, 0.05 + frac * 0.22);
                    g.fillCircle(AX + point.x, AY + point.y, 2 + frac * 3);
                });
            });
        }
        // Sensor cones (alive only).
        for (const s of snaps) {
            if (!s.alive) continue;
            const cx = AX + s.x;
            const cy = AY + s.y;
            const a0 = s.tower - SENSOR_FOV / 2;
            const a1 = s.tower + SENSOR_FOV / 2;
            g.fillStyle(COLORS.team[s.team], 0.07);
            g.fillTriangle(
                cx,
                cy,
                cx + Math.cos(a0) * SENSOR_RANGE,
                cy + Math.sin(a0) * SENSOR_RANGE,
                cx + Math.cos(a1) * SENSOR_RANGE,
                cy + Math.sin(a1) * SENSOR_RANGE,
            );
        }
        // Robots.
        snaps.forEach((s, i) => {
            const cx = AX + s.x;
            const cy = AY + s.y;
            const label = this.nameTexts[i] as Phaser.GameObjects.Text;
            if (!s.alive) {
                g.lineStyle(2, COLORS.dead, 1);
                g.strokeCircle(cx, cy, ROBOT_RADIUS);
                g.lineBetween(cx - 8, cy - 8, cx + 8, cy + 8);
                g.lineBetween(cx - 8, cy + 8, cx + 8, cy - 8);
                label.setPosition(cx, cy - 30).setColor('#5d6a78');
                return;
            }
            const color = COLORS.team[s.team];
            const skin = this.request.skins[i] as SlotSkin;
            if (skin.finish === 'Ring') {
                g.lineStyle(2, skin.paint, 0.85);
                g.strokeCircle(cx, cy, ROBOT_RADIUS + 6);
            }
            // Chassis: rotated rect as two triangles + team outline + nose tick.
            const cos = Math.cos(s.heading);
            const sin = Math.sin(s.heading);
            const fx = cos;
            const fy = sin;
            const sx = -sin;
            const sy = cos;
            const hl = ROBOT_RADIUS;
            const hw = ROBOT_RADIUS * 0.72;
            const p1 = { x: cx + fx * hl + sx * hw, y: cy + fy * hl + sy * hw };
            const p2 = { x: cx + fx * hl - sx * hw, y: cy + fy * hl - sy * hw };
            const p3 = { x: cx - fx * hl - sx * hw, y: cy - fy * hl - sy * hw };
            const p4 = { x: cx - fx * hl + sx * hw, y: cy - fy * hl + sy * hw };
            g.fillStyle(0x222b35, 1);
            g.fillTriangle(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
            g.fillTriangle(p1.x, p1.y, p3.x, p3.y, p4.x, p4.y);
            g.lineStyle(2, color, 1);
            g.lineBetween(p1.x, p1.y, p2.x, p2.y);
            g.lineBetween(p2.x, p2.y, p3.x, p3.y);
            g.lineBetween(p3.x, p3.y, p4.x, p4.y);
            g.lineBetween(p4.x, p4.y, p1.x, p1.y);
            // Finish: racing stripe along the chassis spine.
            if (skin.finish === 'Stripe') {
                g.lineStyle(3, skin.paint, 1);
                g.lineBetween(cx - fx * hl, cy - fy * hl, cx + fx * hl, cy + fy * hl);
            }
            // Tower: barrel line + hub in the player's paint.
            const tx = Math.cos(s.tower);
            const ty = Math.sin(s.tower);
            g.lineStyle(4, skin.paint, 1);
            g.lineBetween(cx, cy, cx + tx * (ROBOT_RADIUS + 10), cy + ty * (ROBOT_RADIUS + 10));
            g.fillStyle(0x0b0e12, 1);
            g.fillCircle(cx, cy, 5);
            g.lineStyle(2, skin.paint, 1);
            g.strokeCircle(cx, cy, 5);
            // Health bar + name.
            const frac = Math.max(s.health, 0) / 100;
            g.fillStyle(0x000000, 0.7);
            g.fillRect(cx - 22, cy - 28, 44, 5);
            g.fillStyle(frac > 0.5 ? COLORS.accent : frac > 0.25 ? COLORS.team[0] : COLORS.danger, 1);
            g.fillRect(cx - 22, cy - 28, 44 * frac, 5);
            label.setPosition(cx, cy - 38).setColor(COLORS.teamCss[s.team]);
        });
        // Bullets.
        for (const b of this.match.bulletSnapshots) {
            g.fillStyle(COLORS.bullet[b.team], 1);
            g.fillCircle(AX + b.x, AY + b.y, 3);
        }
        // HUD.
        const alive0 = snaps.filter((s) => s.alive && s.team === 0).length;
        const alive1 = snaps.filter((s) => s.alive && s.team === 1).length;
        const t = this.match.result.tick / 60;
        const mm = Math.floor(t / 60);
        const ss = Math.floor(t % 60)
            .toString()
            .padStart(2, '0');
        this.hudText.setText(`T1 ${alive0} alive      T2 ${alive1} alive      ${mm}:${ss}`);
    }

    private showResults(): void {
        const result = this.match.result;
        const title =
            result.winner === -1 ? 'DRAW' : result.winner === 0 ? 'TEAM 1 WINS' : 'TEAM 2 WINS';
        const color = result.winner === -1 ? COLORS.ink : COLORS.teamCss[result.winner];
        this.add.rectangle(512, 384, 560, 420, 0x0b0e12, 0.92).setStrokeStyle(1, COLORS.panelEdge);
        this.add.text(512, 210, title, { ...FONTS.title, fontSize: '36px', color }).setOrigin(0.5);
        this.add
            .text(512, 248, `seed ${this.request.seed} · ${(result.tick / 60).toFixed(1)}s`, FONTS.monoSmall)
            .setOrigin(0.5);

        const snaps = this.match.robotSnapshots;
        snaps.forEach((s, i) => {
            const y = 292 + i * 30;
            const skin = this.request.skins[i] as SlotSkin;
            const row = `${s.alive ? '●' : '○'} ${skin.callsign} (${s.name})   ${s.kills} KO   ${Math.round(s.damageDealt)} dmg   ${s.shotsFired} shots`;
            const text = this.add.text(272, y, row, FONTS.monoSmall).setOrigin(0, 0.5);
            text.setColor(s.alive ? COLORS.teamCss[s.team] : '#5d6a78');
            const hit = this.add.rectangle(512, y, 500, 26);
            hit.setInteractive({ useHandCursor: true });
            hit.on('pointerdown', () => this.exportRobot(s.id));
        });
        this.add.text(512, 292 + snaps.length * 30, 'click a row to download that robot (.ts)', FONTS.small).setOrigin(0.5);

        makeButton(this, 412, 560, 170, 44, 'REMATCH', () => {
            this.scene.restart({ ...this.request, seed: (Math.random() * 0x7fffffff) | 0 });
        });
        makeButton(this, 612, 560, 170, 44, 'MENU', () => this.scene.start('Menu'));
    }

    private exportRobot(id: number): void {
        const robotId = this.request.lineupIds[id] as string;
        const source = ROBOT_SOURCES[robotId];
        if (source === undefined) return;
        downloadText(`${robotId}.ts`, source);
    }
}
