// Battle scene: owns the Match, steps the fixed-tick sim, and renders the
// arena with pixel-art sprites. Static layers are built once; per-frame work
// is sprite transforms plus one small dynamic Graphics (cones + trails).

import { Scene } from 'phaser';
import { ARENA_HEIGHT, ARENA_WIDTH, DT, ROBOT_RADIUS } from '../../sim/constants';
import { Match, type BulletSnapshot, type LineupEntry, type RobotSnapshot } from '../../sim/engine';
import { ROBOTS } from '../../robots/registry';
import { ROBOT_SOURCES } from '../../robots/sources';
import { chassisKey, ensureArtTextures } from '../art';
import { COLORS, FONTS } from '../theme';
import { downloadText, makeButton } from '../ui';
import type { SlotSkin } from '../customize';
import type { BattleRequest } from './MenuScene';

const AX = 32;
const AY = 72;
const BULLET_POOL = 40;
const PARTICLE_POOL = 128;

interface Particle {
    img: Phaser.GameObjects.Image;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    gravity: number;
}

export class BattleScene extends Scene {
    private request!: BattleRequest;
    private match!: Match;
    private dyn!: Phaser.GameObjects.Graphics;
    private chassis: Phaser.GameObjects.Image[] = [];
    private towers: Phaser.GameObjects.Image[] = [];
    private hubs: Phaser.GameObjects.Image[] = [];
    private barBg: Phaser.GameObjects.Rectangle[] = [];
    private barFg: Phaser.GameObjects.Rectangle[] = [];
    private nameTexts: Phaser.GameObjects.Text[] = [];
    private bullets: Phaser.GameObjects.Image[] = [];
    private muzzles: Phaser.GameObjects.Image[] = [];
    private particles: Particle[] = [];
    private recoil: number[] = [];
    private muzzleLife: number[] = [];
    private hudPips!: Phaser.GameObjects.Text;
    private hudTimer!: Phaser.GameObjects.Text;
    private banner!: Phaser.GameObjects.Text;
    private bannerQueue: string[] = [];
    private bannerBusy = false;
    private prev!: RobotSnapshot[];
    private acc = 0;
    private paused = false;
    private speed = 1;
    private speedButton!: { setLabel: (label: string) => void };
    private pauseButton!: { setLabel: (label: string) => void };
    private resultsShown = false;
    private trails: Array<Array<{ x: number; y: number }>> = [];
    private lastTrailTick = -1;
    private stripes: Phaser.GameObjects.Rectangle[] = [];
    private barBand: number[] = [];
    private bulletTeam: Array<0 | 1 | null> = [];
    private total0 = 0;
    private total1 = 0;
    private lastHudSecond = -1;
    private lastAlive: [number, number] = [-1, -1];

    constructor() {
        super('Battle');
    }

    init(data: BattleRequest): void {
        this.request = data;
        this.acc = 0;
        this.paused = false;
        this.speed = 1;
        this.resultsShown = false;
        this.chassis = [];
        this.towers = [];
        this.hubs = [];
        this.barBg = [];
        this.barFg = [];
        this.nameTexts = [];
        this.bullets = [];
        this.muzzles = [];
        this.particles = [];
        this.recoil = [];
        this.muzzleLife = [];
        this.trails = [];
        this.lastTrailTick = -1;
        this.stripes = [];
        this.barBand = [];
        this.bulletTeam = [];
        this.total0 = 0;
        this.total1 = 0;
        this.bannerQueue = [];
        this.bannerBusy = false;
        this.lastHudSecond = -1;
        this.lastAlive = [-1, -1];
    }

