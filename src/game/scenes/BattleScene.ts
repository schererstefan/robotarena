// Battle scene: owns the Match, steps the fixed-tick sim, and renders the
// arena with pixel-art sprites. Static layers are built once; per-frame work
// is sprite transforms plus one small dynamic Graphics (cones + trails).

import { BlendModes, Scene } from 'phaser';
import { ARENA_HEIGHT, ARENA_WIDTH, BULLET_DAMAGE, DASH_COOLDOWN_TICKS, DT, EMP_COOLDOWN_TICKS, EMP_RADIUS, MAX_TICKS, PAD_RADIUS, ROBOT_RADIUS, isExhibition, modifierCodes, type ArenaObstacle } from '../../sim/constants';
import { Match, type BulletSnapshot, type LineupEntry, type RobotSnapshot } from '../../sim/engine';
import type { SensePadKind } from '../../sim/types';
import { angleDiff, clamp, wrapAngle } from '../../sim/math';
import { loadoutCode, type SkillLoadout } from '../../sim/skills';
import { decodeReplay, encodeReplay } from '../../sim/replay';
import { getRobot } from '../../robots/registry';
import { ROBOT_SOURCES } from '../../robots/sources';
import { SD_RING_R, bakedTextureCount, blockKey, chassisTeamKey, ensureArtTextures, ensureBlockTexture, towerKey, uiIconKey, wreckKey } from '../art';
import {
    playBattleStart,
    playClick,
    playDash,
    playDraw,
    playEmp,
    playExplosion,
    playHit,
    playLose,
    playShoot,
    playSting,
    playSuddenDeath,
    playWin,
    startBattleLoop,
    stopMusic,
    toggleMuted,
    unlockAudio,
} from '../audio';
import { bulletColor, isReducedMotion, teamColor, teamCss } from '../accessibility';
import { recordDailyResult, recordMatch } from '../history';
import { displayRobotId, isImportedId, resolveLineupEntry } from '../importRobot';
import { createPilotController, PilotInput } from '../pilot';
import { settleTournamentMatch, tiebreakWinner } from '../tournament';
import {
    BATTLE,
    battleTutorialTitle,
    BATTLE_TUTORIAL,
    BATTLE_TUTORIAL_STEPS,
    COMMON,
    cooldownLabel,
    damageText,
    destroyedBanner,
    exhibitionResultsLine,
    exhibitionTag,
    formatClock,
    healText,
    hudTeamPips,
    killCreditBanner,
    mvpLine,
    plateDeadRow,
    plateRow,
    plateTotal,
    reelCountdown,
    reelExitCountdown,
    resultsKeyHint,
    resultsKeysHint,
    resultRow,
    resultsSub,
    resultsTitle,
    sdPreWarning,
    seedLabel,
    showcaseResultsLine,
    showcaseTag,
    speedLabel,
    TOURNAMENT,
    tournamentTag,
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
/** Shockwave rings (ring_fx): event-driven, 4 live max, never allocated. */
const RING_POOL = 4;
/** Tread frame swaps every 6 px traveled (distance-keyed, not timer). */
const TREAD_SWAP_PX = 6;
/** Auto-quality: particle spawn factor per level (HIGH/MED/LOW). */
const QUALITY_FACTORS = [1, 0.5, 0.25];
const QUALITY_NAMES = ['HIGH', 'MED', 'LOW'];
const IND_TTL = 0.8;
const MAP_W = 96;
const MAP_H = 64;
const MAP_CX = 440;
const MAP_CY = 738;
const MAP_X0 = MAP_CX - MAP_W / 2;
const MAP_Y0 = MAP_CY - MAP_H / 2;
/** Scorch-decal pool: oldest recycled, never grown mid-fight. */
const SCORCH_POOL = 24;
const SKULL_POOL = 6;
/** SD pre-warning fires 10 s before the collapse starts. */
const SD_WARN_TICK = MAX_TICKS - 600;
/** Full-collapse radius (matches the engine's safeCircle at rest). */
const SD_FULL_R = Math.hypot(ARENA_WIDTH / 2, ARENA_HEIGHT / 2);

/** Team-neutral pad marker color per kind (never a team color). */
function padColor(kind: SensePadKind): number {
    if (kind === 'amp') return COLORS.gold;
    if (kind === 'repair') return COLORS.accent;
    return COLORS.white;
}

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
    private pipCdCache: Array<[number, number]> = [];
    private bullets: Phaser.GameObjects.Image[] = [];
    private muzzles: Phaser.GameObjects.Image[] = [];
    private particles: Particle[] = [];
    private recoil: number[] = [];
    private muzzleLife: number[] = [];
    private hudPips!: Phaser.GameObjects.Text;
    private hudTimer!: Phaser.GameObjects.Text;
    private banner!: Phaser.GameObjects.Text;
    private bannerQueue: Array<{ text: string; color: string }> = [];
    private bannerBusy = false;
    private hitstop = 0;
    private trauma = 0;
    private traumaClean = true;
    /** Turret spring state (critically-damped lag/overshoot, render-only). */
    private turA: number[] = [];
    private turV: number[] = [];
    /** Twin double-tap: second kick delay. Heavy hub dip (px). */
    private kick2T: number[] = [];
    private hubDip: number[] = [];
    /** Staged intro: acc-hold window + per-robot analytic phases. */
    private introActive = false;
    private introElapsed = 0;
    private introDur = 0;
    private introLanded: boolean[] = [];
    private introSkipHint: Phaser.GameObjects.Text | null = null;
    /** Death-throes: countdown to the delayed detonation (≤450 ms). */
    private throesT: number[] = [];
    private throesDealer: number[] = [];
    private throesStage: number[] = [];
    /** Deciding-kill slow-mo window (acc-rate + results hold). */
    private slowmoT = 0;
    private zoomBusy = false;
    /** HP staging: white ghost lag bar + low-HP/slowed glyphs + EMP rings. */
    private barGhost: Phaser.GameObjects.Rectangle[] = [];
    private ghostFrac: number[] = [];
    private lowMark: Phaser.GameObjects.Text[] = [];
    private slowMark: Phaser.GameObjects.Text[] = [];
    private empRingT: number[] = [];
    /** SD escalation: danger-fill sprite + pre-warning latch. */
    private sdRing!: Phaser.GameObjects.Image;
    private sdWarned = false;
    /** Impact scorch decals (pool) + death skull markers (pool). */
    private scorches: Phaser.GameObjects.Image[] = [];
    private scorchCursor = 0;
    private skulls: Array<{ text: Phaser.GameObjects.Text; ttl: number }> = [];
    /** Flicker variants: gate A/B swap + lamp B overlay on 1 s timers. */
    private gateImgs: Phaser.GameObjects.Image[] = [];
    private lampB: Phaser.GameObjects.Image | null = null;
    private flickT = 0;
    private flickOn = false;
    private rings: Phaser.GameObjects.Image[] = [];
    /** Pad active-edge latch per pad index (collect flash on active -> dark). */
    private prevPadActive: boolean[] = [];
    private treads: Phaser.GameObjects.Image[] = [];
    private treadAcc: number[] = [];
    private treadLastX: number[] = [];
    private treadLastY: number[] = [];
    private treadFlip: boolean[] = [];
    private damaged: boolean[] = [];
    private hurtT: number[] = [];
    private punchT: number[] = [];
    private punchOn: boolean[] = [];
    private healAcc: number[] = [];
    private lastHealTick: number[] = [];
    private firstBlood = false;
    private robotIds: string[] = [];
    private normalDamage = BULLET_DAMAGE;
    private curBX: number[] = [];
    private curBY: number[] = [];
    private prevBX: number[] = [];
    private prevBY: number[] = [];
    private hotSlot: boolean[] = [];
    private hotLive = false;
    private lastMapTick = -99;
    private lastSdCueTick = -9999;
    private prev!: RobotSnapshot[];
    private acc = 0;
    private paused = false;
    private speed = 1;
    private speedButton!: { setLabel: (label: string) => void };
    private pauseButton!: { setLabel: (label: string) => void };
    private stepButton!: { setLabel: (label: string) => void; setEnabled: (enabled: boolean) => void };
    private resultsShown = false;
    /** Results keyboard: set once the results buttons exist. */
    private resultsReady = false;
    private resultsPrimary: (() => void) | null = null;
    private resultsSecondary: (() => void) | null = null;
    private resultsFinish: (() => void) | null = null;
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
    /** Scratch edge indicator for pilot rim chevrons (reused, never alloc'd). */
    private chevScratch: EdgeIndicator = { vx: 0, vy: 0, ax: 0, ay: 0, team: 1, ttl: 0 };
    /** Cooldown dial icons + ready-edge latches for the ready pop. */
    private iconDash: Phaser.GameObjects.Image[] = [];
    private iconEmp: Phaser.GameObjects.Image[] = [];
    private prevDashReady: boolean[] = [];
    private prevEmpReady: boolean[] = [];
    /** Team plates flanking the minimap (4 Hz refresh) + strike graphics. */
    private plateG!: Phaser.GameObjects.Graphics;
    private plateHead: Phaser.GameObjects.Text[] = [];
    private plateRows: Phaser.GameObjects.Text[][] = [];
    private lastPlateTick = -99;
    /** Pooled ADD-blend muzzle halos (one per robot, 90 ms with muzzleLife). */
    private halos: Phaser.GameObjects.Image[] = [];
    /** Damage-rate accumulator feeding the battle-drum intensity. */
    private dmgAcc = 0;
    /**
     * Cinematic filters: persistent danger vignette + arena grade (≤2
     * fullscreen passes), transient explode glow, per-aura glows (≤6).
     * WebGL-only + auto-quality-gated; Canvas degrades to the same info.
     */
    private fxVignette: Phaser.Filters.Vignette | null = null;
    private fxGrade: Phaser.Filters.ColorMatrix | null = null;
    private fxBloom: Phaser.Filters.Glow | null = null;
    private auraGlow: Array<Phaser.Filters.Glow | null> = [];
    private lastGradeFrac = -1;
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
        this.resultsReady = false;
        this.resultsPrimary = null;
        this.resultsSecondary = null;
        this.resultsFinish = null;
        this.chassis = [];
        this.towers = [];
        this.hubs = [];
        this.barBg = [];
        this.barFg = [];
        this.nameTexts = [];
        this.pipTexts = [];
        this.pipCache = [];
        this.pipCdCache = [];
        this.bullets = [];
        this.muzzles = [];
        this.particles = [];
        this.recoil = [];
        this.muzzleLife = [];
        this.treads = [];
        this.treadAcc = [];
        this.treadLastX = [];
        this.treadLastY = [];
        this.treadFlip = [];
        this.damaged = [];
        this.hurtT = [];
        this.punchT = [];
        this.punchOn = [];
        this.healAcc = [];
        this.lastHealTick = [];
        this.robotIds = [];
        this.rings = [];
        this.prevPadActive = [];
        this.curBX = [];
        this.curBY = [];
        this.prevBX = [];
        this.prevBY = [];
        this.hotSlot = [];
        this.hotLive = false;
        this.lastMapTick = -99;
        this.lastSdCueTick = -9999;
        this.hitstop = 0;
        this.trauma = 0;
        this.traumaClean = true;
        this.turA = [];
        this.turV = [];
        this.kick2T = [];
        this.hubDip = [];
        this.introActive = false;
        this.introElapsed = 0;
        this.introDur = 0;
        this.introLanded = [];
        this.introSkipHint = null;
        this.throesT = [];
        this.throesDealer = [];
        this.throesStage = [];
        this.slowmoT = 0;
        this.zoomBusy = false;
        this.barGhost = [];
        this.ghostFrac = [];
        this.lowMark = [];
        this.slowMark = [];
        this.empRingT = [];
        this.sdWarned = false;
        this.scorches = [];
        this.scorchCursor = 0;
        this.skulls = [];
        this.gateImgs = [];
        this.lampB = null;
        this.flickT = 0;
        this.flickOn = false;
        this.iconDash = [];
        this.iconEmp = [];
        this.prevDashReady = [];
        this.prevEmpReady = [];
        this.plateHead = [];
        this.plateRows = [];
        this.lastPlateTick = -99;
        this.halos = [];
        this.dmgAcc = 0;
        this.fxVignette = null;
        this.fxGrade = null;
        this.fxBloom = null;
        this.auraGlow = [];
        this.lastGradeFrac = -1;
        this.firstBlood = false;
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
        this.prevPadActive = this.match.padSnapshots.map((p) => p.active);
        // Imported robots force exhibition: barred from every board, always.
        this.customMatch = this.request.lineupIds.some(isImportedId);
        this.exhibition = isExhibition(this.request.modifiers) || this.customMatch;
        this.prev = this.match.robotSnapshots;

        // Static layers: composed floor (overlay, decals, vignette baked in),
        // wall strips + corners + gates. Verticals use the transposed tile
        // so stripes run down the wall instead of across it.
        this.add.image(AX + ARENA_WIDTH / 2, AY + ARENA_HEIGHT / 2, 'floor_big').setDepth(0);
        const wall = (x: number, y: number, w: number, h: number, key: string) => {
            this.add.tileSprite(x, y, w, h, key).setDepth(1);
        };
        wall(AX + ARENA_WIDTH / 2, AY - 8, ARENA_WIDTH + 32, 16, 'tile_wall');
        wall(AX + ARENA_WIDTH / 2, AY + ARENA_HEIGHT + 8, ARENA_WIDTH + 32, 16, 'tile_wall');
        wall(AX - 8, AY + ARENA_HEIGHT / 2, 16, ARENA_HEIGHT + 32, 'tile_wall_v');
        wall(AX + ARENA_WIDTH + 8, AY + ARENA_HEIGHT / 2, 16, ARENA_HEIGHT + 32, 'tile_wall_v');
        const corner = (x: number, y: number, flipX: boolean, flipY: boolean) => {
            this.add.image(x, y, 'wall_corner').setDepth(1).setFlipX(flipX).setFlipY(flipY);
        };
        corner(AX - 8, AY - 8, false, false);
        corner(AX + ARENA_WIDTH + 8, AY - 8, true, false);
        corner(AX - 8, AY + ARENA_HEIGHT + 8, false, true);
        corner(AX + ARENA_WIDTH + 8, AY + ARENA_HEIGHT + 8, true, true);
        this.gateImgs = [
            this.add.image(AX + ARENA_WIDTH / 2, AY - 8, 'wall_gate').setDepth(1),
            this.add.image(AX + ARENA_WIDTH / 2, AY + ARENA_HEIGHT + 8, 'wall_gate').setDepth(1).setFlipY(true),
        ];
        // Lamp lit-frame overlay over the baked lamp: toggled on the 1 s
        // flicker timer (hidden under reduced motion — the baked lamp stays).
        this.lampB = this.add
            .image(AX + ARENA_WIDTH - 44, AY + ARENA_HEIGHT - 44, 'decor_lamp_b')
            .setDepth(0.5)
            .setAlpha(0.9)
            .setVisible(false);
        // Arena obstacles: per-block one-time bakes (exact dims, no 16 px
        // crop) with drop shadows; material reads as machinery, not wall.
        for (const o of this.obstacles) {
            const cx = AX + o.x + o.w / 2;
            const cy = AY + o.y + o.h / 2;
            this.add.rectangle(cx + 4, cy + 5, o.w, o.h, 0x000000, 0.45).setDepth(0.9);
            ensureBlockTexture(this, o.w, o.h);
            this.add.image(cx, cy, blockKey(o.w, o.h)).setDepth(1);
        }
        // SD danger-fill sprite: pre-baked ring, scaled per frame to the
        // safe circle (hidden until the 10 s pre-warning).
        this.sdRing = this.add
            .image(AX + ARENA_WIDTH / 2, AY + ARENA_HEIGHT / 2, 'sd_ring')
            .setDepth(1.5)
            .setVisible(false);

        this.dyn = this.add.graphics().setDepth(2);

        // Robot sprite sets.
        this.normalDamage = this.request.modifiers.doubleDamage === true ? BULLET_DAMAGE * 2 : BULLET_DAMAGE;
        this.match.robotSnapshots.forEach((snap, i) => {
            const skin = this.request.skins[i] as SlotSkin;
            const robotId = displayRobotId(this.request.lineupIds[i] as string);
            this.robotIds.push(robotId);
            // Bake-time team tint (w pixels only): no whole-sprite setTint.
            const body = this.add.image(0, 0, chassisTeamKey(robotId, snap.team, false)).setScale(2).setDepth(4);
            this.damaged.push(false);
            this.hurtT.push(0);
            this.punchT.push(0);
            this.punchOn.push(false);
            this.healAcc.push(0);
            this.lastHealTick.push(-9999);
            this.treads.push(this.add.image(0, 0, 'treads_a').setScale(2).setDepth(3.5));
            this.treadAcc.push(0);
            this.treadLastX.push(-9999);
            this.treadLastY.push(-9999);
            this.treadFlip.push(false);
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
            aura.setBlendMode(BlendModes.ADD);
            this.auras.push(aura);
            this.auraGlow.push(null);
            this.halos.push(this.add.image(0, 0, 'halo').setScale(2.2).setDepth(8).setVisible(false).setBlendMode(BlendModes.ADD));
            this.chassis.push(body);
            this.towers.push(tower);
            this.hubs.push(hub);
            this.barBg.push(this.add.rectangle(0, 0, 46, 6, 0x000000, 0.7).setDepth(9));
            this.barGhost.push(this.add.rectangle(0, 0, 44, 4, COLORS.white, 0.45).setDepth(9));
            this.ghostFrac.push(1);
            this.barFg.push(this.add.rectangle(0, 0, 44, 4, COLORS.accent).setDepth(9));
            this.empRingT.push(0);
            // Low-HP (!) and slowed (❄) glyphs: text + position redundant.
            const low = this.add.text(0, 0, BATTLE.markLowHp, FONTS.monoSmall).setOrigin(0.5).setDepth(9).setVisible(false);
            low.setColor(COLORS.goldCss);
            low.setStroke('#0b0e12', 3);
            this.lowMark.push(low);
            const slow = this.add.text(0, 0, BATTLE.markSlowed, FONTS.monoSmall).setOrigin(0.5).setDepth(9).setVisible(false);
            slow.setColor('#9be7ff');
            slow.setStroke('#0b0e12', 3);
            this.slowMark.push(slow);
            const name = this.add.text(0, 0, skin.callsign, FONTS.monoSmall).setOrigin(0.5).setDepth(9);
            name.setColor(teamCss(snap.team));
            this.nameTexts.push(name);
            // Cooldown readout: sweep dials (dyn) + D/E icons + seconds text.
            this.pipTexts.push(this.add.text(0, 0, '', FONTS.monoSmall).setOrigin(0.5).setDepth(9));
            this.pipCache.push('');
            this.pipCdCache.push([-1, -1]);
            this.prevDashReady.push(true);
            this.prevEmpReady.push(true);
            this.iconDash.push(this.add.image(0, 0, uiIconKey('dash')).setDepth(9).setAlpha(0.9));
            this.iconEmp.push(this.add.image(0, 0, uiIconKey('emp')).setDepth(9).setAlpha(0.9));
            const muzzle = this.add.image(0, 0, 'muzzle').setScale(2).setDepth(8).setVisible(false);
            muzzle.setTint(skin.paint);
            this.muzzles.push(muzzle);
            this.recoil.push(0);
            this.muzzleLife.push(0);
            this.trails.push([]);
            this.barBand.push(-1);
            if (snap.team === 0) this.total0 += 1;
            else this.total1 += 1;
            this.turA.push(snap.tower);
            this.turV.push(0);
            this.kick2T.push(0);
            this.hubDip.push(0);
            this.throesT.push(0);
            this.throesDealer.push(-1);
            this.throesStage.push(0);
            this.introLanded.push(false);
        });
        // Staged intro (replaces the old spawn-pop): telegraph ring → drop
        // (Cubic ease-in + dust) → power-on (Back ease-out + aura flash),
        // 120 ms stagger, acc held ≤1.2 s, skippable on any input.
        // Reduced motion: robots simply appear, no hold.
        if (!this.reducedMotion) {
            const n = this.match.robotSnapshots.length;
            this.introDur = Math.min(1.2, 0.55 + n * 0.12);
            this.introElapsed = 0;
            this.introActive = true;
            this.introSkipHint = this.add
                .text(AX + ARENA_WIDTH / 2, 712, BATTLE.introSkip, FONTS.monoSmall)
                .setOrigin(0.5)
                .setDepth(10)
                .setAlpha(0.8);
        }

        // Bullet + particle + explosion-flash pools (no mid-fight allocation).
        for (let i = 0; i < BULLET_POOL; i += 1) {
            this.bullets.push(this.add.image(-50, -50, 'bullet').setScale(2).setDepth(7).setVisible(false));
            this.bulletTeam.push(null);
            this.curBX.push(-9999);
            this.curBY.push(-9999);
            this.prevBX.push(-9999);
            this.prevBY.push(-9999);
            this.hotSlot.push(false);
        }
        for (let i = 0; i < RING_POOL; i += 1) {
            this.rings.push(this.add.image(-50, -50, 'ring_fx').setScale(2).setDepth(8).setVisible(false));
        }
        for (let i = 0; i < PARTICLE_POOL; i += 1) {
            const img = this.add.image(-50, -50, 'spark').setScale(2).setDepth(8).setVisible(false);
            this.particles.push({ img, vx: 0, vy: 0, life: 0, maxLife: 1, gravity: 0 });
        }
        for (let i = 0; i < BOOM_POOL; i += 1) {
            this.booms.push(this.add.image(-50, -50, 'boom_1').setScale(3).setDepth(8).setVisible(false));
        }
        // Scorch decals (impact record, oldest recycled) + skull markers.
        for (let i = 0; i < SCORCH_POOL; i += 1) {
            this.scorches.push(this.add.image(-50, -50, 'scorch').setDepth(1).setVisible(false).setAlpha(0.75));
        }
        for (let i = 0; i < SKULL_POOL; i += 1) {
            const text = this.add.text(-50, -50, BATTLE.markSkull, FONTS.mono).setOrigin(0.5).setDepth(9).setVisible(false);
            text.setColor(COLORS.ink);
            text.setStroke('#0b0e12', 3);
            this.skulls.push({ text, ttl: 0 });
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
        } else if (this.request.tournament !== undefined) {
            tags.push(tournamentTag(this.request.tournament.label));
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
        // Bottom strip (coordinated with the team plates): MENU + STEP dock
        // left, T0 plate, minimap, T1 plate, then PAUSE + SPEED right.
        this.stepButton = makeButton(this, 195, 740, 100, 36, BATTLE.step, () => this.stepOnce(), 0, 44);
        this.stepButton.setEnabled(false);
        if (this.request.tournament !== undefined) {
            // Abandon the battle: the unsettled slot stays open on the bracket.
            makeButton(this, 80, 740, 100, 36, TOURNAMENT.bracket, () => this.scene.start('Tournament'), 0, 44);
        } else {
            makeButton(this, 80, 740, 100, 36, COMMON.menu, () => this.scene.start('Menu'), 0, 44);
        }
        this.buildPlates();
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
        this.input.keyboard?.on('keydown', this.onIntroKey);
        this.input.keyboard?.on('keydown-ENTER', this.onResultsConfirm);
        this.input.keyboard?.on('keydown-X', this.onResultsExit);
        this.input.keyboard?.on('keydown-ESC', this.onResultsExit);
        this.events.once('shutdown', () => {
            this.input.keyboard?.off('keydown-SPACE', this.onSpaceKey);
            this.input.keyboard?.off('keydown', this.onPilotKeyDown);
            this.input.keyboard?.off('keyup', this.onPilotKeyUp);
            this.input.keyboard?.off('keydown', this.onIntroKey);
            this.input.keyboard?.off('keydown-M', this.onMuteKey);
            this.input.keyboard?.off('keydown-N', this.onStepKey);
            this.input.keyboard?.off('keydown-F', this.onDebugKey);
            this.input.keyboard?.off('keydown-ENTER', this.onResultsConfirm);
            this.input.keyboard?.off('keydown-X', this.onResultsExit);
            this.input.keyboard?.off('keydown-ESC', this.onResultsExit);
            stopMusic();
            this.clearFilters();
        });

        if (this.request.tutorial === true) this.buildTutorial();

        this.syncSprites(this.match.robotSnapshots, this.match.bulletSnapshots, 0);
        this.drawDynamic(this.match.robotSnapshots);
        this.syncFilters();
        startBattleLoop(() => this.musicIntensity());
        playBattleStart();
    }

    /** Drum intensity: alive-ratio (0.6) + damage-rate (0.4), floored warm. */
    private musicIntensity(): number {
        const snaps = this.match.robotSnapshots;
        let aliveN = 0;
        for (const s of snaps) if (s.alive) aliveN += 1;
        const aliveRatio = snaps.length > 0 ? aliveN / snaps.length : 0;
        return clamp(aliveRatio * 0.6 + Math.min(this.dmgAcc / 60, 1) * 0.4 + 0.15, 0, 1);
    }

    /** Any key skips the staged intro (no-op once it has finished). */
    private onIntroKey = (): void => {
        this.finishIntro();
    };

    /** End the acc-hold; the next sync snaps every robot to its final state. */
    private finishIntro(): void {
        if (!this.introActive) return;
        this.introActive = false;
        this.introSkipHint?.destroy();
        this.introSkipHint = null;
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
        const dt = Math.min(delta / 1000, 0.1);
        // FPS estimate drives auto-quality (evaluated once a second).
        this.fpsEma += (Math.min(1000 / Math.max(delta, 1), 120) - this.fpsEma) * 0.05;
        this.qualityTimer += 1;
        if (this.qualityTimer >= 60) {
            this.qualityTimer = 0;
            this.autoQuality();
            // Auto-quality kill-switch for the cinematic filter layer.
            this.syncFilters();
            if (this.debugText.visible) this.refreshDebugText();
        }
        // Pilot aim follows the pointer (game coords minus the arena offset),
        // refreshed before the sim ticks so the turret tracks the cursor.
        if (this.pilot) {
            const pointer = this.input.activePointer;
            this.pilot.aimX = pointer.x - AX;
            this.pilot.aimY = pointer.y - AY;
        }
        // Staged intro: hold acc (no ticks) until the drop finishes or the
        // player skips. Replay-safe: tick content unchanged, only pacing.
        if (this.introActive && !this.reducedMotion) {
            this.introElapsed += dt;
            if (this.introElapsed >= this.introDur) this.finishIntro();
        }
        if (this.slowmoT > 0 && !this.paused) this.slowmoT -= dt;
        let stepped = false;
        if (!this.paused && !this.match.result.over && !this.introActive) {
            // Hitstop: freeze acc (replay-safe: tick content unchanged, only
            // pacing) for a beat on kills/charged hits. Skipped in reduced
            // motion — the banner + wreck carry the event instead.
            if (this.hitstop > 0) {
                this.hitstop -= 1;
            } else {
                // Deciding-kill slow-mo: quarter acc-rate (C6: acc-gating, never
                // timeScale — the sim cannot see pacing).
                this.acc += dt * this.speed * (this.slowmoT > 0 ? 0.25 : 1);
                let steps = 0;
                while (this.acc >= DT && steps < 12 && !this.match.result.over) {
                    this.match.step();
                    this.acc -= DT;
                    steps += 1;
                }
                if (steps === 12) this.acc = 0;
                stepped = steps > 0;
            }
        }
        // Snapshot once per frame; every helper below reuses these.
        const snaps = this.match.robotSnapshots;
        const bullets = this.match.bulletSnapshots;
        if (stepped) {
            this.diffSnapshots(snaps);
            this.diffPads();
        }
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
        this.updateTrauma(dt);
        if (!this.paused) this.tickThroes(dt);
        this.tickFlicker(dt);
        this.tickSkulls(dt);
        this.syncSdRing();
        this.syncDangerVignette(snaps, dt);
        if (this.dmgAcc > 0) this.dmgAcc *= Math.exp(-dt * 0.8);
        this.syncSprites(snaps, bullets, dt);
        this.drawDynamic(snaps);
        this.syncHud(snaps, bullets);
        if (this.match.result.over && !this.resultsShown) {
            // Deciding-kill slow-mo holds the results panel ~0.8 s so the
            // pre-fired banner + zoom read before the panel lands.
            if (this.slowmoT > 0 && !this.reducedMotion) return;
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

    /** Results keyboard: Enter activates the primary button (NEXT/REMATCH). */
    private onResultsConfirm = (): void => {
        if (!this.resultsShown) return;
        if (!this.resultsReady) {
            this.resultsFinish?.();
            return;
        }
        this.resultsPrimary?.();
    };

    /** Results keyboard: X/Escape activates EXIT/MENU. */
    private onResultsExit = (): void => {
        if (!this.resultsShown || !this.resultsReady) return;
        this.resultsSecondary?.();
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
        this.finishIntro();
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
        this.diffPads();
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
                if (!this.reducedMotion) {
                    // Per-weapon kick: heavy slams (7px + hub dip), twin
                    // double-taps, light nudges (4px).
                    const key = towerKey(this.robotIds[i] as string);
                    if (key === 'tower_heavy') {
                        this.recoil[i] = 7;
                        this.hubDip[i] = 2.5;
                    } else if (key === 'tower_twin') {
                        this.recoil[i] = 5;
                        this.kick2T[i] = 0.07;
                    } else {
                        this.recoil[i] = 4;
                    }
                    this.punchT[i] = 0.06;
                }
                (this.muzzles[i] as Phaser.GameObjects.Image)
                    .setTexture(p.charge > 0.4 ? 'muzzle_big' : 'muzzle')
                    .setScale(2 + Math.random() * 0.8);
                this.burst(cx + Math.cos(s.tower) * 26, cy + Math.sin(s.tower) * 26, 0xffe28a, 4, 120, 0);
                playShoot(p.charge > 0.4, s.x);
            }
            if (s.health < p.health) {
                const dmg = Math.round(p.health - s.health);
                this.dmgAcc += dmg;
                if (!s.alive) {
                    this.spawnDamageNumber(cx, cy - 18, dmg, 'kill');
                } else if (this.match.result.suddenDeath && topDealer < 0) {
                    this.spawnDamageNumber(cx, cy - 18, dmg, 'sd');
                    this.hurtT[i] = 2;
                } else if (dmg > this.normalDamage) {
                    this.spawnDamageNumber(cx, cy - 18, dmg, 'charged');
                    this.hurtT[i] = 2;
                    this.burst(cx, cy, COLORS.danger, 6, 170, 300);
                    this.addTrauma(0.35);
                    this.fireRing(cx, cy, false);
                    if (!this.reducedMotion) this.hitstop = Math.max(this.hitstop, 2);
                    playHit(dmg, s.x);
                } else {
                    this.spawnDamageNumber(cx, cy - 18, dmg, 'hit');
                    this.hurtT[i] = 2;
                    this.burst(cx, cy, COLORS.danger, 6, 170, 300);
                    playHit(dmg, s.x);
                }
                if (topDealer >= 0 && topDealer !== i) {
                    const a = snaps[topDealer] as RobotSnapshot;
                    this.pushIndicator(s.x, s.y, a.x, a.y, a.team);
                }
            } else if (s.health > p.health && s.alive) {
                // Regen (nanorepair) ticks fractional HP: batch to ≤1/s/robot.
                this.healAcc[i] = (this.healAcc[i] as number) + (s.health - p.health);
                const tick = this.match.result.tick;
                if (tick - (this.lastHealTick[i] as number) >= 60 && (this.healAcc[i] as number) >= 1) {
                    this.spawnDamageNumber(cx, cy - 18, Math.floor(this.healAcc[i] as number), 'heal');
                    this.healAcc[i] = 0;
                    this.lastHealTick[i] = tick;
                }
            }
            // Dash/EMP cues are render-side: cooldown edges from snapshots.
            // Dash confirms with a position-delta spike (dashes always move).
            if (s.alive && p.dashCd <= 0 && s.dashCd > 0 && Math.hypot(s.x - p.x, s.y - p.y) > 3) {
                playDash(s.x);
            }
            if (s.alive && p.empCd <= 0 && s.empCd > 0) {
                playEmp(s.x);
                this.empRingT[i] = 0.5;
            }
            if (p.alive && !s.alive) {
                // Death-throes staging (reduced motion: detonate at once).
                if (this.reducedMotion) this.explode(i, cx, cy, topDealer);
                else this.startThroes(i, topDealer);
            }
            if (s.alive && s.health <= 30 && s.health > 0 && this.match.result.tick % 12 === 0) {
                this.burst(cx, cy - 10, COLORS.faintNum, 1, 30, -60);
            }
        });
        this.prev = snaps;
    }

    /** Throes open: the chassis stays visible, jittering, until detonation. */
    private startThroes(i: number, dealer: number): void {
        this.throesT[i] = 0.45;
        this.throesDealer[i] = dealer;
        this.throesStage[i] = 0;
    }

    /**
     * Capped death-throes (C13): ≤2 pre-flashes + 2 spark bursts + scale
     * jitter over ≤450 ms, then the delayed detonation. The kill banner
     * fires from explode(), so it lands post-detonation.
     */
    private tickThroes(dt: number): void {
        for (let i = 0; i < this.throesT.length; i += 1) {
            const t = this.throesT[i] as number;
            if (t <= 0) continue;
            const next = t - dt;
            this.throesT[i] = next;
            const snap = this.match.robotSnapshots[i] as RobotSnapshot;
            const cx = AX + snap.x;
            const cy = AY + snap.y;
            const stage = this.throesStage[i] as number;
            if (stage === 0 && next <= 0.3) {
                this.throesStage[i] = 1;
                this.hurtT[i] = 2;
                this.burst(cx, cy, COLORS.white, 6, 150, 200);
            } else if (stage === 1 && next <= 0.15) {
                this.throesStage[i] = 2;
                this.hurtT[i] = 2;
                this.burst(cx, cy, COLORS.gold, 6, 150, 200);
            }
            if (next <= 0) {
                this.throesT[i] = -1;
                this.explode(i, cx, cy, this.throesDealer[i] as number);
            }
        }
    }

    /** 1 s flicker timers for gate/lamp lit variants (static when reduced). */
    private tickFlicker(dt: number): void {
        if (this.reducedMotion || this.paused) return;
        this.flickT += dt;
        if (this.flickT < 1) return;
        this.flickT = 0;
        this.flickOn = !this.flickOn;
        for (const gate of this.gateImgs) gate.setTexture(this.flickOn ? 'wall_gate_b' : 'wall_gate');
        this.lampB?.setVisible(this.flickOn);
    }

    /** Death skull-markers hold 5 s over the wreck, then fade. */
    private tickSkulls(dt: number): void {
        for (const skull of this.skulls) {
            if (skull.ttl <= 0) continue;
            skull.ttl -= dt;
            if (skull.ttl <= 0) {
                skull.text.setVisible(false);
            } else {
                skull.text.setAlpha(Math.min(skull.ttl / 2, 1));
            }
        }
    }

    private placeSkull(x: number, y: number): void {
        const skull = this.skulls.find((k) => k.ttl <= 0) ?? this.skulls[0]!;
        skull.text.setPosition(x, y - 44).setAlpha(1).setVisible(true);
        skull.ttl = 5;
    }

    /** SD danger-fill: pre-baked sprite scaled per frame + amber→red→white. */
    private syncSdRing(): void {
        const tick = this.match.result.tick;
        const show = tick >= SD_WARN_TICK && !this.match.result.over;
        this.sdRing.setVisible(show);
        if (!show) return;
        const circle = this.match.safeCircle;
        const frac = clamp(circle.r / SD_FULL_R, 0, 1);
        this.sdRing.setPosition(AX + circle.x, AY + circle.y);
        this.sdRing.setScale(Math.max(circle.r, 1) / SD_RING_R);
        this.sdRing.setTint(frac > 0.66 ? COLORS.team[0] : frac > 0.33 ? COLORS.danger : COLORS.white);
        this.sdRing.setAlpha(this.match.result.suddenDeath ? 0.85 : 0.45);
        // SD grade cross-tween: re-saturate only when the bucket moves.
        const bucket = Math.round(frac * 20);
        if (bucket !== this.lastGradeFrac) {
            this.lastGradeFrac = bucket;
            this.applyGrade(frac);
        }
    }

    /**
     * Render-side bullet-impact inference (C5: no engine list): a bullet slot
     * going live→gone near an obstacle splashes gray/amber + a quiet hit +
     * a recycled scorch decal; range-expiry elsewhere fizzles with no decal.
     */
    private bulletGone(x: number, y: number): void {
        let nearBlock = false;
        for (const o of this.obstacles) {
            if (x > o.x - 14 && x < o.x + o.w + 14 && y > o.y - 14 && y < o.y + o.h + 14) {
                nearBlock = true;
                break;
            }
        }
        if (nearBlock) {
            this.burst(AX + x, AY + y, COLORS.faintNum, 4, 120, 160);
            this.burst(AX + x, AY + y, COLORS.team[0], 3, 90, 120);
            playHit(8, x);
            const decal = this.scorches[this.scorchCursor] as Phaser.GameObjects.Image;
            this.scorchCursor = (this.scorchCursor + 1) % this.scorches.length;
            decal
                .setPosition(AX + x, AY + y)
                .setRotation(Math.random() * Math.PI * 2)
                .setScale(0.8 + Math.random() * 0.5)
                .setVisible(true);
        } else {
            // Range-expiry fizzle: a 2-spark shrink-out, no decal.
            this.burst(AX + x, AY + y, COLORS.faintNum, 2, 40, 0);
        }
    }

    /**
     * Cooldown sweep dial: dark well + ready-fraction sweep in the team
     * color, gold ring when ready. The sweep fraction (shape) carries the
     * state; the pip text alongside keeps the D/E letters + seconds.
     */
    private coolDial(g: Phaser.GameObjects.Graphics, x: number, y: number, cd: number, max: number, team: 0 | 1): void {
        const frac = max <= 0 ? 1 : clamp(1 - cd / max, 0, 1);
        const ready = cd <= 0;
        g.fillStyle(0x000000, 0.7);
        g.fillCircle(x, y, 7);
        if (frac > 0) {
            g.fillStyle(ready ? COLORS.gold : teamColor(team), 0.9);
            g.slice(x, y, 6, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
            g.fillPath();
        }
        g.lineStyle(ready ? 2 : 1, ready ? COLORS.gold : COLORS.panelEdge, 1);
        g.strokeCircle(x, y, 7);
    }

    /**
     * Filters are allowed only at full quality on a renderer that supports
     * them (feature-detected: Canvas has no filter lists). Everything is
     * wrapped so a missing API degrades to the unfiltered render.
     */
    private filtersAllowed(): boolean {
        if (this.quality !== 0) return false;
        try {
            const fl = this.cameras.main.filters?.internal;
            return !!fl && typeof fl.addVignette === 'function';
        } catch {
            return false;
        }
    }

    /** Add gated filters (idempotent) or tear them down under load/Canvas. */
    private syncFilters(): void {
        if (!this.filtersAllowed()) {
            this.clearFilters();
            return;
        }
        try {
            const internal = this.cameras.main.filters.internal;
            if (!this.fxVignette) {
                // Radius must exceed the screen-corner distance (0.707 in UV
                // space): outside the radius the shader mixes 100% opaque
                // color, so a smaller radius floods the screen solid red.
                this.fxVignette = internal.addVignette(0.5, 0.5, 0.9, 0, 0xff2a2a);
            }
            if (!this.fxGrade) {
                this.fxGrade = internal.addColorMatrix();
                this.lastGradeFrac = -1;
                this.applyGrade(1);
            }
        } catch {
            this.fxVignette = null;
            this.fxGrade = null;
        }
        // Charged-aura glows (≤6, one per robot max): attached once, the
        // aura image itself gates visibility (charging only).
        this.auras.forEach((aura, i) => {
            if (this.auraGlow[i]) return;
            try {
                const afl = aura.filters?.internal;
                if (afl && typeof afl.addGlow === 'function') {
                    this.auraGlow[i] = afl.addGlow(0xffd28a, 2, 0);
                }
            } catch {
                // Canvas: per-object filters unsupported, ADD blend remains.
            }
        });
    }

    /** Remove + null every filter (auto-quality gate, shutdown, Canvas). */
    private clearFilters(): void {
        this.clearBloom();
        try {
            const internal = this.cameras.main.filters?.internal;
            if (internal) {
                if (this.fxVignette) internal.remove(this.fxVignette);
                if (this.fxGrade) internal.remove(this.fxGrade);
            }
        } catch {
            // Already gone (Canvas/headless): nothing to release.
        }
        this.fxVignette = null;
        this.fxGrade = null;
        this.lastGradeFrac = -1;
        this.auras.forEach((aura, i) => {
            const glow = this.auraGlow[i];
            if (!glow) return;
            try {
                aura.filters?.internal?.remove(glow);
            } catch {
                // Already gone.
            }
            this.auraGlow[i] = null;
        });
    }

    /** Arena grade: warm `open` / cool `blocks`, SD cross-tween saturating. */
    private applyGrade(sdFrac: number): void {
        const cm = this.fxGrade?.colorMatrix;
        if (!cm) return;
        cm.reset();
        if (this.request.arena === 'blocks') {
            cm.saturate(0.94).hue(-8);
        } else {
            cm.saturate(1.08).brightness(0.03).hue(6);
        }
        if (sdFrac < 1) cm.saturate(1 + (1 - sdFrac) * 0.6);
    }

    /** Low-HP danger vignette: lerped by HP, snapped under reduced motion. */
    private syncDangerVignette(snaps: RobotSnapshot[], dt: number): void {
        if (!this.fxVignette) return;
        let frac = 1;
        if (this.pilot) {
            const s0 = snaps[0];
            frac = s0 && s0.alive ? Math.max(s0.health, 0) / s0.maxHealth : 1;
        } else {
            for (const s of snaps) {
                if (!s.alive) continue;
                frac = Math.min(frac, Math.max(s.health, 0) / s.maxHealth);
            }
        }
        // Peak strength 0.15 (was 0.7): a subtle edge glow at near-zero HP
        // instead of a full-screen red wash. The ramp always starts at the
        // center, so strength is the center-slope gain, not just edge depth.
        const target = frac < 0.5 ? (0.5 - frac) * 0.3 : 0;
        if (this.reducedMotion) {
            this.fxVignette.strength = target;
        } else {
            this.fxVignette.strength += (target - this.fxVignette.strength) * Math.min(dt * 3, 1);
        }
    }

    /**
     * Transient explode-only bloom (~200 ms). Phaser 4.2 ships no Bloom
     * controller, so a fullscreen Glow stands in: strength tween-decayed,
     * removed exactly once (leak-free), gated like every other filter.
     */
    private fireBloom(): void {
        if (this.reducedMotion || !this.filtersAllowed() || this.fxBloom) return;
        try {
            const glow = this.cameras.main.filters.internal.addGlow(0xfff2cc, 4, 0);
            this.fxBloom = glow;
            this.tweens.add({ targets: glow, outerStrength: 0, duration: 200, ease: 'Cubic.easeOut' });
            this.time.delayedCall(210, () => this.clearBloom());
        } catch {
            this.fxBloom = null;
        }
    }

    private clearBloom(): void {
        if (!this.fxBloom) return;
        try {
            this.cameras.main.filters.internal.remove(this.fxBloom);
        } catch {
            // Already gone.
        }
        this.fxBloom = null;
    }

    /** True when (tx,ty) sits inside s's sensor cone (victim-centered arcs). */
    private coneCovers(s: RobotSnapshot, tx: number, ty: number): boolean {
        const dx = tx - s.x;
        const dy = ty - s.y;
        if (Math.hypot(dx, dy) > s.scan) return false;
        return Math.abs(angleDiff(s.tower, Math.atan2(dy, dx))) < s.fov / 2;
    }

    private explode(i: number, cx: number, cy: number, dealer: number): void {
        const snap = this.match.robotSnapshots[i] as RobotSnapshot;
        const robotId = this.robotIds[i] as string;
        this.burst(cx, cy, teamColor(snap.team), 22, 260, 200);
        this.burst(cx, cy, COLORS.white, 8, 140, 100);
        this.burst(cx, cy, COLORS.faintNum, 4, 60, -120);
        // Staged kill: trauma kick + hitstop + a ≤90 ms camera flash (all
        // skipped under reduced motion) + an expanding shockwave ring.
        this.addTrauma(0.7);
        if (!this.reducedMotion) {
            this.hitstop = Math.max(this.hitstop, 4);
            this.cameras.main.flash(70, 255, 255, 255);
        }
        this.fireRing(cx, cy, true);
        this.killZoom();
        this.placeSkull(cx, cy);
        this.fireBloom();
        playExplosion(snap.x);
        // Framed explosion from the pool (6 slots for 6 robots max), then a
        // persistent per-archetype wreck. The fallback allocates only if a
        // seventh flash is somehow live within 430 ms. Frame 1 holds 60 ms
        // (white flash), then fire → embers → smoke over ~600 ms staged.
        const pooled = this.booms.find((b) => !b.visible) ?? null;
        if (pooled) {
            pooled.setPosition(cx, cy).setTexture('boom_1').setVisible(true);
            this.time.delayedCall(60, () => pooled.setTexture('boom_2'));
            this.time.delayedCall(160, () => pooled.setTexture('boom_3'));
            this.time.delayedCall(260, () => pooled.setTexture('boom_4'));
            this.time.delayedCall(430, () => pooled.setVisible(false));
        } else {
            const boom = this.add.image(cx, cy, 'boom_1').setScale(3).setDepth(8);
            this.time.delayedCall(60, () => boom.setTexture('boom_2'));
            this.time.delayedCall(160, () => boom.setTexture('boom_3'));
            this.time.delayedCall(260, () => boom.setTexture('boom_4'));
            this.time.delayedCall(430, () => boom.destroy());
        }
        const wreck = this.add.image(cx, cy, wreckKey(robotId)).setScale(2).setDepth(3);
        wreck.setRotation(snap.heading + 0.5);
        wreck.setAlpha(0.95);
        // Wreck settle: Bounce ease-out + a dust kick (static when reduced).
        if (!this.reducedMotion) {
            wreck.setScale(2.6);
            this.tweens.add({ targets: wreck, scale: 2, duration: 380, ease: 'Bounce.easeOut' });
            this.burst(cx, cy + 10, COLORS.faintNum, 5, 70, 260);
        }
        const victim = (this.request.skins[i] as SlotSkin).callsign;
        if (!this.firstBlood) {
            this.firstBlood = true;
            this.queueBanner(BATTLE.bannerFirstBlood, COLORS.goldCss);
            playSting();
        }
        if (dealer >= 0 && dealer !== i) {
            const killer = this.request.skins[dealer] as SlotSkin;
            const ksnap = this.match.robotSnapshots[dealer] as RobotSnapshot;
            this.queueBanner(killCreditBanner(victim, killer.callsign, ksnap.kills), teamCss(ksnap.team));
        } else {
            this.queueBanner(destroyedBanner(victim));
        }
    }

    /** Screen shake as trauma: squared response, linear decay, kills only. */
    private addTrauma(amount: number): void {
        if (this.reducedMotion) return;
        this.trauma = Math.min(1, this.trauma + amount);
        this.traumaClean = false;
    }

    private updateTrauma(dt: number): void {
        if (this.reducedMotion || this.trauma <= 0) {
            if (!this.traumaClean) {
                this.cameras.main.setScroll(0, 0);
                this.traumaClean = true;
            }
            return;
        }
        this.trauma = Math.max(0, this.trauma - dt * 1.6);
        const mag = this.trauma * this.trauma * 14;
        if (this.trauma === 0) {
            this.cameras.main.setScroll(0, 0);
            this.traumaClean = true;
            return;
        }
        this.cameras.main.setScroll((Math.random() * 2 - 1) * mag, (Math.random() * 2 - 1) * mag);
    }

    /** Pad collect flash: active -> dark edge fires the pooled ring + burst. */
    private diffPads(): void {
        const pads = this.match.padSnapshots;
        pads.forEach((pad, i) => {
            const was = this.prevPadActive[i] ?? true;
            if (was && !pad.active) {
                const px = AX + pad.x;
                const py = AY + pad.y;
                this.fireRing(px, py, false);
                this.burst(px, py, padColor(pad.kind), 6, 120, 0);
            }
            this.prevPadActive[i] = pad.active;
        });
    }

    /** Diamond path (pad markers) on the dyn Graphics: caller strokes/fills. */
    private diamondPath(g: Phaser.GameObjects.Graphics, px: number, py: number, r: number): void {
        g.beginPath();
        g.moveTo(px, py - r);
        g.lineTo(px + r, py);
        g.lineTo(px, py + r);
        g.lineTo(px - r, py);
        g.closePath();
    }

    /** Shockwave ring from the pool: scale-out + fade (motion-gated). */
    private fireRing(x: number, y: number, big: boolean): void {
        if (this.reducedMotion) return;
        const ring = this.rings.find((r) => !r.visible) ?? null;
        if (!ring) return;
        ring.setPosition(x, y).setScale(0.75).setAlpha(0.95).setVisible(true);
        this.tweens.add({
            targets: ring,
            scale: big ? 6 : 3.5,
            alpha: 0,
            duration: big ? 450 : 320,
            ease: 'Cubic.easeOut',
            onComplete: () => ring.setVisible(false),
        });
    }

    /**
     * Kill-zoom: a 1.06 punch chained back to 1.0 on every kill. The deciding
     * kill instead opens the slow-mo window (0.25× acc-rate + results hold)
     * with a pre-fired verdict banner. All skipped under reduced motion;
     * results timing is unchanged there.
     */
    private killZoom(): void {
        if (this.reducedMotion || this.resultsShown) return;
        const snaps = this.match.robotSnapshots;
        let alive0 = 0;
        let alive1 = 0;
        for (const s of snaps) {
            if (!s.alive) continue;
            if (s.team === 0) alive0 += 1;
            else alive1 += 1;
        }
        const deciding = alive0 === 0 || alive1 === 0;
        const cam = this.cameras.main;
        if (deciding) {
            const winner: -1 | 0 | 1 = alive0 === 0 && alive1 === 0 ? -1 : alive0 === 0 ? 1 : 0;
            this.slowmoT = 0.8;
            this.queueBanner(
                resultsTitle(this.request.pilot === true, winner),
                winner === -1 ? COLORS.ink : teamCss(winner),
            );
            if (!this.zoomBusy) {
                this.zoomBusy = true;
                cam.zoomTo(1.12, 280, 'Quad.easeOut');
                this.time.delayedCall(800, () => {
                    cam.zoomTo(1.0, 300, 'Quad.easeInOut');
                    this.time.delayedCall(320, () => {
                        this.zoomBusy = false;
                    });
                });
            }
            return;
        }
        if (this.zoomBusy) return;
        this.zoomBusy = true;
        cam.zoomTo(1.06, 140, 'Quad.easeOut');
        this.time.delayedCall(150, () => {
            cam.zoomTo(1.0, 260, 'Quad.easeInOut');
            this.time.delayedCall(280, () => {
                this.zoomBusy = false;
            });
        });
    }

    private queueBanner(text: string, color: string = COLORS.ink): void {
        this.bannerQueue.push({ text, color });
        if (!this.bannerBusy) this.nextBanner();
    }

    private nextBanner(): void {
        const item = this.bannerQueue.shift();
        if (item === undefined) {
            this.bannerBusy = false;
            return;
        }
        this.bannerBusy = true;
        // Per-event edge color (stroke) + a 1.3→1.0 scale punch (gated).
        this.banner.setText(item.text).setAlpha(1).setY(AY + 56).setScale(1);
        this.banner.setStroke(item.color, 4);
        if (this.reducedMotion) {
            this.time.delayedCall(1300, () => {
                this.banner.setAlpha(0);
                this.nextBanner();
            });
            return;
        }
        this.banner.setScale(1.3);
        this.tweens.add({
            targets: this.banner,
            y: AY + 34,
            alpha: 0,
            scale: 1,
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

    /**
     * Damage-number tiers: 12px white hits, 16px gold + scale-pop for charged
     * and killing blows, 12px red SD ticks, green regen. Size AND color AND
     * motion carry the tier (never color-only); the pop is motion-gated.
     */
    private spawnDamageNumber(x: number, y: number, dmg: number, tier: 'hit' | 'charged' | 'kill' | 'sd' | 'heal'): void {
        const slot = this.dmgCursor;
        const text = this.dmgTexts[slot] as Phaser.GameObjects.Text;
        this.dmgCursor = (this.dmgCursor + 1) % this.dmgTexts.length;
        this.tweens.killTweensOf(text);
        const big = tier === 'charged' || tier === 'kill';
        text.setFontSize(big ? 16 : 12);
        text.setColor(
            tier === 'heal' ? COLORS.accentCss : tier === 'sd' ? COLORS.dangerCss : big ? COLORS.goldCss : COLORS.whiteCss,
        );
        text.setText(tier === 'heal' ? healText(dmg) : damageText(dmg));
        text.setPosition(x, y).setAlpha(1).setScale(1).setVisible(true);
        if (this.reducedMotion) {
            // Static show; the token keeps a stale timer from hiding a reuse.
            this.dmgToken[slot] = (this.dmgToken[slot] as number) + 1;
            const token = this.dmgToken[slot] as number;
            this.time.delayedCall(650, () => {
                if (this.dmgToken[slot] === token) text.setVisible(false);
            });
            return;
        }
        if (big) {
            text.setScale(1.4);
            this.tweens.add({ targets: text, scale: 1, duration: 180, ease: 'Back.easeOut' });
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
            // Recoil offset decays exponentially (snappy return, soft tail).
            const rec = this.recoil[i] as number;
            if (rec > 0) {
                const next = rec * Math.exp(-dt * 10);
                this.recoil[i] = next < 0.05 ? 0 : next;
            }
            // Twin double-tap: the second barrel lands 70 ms after the first.
            if ((this.kick2T[i] as number) > 0) {
                this.kick2T[i] = (this.kick2T[i] as number) - dt;
                if ((this.kick2T[i] as number) <= 0) this.recoil[i] = Math.max(this.recoil[i] as number, 3);
            }
            const dip = this.hubDip[i] as number;
            if (dip > 0) {
                const next = dip * Math.exp(-dt * 12);
                this.hubDip[i] = next < 0.05 ? 0 : next;
            }
            if ((this.empRingT[i] as number) > 0) this.empRingT[i] = (this.empRingT[i] as number) - dt;
            if ((this.punchT[i] as number) > 0) this.punchT[i] = (this.punchT[i] as number) - dt;
        }
        for (let i = this.indicators.length - 1; i >= 0; i -= 1) {
            const ind = this.indicators[i] as EdgeIndicator;
            ind.ttl -= dt;
            if (ind.ttl <= 0) this.indicators.splice(i, 1);
        }
    }

    private syncSprites(snaps: RobotSnapshot[], bullets: BulletSnapshot[], dt: number): void {
        const tick = this.match.result.tick;
        snaps.forEach((s, i) => {
            const cx = AX + s.x;
            const cy = AY + s.y;
            const body = this.chassis[i] as Phaser.GameObjects.Image;
            const tower = this.towers[i] as Phaser.GameObjects.Image;
            const hub = this.hubs[i] as Phaser.GameObjects.Image;
            const ring = (body as Phaser.GameObjects.Image & { ring?: Phaser.GameObjects.Graphics }).ring;
            const stripe = this.stripes[i] as Phaser.GameObjects.Rectangle;
            const skin = this.request.skins[i] as SlotSkin;
            const throes = (this.throesT[i] as number) > 0;
            const visible = s.alive || throes;
            // Staged-intro analytic phases (local time, 120 ms stagger):
            // hidden → drop (Cubic ease-in, −46 px) → power-on (Back
            // ease-out 1.2→2 + aura flash). Pure function of elapsed time,
            // so skip/pauses snap cleanly.
            let dropY = 0;
            let introAlpha = 1;
            let introScale = 2;
            let auraFlash = 0;
            if (this.introActive && !this.reducedMotion) {
                const lt = this.introElapsed - i * 0.12;
                if (lt < 0) {
                    introAlpha = 0;
                } else if (lt < 0.25) {
                    const t = lt / 0.25;
                    dropY = -46 * (1 - t * t * t);
                    introAlpha = t;
                } else {
                    if (!(this.introLanded[i] as boolean)) {
                        this.introLanded[i] = true;
                        this.burst(cx, cy + 10, COLORS.faintNum, 5, 70, 260);
                    }
                    const t = Math.min((lt - 0.25) / 0.25, 1);
                    const e = 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
                    introScale = 1.2 + 0.8 * e;
                    auraFlash = 1 - t;
                }
            }
            // Step delta (render-side, from position deltas): drives treads,
            // lean, and bob. Correct under pause/slow-mo by construction.
            const lx = this.treadLastX[i] as number;
            const ly = this.treadLastY[i] as number;
            const stepx = lx > -9998 ? s.x - lx : 0;
            const stepy = ly > -9998 ? s.y - ly : 0;
            this.treadLastX[i] = s.x;
            this.treadLastY[i] = s.y;
            const stepLen = Math.hypot(stepx, stepy);
            let ox = 0;
            let oy = 0;
            if (!this.reducedMotion) {
                // Speed lean (≤2 px along heading) + 1 px sinusoidal bob.
                const lean = Math.min(stepLen * 0.2, 2);
                ox = Math.cos(s.heading) * lean;
                oy = Math.sin(s.heading) * lean + Math.sin((tick + i * 9) / 5);
            }
            let px = cx + ox;
            let py = cy + oy + dropY;
            // Death-throes jitter: ±2.5 px shake (throes only run unreduced).
            if (throes) {
                px += (Math.random() * 2 - 1) * 2.5;
                py += (Math.random() * 2 - 1) * 2.5;
            }
            // Turret spring: critically-damped lag/overshoot (k~180, d~22).
            // Reduced motion keeps the direct set (no lag, no overshoot).
            let aim = s.tower;
            if (!this.reducedMotion && visible) {
                const err = wrapAngle(s.tower - (this.turA[i] as number));
                const v = (this.turV[i] as number) + (err * 180 - (this.turV[i] as number) * 22) * dt;
                this.turV[i] = v;
                this.turA[i] = (this.turA[i] as number) + v * dt;
                aim = this.turA[i] as number;
            } else {
                this.turA[i] = s.tower;
                this.turV[i] = 0;
            }
            // Treads: distance-keyed frame swap (static under reduced motion).
            const tread = this.treads[i] as Phaser.GameObjects.Image;
            tread.setVisible(visible && introAlpha > 0.05).setPosition(px, py).setRotation(s.heading);
            tread.setAlpha(introAlpha);
            if (visible && !this.reducedMotion) {
                this.treadAcc[i] = (this.treadAcc[i] as number) + stepLen;
                if ((this.treadAcc[i] as number) >= TREAD_SWAP_PX) {
                    this.treadAcc[i] = 0;
                    const flip = !(this.treadFlip[i] as boolean);
                    this.treadFlip[i] = flip;
                    tread.setTexture(flip ? 'treads_b' : 'treads_a');
                }
            }
            // Bake-time damage overlay below 35% HP (texture swap, no tint).
            const wantDmg = visible && s.health < s.maxHealth * 0.35;
            if (wantDmg !== this.damaged[i]) {
                this.damaged[i] = wantDmg;
                body.setTexture(chassisTeamKey(this.robotIds[i] as string, s.team, wantDmg));
            }
            // Hurt-flash: 2-frame white blink on the damaged chassis.
            // Slowed robots desaturate (tint) + carry the ❄ glyph instead.
            if ((this.hurtT[i] as number) > 0) {
                body.setTint(COLORS.white);
                this.hurtT[i] = (this.hurtT[i] as number) - 1;
            } else if (visible && s.slowed) {
                body.setTint(0x8fa3b8);
            } else {
                body.clearTint();
            }
            const aura = this.auras[i] as Phaser.GameObjects.Image;
            const charging = visible && s.charge > 0.05;
            const auraOn = charging || auraFlash > 0;
            aura.setVisible(auraOn && introAlpha > 0.05).setPosition(px, py);
            // Charge pulse: the aura throbs harder as the bank fills; full
            // charge pins it near-opaque (plus a muzzle pre-glow dot in dyn).
            if (auraOn) {
                const pulse = this.reducedMotion ? 0 : 0.12 * Math.sin(tick / 3) * s.charge;
                aura.setAlpha(Math.min(0.25 + 0.55 * Math.max(s.charge, auraFlash) + pulse, 1) * introAlpha);
            }
            if (auraOn && !this.reducedMotion) aura.setRotation(tick / 24);
            // Idle breathing: 2±0.03 (intro/throes own the scale otherwise).
            let chassisScale = introScale;
            if (!this.reducedMotion && !this.introActive) {
                chassisScale = throes ? 2 + Math.random() * 0.15 : 2 + 0.03 * Math.sin((tick + i * 13) / 14);
            }
            body
                .setVisible(visible && introAlpha > 0.05)
                .setPosition(px, py)
                .setRotation(s.heading)
                .setScale(chassisScale)
                .setAlpha(introAlpha);
            stripe
                .setVisible(visible && skin.finish === 'Stripe' && introAlpha > 0.05)
                .setPosition(px, py)
                .setRotation(s.heading)
                .setAlpha(introAlpha);
            const rec = this.recoil[i] as number;
            const tx = px - Math.cos(aim) * rec;
            const ty = py - Math.sin(aim) * rec;
            tower.setVisible(visible && introAlpha > 0.05).setPosition(tx, ty).setRotation(aim).setAlpha(introAlpha);
            // Scale punch: touch scale only across the punch window.
            if ((this.punchT[i] as number) > 0) {
                tower.setScale(2.3);
                this.punchOn[i] = true;
            } else if (this.punchOn[i] === true) {
                tower.setScale(2);
                this.punchOn[i] = false;
            }
            // Heavy hub dip: the hub presses back along the aim axis.
            const dip = this.hubDip[i] as number;
            hub
                .setVisible(visible && introAlpha > 0.05)
                .setPosition(tx - Math.cos(aim) * dip, ty - Math.sin(aim) * dip)
                .setRotation(0)
                .setAlpha(introAlpha);
            if (ring) ring.setVisible(visible).setPosition(px, py).setAlpha(introAlpha);
            // Muzzle flash + pooled ADD halo (90 ms, alongside muzzleLife).
            const muzzle = this.muzzles[i] as Phaser.GameObjects.Image;
            const show = visible && (this.muzzleLife[i] as number) > 0;
            const halo = this.halos[i] as Phaser.GameObjects.Image;
            muzzle.setVisible(show);
            halo.setVisible(show);
            if (show) {
                const hx = cx + Math.cos(aim) * 30;
                const hy = cy + Math.sin(aim) * 30;
                muzzle.setPosition(hx, hy);
                muzzle.setRotation(aim);
                halo.setPosition(hx, hy);
                halo.setAlpha(0.8);
                if (!this.reducedMotion) halo.setScale(2.2 + 0.5 * ((this.muzzleLife[i] as number) / 0.09));
            }
            // Health bar + name.
            const frac = Math.max(s.health, 0) / s.maxHealth;
            const bg = this.barBg[i] as Phaser.GameObjects.Rectangle;
            const ghost = this.barGhost[i] as Phaser.GameObjects.Rectangle;
            const fg = this.barFg[i] as Phaser.GameObjects.Rectangle;
            const plateOn = visible && introAlpha > 0.5;
            bg.setVisible(plateOn).setPosition(cx, cy - 28);
            // White ghost lag bar: drains toward the live value, snaps up.
            let gfrac = this.ghostFrac[i] as number;
            if (frac < gfrac) gfrac = Math.max(frac, gfrac - dt * 0.5);
            else gfrac = frac;
            this.ghostFrac[i] = gfrac;
            ghost.setVisible(plateOn).setPosition(cx - 22 + (44 * gfrac) / 2, cy - 28);
            ghost.setSize(44 * gfrac, 4);
            fg.setVisible(plateOn).setPosition(cx - 22 + (44 * frac) / 2, cy - 28);
            fg.setSize(44 * frac, 4);
            // Low-HP pulse + '!' glyph (static glyph when reduced).
            const lowHp = s.alive && frac <= 0.25;
            fg.setAlpha(lowHp && !this.reducedMotion ? 0.65 + 0.35 * Math.sin(tick / 4) : 1);
            const low = this.lowMark[i] as Phaser.GameObjects.Text;
            low.setVisible(lowHp && plateOn).setPosition(cx + 27, cy - 28);
            const slow = this.slowMark[i] as Phaser.GameObjects.Text;
            slow.setVisible(visible && s.slowed && plateOn).setPosition(cx - 29, cy - 28);
            const band = frac > 0.5 ? 2 : frac > 0.25 ? 1 : 0;
            if (band !== this.barBand[i]) {
                this.barBand[i] = band;
                fg.setFillStyle(band === 2 ? COLORS.accent : band === 1 ? COLORS.team[0] : COLORS.danger);
            }
            // Dead names stop persisting: the skull marker takes over.
            const label = this.nameTexts[i] as Phaser.GameObjects.Text;
            label.setVisible((s.alive || throes) && introAlpha > 0.5).setPosition(cx, cy - 40);
            // Cooldown readout under the chassis: sweep dials flank the icons
            // in dyn; the text keeps the D/E letters + seconds under 3 s.
            const dashReady = s.dashCd <= 0;
            const empReady = s.empCd <= 0;
            const pips = this.pipTexts[i] as Phaser.GameObjects.Text;
            pips.setVisible(plateOn).setPosition(cx, cy + 44);
            if (visible) {
                // Numeric gate first: skip the label build (strings + closures)
                // entirely when neither cooldown moved since last frame.
                let cdCached = this.pipCdCache[i];
                if (cdCached === undefined) {
                    cdCached = [-1, -1];
                    this.pipCdCache[i] = cdCached;
                }
                if (cdCached[0] !== s.dashCd || cdCached[1] !== s.empCd) {
                    cdCached[0] = s.dashCd;
                    cdCached[1] = s.empCd;
                    const text = cooldownLabel(s.dashCd, s.empCd);
                    if (text !== this.pipCache[i]) {
                        this.pipCache[i] = text;
                        pips.setText(text);
                        pips.setColor(dashReady && empReady ? '#7de08a' : '#9aa7b4');
                    }
                }
                // Ready pop on the false→true edge (motion-gated).
                if (!this.reducedMotion && ((dashReady && !this.prevDashReady[i]) || (empReady && !this.prevEmpReady[i]))) {
                    this.tweens.killTweensOf(pips);
                    pips.setScale(1.5);
                    this.tweens.add({ targets: pips, scale: 1, duration: 150, ease: 'Back.easeOut' });
                }
            }
            this.prevDashReady[i] = dashReady;
            this.prevEmpReady[i] = empReady;
            (this.iconDash[i] as Phaser.GameObjects.Image).setVisible(plateOn).setPosition(cx - 30, cy + 30);
            (this.iconEmp[i] as Phaser.GameObjects.Image).setVisible(plateOn).setPosition(cx + 30, cy + 30);
        });
        // Bullets from pool (tint only when the slot's team changes).
        // Cur/prev positions feed the dyn-Graphics hot-bullet tracers.
        let hot = false;
        this.bullets.forEach((img, i) => {
            this.prevBX[i] = this.curBX[i] as number;
            this.prevBY[i] = this.curBY[i] as number;
            const b = bullets[i];
            if (b === undefined) {
                // Live→gone edge: the slot's last known pos feeds impact
                // inference (prevBX still holds it — curBX is today's write).
                const lx = this.prevBX[i] as number;
                const ly = this.prevBY[i] as number;
                if (lx > -9998 && this.match.result.tick > 0) this.bulletGone(lx, ly);
                img.setVisible(false);
                this.bulletTeam[i] = null;
                this.hotSlot[i] = false;
                this.curBX[i] = -9999;
                this.curBY[i] = -9999;
                return;
            }
            this.curBX[i] = b.x;
            this.curBY[i] = b.y;
            this.hotSlot[i] = b.hot;
            if (b.hot) hot = true;
            img.setVisible(true).setPosition(AX + b.x, AY + b.y);
            const want = b.hot ? 'bullet_hot' : 'bullet';
            if (this.bulletTeam[i] !== b.team || img.texture.key !== want) {
                this.bulletTeam[i] = b.team;
                img.setTexture(want);
                img.setTint(bulletColor(b.team));
            }
        });
        this.hotLive = hot;
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
        // Anti-clutter rule: FOV cones dim while charged fire is live, paying
        // for the added tracer brightness (no net glow growth).
        const coneAlpha = this.hotLive ? 0.035 : 0.07;
        // Staged-intro telegraph rings: shrinking team circles on each pad
        // until its robot drops (drawn in dyn: zero new objects).
        if (this.introActive && !this.reducedMotion) {
            snaps.forEach((s, i) => {
                const lt = this.introElapsed - i * 0.12;
                if (lt >= 0.25) return;
                const t = Math.max(lt, 0) / 0.25;
                g.lineStyle(2, teamColor(s.team), 0.85);
                g.strokeCircle(AX + s.x, AY + s.y, 34 - 14 * t);
            });
        }
        // Powerup pads: team-neutral diamond/ring markers per kind. Active
        // pads pulse (outer ring = pickup radius); dark pads render dim.
        // Pixel-art: 2px strokes on dyn, zero new objects.
        for (const pad of this.match.padSnapshots) {
            const px = AX + pad.x;
            const py = AY + pad.y;
            const color = padColor(pad.kind);
            if (!pad.active) {
                g.lineStyle(2, color, 0.22);
                this.diamondPath(g, px, py, 9);
                g.strokePath();
                continue;
            }
            const pulse = this.reducedMotion ? 0.7 : 0.55 + 0.3 * Math.sin(this.match.result.tick * 0.15 + (pad.x + pad.y) * 0.01);
            g.lineStyle(2, color, pulse);
            g.strokeCircle(px, py, PAD_RADIUS);
            if (pad.kind === 'amp') {
                g.fillStyle(color, pulse);
                this.diamondPath(g, px, py, 9);
                g.fillPath();
            } else if (pad.kind === 'repair') {
                g.lineStyle(2, color, pulse);
                this.diamondPath(g, px, py, 9);
                g.strokePath();
                g.fillStyle(color, pulse);
                g.fillRect(px - 2, py - 6, 4, 12);
                g.fillRect(px - 6, py - 2, 12, 4);
            } else {
                g.lineStyle(2, color, pulse);
                g.strokeCircle(px, py, 13);
                this.diamondPath(g, px, py, 7);
                g.strokePath();
            }
        }
        for (const s of snaps) {
            if (!s.alive) continue;
            const cx = AX + s.x;
            const cy = AY + s.y;
            // Full-charge muzzle pre-glow dot (shape + position, not color-only).
            if (s.charge >= 1) {
                g.fillStyle(COLORS.gold, 0.9);
                g.fillCircle(cx + Math.cos(s.tower) * 32, cy + Math.sin(s.tower) * 32, 3);
            }
            const a0 = s.tower - s.fov / 2;
            const a1 = s.tower + s.fov / 2;
            g.fillStyle(teamColor(s.team), coneAlpha);
            g.fillTriangle(
                cx,
                cy,
                cx + Math.cos(a0) * s.scan,
                cy + Math.sin(a0) * s.scan,
                cx + Math.cos(a1) * s.scan,
                cy + Math.sin(a1) * s.scan,
            );
        }
        // Hot-bullet tracers: fixed-length streaks in dyn Graphics (no new
        // sprites), oriented by per-slot position deltas. Teleport-length
        // deltas mean pool-slot reuse, not motion — skipped.
        for (let i = 0; i < BULLET_POOL; i += 1) {
            if (!(this.hotSlot[i] as boolean)) continue;
            const team = this.bulletTeam[i];
            if (team === null || team === undefined) continue;
            const px = this.prevBX[i] as number;
            const py = this.prevBY[i] as number;
            const cx = this.curBX[i] as number;
            const cy = this.curBY[i] as number;
            if (px < -9998) continue;
            const dx = cx - px;
            const dy = cy - py;
            const len = Math.hypot(dx, dy);
            if (len < 0.5 || len > 40) continue;
            g.lineStyle(3, bulletColor(team), 0.65);
            g.lineBetween(AX + cx - (dx / len) * 26, AY + cy - (dy / len) * 26, AX + cx, AY + cy);
        }
        for (const ind of this.indicators) this.drawEdgeIndicator(g, ind);
        // Readability set (single dyn redraw, O(N²), N ≤ 6): HP divider
        // ticks, charge cast-bars, EMP rings, victim-centered threat arcs
        // (white = contested), focus-fire ▼, SD outside pips. The SD circle
        // itself is the pre-baked sprite now (syncSdRing), not dyn strokes.
        const tickNow = this.match.result.tick;
        const sdOn = this.match.result.suddenDeath;
        const circle = sdOn ? this.match.safeCircle : null;
        snaps.forEach((s, i) => {
            if (!s.alive) return;
            const cx = AX + s.x;
            const cy = AY + s.y;
            // HP staging: divider ticks every 25 HP across the bar.
            g.lineStyle(1, 0x000000, 0.8);
            for (let v = 25; v < s.maxHealth; v += 25) {
                const tx = cx - 22 + (44 * v) / s.maxHealth;
                g.lineBetween(tx, cy - 30, tx, cy - 26);
            }
            // Cooldown sweep dials: dash left, EMP right of the chassis.
            this.coolDial(g, cx - 13, cy + 30, s.dashCd, DASH_COOLDOWN_TICKS, s.team);
            this.coolDial(g, cx + 13, cy + 30, s.empCd, EMP_COOLDOWN_TICKS, s.team);
            // Charge cast-bar (bar + white MAX frame, not color-only).
            if (s.charge > 0.05) {
                g.fillStyle(0x000000, 0.7);
                g.fillRect(cx - 15, cy - 52, 30, 4);
                g.fillStyle(COLORS.gold, 0.95);
                g.fillRect(cx - 15, cy - 52, 30 * Math.min(s.charge, 1), 4);
                if (s.charge >= 1) {
                    g.lineStyle(1, COLORS.white, 0.9);
                    g.strokeRect(cx - 15, cy - 52, 30, 4);
                }
            }
            // EMP ring on the empCd edge: expands to EMP_RADIUS (static at
            // full radius under reduced motion).
            const et = this.empRingT[i] as number;
            if (et > 0) {
                const er = this.reducedMotion ? EMP_RADIUS : (0.5 - et) * (EMP_RADIUS / 0.5);
                g.lineStyle(2, 0x9be7ff, Math.min(et * 2, 1) * 0.7);
                g.strokeCircle(cx, cy, Math.max(er, 4));
            }
            // Victim-centered threat arcs: one attacker = their team color
            // facing them; ≥2 = white contested ring + gold focus ▼.
            let foes = 0;
            let foeX = 0;
            let foeY = 0;
            let foeTeam: 0 | 1 = 0;
            for (const f of snaps) {
                if (!f.alive || f.team === s.team) continue;
                if (!this.coneCovers(f, s.x, s.y)) continue;
                foes += 1;
                foeX = f.x;
                foeY = f.y;
                foeTeam = f.team;
                if (foes >= 2) break;
            }
            if (foes === 1) {
                const a = Math.atan2(foeY - s.y, foeX - s.x);
                g.lineStyle(2, teamColor(foeTeam), 0.85);
                g.beginPath();
                g.arc(cx, cy, 22, a - 0.5, a + 0.5);
                g.strokePath();
            } else if (foes >= 2) {
                g.lineStyle(2, COLORS.white, 0.9);
                g.strokeCircle(cx, cy, 22);
                g.fillStyle(COLORS.gold, 0.95);
                g.fillTriangle(cx - 6, cy - 58, cx + 6, cy - 58, cx, cy - 50);
            }
            // SD outside blink pip (2 Hz triangle below the robot).
            if (circle && Math.hypot(s.x - circle.x, s.y - circle.y) > circle.r && tickNow % 30 < 15) {
                g.fillStyle(COLORS.danger, 0.95);
                g.fillTriangle(cx - 6, cy + 50, cx + 6, cy + 50, cx, cy + 42);
            }
        });
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
                // Rim chevrons (pilot-only): one per live foe, pointing from
                // the pilot's hull toward them. Drawn through the shared
                // scratch indicator: zero per-frame allocation.
                for (const f of snaps) {
                    if (!f.alive || f.team === s0.team) continue;
                    this.chevScratch.vx = s0.x;
                    this.chevScratch.vy = s0.y;
                    this.chevScratch.ax = f.x;
                    this.chevScratch.ay = f.y;
                    this.chevScratch.team = f.team;
                    this.chevScratch.ttl = IND_TTL * 0.8;
                    this.drawEdgeIndicator(g, this.chevScratch);
                }
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

    private syncHud(snaps: RobotSnapshot[], bullets: BulletSnapshot[]): void {
        // SD escalation: 10 s pre-warning banner + red timer, then the
        // collapse banner. The danger-fill sprite + minimap echo ride along.
        const nowTick = this.match.result.tick;
        if (!this.sdWarned && !this.match.result.over && nowTick >= SD_WARN_TICK) {
            this.sdWarned = true;
            this.queueBanner(sdPreWarning(10), COLORS.dangerCss);
            this.hudTimer.setColor(COLORS.dangerCss);
        }
        if (this.match.result.suddenDeath && !this.sdAnnounced) {
            this.sdAnnounced = true;
            this.queueBanner(BATTLE.bannerSuddenDeath, COLORS.dangerCss);
        }
        // SD alarm, throttled ~1/s by tick (silent while paused).
        if (this.match.result.suddenDeath && !this.match.result.over) {
            const tick = this.match.result.tick;
            if (tick - this.lastSdCueTick >= 60) {
                this.lastSdCueTick = tick;
                playSuddenDeath();
            }
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
        // Minimap redraws at most every 3rd tick (perf budget).
        if (this.match.result.tick - this.lastMapTick >= 3 || this.match.result.over) {
            this.lastMapTick = this.match.result.tick;
            this.drawMinimap(snaps, bullets);
        }
        // Team plates refresh at 4 Hz (every 15 ticks).
        if (this.match.result.tick - this.lastPlateTick >= 15 || this.match.result.over) {
            this.lastPlateTick = this.match.result.tick;
            this.refreshPlates(snaps);
        }
    }

    /**
     * Team plates flanking the minimap: callsign, mini-HP, cooldowns,
     * loadout code, team totals; dead rows get ✕ + a drawn strike line.
     * Layout coordinated with the bottom strip (MENU/STEP left, PAUSE/SPEED
     * right, minimap center): T0 250–380, minimap panel 387–493, T1 500–630.
     */
    private buildPlates(): void {
        this.plateG = this.add.graphics().setDepth(11);
        for (const team of [0, 1] as const) {
            const cxp = team === 0 ? 315 : 565;
            this.add.rectangle(cxp, 738, 130, 60, COLORS.panel).setStrokeStyle(1, COLORS.panelEdge).setDepth(10);
            const head = this.add.text(cxp, 712, '', FONTS.monoSmall).setOrigin(0.5).setDepth(10);
            head.setColor(teamCss(team));
            this.plateHead.push(head);
            const rows: Phaser.GameObjects.Text[] = [];
            for (let r = 0; r < 3; r += 1) {
                rows.push(this.add.text(cxp - 61, 726 + r * 14, '', FONTS.buttonSmall).setOrigin(0, 0.5).setDepth(10));
            }
            this.plateRows.push(rows);
        }
    }

    private refreshPlates(snaps: RobotSnapshot[]): void {
        this.plateG.clear();
        for (const team of [0, 1] as const) {
            const cxp = team === 0 ? 315 : 565;
            const members: number[] = [];
            snaps.forEach((s, i) => {
                if (s.team === team) members.push(i);
            });
            let alive = 0;
            for (const i of members) {
                if ((snaps[i] as RobotSnapshot).alive) alive += 1;
            }
            (this.plateHead[team] as Phaser.GameObjects.Text).setText(plateTotal(team === 0 ? 1 : 2, alive, members.length));
            const rows = this.plateRows[team] as Phaser.GameObjects.Text[];
            rows.forEach((row, r) => {
                const i = members[r];
                if (i === undefined) {
                    row.setVisible(false);
                    return;
                }
                const s = snaps[i] as RobotSnapshot;
                const skin = this.request.skins[i] as SlotSkin;
                row.setVisible(true);
                if (s.alive) {
                    row.setText(plateRow(skin.callsign, Math.max(s.health, 0) / s.maxHealth, s.dashCd, s.empCd, loadoutCode(this.request.loadouts[i] as SkillLoadout)));
                    row.setColor(teamCss(team));
                } else {
                    row.setText(plateDeadRow(skin.callsign));
                    row.setColor(COLORS.faint);
                    // Struck-through dead: a drawn line (Text has no strike).
                    const y = 726 + r * 14;
                    this.plateG.lineStyle(1, COLORS.faintNum, 0.9);
                    this.plateG.lineBetween(cxp - 61, y, cxp + 61, y);
                }
            });
        }
    }

    /**
     * 96×64 minimap: obstacles, team dots + facing ticks, charged ■, dead
     * ✕, bullet dots, EMP rings, and the SD circle echo. Shape-redundant:
     * every state has a glyph, not just a color.
     */
    private drawMinimap(snaps: RobotSnapshot[], bullets: BulletSnapshot[]): void {
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
        if (this.match.result.suddenDeath) {
            const circle = this.match.safeCircle;
            g.lineStyle(1, COLORS.danger, 0.9);
            g.strokeCircle(
                MAP_X0 + (circle.x / ARENA_WIDTH) * MAP_W,
                MAP_Y0 + (circle.y / ARENA_HEIGHT) * MAP_H,
                Math.max((circle.r / ARENA_WIDTH) * MAP_W, 1),
            );
        }
        g.fillStyle(COLORS.white, 0.8);
        for (const b of bullets) {
            g.fillRect(MAP_X0 + (b.x / ARENA_WIDTH) * MAP_W, MAP_Y0 + (b.y / ARENA_HEIGHT) * MAP_H, 1.5, 1.5);
        }
        snaps.forEach((s, i) => {
            const mx = MAP_X0 + (s.x / ARENA_WIDTH) * MAP_W;
            const my = MAP_Y0 + (s.y / ARENA_HEIGHT) * MAP_H;
            if (s.alive) {
                if (s.charge >= 1) {
                    g.fillStyle(COLORS.gold, 1);
                    g.fillRect(mx - 2.5, my - 2.5, 5, 5);
                }
                g.fillStyle(teamColor(s.team), 1);
                g.fillCircle(mx, my, 2.5);
                g.lineStyle(1, COLORS.white, 0.9);
                g.lineBetween(mx, my, mx + Math.cos(s.heading) * 5, my + Math.sin(s.heading) * 5);
                if ((this.empRingT[i] as number) > 0) {
                    g.lineStyle(1, 0x9be7ff, 0.9);
                    g.strokeCircle(mx, my, 6);
                }
            } else {
                g.lineStyle(1, teamColor(s.team), 0.9);
                g.lineBetween(mx - 3, my - 3, mx + 3, my + 3);
                g.lineBetween(mx - 3, my + 3, mx + 3, my - 3);
            }
        });
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
        // Tournament battles settle into the stored bracket here (not on
        // button press) so MENU/BRACKET can't drop a watched result. Draws
        // use the same damage tiebreak as headless settling.
        const tourney = this.request.tournament;
        if (tourney !== undefined) {
            const idA = this.request.lineupIds[0] ?? '';
            const idB = this.request.lineupIds[1] ?? '';
            const winner =
                result.winner === 0 ? idA : result.winner === 1 ? idB : tiebreakWinner(this.match.robotSnapshots, idA, idB);
            settleTournamentMatch(tourney.round, tourney.index, winner, result.winner !== 0 && result.winner !== 1, result.tick);
        }
        stopMusic();
        if (result.winner === -1) {
            playDraw();
        } else if (this.request.pilot === true) {
            if (result.winner === 0) playWin();
            else playLose();
        } else {
            playWin();
        }
        const title = resultsTitle(this.request.pilot === true, result.winner);
        const color = result.winner === -1 ? COLORS.ink : teamCss(result.winner);
        // Results drama: dim → title slam → rows cascade (60 ms) → MVP line
        // → replay code + buttons. ≤1.2 s total, click-skippable, instant
        // under reduced motion. Everything is built up front (hidden unless
        // reduced) and revealed by the timeline or the skip handler.
        const R = this.reducedMotion;
        const backdrop = this.add
            .rectangle(512, 384, 620, 440, 0x0b0e12, R ? 0.94 : 0)
            .setStrokeStyle(2, COLORS.panelEdge)
            .setDepth(20);
        const titleObj = this.add.text(512, R ? 196 : 186, title, { ...FONTS.banner, color }).setOrigin(0.5).setDepth(20);
        if (!R) titleObj.setScale(1.8).setAlpha(0);
        const subObj = this.add
            .text(512, 232, resultsSub(this.request.seed, result.tick), FONTS.monoSmall)
            .setOrigin(0.5)
            .setDepth(20);
        if (!R) subObj.setAlpha(0);
        let tagObj: Phaser.GameObjects.Text | null = null;
        if (this.exhibition) {
            const parts = [...(this.customMatch ? [BATTLE.customRobotPart] : []), ...modifierCodes(this.request.modifiers)];
            tagObj = this.add
                .text(512, 250, exhibitionResultsLine(parts), {
                    ...FONTS.monoSmall,
                    color: COLORS.goldCss,
                })
                .setOrigin(0.5)
                .setDepth(20);
        } else if (this.request.showcase !== undefined) {
            tagObj = this.add
                .text(512, 250, showcaseResultsLine(), {
                    ...FONTS.monoSmall,
                    color: COLORS.goldCss,
                })
                .setOrigin(0.5)
                .setDepth(20);
        }
        if (tagObj && !R) tagObj.setAlpha(0);

        const snaps = this.match.robotSnapshots;
        const rowObjs: Phaser.GameObjects.Text[] = [];
        const skullObjs: Phaser.GameObjects.Image[] = [];
        snaps.forEach((s, i) => {
            const y = 274 + i * 30;
            const skin = this.request.skins[i] as SlotSkin;
            const row = resultRow(s.alive, skin.callsign, s.name, s.kills, Math.round(s.damageDealt), s.shotsFired);
            const x0 = R ? 232 : 220;
            const code = this.add.text(x0, y + 13, s.code, FONTS.monoSmall).setOrigin(0, 0.5).setDepth(20);
            code.setColor(COLORS.faint);
            const text = this.add.text(x0, y, row, FONTS.monoSmall).setOrigin(0, 0.5).setDepth(20);
            text.setColor(s.alive ? teamCss(s.team) : COLORS.faint);
            if (!R) {
                code.setAlpha(0);
                text.setAlpha(0);
            }
            rowObjs.push(code, text);
            // Skull icon paired with dead rows (icons never stand alone).
            if (!s.alive) {
                const skull = this.add.image(214, y, uiIconKey('skull')).setDepth(20);
                if (!R) skull.setAlpha(0);
                skullObjs.push(skull);
            }
            const hit = this.add.rectangle(512, y, 560, 26).setDepth(20);
            hit.setInteractive({ useHandCursor: true });
            hit.on('pointerdown', () => this.exportRobot(s.id));
        });
        const hintY = 274 + snaps.length * 30;
        // MVP line: most kills, damageDealt tiebreak — trophy icon + text.
        const mvpIdx = this.computeMvp(snaps);
        const mvpSnap = snaps[mvpIdx] as RobotSnapshot;
        const mvpSkin = this.request.skins[mvpIdx] as SlotSkin;
        const mvpObj = this.add
            .text(512, hintY, mvpLine(mvpSkin.callsign, mvpSnap.kills, mvpSnap.damageDealt), {
                ...FONTS.monoSmall,
                color: COLORS.goldCss,
            })
            .setOrigin(0.5)
            .setDepth(20);
        const trophy = this.add.image(512 - mvpObj.width / 2 - 14, hintY, uiIconKey('trophy')).setDepth(20);
        const hintObj = this.add.text(512, hintY + 20, BATTLE.exportHint, FONTS.small).setOrigin(0.5).setDepth(20);
        if (!R) {
            mvpObj.setAlpha(0);
            trophy.setAlpha(0);
            hintObj.setAlpha(0);
        }

        const code = encodeReplay({
            seed: this.request.seed,
            teamSize: this.request.teamSize,
            lineupIds: this.request.lineupIds,
            loadouts: this.request.loadouts,
            arena: this.request.arena,
            modifiers: this.request.modifiers,
        });
        let replayObjs: Phaser.GameObjects.GameObject[] = [];
        if (this.customMatch) {
            // The code can't restore imported robots, so don't show one.
            const unavail = this.add
                .text(512, hintY + 44, BATTLE.replayUnavailable, { ...FONTS.monoSmall, color: COLORS.goldCss })
                .setOrigin(0.5)
                .setDepth(20);
            if (!R) unavail.setAlpha(0);
            replayObjs = [unavail];
        } else {
            replayObjs = this.showReplayCode(code, hintY + 18, !R);
        }

        const showcase = this.request.showcase;
        const doRematch = (): void => {
            this.scene.restart({
                ...this.request,
                seed: (Math.random() * 0x7fffffff) | 0,
                replay: false,
                daily: undefined,
                tutorial: undefined,
            });
        };
        const hintKeys = (hint: string): void => {
            this.add.text(512, 614, hint, FONTS.monoSmall).setOrigin(0.5).setDepth(20);
        };
        const buildButtons = (): void => {
            this.resultsReady = true;
            if (tourney !== undefined) {
                const toBracket = (): void => {
                    this.scene.start('Tournament');
                };
                makeButton(this, 412, 566, 170, 44, COMMON.next, () => this.scene.start('Tournament', { autoWatch: true }), 21, 0, {
                    tier: 'primary',
                });
                makeButton(this, 612, 566, 170, 44, TOURNAMENT.bracket, toBracket, 21);
                this.resultsPrimary = () => this.scene.start('Tournament', { autoWatch: true });
                this.resultsSecondary = toBracket;
                hintKeys(resultsKeysHint(COMMON.next, TOURNAMENT.bracket));
            } else if (showcase?.reel) {
                this.showReelButtons(showcase.reel);
            } else if (showcase !== undefined) {
                makeButton(this, 412, 566, 170, 44, BATTLE.rematch, doRematch, 21, 0, { tier: 'primary' });
                makeButton(this, 612, 566, 170, 44, BATTLE.exitShowcase, () => this.scene.start('Showcase'), 21);
                this.resultsPrimary = doRematch;
                this.resultsSecondary = () => this.scene.start('Showcase');
                hintKeys(resultsKeysHint(BATTLE.rematch, BATTLE.exitShowcase));
            } else {
                makeButton(this, 412, 566, 170, 44, BATTLE.rematch, doRematch, 21, 0, { tier: 'primary' });
                makeButton(this, 612, 566, 170, 44, COMMON.menu, () => this.scene.start('Menu'), 21);
                this.resultsPrimary = doRematch;
                this.resultsSecondary = () => this.scene.start('Menu');
                hintKeys(resultsKeysHint(BATTLE.rematch, COMMON.menu));
            }
        };
        if (R) {
            buildButtons();
            return;
        }
        // Staged timeline (~0.95 s worst case): any click finishes instantly.
        let finished = false;
        let buttonsBuilt = false;
        const finish = (): void => {
            if (finished) return;
            finished = true;
            this.tweens.killTweensOf([backdrop, titleObj, subObj, ...rowObjs, ...skullObjs, mvpObj, trophy, hintObj, ...replayObjs]);
            backdrop.setAlpha(0.94);
            titleObj.setScale(1).setAlpha(1).setY(196);
            subObj.setAlpha(1);
            tagObj?.setAlpha(1);
            for (const o of rowObjs) o.setAlpha(1).setX(232);
            for (const o of skullObjs) o.setAlpha(1);
            mvpObj.setAlpha(1);
            trophy.setAlpha(1);
            hintObj.setAlpha(1);
            for (const o of replayObjs) (o as unknown as { setAlpha: (a: number) => void }).setAlpha(1);
            if (!buttonsBuilt) {
                buttonsBuilt = true;
                buildButtons();
            }
        };
        this.resultsFinish = finish;
        this.input.once('pointerdown', finish);
        this.tweens.add({ targets: backdrop, alpha: 0.94, duration: 150, ease: 'Quad.easeOut' });
        this.tweens.add({ targets: titleObj, scale: 1, alpha: 1, y: 196, duration: 180, delay: 120, ease: 'Cubic.easeIn' });
        const headliners: Phaser.GameObjects.Text[] = tagObj ? [subObj, tagObj] : [subObj];
        this.tweens.add({ targets: headliners, alpha: 1, duration: 150, delay: 200 });
        snaps.forEach((_s, k) => {
            this.tweens.add({
                targets: [rowObjs[k * 2] as Phaser.GameObjects.Text, rowObjs[k * 2 + 1] as Phaser.GameObjects.Text],
                alpha: 1,
                x: '+=12',
                duration: 150,
                delay: 320 + k * 60,
            });
        });
        if (skullObjs.length > 0) this.tweens.add({ targets: skullObjs, alpha: 1, duration: 200, delay: 340 });
        const tailT = 320 + snaps.length * 60;
        this.time.delayedCall(tailT, () => {
            if (!finished) this.tweens.add({ targets: [mvpObj, trophy, hintObj], alpha: 1, duration: 150 });
        });
        this.time.delayedCall(tailT + 140, () => {
            if (finished) return;
            this.tweens.add({ targets: replayObjs, alpha: 1, duration: 150 });
            buttonsBuilt = true;
            buildButtons();
        });
    }

    /** MVP: most kills, damageDealt tiebreak (render-side, existing data). */
    private computeMvp(snaps: RobotSnapshot[]): number {
        let best = 0;
        snaps.forEach((s, i) => {
            const b = snaps[best] as RobotSnapshot;
            if (s.kills > b.kills || (s.kills === b.kills && s.damageDealt > b.damageDealt)) best = i;
        });
        return best;
    }

    /** Reel results: NEXT steps the reel, EXIT returns to the showcase. */
    private showReelButtons(reel: { codes: string[]; index: number }): void {
        const hasNext = reel.index + 1 < reel.codes.length;
        if (hasNext) {
            makeButton(this, 412, 566, 170, 44, COMMON.next, () => this.advanceReel(), 21, 0, { tier: 'primary' });
        }
        makeButton(this, hasNext ? 612 : 512, 566, 170, 44, BATTLE.exitShowcase, () => this.scene.start('Showcase'), 21);
        this.resultsPrimary = () => this.advanceReel();
        this.resultsSecondary = () => this.scene.start('Showcase');
        this.add
            .text(512, 614, hasNext ? resultsKeysHint(COMMON.next, BATTLE.exitShowcase) : resultsKeyHint(BATTLE.exitShowcase), FONTS.monoSmall)
            .setOrigin(0.5)
            .setDepth(20);
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
            skins: data.lineupIds.map((id, i) => defaultSkin(CALLSIGNS[i % CALLSIGNS.length] ?? id, i, (i < data.teamSize ? 0 : 1) as 0 | 1)),
            trails: this.request.trails,
            seed: data.seed,
            arena: data.arena ?? 'open',
            modifiers: data.modifiers ?? {},
            showcase: { botId: showcase.botId, reel: { codes: [...reel.codes], index: reel.index + 1 } },
        } satisfies BattleRequest);
    }

    private showReplayCode(code: string, hintY: number, hidden = false): Phaser.GameObjects.GameObject[] {
        const copyLabel = this.add
            .text(512, hintY + 26, BATTLE.replayLabel, FONTS.monoSmall)
            .setOrigin(0.5)
            .setDepth(20);
        // Copy icon paired with the replay label (icons never stand alone).
        const icon = this.add.image(512 - copyLabel.width / 2 - 14, hintY + 26, uiIconKey('copy')).setDepth(20);
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
        if (hidden) {
            copyLabel.setAlpha(0);
            icon.setAlpha(0);
            codeText.setAlpha(0);
        }
        return [copyLabel, icon, codeText];
    }

    private exportRobot(id: number): void {
        const robotId = this.request.lineupIds[id] as string;
        const source = ROBOT_SOURCES[robotId];
        if (source === undefined) return;
        downloadText(tsFilename(robotId), source);
    }
}
