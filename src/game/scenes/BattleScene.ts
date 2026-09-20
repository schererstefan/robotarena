// Battle scene: owns the Match, steps the fixed-tick sim, and renders the
// arena with pixel-art sprites. Static layers are built once; per-frame work
// is sprite transforms plus one small dynamic Graphics (cones + trails).

import { Scene } from 'phaser';
import { ARENA_HEIGHT, ARENA_WIDTH, DT, ROBOT_RADIUS, isExhibition, modifierCodes, type ArenaObstacle } from '../../sim/constants';
import { Match, type BulletSnapshot, type LineupEntry, type RobotSnapshot } from '../../sim/engine';
import { clamp } from '../../sim/math';
import { decodeReplay, encodeReplay } from '../../sim/replay';
import { getRobot } from '../../robots/registry';
import { ROBOT_SOURCES } from '../../robots/sources';
import { bakedTextureCount, chassisKey, ensureArtTextures, towerKey, wreckKey } from '../art';
import { playClick, playExplosion, playHit, playShoot, playWin, toggleMuted, unlockAudio } from '../audio';
import { bulletColor, isReducedMotion, teamColor, teamCss } from '../accessibility';
import { recordDailyResult, recordMatch } from '../history';
import { displayRobotId, isImportedId, resolveLineupEntry } from '../importRobot';
import { createPilotController, PilotInput } from '../pilot';
import {
    BATTLE,
    battleTutorialTitle,
    BATTLE_TUTORIAL,
    BATTLE_TUTORIAL_STEPS,
    COMMON,
    cooldownPips,
    damageText,
    destroyedBanner,
    exhibitionResultsLine,
    exhibitionTag,
    formatClock,
    hudTeamPips,
    reelCountdown,
    reelExitCountdown,
    resultRow,
    resultsSub,
    resultsTitle,
    seedLabel,
    showcaseResultsLine,
    showcaseTag,
    speedLabel,
    tsFilename,
    type CopyStep,
} from '../strings';
import { COLORS, FONTS } from '../theme';
import { markTutorialSeen } from '../tutorial';
import { copyText, downloadText, makeButton, type Button } from '../ui';
import { CALLSIGNS, defaultSkin, type SlotSkin } from '../customize';
import type { BattleRequest } from './MenuScene';

const AX = 32;
const AY = 72;
const BULLET_POOL = 40;
const PARTICLE_POOL = 128;
const DMG_POOL = 20;
/** Pool audit: 6 robots max, so 6 explosion flashes can never exhaust. */
const BOOM_POOL = 6;
/** Auto-quality: particle spawn factor per level (HIGH/MED/LOW). */
const QUALITY_FACTORS = [1, 0.5, 0.25];
const QUALITY_NAMES = ['HIGH', 'MED', 'LOW'];
const IND_TTL = 0.8;
const MAP_W = 72;
const MAP_H = 48;
const MAP_CX = 440;
const MAP_CY = 738;
const MAP_X0 = MAP_CX - MAP_W / 2;
const MAP_Y0 = MAP_CY - MAP_H / 2;

interface Particle {
    img: Phaser.GameObjects.Image;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    gravity: number;
}