    create(): void {
        ensureArtTextures(this);
        const lineups: LineupEntry[] = this.request.lineupIds.map((id, i) => {
            const entry = ROBOTS.find((r) => r.meta.id === id) ?? ROBOTS[0]!;
            return {
                team: (i < this.request.teamSize ? 0 : 1) as 0 | 1,
                controller: entry.create(),
                loadout: { ...(this.request.loadouts[i] ?? {}) },
            };
        });
        this.match = new Match(lineups, this.request.seed);
        this.prev = this.match.robotSnapshots;

        // Static layers: floor + wall strips.
        this.add.tileSprite(AX + ARENA_WIDTH / 2, AY + ARENA_HEIGHT / 2, ARENA_WIDTH, ARENA_HEIGHT, 'tile_floor').setDepth(0);
        const wall = (x: number, y: number, w: number, h: number) => {
            this.add.tileSprite(x, y, w, h, 'tile_wall').setDepth(1);
        };
        wall(AX + ARENA_WIDTH / 2, AY - 8, ARENA_WIDTH + 32, 16);
        wall(AX + ARENA_WIDTH / 2, AY + ARENA_HEIGHT + 8, ARENA_WIDTH + 32, 16);
        wall(AX - 8, AY + ARENA_HEIGHT / 2, 16, ARENA_HEIGHT + 32);
        wall(AX + ARENA_WIDTH + 8, AY + ARENA_HEIGHT / 2, 16, ARENA_HEIGHT + 32);

        this.dyn = this.add.graphics().setDepth(2);

        // Robot sprite sets.
        this.match.robotSnapshots.forEach((snap, i) => {
            const skin = this.request.skins[i] as SlotSkin;
            const robotId = this.request.lineupIds[i] as string;
            const team = COLORS.team[snap.team];
            const body = this.add.image(0, 0, chassisKey(robotId)).setScale(2).setDepth(4);
            body.setTint(team);
            const tower = this.add.image(0, 0, 'tower').setScale(2).setDepth(5);
            tower.setTint(skin.paint);
            const hub = this.add.image(0, 0, 'hub').setScale(2).setDepth(6);
            hub.setTint(skin.paint);
            if (skin.finish === 'Ring') {
                const ring = this.add.graphics().setDepth(3);
                ring.lineStyle(2, skin.paint, 0.85);
                ring.strokeCircle(0, 0, (ROBOT_RADIUS + 6) * 1);
                ring.setPosition(0, 0);
                (body as Phaser.GameObjects.Image & { ring?: Phaser.GameObjects.Graphics }).ring = ring;
            }
            const stripe = this.add.rectangle(0, 0, 26, 5, skin.paint).setDepth(4);
            stripe.setVisible(skin.finish === 'Stripe');
            this.stripes.push(stripe);
            this.chassis.push(body);
            this.towers.push(tower);
            this.hubs.push(hub);
            this.barBg.push(this.add.rectangle(0, 0, 46, 6, 0x000000, 0.7).setDepth(9));
            this.barFg.push(this.add.rectangle(0, 0, 44, 4, COLORS.accent).setDepth(9));
            const name = this.add.text(0, 0, skin.callsign, FONTS.monoSmall).setOrigin(0.5).setDepth(9);
            name.setColor(COLORS.teamCss[snap.team]);
            this.nameTexts.push(name);
            const muzzle = this.add.image(0, 0, 'muzzle').setScale(2).setDepth(8).setVisible(false);
            muzzle.setTint(skin.paint);
            this.muzzles.push(muzzle);
            this.recoil.push(0);
            this.muzzleLife.push(0);
            this.trails.push([]);
            this.barBand.push(-1);
            if (snap.team === 0) this.total0 += 1;
            else this.total1 += 1;
            // Spawn-in pop (chassis + tower + hub scale together).
            body.setScale(0.5).setAlpha(0);
            tower.setScale(0.5).setAlpha(0);
            hub.setScale(0.5).setAlpha(0);
            stripe.setAlpha(0);
            this.tweens.add({ targets: [body, tower, hub], scale: 2, alpha: 1, duration: 350, delay: i * 90, ease: 'Back.easeOut' });
            this.tweens.add({ targets: stripe, alpha: 1, duration: 350, delay: i * 90 });
        });

        // Bullet + particle pools.
        for (let i = 0; i < BULLET_POOL; i += 1) {
            this.bullets.push(this.add.image(-50, -50, 'bullet').setScale(2).setDepth(7).setVisible(false));
            this.bulletTeam.push(null);
        }
        for (let i = 0; i < PARTICLE_POOL; i += 1) {
            const img = this.add.image(-50, -50, 'spark').setScale(2).setDepth(8).setVisible(false);
            this.particles.push({ img, vx: 0, vy: 0, life: 0, maxLife: 1, gravity: 0 });
        }

        // HUD.
        this.add.rectangle(AX + ARENA_WIDTH / 2, 26, ARENA_WIDTH + 32, 40, COLORS.panel).setStrokeStyle(1, COLORS.panelEdge).setDepth(10);
        this.hudPips = this.add.text(AX + 12, 26, '', FONTS.mono).setOrigin(0, 0.5).setDepth(10);
        this.hudTimer = this.add.text(AX + ARENA_WIDTH / 2, 26, '', FONTS.heading).setOrigin(0.5).setDepth(10);
        this.add.text(AX + ARENA_WIDTH - 12, 26, `SEED ${this.request.seed}`, FONTS.monoSmall).setOrigin(1, 0.5).setDepth(10);
        this.banner = this.add.text(AX + ARENA_WIDTH / 2, AY + 56, '', FONTS.heading).setOrigin(0.5).setDepth(10).setAlpha(0);

        this.pauseButton = makeButton(this, 760, 740, 120, 36, 'PAUSE', () => this.togglePause());
        this.speedButton = makeButton(this, 890, 740, 100, 36, '1X', () => this.cycleSpeed());
        makeButton(this, 134, 740, 120, 36, 'MENU', () => this.scene.start('Menu'));
        // Named handler, removed on shutdown: the keyboard plugin is global and
        // outlives the scene, so anonymous listeners would stack per visit.
        this.input.keyboard?.on('keydown-SPACE', this.onSpaceKey);
        this.events.once('shutdown', () => this.input.keyboard?.off('keydown-SPACE', this.onSpaceKey));

        this.syncSprites(this.match.robotSnapshots, this.match.bulletSnapshots);
        this.drawDynamic(this.match.robotSnapshots);
    }

    update(_time: number, delta: number): void {
        void _time;
        const dt = Math.min(delta / 1000, 0.1);
        let stepped = false;
        if (!this.paused && !this.match.result.over) {
            this.acc += dt * this.speed;
            let steps = 0;
            while (this.acc >= DT && steps < 12 && !this.match.result.over) {
                this.match.step();
                this.acc -= DT;
                steps += 1;
            }
            if (steps === 12) this.acc = 0;
            stepped = steps > 0;
        }
        // Snapshot once per frame; every helper below reuses these.
        const snaps = this.match.robotSnapshots;
        const bullets = this.match.bulletSnapshots;
        if (stepped) this.diffSnapshots(snaps);
        const tick = this.match.result.tick;
        if (this.request.trails && tick % 3 === 0 && tick !== this.lastTrailTick && !this.match.result.over) {
            this.lastTrailTick = tick;
            snaps.forEach((s, i) => {
                const trail = this.trails[i] as Array<{ x: number; y: number }>;
                if (s.alive) {
                    trail.push({ x: s.x, y: s.y });
                    if (trail.length > 14) trail.shift();
                } else if (trail.length > 0) {
                    trail.shift();
                }
            });
        }
        this.updateParticles(dt);
        this.decayEffects(dt);
        this.syncSprites(snaps, bullets);
        this.drawDynamic(snaps);
        this.syncHud(snaps);
        if (this.match.result.over && !this.resultsShown) {
            this.resultsShown = true;
            this.showResults();
        }
    }

    private onSpaceKey = (): void => {
        this.togglePause();
    };

    private togglePause(): void {
        if (this.match.result.over) return;
        this.paused = !this.paused;
        this.pauseButton.setLabel(this.paused ? 'RESUME' : 'PAUSE');
    }

    private cycleSpeed(): void {
        this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1;
        this.speedButton.setLabel(`${this.speed}X`);
    }