interface EdgeIndicator {
    vx: number;
    vy: number;
    ax: number;
    ay: number;
    team: 0 | 1;
    ttl: number;
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
    private pipTexts: Phaser.GameObjects.Text[] = [];
    private pipCache: string[] = [];
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
    private stepButton!: { setLabel: (label: string) => void; setEnabled: (enabled: boolean) => void };
    private resultsShown = false;
    private trails: Array<Array<{ x: number; y: number }>> = [];
    private lastTrailTick = -1;
    private stripes: Phaser.GameObjects.Rectangle[] = [];
    private auras: Phaser.GameObjects.Image[] = [];
    private barBand: number[] = [];
    private bulletTeam: Array<0 | 1 | null> = [];
    private total0 = 0;
    private total1 = 0;
    private lastHudSecond = -1;
    private lastAlive: [number, number] = [-1, -1];
    private dmgTexts: Phaser.GameObjects.Text[] = [];
    private dmgCursor = 0;
    private dmgToken: number[] = [];
    private booms: Phaser.GameObjects.Image[] = [];
    private debugText!: Phaser.GameObjects.Text;
    private fpsEma = 60;
    private quality = 0;
    private qualityTimer = 0;
    private goodStreak = 0;
    private indicators: EdgeIndicator[] = [];
    private mapG!: Phaser.GameObjects.Graphics;
    private pilot: PilotInput | null = null;
    private obstacles: ArenaObstacle[] = [];
    private sdAnnounced = false;
    private exhibition = false;
    private customMatch = false;
    private reducedMotion = false;
    private tutStep = 0;
    private tutTitle!: Phaser.GameObjects.Text;
    private tutBody!: Phaser.GameObjects.Text;
    private tutNext: Button | null = null;

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
        this.pipTexts = [];
        this.pipCache = [];
        this.bullets = [];
        this.muzzles = [];
        this.particles = [];
        this.recoil = [];
        this.muzzleLife = [];
        this.trails = [];
        this.lastTrailTick = -1;
        this.stripes = [];
        this.auras = [];
        this.barBand = [];
        this.bulletTeam = [];
        this.total0 = 0;
        this.total1 = 0;
        this.bannerQueue = [];
        this.bannerBusy = false;
        this.lastHudSecond = -1;
        this.lastAlive = [-1, -1];
        this.dmgTexts = [];
        this.dmgCursor = 0;
        this.dmgToken = [];
        this.booms = [];
        this.fpsEma = 60;
        this.quality = 0;
        this.qualityTimer = 0;
        this.goodStreak = 0;
        this.indicators = [];
        this.pilot = null;
        this.customMatch = false;
        this.tutStep = 0;
        this.tutNext = null;
        this.sdAnnounced = false;
    }

    create(): void {
        ensureArtTextures(this);
        this.reducedMotion = isReducedMotion();
        // Pilot mode: slot 0 keeps its robot identity but is driven by human
        // input through the same Intent pipeline (no sim changes).
        this.pilot = this.request.pilot === true ? new PilotInput() : null;
        const lineups: LineupEntry[] = this.request.lineupIds.map((id, i) => {
            const entry = resolveLineupEntry(id);
            const controller =
                i === 0 && this.pilot
                    ? createPilotController(entry.meta, entry.loadout, this.pilot)
                    : entry.create();
            return {
                team: (i < this.request.teamSize ? 0 : 1) as 0 | 1,
                controller,
                loadout: { ...(this.request.loadouts[i] ?? {}) },
            };
        });
        this.match = new Match(lineups, this.request.seed, { arena: this.request.arena, modifiers: this.request.modifiers });
        this.obstacles = this.match.obstacles;
        // Imported robots force exhibition: barred from every board, always.
        this.customMatch = this.request.lineupIds.some(isImportedId);
        this.exhibition = isExhibition(this.request.modifiers) || this.customMatch;
        this.prev = this.match.robotSnapshots;

        // Static layers: composed floor, wall strips + corners + gates, decals.
        this.add.image(AX + ARENA_WIDTH / 2, AY + ARENA_HEIGHT / 2, 'floor_big').setDepth(0);
        const wall = (x: number, y: number, w: number, h: number) => {
            this.add.tileSprite(x, y, w, h, 'tile_wall').setDepth(1);
        };
        wall(AX + ARENA_WIDTH / 2, AY - 8, ARENA_WIDTH + 32, 16);
        wall(AX + ARENA_WIDTH / 2, AY + ARENA_HEIGHT + 8, ARENA_WIDTH + 32, 16);
        wall(AX - 8, AY + ARENA_HEIGHT / 2, 16, ARENA_HEIGHT + 32);
        wall(AX + ARENA_WIDTH + 8, AY + ARENA_HEIGHT / 2, 16, ARENA_HEIGHT + 32);
        const corner = (x: number, y: number, flipX: boolean, flipY: boolean) => {
            this.add.image(x, y, 'wall_corner').setDepth(1).setFlipX(flipX).setFlipY(flipY);
        };
        corner(AX - 8, AY - 8, false, false);
        corner(AX + ARENA_WIDTH + 8, AY - 8, true, false);
        corner(AX - 8, AY + ARENA_HEIGHT + 8, false, true);
        corner(AX + ARENA_WIDTH + 8, AY + ARENA_HEIGHT + 8, true, true);
        this.add.image(AX + ARENA_WIDTH / 2, AY - 8, 'wall_gate').setDepth(1);
        this.add.image(AX + ARENA_WIDTH / 2, AY + ARENA_HEIGHT + 8, 'wall_gate').setDepth(1).setFlipY(true);
        const decal = (key: string, x: number, y: number) => {
            this.add.image(AX + x, AY + y, key).setDepth(0).setAlpha(0.55);
        };
        decal('decor_crate', 44, 44);
        decal('decor_barrel', ARENA_WIDTH - 44, 44);
        decal('decor_vent', 44, ARENA_HEIGHT - 44);
        decal('decor_lamp', ARENA_WIDTH - 44, ARENA_HEIGHT - 44);
        // Arena obstacles: wall-textured blocks with an edge frame.
        for (const o of this.obstacles) {
            const cx = AX + o.x + o.w / 2;
            const cy = AY + o.y + o.h / 2;
            this.add.rectangle(cx, cy, o.w + 4, o.h + 4, COLORS.panel).setStrokeStyle(2, COLORS.panelEdge).setDepth(1);
            this.add.tileSprite(cx, cy, o.w, o.h, 'tile_wall').setDepth(1);
        }

        this.dyn = this.add.graphics().setDepth(2);

        // Robot sprite sets.
        this.match.robotSnapshots.forEach((snap, i) => {
            const skin = this.request.skins[i] as SlotSkin;
            const robotId = displayRobotId(this.request.lineupIds[i] as string);
            const team = teamColor(snap.team);
            const body = this.add.image(0, 0, chassisKey(robotId)).setScale(2).setDepth(4);
            body.setTint(team);
            const tower = this.add.image(0, 0, towerKey(robotId)).setScale(2).setDepth(5);
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
            const aura = this.add.image(0, 0, 'charge_aura').setScale(2.5).setDepth(3).setVisible(false);
            this.auras.push(aura);
            this.chassis.push(body);
            this.towers.push(tower);
            this.hubs.push(hub);
            this.barBg.push(this.add.rectangle(0, 0, 46, 6, 0x000000, 0.7).setDepth(9));
            this.barFg.push(this.add.rectangle(0, 0, 44, 4, COLORS.accent).setDepth(9));
            const name = this.add.text(0, 0, skin.callsign, FONTS.monoSmall).setOrigin(0.5).setDepth(9);
            name.setColor(teamCss(snap.team));
            this.nameTexts.push(name);
            // Active-skill cooldown pips: D = dash, E = EMP, filled = ready.
            this.pipTexts.push(this.add.text(0, 0, '', FONTS.monoSmall).setOrigin(0.5).setDepth(9));
            this.pipCache.push('');
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
            // Reduced motion: robots simply appear, no pop or spawn rings.
            if (!this.reducedMotion) {
                body.setScale(0.5).setAlpha(0);
                tower.setScale(0.5).setAlpha(0);
                hub.setScale(0.5).setAlpha(0);
                stripe.setAlpha(0);
                this.tweens.add({ targets: [body, tower, hub], scale: 2, alpha: 1, duration: 350, delay: i * 90, ease: 'Back.easeOut' });
                this.tweens.add({ targets: stripe, alpha: 1, duration: 350, delay: i * 90 });
                // Spawn ring pop at the spawn point.
                const ring = this.add.image(AX + snap.x, AY + snap.y, 'spawn_a').setScale(2).setDepth(3).setAlpha(0.9);
                this.time.delayedCall(i * 90, () => ring.setVisible(true));
                ring.setVisible(false);
                this.time.delayedCall(i * 90 + 130, () => ring.setTexture('spawn_b'));
                this.time.delayedCall(i * 90 + 260, () => ring.destroy());
            }
        });

        // Bullet + particle + explosion-flash pools (no mid-fight allocation).
        for (let i = 0; i < BULLET_POOL; i += 1) {
            this.bullets.push(this.add.image(-50, -50, 'bullet').setScale(2).setDepth(7).setVisible(false));
            this.bulletTeam.push(null);
        }
        for (let i = 0; i < PARTICLE_POOL; i += 1) {
            const img = this.add.image(-50, -50, 'spark').setScale(2).setDepth(8).setVisible(false);
            this.particles.push({ img, vx: 0, vy: 0, life: 0, maxLife: 1, gravity: 0 });
        }
        for (let i = 0; i < BOOM_POOL; i += 1) {
            this.booms.push(this.add.image(-50, -50, 'boom_1').setScale(3).setDepth(8).setVisible(false));
        }

        // HUD.
        this.add.rectangle(AX + ARENA_WIDTH / 2, 26, ARENA_WIDTH + 32, 40, COLORS.panel).setStrokeStyle(1, COLORS.panelEdge).setDepth(10);
        this.hudPips = this.add.text(AX + 12, 26, '', FONTS.mono).setOrigin(0, 0.5).setDepth(10);
        this.hudTimer = this.add.text(AX + ARENA_WIDTH / 2, 26, '', FONTS.heading).setOrigin(0.5).setDepth(10);
        const tags: string[] = [];
        if (this.request.pilot === true) tags.push(BATTLE.tagPilot);
        else if (this.request.daily !== undefined) tags.push(BATTLE.tagDaily);
        else if (this.request.replay === true) tags.push(BATTLE.tagReplay);
        else if (this.request.showcase !== undefined) {
            const reel = this.request.showcase.reel;
            tags.push(showcaseTag(reel ? reel.index : null, reel ? reel.codes.length : 0));
        }
        if (this.exhibition) {
            const parts = [...(this.customMatch ? [BATTLE.tagCustom] : []), ...modifierCodes(this.request.modifiers)];
            tags.push(exhibitionTag(parts));
        }
        const seedText = this.add.text(AX + ARENA_WIDTH - 12, 26, seedLabel(this.request.seed, tags), FONTS.monoSmall).setOrigin(1, 0.5).setDepth(10);
        if (this.exhibition) seedText.setColor(COLORS.goldCss);
        if (this.request.pilot === true) {
            this.add.rectangle(AX + ARENA_WIDTH / 2, AY + 14, 560, 20, 0x000000, 0.6).setDepth(10);
            this.add
                .text(AX + ARENA_WIDTH / 2, AY + 14, BATTLE.pilotHelp, FONTS.monoSmall)
                .setOrigin(0.5)
                .setDepth(10);
        }
        this.banner = this.add.text(AX + ARENA_WIDTH / 2, AY + 56, '', FONTS.heading).setOrigin(0.5).setDepth(10).setAlpha(0);
        if (this.exhibition) {
            this.queueBanner(this.customMatch ? BATTLE.bannerExhibitionCustom : BATTLE.bannerExhibition);
        }

        // Damage-number pool + live minimap (bottom HUD strip).
        for (let i = 0; i < DMG_POOL; i += 1) {
            const text = this.add.text(-50, -50, '', FONTS.monoSmall).setOrigin(0.5).setDepth(10).setVisible(false);
            text.setColor(COLORS.whiteCss);
            text.setStroke('#0b0e12', 3);
            this.dmgTexts.push(text);
            this.dmgToken.push(0);
        }
        this.add
            .rectangle(MAP_CX, MAP_CY, MAP_W + 10, MAP_H + 10, COLORS.panel)
            .setStrokeStyle(1, COLORS.panelEdge)
            .setDepth(10);
        this.mapG = this.add.graphics().setDepth(10);

        // Debug overlay (F key): fps meter + auto-quality level + texture
        // count. Session-only, hidden by default.
        this.debugText = this.add
            .text(AX + ARENA_WIDTH - 12, 50, '', FONTS.monoSmall)
            .setOrigin(1, 0)
            .setDepth(30)
            .setVisible(false);
        this.debugText.setStroke('#0b0e12', 3);

        this.pauseButton = makeButton(this, 760, 740, 120, 36, BATTLE.pause, () => this.togglePause(), 0, 44);
        this.speedButton = makeButton(this, 890, 740, 100, 36, speedLabel(1), () => this.cycleSpeed(), 0, 44);
        this.stepButton = makeButton(this, 600, 740, 120, 36, BATTLE.step, () => this.stepOnce(), 0, 44);
        this.stepButton.setEnabled(false);
        makeButton(this, 134, 740, 120, 36, COMMON.menu, () => this.scene.start('Menu'), 0, 44);
        this.input.on('pointerdown', this.onAnyPointer);
        // Named handlers, removed on shutdown: the keyboard plugin is global
        // and outlives the scene, so anonymous listeners would stack per visit.
        // In pilot mode Space fires the gun, so pause moves to P.
        if (this.request.pilot === true) {
            this.input.keyboard?.on('keydown', this.onPilotKeyDown);
            this.input.keyboard?.on('keyup', this.onPilotKeyUp);
        } else {
            this.input.keyboard?.on('keydown-SPACE', this.onSpaceKey);
        }
        this.input.keyboard?.on('keydown-M', this.onMuteKey);
        this.input.keyboard?.on('keydown-N', this.onStepKey);
        this.input.keyboard?.on('keydown-F', this.onDebugKey);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown-SPACE', this.onSpaceKey);
            this.input.keyboard?.off('keydown', this.onPilotKeyDown);
            this.input.keyboard?.off('keyup', this.onPilotKeyUp);
            this.input.keyboard?.off('keydown-M', this.onMuteKey);
            this.input.keyboard?.off('keydown-N', this.onStepKey);
            this.input.keyboard?.off('keydown-F', this.onDebugKey);
        });

        if (this.request.tutorial === true) this.buildTutorial();

        this.syncSprites(this.match.robotSnapshots, this.match.bulletSnapshots);
        this.drawDynamic(this.match.robotSnapshots);
    }

    // ---- Onboarding tutorial: scripted spectated battle + coach marks ------
    private buildTutorial(): void {
        this.tutStep = 0;
        this.add.rectangle(512, 682, 780, 56, 0x0b0e12, 0.92).setStrokeStyle(2, COLORS.team[0]).setDepth(30);
        this.tutTitle = this.add.text(140, 660, '', FONTS.monoSmall).setOrigin(0, 0.5).setDepth(30);
        this.tutBody = this.add.text(140, 676, '', FONTS.small).setOrigin(0, 0).setDepth(30);
        this.tutBody.setWordWrapWidth(556);
        this.tutNext = makeButton(this, 768, 682, 120, 36, '', () => this.nextTutorialStep(), 30, 44);
        makeButton(this, 862, 682, 64, 36, COMMON.skip, () => this.skipTutorial(), 30, 44);
        this.refreshTutorialStep();
    }

    private refreshTutorialStep(): void {
        const step = BATTLE_TUTORIAL_STEPS[this.tutStep] as CopyStep;
        this.tutTitle.setText(battleTutorialTitle(this.tutStep, BATTLE_TUTORIAL_STEPS.length, step.title));
        this.tutBody.setText(step.body);
        this.tutNext?.setLabel(this.tutStep === BATTLE_TUTORIAL_STEPS.length - 1 ? BATTLE_TUTORIAL.loadoutTour : COMMON.next);
    }

    private nextTutorialStep(): void {
        if (this.tutStep >= BATTLE_TUTORIAL_STEPS.length - 1) {
            // Seen is marked when the loadout tour ends; the tour is next.
            this.scene.start('Menu', { tour: true });
            return;
        }
        this.tutStep += 1;
        this.refreshTutorialStep();
    }

    private skipTutorial(): void {
        markTutorialSeen();
        this.scene.start('Menu');
    }

    update(_time: number, delta: number): void {
        void _time;
        const dt = Math.min(delta / 1000, 0.1);
        // FPS estimate drives auto-quality (evaluated once a second).
        this.fpsEma += (Math.min(1000 / Math.max(delta, 1), 120) - this.fpsEma) * 0.05;
        this.qualityTimer += 1;
        if (this.qualityTimer >= 60) {
            this.qualityTimer = 0;
            this.autoQuality();
            if (this.debugText.visible) this.refreshDebugText();
        }
        // Pilot aim follows the pointer (game coords minus the arena offset),
        // refreshed before the sim ticks so the turret tracks the cursor.
        if (this.pilot) {
            const pointer = this.input.activePointer;
            this.pilot.aimX = pointer.x - AX;
            this.pilot.aimY = pointer.y - AY;
        }
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

    private onStepKey = (): void => {
        this.stepOnce();
    };

    private onPilotKeyDown = (event: KeyboardEvent): void => {
        const pilot = this.pilot;
        if (!pilot) return;
        switch (event.code) {
            case 'KeyW':
            case 'ArrowUp':
                pilot.forward = true;
                event.preventDefault();
                break;
            case 'KeyS':
            case 'ArrowDown':
                pilot.back = true;
                event.preventDefault();
                break;
            case 'KeyA':
            case 'ArrowLeft':
                pilot.left = true;
                event.preventDefault();
                break;
            case 'KeyD':
            case 'ArrowRight':
                pilot.right = true;
                event.preventDefault();
                break;
            case 'KeyQ':
                pilot.strafeLeft = true;
                event.preventDefault();
                break;
            case 'KeyE':
                pilot.strafeRight = true;
                event.preventDefault();
                break;
            case 'Space':
                pilot.charging = true;
                if (!event.repeat) pilot.queueShot();
                event.preventDefault();
                break;
            case 'KeyP':
                this.togglePause();
                break;
            default:
                break;
        }
    };

    private onPilotKeyUp = (event: KeyboardEvent): void => {
        const pilot = this.pilot;
        if (!pilot) return;
        switch (event.code) {
            case 'KeyW':
            case 'ArrowUp':
                pilot.forward = false;
                break;
            case 'KeyS':
            case 'ArrowDown':
                pilot.back = false;
                break;
            case 'KeyA':
            case 'ArrowLeft':
                pilot.left = false;
                break;
            case 'KeyD':
            case 'ArrowRight':
                pilot.right = false;
                break;
            case 'KeyQ':
                pilot.strafeLeft = false;
                break;
            case 'KeyE':
                pilot.strafeRight = false;
                break;
            case 'Space':
                pilot.charging = false;
                pilot.queueShot();
                break;
            default:
                break;
        }
    };

    private onAnyPointer = (): void => {
        unlockAudio();
        playClick();
    };

    private onMuteKey = (): void => {
        unlockAudio();
        const nowMuted = toggleMuted();
        this.queueBanner(nowMuted ? BATTLE.bannerSoundOff : BATTLE.bannerSoundOn);
    };

    private onDebugKey = (): void => {
        const show = !this.debugText.visible;
        this.debugText.setVisible(show);
        if (show) this.refreshDebugText();
    };

    private refreshDebugText(): void {
        const fps = Math.round(Math.min(this.fpsEma, 999));
        this.debugText.setText(`${fps} FPS - Q ${QUALITY_NAMES[this.quality] as string} - TEX ${bakedTextureCount()}`);
    }

    private togglePause(): void {
        if (this.match.result.over) return;
        this.paused = !this.paused;
        this.pauseButton.setLabel(this.paused ? BATTLE.resume : BATTLE.pause);
        this.stepButton.setEnabled(this.paused);
    }

    /** Replay viewer: advance exactly one sim tick while paused. */
    private stepOnce(): void {
        if (!this.paused || this.match.result.over) return;
        this.match.step();
        this.acc = 0;
        this.diffSnapshots(this.match.robotSnapshots);
    }

    private cycleSpeed(): void {
        this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1;
        this.speedButton.setLabel(speedLabel(this.speed));
    }

    /** Compare fresh snapshots to previous frame: fire flashes, hits, deaths. */
    private diffSnapshots(snaps: RobotSnapshot[]): void {
        // Attacker attribution (render-only): credit health drops to whichever
        // robot's damageDealt grew most in this window.
        let topDealer = -1;
        let topDealt = 0;
        snaps.forEach((s, i) => {
            const p = this.prev[i] as RobotSnapshot;
            const delta = s.damageDealt - p.damageDealt;
            if (delta > topDealt) {
                topDealt = delta;
                topDealer = i;
            }
        });
        snaps.forEach((s, i) => {
            const p = this.prev[i] as RobotSnapshot;
            const cx = AX + s.x;
            const cy = AY + s.y;
            if (s.shotsFired > p.shotsFired && s.alive) {
                this.muzzleLife[i] = 0.09;
                if (!this.reducedMotion) this.recoil[i] = 5;
                (this.muzzles[i] as Phaser.GameObjects.Image)
                    .setTexture(p.charge > 0.4 ? 'muzzle_big' : 'muzzle')
                    .setScale(2 + Math.random() * 0.8);
                this.burst(cx + Math.cos(s.tower) * 26, cy + Math.sin(s.tower) * 26, 0xffe28a, 4, 120, 0);
                playShoot();
            }
            if (s.health < p.health) {
                this.spawnDamageNumber(cx, cy - 18, Math.round(p.health - s.health));
                if (s.alive) {
                    this.burst(cx, cy, 0xff5d5d, 6, 170, 300);
                    playHit();
                }
                if (topDealer >= 0 && topDealer !== i) {
                    const a = snaps[topDealer] as RobotSnapshot;
                    this.pushIndicator(s.x, s.y, a.x, a.y, a.team);
                }
            }
            if (p.alive && !s.alive) {
                this.explode(i, cx, cy);
            }
            if (s.alive && s.health <= 30 && s.health > 0 && this.match.result.tick % 12 === 0) {
                this.burst(cx, cy - 10, COLORS.faintNum, 1, 30, -60);
            }
        });
        this.prev = snaps;
    }

    private explode(i: number, cx: number, cy: number): void {
        const snap = this.match.robotSnapshots[i] as RobotSnapshot;
        const robotId = displayRobotId(this.request.lineupIds[i] as string);
        this.burst(cx, cy, teamColor(snap.team), 22, 260, 200);
        this.burst(cx, cy, COLORS.white, 8, 140, 100);
        if (!this.reducedMotion) this.cameras.main.shake(180, 0.006);
        playExplosion();
        // Framed explosion from the pool (6 slots for 6 robots max), then a
        // persistent per-archetype wreck. The fallback allocates only if a
        // seventh flash is somehow live within 430 ms.
        const pooled = this.booms.find((b) => !b.visible) ?? null;
        if (pooled) {
            pooled.setPosition(cx, cy).setTexture('boom_1').setVisible(true);
            this.time.delayedCall(90, () => pooled.setTexture('boom_2'));
            this.time.delayedCall(180, () => pooled.setTexture('boom_3'));
            this.time.delayedCall(270, () => pooled.setTexture('boom_4'));
            this.time.delayedCall(430, () => pooled.setVisible(false));
        } else {
            const boom = this.add.image(cx, cy, 'boom_1').setScale(3).setDepth(8);
            this.time.delayedCall(90, () => boom.setTexture('boom_2'));
            this.time.delayedCall(180, () => boom.setTexture('boom_3'));
            this.time.delayedCall(270, () => boom.setTexture('boom_4'));
            this.time.delayedCall(430, () => boom.destroy());
        }
        const wreck = this.add.image(cx, cy, wreckKey(robotId)).setScale(2).setDepth(3);
        wreck.setRotation(snap.heading + 0.5);
        wreck.setAlpha(0.95);
        const skin = this.request.skins[i] as SlotSkin;
        this.queueBanner(destroyedBanner(skin.callsign));
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
        if (this.reducedMotion) {
            this.time.delayedCall(1300, () => {
                this.banner.setAlpha(0);
                this.nextBanner();
            });
            return;
        }
        this.tweens.add({
            targets: this.banner,
            y: AY + 34,
            alpha: 0,
            duration: 1300,
            ease: 'Cubic.easeOut',
            onComplete: () => this.nextBanner(),
        });
    }

    /** Step quality down fast on sustained low fps, up slowly on headroom. */
    private autoQuality(): void {
        if (this.fpsEma < 45 && this.quality < QUALITY_FACTORS.length - 1) {
            this.quality += 1;
            this.goodStreak = 0;
        } else if (this.fpsEma > 57) {
            this.goodStreak += 1;
            if (this.goodStreak >= 2 && this.quality > 0) {
                this.quality -= 1;
                this.goodStreak = 0;
            }
        } else {
            this.goodStreak = 0;
        }
    }

    private burst(x: number, y: number, color: number, n: number, speed: number, gravity: number): void {
        // Reduced motion: no particles at all.
        if (this.reducedMotion) return;
        const scaled = Math.max(1, Math.round(n * (QUALITY_FACTORS[this.quality] as number)));
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
            if (spawned >= scaled) break;
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

    private spawnDamageNumber(x: number, y: number, dmg: number): void {
        const slot = this.dmgCursor;
        const text = this.dmgTexts[slot] as Phaser.GameObjects.Text;
        this.dmgCursor = (this.dmgCursor + 1) % this.dmgTexts.length;
        this.tweens.killTweensOf(text);
        text.setText(damageText(dmg)).setPosition(x, y).setAlpha(1).setVisible(true);
        if (this.reducedMotion) {
            // Static show; the token keeps a stale timer from hiding a reuse.
            this.dmgToken[slot] = (this.dmgToken[slot] as number) + 1;
            const token = this.dmgToken[slot] as number;
            this.time.delayedCall(650, () => {
                if (this.dmgToken[slot] === token) text.setVisible(false);
            });
            return;
        }
        this.tweens.add({
            targets: text,
            y: y - 34,
            alpha: 0,
            duration: 650,
            ease: 'Cubic.easeOut',
            onComplete: () => text.setVisible(false),
        });
    }

    private pushIndicator(vx: number, vy: number, ax: number, ay: number, team: 0 | 1): void {
        if (this.indicators.length >= 6) this.indicators.shift();
        this.indicators.push({ vx, vy, ax, ay, team, ttl: IND_TTL });
    }

    private decayEffects(dt: number): void {
        for (let i = 0; i < this.muzzleLife.length; i += 1) {
            if ((this.muzzleLife[i] as number) > 0) this.muzzleLife[i] = (this.muzzleLife[i] as number) - dt;
            if ((this.recoil[i] as number) > 0) {
                this.recoil[i] = Math.max((this.recoil[i] as number) - dt * 60, 0);
            }
        }
        for (let i = this.indicators.length - 1; i >= 0; i -= 1) {
            const ind = this.indicators[i] as EdgeIndicator;
            ind.ttl -= dt;
            if (ind.ttl <= 0) this.indicators.splice(i, 1);
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
            const aura = this.auras[i] as Phaser.GameObjects.Image;
            const charging = visible && s.charge > 0.05;
            aura.setVisible(charging).setPosition(cx, cy);
            if (charging) aura.setAlpha(0.25 + 0.55 * s.charge);
            if (charging && !this.reducedMotion) aura.setRotation(this.match.result.tick / 24);
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
            if (!s.alive) label.setColor(COLORS.faint);
            // Cooldown pips under the chassis; text only re-renders on change.
            const pips = this.pipTexts[i] as Phaser.GameObjects.Text;
            pips.setVisible(visible).setPosition(cx, cy + 30);
            if (visible) {
                const text = cooldownPips(s.dashCd <= 0, s.empCd <= 0);
                if (text !== this.pipCache[i]) {
                    this.pipCache[i] = text;
                    pips.setText(text);
                    pips.setColor(s.dashCd <= 0 && s.empCd <= 0 ? '#7de08a' : '#9aa7b4');
                }
            }
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
            const want = b.hot ? 'bullet_hot' : 'bullet';
            if (this.bulletTeam[i] !== b.team || img.texture.key !== want) {
                this.bulletTeam[i] = b.team;
                img.setTexture(want);
                img.setTint(bulletColor(b.team));
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
            g.fillStyle(teamColor(s.team), 0.07);
            g.fillTriangle(
                cx,
                cy,
                cx + Math.cos(a0) * s.scan,
                cy + Math.sin(a0) * s.scan,
                cx + Math.cos(a1) * s.scan,
                cy + Math.sin(a1) * s.scan,
            );
        }
        for (const ind of this.indicators) this.drawEdgeIndicator(g, ind);
        // Sudden-death safe circle: red ring shrinking onto the arena center.
        if (this.match.result.suddenDeath) {
            const circle = this.match.safeCircle;
            const r = Math.max(circle.r, 1);
            g.lineStyle(3, COLORS.danger, 0.9);
            g.strokeCircle(AX + circle.x, AY + circle.y, r);
            g.lineStyle(1, COLORS.white, 0.5);
            g.strokeCircle(AX + circle.x, AY + circle.y, Math.max(r - 4, 1));
        }
        // Pilot aim reticle: faint sight line plus a crosshair at the cursor.
        if (this.pilot) {
            const s0 = snaps[0] as RobotSnapshot | undefined;
            if (s0 && s0.alive) {
                const ax = clamp(AX + this.pilot.aimX, AX, AX + ARENA_WIDTH);
                const ay = clamp(AY + this.pilot.aimY, AY, AY + ARENA_HEIGHT);
                g.lineStyle(1, COLORS.white, 0.3);
                g.lineBetween(AX + s0.x, AY + s0.y, ax, ay);
                g.lineStyle(2, COLORS.white, 0.8);
                g.lineBetween(ax - 6, ay, ax + 6, ay);
                g.lineBetween(ax, ay - 6, ax, ay + 6);
            }
        }
    }

    /** Chevron on the arena rim pointing from the victim toward its attacker. */
    private drawEdgeIndicator(g: Phaser.GameObjects.Graphics, ind: EdgeIndicator): void {
        const dx = ind.ax - ind.vx;
        const dy = ind.ay - ind.vy;
        const len = Math.hypot(dx, dy);
        if (len < 1) return;
        const nx = dx / len;
        const ny = dy / len;
        const inset = 16;
        let t = Number.POSITIVE_INFINITY;
        if (nx > 0) t = Math.min(t, (ARENA_WIDTH - inset - ind.vx) / nx);
        else if (nx < 0) t = Math.min(t, (ind.vx - inset) / -nx);
        if (ny > 0) t = Math.min(t, (ARENA_HEIGHT - inset - ind.vy) / ny);
        else if (ny < 0) t = Math.min(t, (ind.vy - inset) / -ny);
        if (!Number.isFinite(t) || t < 0) return;
        const ex = AX + ind.vx + nx * t;
        const ey = AY + ind.vy + ny * t;
        const size = 10;
        const px = -ny;
        const py = nx;
        const alpha = Math.min(Math.max(ind.ttl / IND_TTL, 0), 1);
        g.fillStyle(teamColor(ind.team), alpha);
        g.fillTriangle(
            ex + nx * size,
            ey + ny * size,
            ex - nx * size * 0.6 + px * size * 0.7,
            ey - ny * size * 0.6 + py * size * 0.7,
            ex - nx * size * 0.6 - px * size * 0.7,
            ey - ny * size * 0.6 - py * size * 0.7,
        );
    }

    private syncHud(snaps: RobotSnapshot[]): void {
        if (this.match.result.suddenDeath && !this.sdAnnounced) {
            this.sdAnnounced = true;
            this.queueBanner(BATTLE.bannerSuddenDeath);
        }
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
            this.hudPips.setText(hudTeamPips(alive0, this.total0, alive1, this.total1));
        }
        if (second !== this.lastHudSecond) {
            this.lastHudSecond = second;
            this.hudTimer.setText(formatClock(this.match.result.tick));
        }
        this.drawMinimap(snaps);
    }

    private drawMinimap(snaps: RobotSnapshot[]): void {
        const g = this.mapG;
        g.clear();
        for (const o of this.obstacles) {
            g.fillStyle(COLORS.panelEdge, 0.9);
            g.fillRect(
                MAP_X0 + (o.x / ARENA_WIDTH) * MAP_W,
                MAP_Y0 + (o.y / ARENA_HEIGHT) * MAP_H,
                (o.w / ARENA_WIDTH) * MAP_W,
                (o.h / ARENA_HEIGHT) * MAP_H,
            );
        }
        for (const s of snaps) {
            const mx = MAP_X0 + (s.x / ARENA_WIDTH) * MAP_W;
            const my = MAP_Y0 + (s.y / ARENA_HEIGHT) * MAP_H;
            if (s.alive) {
                g.fillStyle(teamColor(s.team), 1);
                g.fillCircle(mx, my, 2.5);
            } else {
                g.lineStyle(1, teamColor(s.team), 0.75);
                g.strokeCircle(mx, my, 2.5);
            }
        }
    }

    private showResults(): void {
        const result = this.match.result;
        this.stepButton.setEnabled(false);
        // Replays re-watch history; only live battles append to it. Daily
        // matches go to the daily board instead of the main log so the fixed
        // daily matchup can't skew per-robot win rates. Pilot matches are
        // human-driven, tutorial matches are a fixed scripted matchup, and
        // showcase matches replay curated champion content, so all three
        // stay out of the log for the same reason. Exhibition matches
        // (any modifier on) are barred from every board.
        if (this.exhibition) {
            // Barred from stats: no record anywhere.
        } else if (this.request.daily !== undefined) {
            recordDailyResult(this.request.daily, {
                seed: this.request.seed,
                lineupIds: [...this.request.lineupIds],
                winner: result.winner,
                ticks: result.tick,
            });
        } else if (this.request.replay !== true && this.request.pilot !== true && this.request.tutorial !== true && this.request.showcase === undefined) {
            recordMatch({
                teamSize: this.request.teamSize,
                lineupIds: [...this.request.lineupIds],
                loadouts: this.request.loadouts.map((l) => ({ ...l })),
                winner: result.winner,
                ticks: result.tick,
                seed: this.request.seed,
            });
        }
        if (result.winner !== -1) playWin();
        const title = resultsTitle(this.request.pilot === true, result.winner);
        const color = result.winner === -1 ? COLORS.ink : teamCss(result.winner);
        this.add.rectangle(512, 384, 620, 440, 0x0b0e12, 0.94).setStrokeStyle(2, COLORS.panelEdge).setDepth(20);
        this.add.text(512, 196, title, { ...FONTS.banner, color }).setOrigin(0.5).setDepth(20);
        this.add
            .text(512, 232, resultsSub(this.request.seed, result.tick), FONTS.monoSmall)
            .setOrigin(0.5)
            .setDepth(20);
        if (this.exhibition) {
            const parts = [...(this.customMatch ? [BATTLE.customRobotPart] : []), ...modifierCodes(this.request.modifiers)];
            this.add
                .text(512, 250, exhibitionResultsLine(parts), {
                    ...FONTS.monoSmall,
                    color: COLORS.goldCss,
                })
                .setOrigin(0.5)
                .setDepth(20);
        } else if (this.request.showcase !== undefined) {
            this.add
                .text(512, 250, showcaseResultsLine(), {
                    ...FONTS.monoSmall,
                    color: COLORS.goldCss,
                })
                .setOrigin(0.5)
                .setDepth(20);
        }

        const snaps = this.match.robotSnapshots;
        snaps.forEach((s, i) => {
            const y = 274 + i * 30;
            const skin = this.request.skins[i] as SlotSkin;
            const row = resultRow(s.alive, skin.callsign, s.name, s.kills, Math.round(s.damageDealt), s.shotsFired);
            const code = this.add.text(232, y + 13, s.code, FONTS.monoSmall).setOrigin(0, 0.5).setDepth(20);
            code.setColor(COLORS.faint);
            const text = this.add.text(232, y, row, FONTS.monoSmall).setOrigin(0, 0.5).setDepth(20);
            text.setColor(s.alive ? teamCss(s.team) : COLORS.faint);
            const hit = this.add.rectangle(512, y, 560, 26).setDepth(20);
            hit.setInteractive({ useHandCursor: true });
            hit.on('pointerdown', () => this.exportRobot(s.id));
        });
        const hintY = 274 + snaps.length * 30;
        this.add.text(512, hintY, BATTLE.exportHint, FONTS.small).setOrigin(0.5).setDepth(20);

        const code = encodeReplay({
            seed: this.request.seed,
            teamSize: this.request.teamSize,
            lineupIds: this.request.lineupIds,
            loadouts: this.request.loadouts,
            arena: this.request.arena,
            modifiers: this.request.modifiers,
        });
        if (this.customMatch) {
            // The code can't restore imported robots, so don't show one.
            this.add
                .text(512, hintY + 26, BATTLE.replayUnavailable, { ...FONTS.monoSmall, color: COLORS.goldCss })
                .setOrigin(0.5)
                .setDepth(20);
        } else {
            this.showReplayCode(code, hintY);
        }

        const showcase = this.request.showcase;
        if (showcase?.reel) {
            this.showReelButtons(showcase.reel);
        } else if (showcase !== undefined) {
            makeButton(
                this,
                412,
                566,
                170,
                44,
                BATTLE.rematch,
                () => {
                    this.scene.restart({
                        ...this.request,
                        seed: (Math.random() * 0x7fffffff) | 0,
                        replay: false,
                        daily: undefined,
                        tutorial: undefined,
                    });
                },
                21,
            );
            makeButton(this, 612, 566, 170, 44, BATTLE.exitShowcase, () => this.scene.start('Showcase'), 21);
        } else {
            makeButton(
                this,
                412,
                566,
                170,
                44,
                BATTLE.rematch,
                () => {
                    this.scene.restart({
                        ...this.request,
                        seed: (Math.random() * 0x7fffffff) | 0,
                        replay: false,
                        daily: undefined,
                        tutorial: undefined,
                    });
                },
                21,
            );
            makeButton(this, 612, 566, 170, 44, COMMON.menu, () => this.scene.start('Menu'), 21);
        }
    }

    /** Reel results: NEXT steps the reel, EXIT returns to the showcase. */
    private showReelButtons(reel: { codes: string[]; index: number }): void {
        const hasNext = reel.index + 1 < reel.codes.length;
        if (hasNext) {
            makeButton(this, 412, 566, 170, 44, COMMON.next, () => this.advanceReel(), 21);
        }
        makeButton(this, hasNext ? 612 : 512, 566, 170, 44, BATTLE.exitShowcase, () => this.scene.start('Showcase'), 21);
        // 4 s skippable auto-advance: NEXT jumps ahead immediately, EXIT
        // leaves, otherwise the reel plays through (out at the end).
        const label = this.add.text(512, 528, '', FONTS.monoSmall).setOrigin(0.5).setDepth(20);
        let left = 4;
        label.setText(hasNext ? reelCountdown(left) : reelExitCountdown(left));
        this.time.addEvent({
            delay: 1000,
            repeat: 3,
            callback: () => {
                left -= 1;
                if (left <= 0) this.advanceReel();
                else label.setText(hasNext ? reelCountdown(left) : reelExitCountdown(left));
            },
        });
    }

    /** Step to the next reel code (or EXIT to the showcase at the end). */
    private advanceReel(): void {
        const showcase = this.request.showcase;
        const reel = showcase?.reel;
        if (!showcase || !reel || reel.index + 1 >= reel.codes.length) {
            this.scene.start('Showcase');
            return;
        }
        const data = decodeReplay(reel.codes[reel.index + 1] as string);
        if (!data || !data.lineupIds.every((id) => getRobot(id))) {
            this.scene.start('Showcase');
            return;
        }
        this.scene.restart({
            teamSize: data.teamSize,
            lineupIds: [...data.lineupIds],
            loadouts: data.loadouts.map((l) => ({ ...l })),
            skins: data.lineupIds.map((id, i) => defaultSkin(CALLSIGNS[i % CALLSIGNS.length] ?? id, i)),
            trails: this.request.trails,
            seed: data.seed,
            arena: data.arena ?? 'open',
            modifiers: data.modifiers ?? {},
            showcase: { botId: showcase.botId, reel: { codes: [...reel.codes], index: reel.index + 1 } },
        } satisfies BattleRequest);
    }

    private showReplayCode(code: string, hintY: number): void {
        const copyLabel = this.add
            .text(512, hintY + 26, BATTLE.replayLabel, FONTS.monoSmall)
            .setOrigin(0.5)
            .setDepth(20);
        const codeText = this.add
            .text(512, hintY + 40, code, { ...FONTS.monoSmall, color: COLORS.goldCss })
            .setOrigin(0.5, 0)
            .setDepth(20);
        codeText.setWordWrapWidth(560);
        codeText.setInteractive({ useHandCursor: true });
        codeText.on('pointerdown', () => {
            void copyText(code).then((ok) => {
                copyLabel.setText(ok ? BATTLE.replayCopied : BATTLE.replayCopyFailed);
                this.time.delayedCall(1500, () => {
                    copyLabel.setText(BATTLE.replayLabel);
                });
            });
        });
    }

    private exportRobot(id: number): void {
        const robotId = this.request.lineupIds[id] as string;
        const source = ROBOT_SOURCES[robotId];
        if (source === undefined) return;
        downloadText(tsFilename(robotId), source);
    }
}