    /** Compare fresh snapshots to previous frame: fire flashes, hits, deaths. */
    private diffSnapshots(snaps: RobotSnapshot[]): void {
        snaps.forEach((s, i) => {
            const p = this.prev[i] as RobotSnapshot;
            const cx = AX + s.x;
            const cy = AY + s.y;
            if (s.shotsFired > p.shotsFired && s.alive) {
                this.muzzleLife[i] = 0.09;
                this.recoil[i] = 5;
                (this.muzzles[i] as Phaser.GameObjects.Image).setScale(2 + Math.random() * 0.8);
                this.burst(cx + Math.cos(s.tower) * 26, cy + Math.sin(s.tower) * 26, 0xffe28a, 4, 120, 0);
            }
            if (s.health < p.health && s.alive) {
                this.burst(cx, cy, 0xff5d5d, 6, 170, 300);
            }
            if (p.alive && !s.alive) {
                this.explode(i, cx, cy);
            }
            if (s.alive && s.health <= 30 && s.health > 0 && this.match.result.tick % 12 === 0) {
                this.burst(cx, cy - 10, 0x5d6a78, 1, 30, -60);
            }
        });
        this.prev = snaps;
    }

    private explode(i: number, cx: number, cy: number): void {
        const snap = this.match.robotSnapshots[i] as RobotSnapshot;
        const robotId = this.request.lineupIds[i] as string;
        this.burst(cx, cy, COLORS.team[snap.team], 22, 260, 200);
        this.burst(cx, cy, 0xffffff, 8, 140, 100);
        this.cameras.main.shake(180, 0.006);
        // Persistent wreck.
        const wreck = this.add.image(cx, cy, chassisKey(robotId)).setScale(2).setDepth(3);
        wreck.setTint(0x1c222a);
        wreck.setRotation(snap.heading + 0.5);
        wreck.setAlpha(0.9);
        const skin = this.request.skins[i] as SlotSkin;
        this.queueBanner(`${skin.callsign} DESTROYED`);
    }

    private queueBanner(text: string): void {
        this.bannerQueue.push(text);
        if (!this.bannerBusy) this.nextBanner();
    }

    private nextBanner(): void {
        const text = this.bannerQueue.shift();
        if (text === undefined) {
            this.bannerBusy = false;
            return;
        }
        this.bannerBusy = true;
        this.banner.setText(text).setAlpha(1).setY(AY + 56);
        this.tweens.add({
            targets: this.banner,
            y: AY + 34,
            alpha: 0,
            duration: 1300,
            ease: 'Cubic.easeOut',
            onComplete: () => this.nextBanner(),
        });
    }

    private burst(x: number, y: number, color: number, n: number, speed: number, gravity: number): void {
        let spawned = 0;
        for (const p of this.particles) {
            if (p.life > 0) continue;
            const angle = Math.random() * Math.PI * 2;
            const v = speed * (0.4 + Math.random() * 0.8);
            p.img.setPosition(x, y).setVisible(true).setAlpha(1);
            p.img.setTint(color);
            p.vx = Math.cos(angle) * v;
            p.vy = Math.sin(angle) * v;
            p.maxLife = 0.35 + Math.random() * 0.35;
            p.life = p.maxLife;
            p.gravity = gravity;
            spawned += 1;
            if (spawned >= n) break;
        }
    }

    private updateParticles(dt: number): void {
        for (const p of this.particles) {
            if (p.life <= 0) continue;
            p.life -= dt;
            if (p.life <= 0) {
                p.img.setVisible(false);
                continue;
            }
            p.vy += p.gravity * dt;
            p.img.x += p.vx * dt;
            p.img.y += p.vy * dt;
            p.img.setAlpha(Math.max(p.life / p.maxLife, 0));
        }
    }

    private decayEffects(dt: number): void {
        for (let i = 0; i < this.muzzleLife.length; i += 1) {
            if ((this.muzzleLife[i] as number) > 0) this.muzzleLife[i] = (this.muzzleLife[i] as number) - dt;
            if ((this.recoil[i] as number) > 0) {
                this.recoil[i] = Math.max((this.recoil[i] as number) - dt * 60, 0);
            }
        }
    }

    private syncSprites(snaps: RobotSnapshot[], bullets: BulletSnapshot[]): void {
        snaps.forEach((s, i) => {
            const cx = AX + s.x;
            const cy = AY + s.y;
            const body = this.chassis[i] as Phaser.GameObjects.Image;
            const tower = this.towers[i] as Phaser.GameObjects.Image;
            const hub = this.hubs[i] as Phaser.GameObjects.Image;
            const ring = (body as Phaser.GameObjects.Image & { ring?: Phaser.GameObjects.Graphics }).ring;
            const stripe = this.stripes[i] as Phaser.GameObjects.Rectangle;
            const skin = this.request.skins[i] as SlotSkin;
            const visible = s.alive;
            body.setVisible(visible).setPosition(cx, cy).setRotation(s.heading);
            stripe.setVisible(visible && skin.finish === 'Stripe').setPosition(cx, cy).setRotation(s.heading);
            const rec = this.recoil[i] as number;
            const tx = cx - Math.cos(s.tower) * rec;
            const ty = cy - Math.sin(s.tower) * rec;
            tower.setVisible(visible).setPosition(tx, ty).setRotation(s.tower);
            hub.setVisible(visible).setPosition(tx, ty).setRotation(0);
            if (ring) ring.setVisible(visible).setPosition(cx, cy);
            // Muzzle flash.
            const muzzle = this.muzzles[i] as Phaser.GameObjects.Image;
            const show = visible && (this.muzzleLife[i] as number) > 0;
            muzzle.setVisible(show);
            if (show) {
                muzzle.setPosition(cx + Math.cos(s.tower) * 30, cy + Math.sin(s.tower) * 30);
                muzzle.setRotation(s.tower);
            }
            // Health bar + name.
            const frac = Math.max(s.health, 0) / s.maxHealth;
            const bg = this.barBg[i] as Phaser.GameObjects.Rectangle;
            const fg = this.barFg[i] as Phaser.GameObjects.Rectangle;
            bg.setVisible(visible).setPosition(cx, cy - 28);
            fg.setVisible(visible).setPosition(cx - 22 + (44 * frac) / 2, cy - 28);
            fg.setSize(44 * frac, 4);
            const band = frac > 0.5 ? 2 : frac > 0.25 ? 1 : 0;
            if (band !== this.barBand[i]) {
                this.barBand[i] = band;
                fg.setFillStyle(band === 2 ? COLORS.accent : band === 1 ? COLORS.team[0] : COLORS.danger);
            }
            const label = this.nameTexts[i] as Phaser.GameObjects.Text;
            label.setVisible(true).setPosition(cx, cy - 40);
            if (!s.alive) label.setColor('#5d6a78');
        });
        // Bullets from pool (tint only when the slot's team changes).
        this.bullets.forEach((img, i) => {
            const b = bullets[i];
            if (b === undefined) {
                img.setVisible(false);
                this.bulletTeam[i] = null;
                return;
            }
            img.setVisible(true).setPosition(AX + b.x, AY + b.y);
            if (this.bulletTeam[i] !== b.team) {
                this.bulletTeam[i] = b.team;
                img.setTint(COLORS.bullet[b.team]);
            }
        });
    }

    private drawDynamic(snaps: RobotSnapshot[]): void {
        const g = this.dyn;
        g.clear();
        if (this.request.trails) {
            snaps.forEach((_ignored, i) => {
                const skin = this.request.skins[i] as SlotSkin;
                const trail = this.trails[i] as Array<{ x: number; y: number }>;
                trail.forEach((point, k) => {
                    const frac = (k + 1) / trail.length;
                    g.fillStyle(skin.paint, 0.05 + frac * 0.2);
                    g.fillRect(AX + point.x - 2, AY + point.y - 2, 4, 4);
                });
            });
        }
        for (const s of snaps) {
            if (!s.alive) continue;
            const cx = AX + s.x;
            const cy = AY + s.y;
            const a0 = s.tower - s.fov / 2;
            const a1 = s.tower + s.fov / 2;
            g.fillStyle(COLORS.team[s.team], 0.07);
            g.fillTriangle(
                cx,
                cy,
                cx + Math.cos(a0) * s.scan,
                cy + Math.sin(a0) * s.scan,
                cx + Math.cos(a1) * s.scan,
                cy + Math.sin(a1) * s.scan,
            );
            if (s.charged) {
                const pulse = 0.45 + 0.3 * Math.sin(this.match.result.tick / 6);
                g.lineStyle(2, 0xffffff, pulse);
                g.strokeCircle(cx, cy, ROBOT_RADIUS + 9);
            } else if (s.charge > 0.05) {
                g.lineStyle(2, 0xffe28a, 0.35);
                g.strokeCircle(cx, cy, ROBOT_RADIUS + 9);
            }
        }
    }

    private syncHud(snaps: RobotSnapshot[]): void {
        let alive0 = 0;
        let alive1 = 0;
        for (const s of snaps) {
            if (!s.alive) continue;
            if (s.team === 0) alive0 += 1;
            else alive1 += 1;
        }
        const second = Math.floor(this.match.result.tick / 60);
        if (alive0 !== this.lastAlive[0] || alive1 !== this.lastAlive[1]) {
            this.lastAlive = [alive0, alive1];
            const pips = (alive: number, total: number) => '●'.repeat(alive) + '○'.repeat(total - alive);
            this.hudPips.setText(`T1 ${pips(alive0, this.total0)}   T2 ${pips(alive1, this.total1)}`);
        }
        if (second !== this.lastHudSecond) {
            this.lastHudSecond = second;
            const mm = Math.floor(second / 60);
            const ss = (second % 60).toString().padStart(2, '0');
            this.hudTimer.setText(`${mm}:${ss}`);
        }
    }

    private showResults(): void {
        const result = this.match.result;
        const title = result.winner === -1 ? 'DRAW' : result.winner === 0 ? 'TEAM 1 WINS' : 'TEAM 2 WINS';
        const color = result.winner === -1 ? COLORS.ink : COLORS.teamCss[result.winner];
        this.add.rectangle(512, 384, 620, 440, 0x0b0e12, 0.94).setStrokeStyle(2, COLORS.panelEdge).setDepth(20);
        this.add.text(512, 196, title, { ...FONTS.banner, color }).setOrigin(0.5).setDepth(20);
        this.add
            .text(512, 232, `seed ${this.request.seed} - ${(result.tick / 60).toFixed(1)}s`, FONTS.monoSmall)
            .setOrigin(0.5)
            .setDepth(20);

        const snaps = this.match.robotSnapshots;
        snaps.forEach((s, i) => {
            const y = 274 + i * 30;
            const skin = this.request.skins[i] as SlotSkin;
            const row = `${s.alive ? '>' : 'x'} ${skin.callsign} (${s.name})  ${s.kills} KO  ${Math.round(s.damageDealt)} dmg  ${s.shotsFired} shots`;
            const code = this.add.text(232, y + 13, s.code, FONTS.monoSmall).setOrigin(0, 0.5).setDepth(20);
            code.setColor('#5d6a78');
            const text = this.add.text(232, y, row, FONTS.monoSmall).setOrigin(0, 0.5).setDepth(20);
            text.setColor(s.alive ? COLORS.teamCss[s.team] : '#5d6a78');
            const hit = this.add.rectangle(512, y, 560, 26).setDepth(20);
            hit.setInteractive({ useHandCursor: true });
            hit.on('pointerdown', () => this.exportRobot(s.id));
        });
        this.add
            .text(512, 274 + snaps.length * 30, 'click a row to download that robot (.ts)', FONTS.small)
            .setOrigin(0.5)
            .setDepth(20);

        makeButton(
            this,
            412,
            566,
            170,
            44,
            'REMATCH',
            () => {
                this.scene.restart({ ...this.request, seed: (Math.random() * 0x7fffffff) | 0 });
            },
            21,
        );
        makeButton(this, 612, 566, 170, 44, 'MENU', () => this.scene.start('Menu'), 21);
    }

    private exportRobot(id: number): void {
        const robotId = this.request.lineupIds[id] as string;
        const source = ROBOT_SOURCES[robotId];
        if (source === undefined) return;
        downloadText(`${robotId}.ts`, source);
    }
}
