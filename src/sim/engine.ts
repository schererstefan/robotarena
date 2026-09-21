// Deterministic battle simulation. No Phaser imports here: this module runs
// identically in the browser and in headless Node soak tests.

import { AMP_MULT, AMP_TICKS, ARENA_HEIGHT, ARENA_WIDTH, BULLET_DAMAGE, BULLET_RADIUS, COMMS_DELAY, COMMS_INBOX_MAX, DASH_COOLDOWN_TICKS, DASH_DURATION_TICKS, DASH_SPEED_MULT, DT, EMP_COOLDOWN_TICKS, EMP_RADIUS, EMP_SLOW_MULT, EMP_SLOW_TICKS, MAX_TICKS, MAX_TICKS_TOTAL, OVERDRIVE_MULT, OVERDRIVE_TICKS, PAD_RADIUS, PAD_RESPAWN_TICKS, REPAIR_HP, REVERSE_FACTOR, ROBOT_RADIUS, SENSE_BULLETS_MAX, SENSE_EVENTS_MAX, SENSE_GRID_CELL, SENSE_GRID_H, SENSE_GRID_STAMP, SENSE_GRID_W, SENSOR_SHARE_DELAY, SPAWN_HEADING_JITTER, SPAWN_SALT, SPAWN_X, SPAWN_X_JITTER, SPAWN_Y_JITTER, SPAWN_Y_SHIFT, STRAFE_FACTOR, SUDDEN_DEATH_DAMAGE, SUDDEN_DEATH_PERIOD, SUDDEN_DEATH_TICKS, barriersForSeed, sanitizeModifiers, type ArenaId, type ArenaObstacle, type MatchModifiers } from './constants';
import { angleDiff, assistSteer, clamp, dist, toNumber, wrapAngle } from './math';
import { createRng } from './rng';
import { computeStats, loadoutCode, sanitizeLoadout, type RobotStats, type SkillLoadout } from './skills';
import { COMMS_KINDS, IDLE_INTENT, type CommsKind, type DamageSite, type InboxMessage, type Intent, type OutboxMessage, type RobotController, type SensedAlly, type SensedBullet, type SensedRobot, type SenseEvent, type SensePad, type SensePadKind, type SenseState, type TrackedFoe } from './types';

export interface RobotSnapshot {
    id: number;
    team: 0 | 1;
    name: string;
    x: number;
    y: number;
    heading: number;
    tower: number;
    health: number;
    maxHealth: number;
    alive: boolean;
    cooldown: number;
    kills: number;
    damageDealt: number;
    shotsFired: number;
    charge: number;
    charged: boolean;
    dashCd: number;
    empCd: number;
    slowed: boolean;
    code: string;
    scan: number;
    fov: number;
    errors: number;
}

export interface BulletSnapshot {
    x: number;
    y: number;
    team: 0 | 1;
    hot: boolean;
}

export interface MatchResult {
    over: boolean;
    /** Winning team, or -1 for a draw / undecided. */
    winner: -1 | 0 | 1;
    tick: number;
    /** True once the time cap passes and the safe circle starts shrinking. */
    suddenDeath: boolean;
}

export interface SafeCircle {
    x: number;
    y: number;
    r: number;
}

/** A hostile controller's meta getter must not break snapshots. */
function safeControllerName(controller: RobotController, id: number): string {
    try {
        return controller.meta?.name ?? `robot-${id}`;
    } catch {
        return `robot-${id}`;
    }
}

interface Robot {
    id: number;
    team: 0 | 1;
    controller: RobotController;
    loadout: SkillLoadout;
    stats: RobotStats;
    x: number;
    y: number;
    heading: number;
    tower: number;
    speed: number;
    health: number;
    cooldown: number;
    charge: number;
    dashCd: number;
    empCd: number;
    /** Exclusive tick: dashing while `tick < dashUntil`. */
    dashUntil: number;
    /** Exclusive tick: slowed while `tick < slowUntil`. */
    slowUntil: number;
    /** Exclusive tick: AMP bullet boost while `tick < ampUntil`. */
    ampUntil: number;
    /** Exclusive tick: OVERDRIVE speed boost while `tick < overdriveUntil`. */
    overdriveUntil: number;
    alive: boolean;
    kills: number;
    damageDealt: number;
    shotsFired: number;
    errors: number;
    lastDamage: DamageSite | null;
    /** Last cone sighting per foe id (engine-kept memory for `tracks`). */
    tracks: Map<number, { x: number; y: number; heading: number; speed: number; lastSeenTick: number }>;
}

interface Bullet {
    x: number;
    y: number;
    vx: number;
    vy: number;
    team: 0 | 1;
    owner: number;
    travelled: number;
    range: number;
    damage: number;
    speed: number;
}

/** One radio message in flight: delivered to living teammates COMMS_DELAY ticks later. */
interface PendingRadio {
    tick: number;
    team: 0 | 1;
    from: number;
    msg: OutboxMessage;
}

/** One ally's sighting of a foe: position only, delivered 30 ticks later. */
interface SharedSighting {
    tick: number;
    team: 0 | 1;
    foe: number;
    /** Observing ally: the observer never receives its own sighting back. */
    by: number;
    x: number;
    y: number;
}

export interface LineupEntry {
    team: 0 | 1;
    controller: RobotController;
    loadout?: SkillLoadout;
}

export interface MatchOptions {
    /** Arena layout. Unknown values fall back to `open`. Defaults to `open`. */
    arena?: ArenaId;
    /** Exhibition modifiers. Sanitized; defaults to none. */
    modifiers?: MatchModifiers;
}

function sanitizeRadio(raw: unknown): OutboxMessage | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'object') return null;
    const m = raw as Partial<OutboxMessage>;
    if (!(COMMS_KINDS as readonly unknown[]).includes(m.kind)) return null;
    const int = (value: unknown): number =>
        typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
    return {
        kind: m.kind as CommsKind,
        x: clamp(toNumber(m.x), 0, ARENA_WIDTH),
        y: clamp(toNumber(m.y), 0, ARENA_HEIGHT),
        foe: int(m.foe),
        role: int(m.role),
        slot: int(m.slot),
        bid: int(m.bid),
    };
}

/**
 * Strict intent sanitize: every field clamped day one, unknown mode values
 * fall to manual. Exported for the soak's sanitize unit checks.
 */
export function sanitizeIntent(raw: unknown): Required<Intent> {
    if (typeof raw !== 'object' || raw === null) return { ...IDLE_INTENT };
    const r = raw as Partial<Intent>;
    const aimTarget =
        typeof r.aimTarget === 'number' && Number.isFinite(r.aimTarget) ? Math.floor(r.aimTarget) : -1;
    return {
        throttle: clamp(toNumber(r.throttle), -1, 1),
        turn: clamp(toNumber(r.turn), -1, 1),
        towerTurn: clamp(toNumber(r.towerTurn), -1, 1),
        fire: r.fire === true,
        charge: r.charge === true,
        dash: r.dash === true,
        emp: r.emp === true,
        strafe: clamp(toNumber(r.strafe), -1, 1),
        moveX: clamp(toNumber(r.moveX), 0, ARENA_WIDTH),
        moveY: clamp(toNumber(r.moveY), 0, ARENA_HEIGHT),
        moveMode: r.moveMode === 1 ? 1 : 0,
        aimMode: r.aimMode === 1 ? 1 : r.aimMode === 2 ? 2 : 0,
        aimTarget,
        aimLead: r.aimLead === true,
        fireMode: r.fireMode === 1 ? 1 : 0,
        radio: sanitizeRadio(r.radio),
    };
}

export class Match {
    readonly robots: Robot[] = [];
    private bullets: Bullet[] = [];
    private tick = 0;
    private over = false;
    private winner: -1 | 0 | 1 = -1;
    private readonly seed: number;
    private readonly arena: ArenaId;
    private readonly mods: MatchModifiers;
    /** Seed-derived barrier rects for this match (`blocks` only, else empty). */
    private readonly barriers: ArenaObstacle[];
    /** Recent ally sightings, pruned to the last SENSOR_SHARE_DELAY ticks. */
    private sightings: SharedSighting[] = [];
    /** Radio messages in flight, pruned to the last COMMS_DELAY ticks. */
    private pendingRadio: PendingRadio[] = [];
    /** Per-team heat-map channels (index 0/1 by team), decayed each tick. */
    private gridFoes: number[][] = [[], []];
    private gridDanger: number[][] = [[], []];
    /** Events of the last completed step (delivered) and the current step (building), per robot id. */
    private prevEvents: SenseEvent[][] = [];
    private curEvents: SenseEvent[][] = [];
    /** Static powerup pads (seed-derived layout, per-tick state lives here). */
    private pads: SensePad[] = [];
    /** Pad pickup records in `tick:padIdx:robotId` order (fingerprint segment). */
    private padLog: string[] = [];

    constructor(lineups: LineupEntry[], seed: number, options: MatchOptions = {}) {
        this.seed = seed;
        this.arena = options.arena === 'blocks' ? 'blocks' : 'open';
        this.mods = sanitizeModifiers(options.modifiers);
        // Seed-derived, mirror-symmetric barriers: same seed => identical
        // layout, zero replay-codec bits. Dedicated stream, drawn once here.
        this.barriers = this.arena === 'blocks' ? barriersForSeed(seed >>> 0) : [];
        const spawns = Match.computeSpawns(lineups, seed);
        lineups.forEach((entry, index) => {
            const spawn = spawns[index] as { x: number; y: number; heading: number };
            // Guarded: hostile getters on the entry/controller must not kill setup.
            let loadout: SkillLoadout = {};
            let setupErrors = 0;
            try {
                loadout = sanitizeLoadout(entry.loadout ?? entry.controller.loadout ?? {});
            } catch {
                setupErrors = 1;
            }
            const stats = computeStats(loadout);
            // Hardcore fog halves every robot's sensor range (visible in stats).
            if (this.mods.hardcoreFog === true) stats.sensorRange *= 0.5;
            this.robots.push({
                id: index,
                team: entry.team,
                controller: entry.controller,
                loadout,
                stats,
                x: spawn.x,
                y: spawn.y,
                heading: spawn.heading,
                tower: spawn.heading,
                speed: 0,
                health: stats.maxHealth,
                cooldown: 0,
                charge: 0,
                dashCd: 0,
                empCd: 0,
                dashUntil: -1,
                slowUntil: -1,
                ampUntil: -1,
                overdriveUntil: -1,
                alive: true,
                kills: 0,
                damageDealt: 0,
                shotsFired: 0,
                errors: setupErrors,
                lastDamage: null,
                tracks: new Map(),
            });
            this.prevEvents.push([]);
            this.curEvents.push([]);
        });
        const cells = SENSE_GRID_W * SENSE_GRID_H;
        this.gridFoes = [new Array<number>(cells).fill(0), new Array<number>(cells).fill(0)];
        this.gridDanger = [new Array<number>(cells).fill(0), new Array<number>(cells).fill(0)];
        // Seed-derived pad layout (symmetric, public): ready before onSpawn
        // so the first sense already carries the pads.
        this.pads = Match.padLayout(seed);
        // Aim towers at the nearest foe and fire spawn hooks in fixed order.
        for (const robot of this.robots) {
            const foe = this.nearestFoe(robot);
            if (foe) robot.tower = Math.atan2(foe.y - robot.y, foe.x - robot.x);
            if (robot.controller.onSpawn) {
                try {
                    robot.controller.onSpawn(this.sense(robot));
                } catch {
                    robot.errors += 1;
                }
            }
        }
    }

    get result(): MatchResult {
        return { over: this.over, winner: this.winner, tick: this.tick, suddenDeath: this.tick >= MAX_TICKS };
    }

    /** Sudden-death safe circle: arena center, shrinking to zero past the cap. */
    get safeCircle(): SafeCircle {
        const full = Math.hypot(ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
        const past = this.tick - MAX_TICKS;
        const r = past <= 0 ? full : Math.max(0, full * (1 - past / SUDDEN_DEATH_TICKS));
        return { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2, r };
    }

    get arenaId(): ArenaId {
        return this.arena;
    }

    /** Barrier rects for this match (renderer + tests). Copies: mutate freely. */
    get obstacles(): ArenaObstacle[] {
        return this.barriers.map((o) => ({ ...o }));
    }

    /** Sanitized exhibition modifiers for this match. */
    get modifiers(): MatchModifiers {
        return { ...this.mods };
    }

    /**
     * Seed-derived powerup pad layout: 4 pads at fixed arena fractions
     * (0.22/0.78 x by 0.30/0.70 y), mirrored through the arena center.
     * Kinds cycle [amp, repair, overdrive] with a seed offset; each
     * center-mirror pair shares a kind so neither team gains an edge.
     * Pure function of the seed: no Math.random, no wall-clock.
     */
    static padLayout(seed: number): SensePad[] {
        const fx = [0.22, 0.78, 0.22, 0.78];
        const fy = [0.3, 0.3, 0.7, 0.7];
        // Center-mirror pairs: 0 <-> 3, 1 <-> 2.
        const pairOf = [0, 1, 1, 0];
        const cycle: SensePadKind[] = ['amp', 'repair', 'overdrive'];
        const offset = (seed >>> 0) % cycle.length;
        return fx.map((x, i) => ({
            x: (x as number) * ARENA_WIDTH,
            y: (fy[i] as number) * ARENA_HEIGHT,
            kind: cycle[(offset + (pairOf[i] as number)) % cycle.length] as SensePadKind,
            active: true,
            respawnIn: 0,
        }));
    }

    /** Powerup pads in fixed pad order (fresh copies each read). */
    get padSnapshots(): SensePad[] {
        return this.pads.map((p) => ({ ...p }));
    }

    /** Pad pickup records (`tick:padIdx:robotId`), in pickup order. */
    get pickupLog(): string[] {
        return [...this.padLog];
    }

    /** Remaining pad-effect ticks for one robot (AMP, OVERDRIVE), clamped at 0. */
    effectTicks(id: number): { amp: number; overdrive: number } {
        const robot = this.robots[id] as unknown as Robot | undefined;
        if (!robot) return { amp: 0, overdrive: 0 };
        return {
            amp: Math.max(0, robot.ampUntil - this.tick),
            overdrive: Math.max(0, robot.overdriveUntil - this.tick),
        };
    }

    get robotSnapshots(): RobotSnapshot[] {
        return this.robots.map((r) => ({
            id: r.id,
            team: r.team,
            name: safeControllerName(r.controller, r.id),
            x: r.x,
            y: r.y,
            heading: r.heading,
            tower: r.tower,
            health: r.health,
            maxHealth: r.stats.maxHealth,
            alive: r.alive,
            cooldown: r.cooldown,
            kills: r.kills,
            damageDealt: r.damageDealt,
            shotsFired: r.shotsFired,
            charge: r.charge,
            charged: r.charge >= 1,
            dashCd: r.dashCd,
            empCd: r.empCd,
            slowed: this.tick < r.slowUntil,
            code: loadoutCode(r.loadout),
            scan: r.stats.sensorRange,
            fov: r.stats.sensorFov,
            errors: r.errors,
        }));
    }

    get bulletSnapshots(): BulletSnapshot[] {
        return this.bullets.map((b) => ({ x: b.x, y: b.y, team: b.team, hot: b.damage > BULLET_DAMAGE }));
    }

    step(): void {
        if (this.over) return;
        // Fresh event buffer for this step; the brains below still read the
        // last completed step's events via prevEvents.
        this.curEvents = this.robots.map(() => []);
        // Drop sightings too old to ever be delivered (exact-delay window).
        if (this.sightings.length > 0 && this.tick > SENSOR_SHARE_DELAY) {
            const cutoff = this.tick - SENSOR_SHARE_DELAY;
            this.sightings = this.sightings.filter((s) => s.tick >= cutoff);
        }
        // Drop radio too old to ever be delivered (exact-delay window).
        if (this.pendingRadio.length > 0 && this.tick > COMMS_DELAY) {
            const cutoff = this.tick - COMMS_DELAY;
            this.pendingRadio = this.pendingRadio.filter((p) => p.tick >= cutoff);
        }
        // 1. Brains: fixed robot order keeps the shared RNG stream deterministic.
        const intents = this.robots.map((robot) => {
            if (!robot.alive) return { ...IDLE_INTENT };
            try {
                return sanitizeIntent(robot.controller.update(this.sense(robot)));
            } catch {
                robot.errors += 1;
                return { ...IDLE_INTENT };
            }
        });
        // 1b. Radio collection: the engine only routes. Dead robots never
        // reach this (idle intents carry no radio); foe-id liveness is
        // validated at the send tick (-1 = no foe).
        this.robots.forEach((robot, i) => {
            if (!robot.alive) return;
            const radio = (intents[i] as Required<Intent>).radio;
            if (!radio) return;
            if (!(COMMS_KINDS as readonly unknown[]).includes(radio.kind)) return;
            if (radio.foe !== -1) {
                const foe = this.robots[radio.foe] as Robot | undefined;
                if (!foe || !foe.alive || foe.team === robot.team) return;
            }
            this.pendingRadio.push({ tick: this.tick, team: robot.team, from: robot.id, msg: { ...radio } });
        });
        // 2. Actives: dash bursts and EMP pulses trigger before the drive so
        // they apply the same tick. Positions are pre-move for every robot.
        this.robots.forEach((robot, i) => {
            if (!robot.alive) return;
            const intent = intents[i] as Required<Intent>;
            if (intent.dash === true && robot.dashCd <= 0) {
                robot.dashCd = DASH_COOLDOWN_TICKS;
                robot.dashUntil = this.tick + DASH_DURATION_TICKS;
            }
            if (intent.emp === true && robot.empCd <= 0) {
                robot.empCd = EMP_COOLDOWN_TICKS;
                for (const other of this.robots) {
                    if (!other.alive || other.team === robot.team || other.id === robot.id) continue;
                    if (dist(robot.x, robot.y, other.x, other.y) <= EMP_RADIUS) {
                        other.slowUntil = this.tick + EMP_SLOW_TICKS;
                    }
                }
            }
        });
        // 3. Drive + towers + charge. Application order: radio collection
        // first (step 1b), then move assist (overrides throttle/turn), then
        // drive normalize (forward + strafe never exceed top speed), then
        // turret assist, then fire below.
        this.robots.forEach((robot, i) => {
            if (!robot.alive) return;
            const intent = intents[i] as Required<Intent>;
            const canCharge = robot.stats.chargeMult > 1;
            const charging = intent.charge && canCharge && robot.cooldown <= 0;
            if (charging) {
                robot.charge = Math.min(1, robot.charge + 1 / robot.stats.chargeTicks);
            } else {
                robot.charge = Math.max(0, robot.charge - DT / 4); // bank decays in ~4s
            }
            let throttle = intent.throttle;
            let turn = intent.turn;
            if (intent.moveMode === 1) {
                const assist = assistSteer(robot.heading, intent.moveX, intent.moveY, robot.x, robot.y);
                throttle = assist.throttle;
                turn = assist.turn;
            }
            const slow = intent.charge && canCharge ? 0.75 : 1;
            const dashing = this.tick < robot.dashUntil;
            const slowed = this.tick < robot.slowUntil;
            const overdrive = this.tick < robot.overdriveUntil ? OVERDRIVE_MULT : 1;
            const top = robot.stats.maxSpeed * slow * (dashing ? DASH_SPEED_MULT : 1) * (slowed ? EMP_SLOW_MULT : 1) * overdrive;
            let forward = throttle >= 0 ? throttle : throttle * REVERSE_FACTOR;
            let lateral = intent.strafe * STRAFE_FACTOR;
            const driveMag = Math.hypot(forward, lateral);
            if (driveMag > 1) {
                forward /= driveMag;
                lateral /= driveMag;
            }
            const dv = clamp(forward * top - robot.speed, -robot.stats.accel * DT, robot.stats.accel * DT);
            robot.speed += dv;
            robot.heading = wrapAngle(robot.heading + turn * robot.stats.turnRate * DT);
            let towerTurn = intent.towerTurn;
            if (intent.aimMode !== 0) {
                const solution = this.aimSolution(robot, intent.aimTarget, intent.aimMode === 2 || intent.aimLead);
                if (solution !== null) towerTurn = clamp(angleDiff(robot.tower, solution) * 3, -1, 1);
            }
            robot.tower = wrapAngle(robot.tower + towerTurn * robot.stats.towerRate * DT);
            robot.x += (Math.cos(robot.heading) * robot.speed - Math.sin(robot.heading) * lateral * top) * DT;
            robot.y += (Math.sin(robot.heading) * robot.speed + Math.cos(robot.heading) * lateral * top) * DT;
            if (robot.cooldown > 0) robot.cooldown -= 1;
            if (robot.dashCd > 0) robot.dashCd -= 1;
            if (robot.empCd > 0) robot.empCd -= 1;
            if (robot.stats.regen > 0 && robot.health < robot.stats.maxHealth) {
                robot.health = Math.min(robot.stats.maxHealth, robot.health + robot.stats.regen * DT);
            }
        });
        this.collideWalls();
        this.collideRobots();
        this.collideObstacles();
        this.collideWalls(); // separation can shove robots past the walls
        // 4. Fire guns.
        this.robots.forEach((robot, i) => {
            if (!robot.alive) return;
            const intent = intents[i] as Required<Intent>;
            let shoot = intent.fire;
            if (!shoot && intent.fireMode === 1 && intent.aimMode !== 0 && robot.cooldown <= 0) {
                const solution = this.aimSolution(robot, intent.aimTarget, intent.aimMode === 2 || intent.aimLead);
                shoot = solution !== null && Math.abs(angleDiff(robot.tower, solution)) < 0.07;
            }
            if (shoot && robot.cooldown <= 0) {
                robot.cooldown = robot.stats.cooldownTicks;
                robot.shotsFired += 1;
                // AMP does NOT stack with the doubleDamage modifier:
                // the strongest multiplier wins.
                const modMult = this.mods.doubleDamage === true ? 2 : 1;
                const ampMult = this.tick < robot.ampUntil ? AMP_MULT : 1;
                const damage = robot.stats.damage * Math.max(modMult, ampMult) * (1 + robot.charge * (robot.stats.chargeMult - 1));
                robot.charge = 0;
                this.bullets.push({
                    x: robot.x + Math.cos(robot.tower) * (ROBOT_RADIUS + 4),
                    y: robot.y + Math.sin(robot.tower) * (ROBOT_RADIUS + 4),
                    vx: Math.cos(robot.tower) * robot.stats.bulletSpeed,
                    vy: Math.sin(robot.tower) * robot.stats.bulletSpeed,
                    team: robot.team,
                    owner: robot.id,
                    travelled: ROBOT_RADIUS + 4, // muzzle starts ahead of center
                    range: robot.stats.gunRange,
                    damage,
                    speed: robot.stats.bulletSpeed,
                });
            }
        });
        // 5. Bullets.
        this.stepBullets();
        // 5b. Powerup pads (P1 slot: right after bullets, before hazards).
        this.stepPads();
        // 6. Sudden death: past the cap, robots outside the circle pulse damage.
        if (this.tick >= MAX_TICKS) this.suddenDeath();
        // 7. Sense channels: freeze this step's events for delivery and roll
        // the team heat-maps forward (decay, then stamp fresh sightings).
        this.prevEvents = this.curEvents;
        this.updateGrid();
        this.tick += 1;
        this.checkEnd();
    }

    /** Queue a per-tick event for one robot (sorted + capped at delivery). */
    private emit(to: number, event: Omit<SenseEvent, 'tick'>): void {
        (this.curEvents[to] as SenseEvent[]).push({ ...event, tick: this.tick });
    }

    /** Eliminate a robot, notifying the killer plus living teammates and foes. */
    private slay(victim: Robot, killerId: number | null): void {
        victim.health = 0;
        victim.alive = false;
        // Death clears timed pad effects (no drops).
        victim.ampUntil = -1;
        victim.overdriveUntil = -1;
        if (killerId !== null) {
            const killer = this.robots[killerId] as Robot | undefined;
            if (killer) {
                killer.kills += 1;
                this.emit(killer.id, { kind: 'kill', fromId: victim.id });
            }
        }
        for (const other of this.robots) {
            if (!other.alive || other.id === victim.id) continue;
            this.emit(other.id, {
                kind: other.team === victim.team ? 'ally-down' : 'foe-down',
                fromId: victim.id,
            });
        }
    }

    /** Heat-map cell index for an arena position. */
    private static gridCell(x: number, y: number): number {
        const cx = clamp(Math.floor(x / SENSE_GRID_CELL), 0, SENSE_GRID_W - 1);
        const cy = clamp(Math.floor(y / SENSE_GRID_CELL), 0, SENSE_GRID_H - 1);
        return cy * SENSE_GRID_W + cx;
    }

    /** Stamp recent damage onto the victim's team heat-map. */
    private stampDanger(victim: Robot, amount: number): void {
        const channel = this.gridDanger[victim.team] as number[];
        const cell = Match.gridCell(victim.x, victim.y);
        channel[cell] = Math.min(99, (channel[cell] as number) + Math.max(1, Math.round(amount)));
    }

    /** Decay both team heat-maps by 1, then refresh sighted foe cells. */
    private updateGrid(): void {
        for (const team of [0, 1] as const) {
            const foes = this.gridFoes[team] as number[];
            const danger = this.gridDanger[team] as number[];
            for (let i = 0; i < foes.length; i += 1) {
                if ((foes[i] as number) > 0) foes[i] = (foes[i] as number) - 1;
                if ((danger[i] as number) > 0) danger[i] = (danger[i] as number) - 1;
            }
        }
        for (const robot of this.robots) {
            if (!robot.alive) continue;
            const channel = this.gridFoes[robot.team] as number[];
            for (const foe of this.robots) {
                if (!foe.alive || foe.team === robot.team) continue;
                if (!Match.sees(robot, foe)) continue;
                const cell = Match.gridCell(foe.x, foe.y);
                if ((channel[cell] as number) < SENSE_GRID_STAMP) channel[cell] = SENSE_GRID_STAMP;
            }
        }
    }

    /**
     * Whisker range-finder: distance from the chassis edge to the nearest
     * wall or block along the heading ray. O(4 obstacles); the walls always
     * hit, so the result is finite.
     */
    private whiskerAhead(robot: Robot): number {
        const dx = Math.cos(robot.heading);
        const dy = Math.sin(robot.heading);
        let best = Infinity;
        if (dx > 0) best = Math.min(best, (ARENA_WIDTH - robot.x) / dx);
        else if (dx < 0) best = Math.min(best, (0 - robot.x) / dx);
        if (dy > 0) best = Math.min(best, (ARENA_HEIGHT - robot.y) / dy);
        else if (dy < 0) best = Math.min(best, (0 - robot.y) / dy);
        for (const o of this.barriers) {
            const t = Match.rayBox(robot.x, robot.y, dx, dy, o);
            if (t !== null && t < best) best = t;
        }
        return Math.max(0, best - ROBOT_RADIUS);
    }

    /** Ray vs rect entry distance, or null on a miss (slab method). */
    private static rayBox(
        x: number, y: number, dx: number, dy: number,
        o: { x: number; y: number; w: number; h: number },
    ): number | null {
        let tmin = 0;
        let tmax = Infinity;
        if (dx !== 0) {
            const t1 = (o.x - x) / dx;
            const t2 = (o.x + o.w - x) / dx;
            tmin = Math.max(tmin, Math.min(t1, t2));
            tmax = Math.min(tmax, Math.max(t1, t2));
        } else if (x < o.x || x > o.x + o.w) {
            return null;
        }
        if (dy !== 0) {
            const t1 = (o.y - y) / dy;
            const t2 = (o.y + o.h - y) / dy;
            tmin = Math.max(tmin, Math.min(t1, t2));
            tmax = Math.min(tmax, Math.max(t1, t2));
        } else if (y < o.y || y > o.y + o.h) {
            return null;
        }
        return tmax >= tmin ? tmin : null;
    }

    /**
     * Step until the match ends. `maxGuard` bounds the step count so a
     * stuck match cannot hang a harness; the default covers the full
     * sudden-death tail with slack.
     */
    runToEnd(maxGuard: number = MAX_TICKS_TOTAL + 10): void {
        let guard = 0;
        while (!this.over && guard <= maxGuard) {
            this.step();
            guard += 1;
        }
    }

    /**
     * Turret-assist solution: the tower angle for `aimTarget` from the best
     * legal knowledge — live cone sighting (lead-capable), scout blip, stale
     * shared sighting, stale track — or null for manual fallback (dead, ally,
     * self, unknown id, or never seen).
     */
    private aimSolution(robot: Robot, targetId: number, lead: boolean): number | null {
        const foe = this.robots[targetId] as Robot | undefined;
        if (!foe || !foe.alive || foe.team === robot.team || foe.id === robot.id) return null;
        if (Match.sees(robot, foe)) {
            if (lead) {
                const flight = dist(robot.x, robot.y, foe.x, foe.y) / robot.stats.bulletSpeed;
                const px = foe.x + Math.cos(foe.heading) * foe.speed * flight;
                const py = foe.y + Math.sin(foe.heading) * foe.speed * flight;
                return Math.atan2(py - robot.y, px - robot.x);
            }
            return Math.atan2(foe.y - robot.y, foe.x - robot.x);
        }
        if (robot.stats.scoutRange > 0 && dist(robot.x, robot.y, foe.x, foe.y) <= robot.stats.scoutRange) {
            return Math.atan2(foe.y - robot.y, foe.x - robot.x);
        }
        const want = this.tick - SENSOR_SHARE_DELAY;
        if (want >= 0) {
            for (const s of this.sightings) {
                if (s.tick === want && s.team === robot.team && s.by !== robot.id && s.foe === foe.id) {
                    return Math.atan2(s.y - robot.y, s.x - robot.x);
                }
            }
        }
        const track = robot.tracks.get(foe.id);
        if (track) return Math.atan2(track.y - robot.y, track.x - robot.x);
        return null;
    }

    /** True when the viewer's sensor cone currently covers the target. */
    private static sees(viewer: Robot, target: Robot): boolean {
        const d = dist(viewer.x, viewer.y, target.x, target.y);
        if (d > viewer.stats.sensorRange) return false;
        const bearing = Math.atan2(target.y - viewer.y, target.x - viewer.x);
        return Math.abs(angleDiff(viewer.tower, bearing)) <= viewer.stats.sensorFov / 2;
    }

    /** Record what this robot's allies see right now for delayed delivery. */
    private recordAllySightings(robot: Robot): void {
        for (const ally of this.robots) {
            if (!ally.alive || ally.team !== robot.team || ally.id === robot.id) continue;
            for (const foe of this.robots) {
                if (!foe.alive || foe.team === robot.team) continue;
                if (!Match.sees(ally, foe)) continue;
                const known = this.sightings.some(
                    (s) => s.tick === this.tick && s.team === robot.team && s.foe === foe.id && s.by === ally.id,
                );
                if (!known) {
                    this.sightings.push({ tick: this.tick, team: robot.team, foe: foe.id, by: ally.id, x: foe.x, y: foe.y });
                }
            }
        }
    }

    /** Teammates' radio from exactly COMMS_DELAY ticks ago, sorted (sent,from), capped. */
    private inboxFor(robot: Robot): InboxMessage[] {
        const want = this.tick - COMMS_DELAY;
        if (want < 0) return [];
        const inbox: InboxMessage[] = [];
        for (const p of this.pendingRadio) {
            if (p.tick !== want || p.team !== robot.team || p.from === robot.id) continue;
            const sender = this.robots[p.from] as Robot | undefined;
            if (!sender || !sender.alive) continue;
            inbox.push({ ...p.msg, from: p.from, sent: p.tick });
        }
        inbox.sort((a, b) => a.sent - b.sent || a.from - b.from);
        return inbox.slice(0, COMMS_INBOX_MAX);
    }

    /** Ally sightings from exactly SENSOR_SHARE_DELAY ticks ago. */
    private sharedSightings(robot: Robot, ownFoeIds: Set<number>): SensedRobot[] {
        const shared: SensedRobot[] = [];
        const want = this.tick - SENSOR_SHARE_DELAY;
        if (want < 0) return shared;
        for (const s of this.sightings) {
            if (s.tick !== want || s.team !== robot.team || s.by === robot.id || ownFoeIds.has(s.foe)) continue;
            const foe = this.robots[s.foe] as Robot | undefined;
            if (!foe || !foe.alive || foe.team === robot.team) continue;
            shared.push({
                id: foe.id,
                team: foe.team,
                x: s.x,
                y: s.y,
                heading: 0,
                speed: 0,
                health: 0,
                distance: dist(robot.x, robot.y, s.x, s.y),
                bearing: Math.atan2(s.y - robot.y, s.x - robot.x),
            });
        }
        shared.sort((a, b) => a.distance - b.distance || a.id - b.id);
        return shared;
    }

    private sense(robot: Robot): SenseState {
        const foes: SensedRobot[] = [];
        const allies: SensedAlly[] = [];
        const scout: SensedRobot[] = [];
        for (const other of this.robots) {
            if (other.id === robot.id || !other.alive) continue;
            const d = dist(robot.x, robot.y, other.x, other.y);
            const bearing = Math.atan2(other.y - robot.y, other.x - robot.x);
            if (other.team === robot.team) {
                allies.push({
                    id: other.id,
                    team: other.team,
                    x: other.x,
                    y: other.y,
                    heading: other.heading,
                    speed: other.speed,
                    health: other.health,
                    distance: d,
                    bearing,
                    tower: other.tower,
                    cooldown: other.cooldown,
                    charge: other.charge,
                    charged: other.charge >= 1,
                    loadout: { ...other.loadout },
                });
                continue;
            }
            const sensed: SensedRobot = {
                id: other.id,
                team: other.team,
                x: other.x,
                y: other.y,
                heading: other.heading,
                speed: other.speed,
                health: other.health,
                distance: d,
                bearing,
            };
            if (Match.sees(robot, other)) {
                foes.push(sensed);
            } else if (robot.stats.scoutRange > 0 && d <= robot.stats.scoutRange) {
                scout.push({
                    id: other.id,
                    team: other.team,
                    x: other.x,
                    y: other.y,
                    heading: 0,
                    speed: 0,
                    health: 0,
                    distance: d,
                    bearing,
                });
            }
        }
        foes.sort((a, b) => a.distance - b.distance || a.id - b.id);
        allies.sort((a, b) => a.id - b.id);
        scout.sort((a, b) => a.distance - b.distance || a.id - b.id);
        this.recordAllySightings(robot);
        const shared = this.sharedSightings(robot, new Set(foes.map((f) => f.id)));
        // Tracks: refresh on every cone sighting, drop the dead, flag the seen.
        const seenIds = new Set(foes.map((f) => f.id));
        for (const foe of foes) {
            robot.tracks.set(foe.id, {
                x: foe.x,
                y: foe.y,
                heading: foe.heading,
                speed: foe.speed,
                lastSeenTick: this.tick,
            });
        }
        for (const id of [...robot.tracks.keys()]) {
            const foe = this.robots[id] as Robot | undefined;
            if (!foe || !foe.alive || foe.team === robot.team) robot.tracks.delete(id);
        }
        const tracks: TrackedFoe[] = [...robot.tracks.entries()]
            .map(([id, t]) => ({ id, x: t.x, y: t.y, heading: t.heading, speed: t.speed, lastSeenTick: t.lastSeenTick, seenNow: seenIds.has(id) }))
            .sort((a, b) => a.id - b.id);
        // Bullets: incoming foe-team rounds inside the sensor cone, nearest first.
        const bullets: SensedBullet[] = [];
        for (const bullet of this.bullets) {
            if (bullet.team === robot.team) continue;
            const d = dist(robot.x, robot.y, bullet.x, bullet.y);
            if (d > robot.stats.sensorRange) continue;
            const bearing = Math.atan2(bullet.y - robot.y, bullet.x - robot.x);
            if (Math.abs(angleDiff(robot.tower, bearing)) > robot.stats.sensorFov / 2) continue;
            const closing = d > 0 ? -((bullet.vx * (bullet.x - robot.x) + bullet.vy * (bullet.y - robot.y)) / d) : 0;
            bullets.push({ x: bullet.x, y: bullet.y, vx: bullet.vx, vy: bullet.vy, distance: d, bearing, closing, damage: bullet.damage });
        }
        bullets.sort((a, b) => a.distance - b.distance || a.x - b.x || a.y - b.y);
        // Events: the step just completed, sorted kind-then-id, capped.
        const events = [...((this.prevEvents[robot.id] as SenseEvent[] | undefined) ?? [])]
            .sort((a, b) =>
                a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : (a.fromId ?? -1) - (b.fromId ?? -1),
            )
            .slice(0, SENSE_EVENTS_MAX)
            .map((e) => ({ ...e }));
        const circle = this.safeCircle;
        const distCenter = dist(robot.x, robot.y, circle.x, circle.y);
        const shrinking = this.tick >= MAX_TICKS;
        let killsTeam = 0;
        let aliveFoes = 0;
        for (const other of this.robots) {
            if (other.team === robot.team) killsTeam += other.kills;
            else if (other.alive) aliveFoes += 1;
        }
        return {
            tick: this.tick,
            time: this.tick * DT,
            self: {
                id: robot.id,
                team: robot.team,
                x: robot.x,
                y: robot.y,
                heading: robot.heading,
                tower: robot.tower,
                speed: robot.speed,
                health: robot.health,
                cooldown: robot.cooldown,
                // Copies: robot code must never alias mutable engine state.
                stats: { ...robot.stats },
                charge: robot.charge,
                charged: robot.charge >= 1,
                dashCd: robot.dashCd,
                empCd: robot.empCd,
                slowed: this.tick < robot.slowUntil,
                loadout: { ...robot.loadout },
                lastDamage: robot.lastDamage ? { ...robot.lastDamage } : null,
                blocked: { ahead: this.whiskerAhead(robot) },
            },
            foes,
            allies,
            scout,
            shared,
            walls: {
                left: robot.x,
                right: ARENA_WIDTH - robot.x,
                top: robot.y,
                bottom: ARENA_HEIGHT - robot.y,
            },
            // Per-(robot,tick) stream: one robot's draws never shift another's.
            rand: createRng(
                (this.seed ^ Math.imul(robot.id + 1, 2654435761) ^ Math.imul(this.tick + 1, 40503)) >>> 0,
            ),
            events,
            bullets: bullets.slice(0, SENSE_BULLETS_MAX),
            tracks,
            arena: {
                id: this.arena,
                obstacles: this.barriers.map((o) => ({ ...o })),
                centerX: ARENA_WIDTH / 2,
                centerY: ARENA_HEIGHT / 2,
            },
            zone: {
                phase: shrinking ? 'shrinking' : 'normal',
                suddenDeathIn: Math.max(0, MAX_TICKS - this.tick),
                circle: { x: circle.x, y: circle.y, r: circle.r },
                distToSafety: Math.max(0, distCenter - circle.r),
                inside: distCenter < circle.r,
            },
            grid: {
                w: SENSE_GRID_W,
                h: SENSE_GRID_H,
                cell: SENSE_GRID_CELL,
                foes: [...(this.gridFoes[robot.team] as number[])],
                danger: [...(this.gridDanger[robot.team] as number[])],
            },
            match: {
                arena: this.arena,
                modifiers: { ...this.mods },
                tickCap: MAX_TICKS_TOTAL,
                killsYou: robot.kills,
                killsTeam,
                aliveFoes,
            },
            // All pads, fixed order: public map knowledge. Fresh copies.
            pickups: this.pads.map((p) => ({ ...p })),
            inbox: this.inboxFor(robot),
        };
    }

    private nearestFoe(robot: Robot): Robot | null {
        let best: Robot | null = null;
        let bestDist = Infinity;
        for (const other of this.robots) {
            if (other.team === robot.team) continue;
            const d = dist(robot.x, robot.y, other.x, other.y);
            if (d < bestDist) {
                bestDist = d;
                best = other;
            }
        }
        return best;
    }

    private collideWalls(): void {
        for (const robot of this.robots) {
            if (!robot.alive) continue;
            const minX = ROBOT_RADIUS;
            const maxX = ARENA_WIDTH - ROBOT_RADIUS;
            const minY = ROBOT_RADIUS;
            const maxY = ARENA_HEIGHT - ROBOT_RADIUS;
            let bumped = false;
            if (robot.x < minX) {
                robot.x = minX;
                robot.speed *= 0.4;
                bumped = true;
            } else if (robot.x > maxX) {
                robot.x = maxX;
                robot.speed *= 0.4;
                bumped = true;
            }
            if (robot.y < minY) {
                robot.y = minY;
                robot.speed *= 0.4;
                bumped = true;
            } else if (robot.y > maxY) {
                robot.y = maxY;
                robot.speed *= 0.4;
                bumped = true;
            }
            // Once per step: this pass runs twice (separation can re-shove past walls).
            if (bumped && !(this.curEvents[robot.id] as SenseEvent[]).some((e) => e.kind === 'wall-bump')) {
                this.emit(robot.id, { kind: 'wall-bump' });
            }
        }
    }

    private collideRobots(): void {
        for (let a = 0; a < this.robots.length; a += 1) {
            const ra = this.robots[a] as Robot;
            if (!ra.alive) continue;
            for (let b = a + 1; b < this.robots.length; b += 1) {
                const rb = this.robots[b] as Robot;
                if (!rb.alive) continue;
                const dx = rb.x - ra.x;
                const dy = rb.y - ra.y;
                const d = Math.hypot(dx, dy);
                const minDist = ROBOT_RADIUS * 2;
                if (d > 0 && d < minDist) {
                    const push = (minDist - d) / 2;
                    const nx = dx / d;
                    const ny = dy / d;
                    ra.x -= nx * push;
                    ra.y -= ny * push;
                    rb.x += nx * push;
                    rb.y += ny * push;
                    this.emit(ra.id, { kind: 'ram', fromId: rb.id });
                    this.emit(rb.id, { kind: 'ram', fromId: ra.id });
                } else if (d === 0) {
                    // Exact overlap: deterministic id-ordered split along x.
                    const push = minDist / 2;
                    if (ra.id < rb.id) {
                        ra.x -= push;
                        rb.x += push;
                    } else {
                        ra.x += push;
                        rb.x -= push;
                    }
                    this.emit(ra.id, { kind: 'ram', fromId: rb.id });
                    this.emit(rb.id, { kind: 'ram', fromId: ra.id });
                }
            }
        }
    }

    private collideObstacles(): void {
        const obstacles = this.barriers;
        if (obstacles.length === 0) return;
        for (const robot of this.robots) {
            if (!robot.alive) continue;
            for (const o of obstacles) {
                const cx = clamp(robot.x, o.x, o.x + o.w);
                const cy = clamp(robot.y, o.y, o.y + o.h);
                const dx = robot.x - cx;
                const dy = robot.y - cy;
                const d = Math.hypot(dx, dy);
                if (d >= ROBOT_RADIUS) continue;
                if (d > 0) {
                    const push = ROBOT_RADIUS - d;
                    robot.x += (dx / d) * push;
                    robot.y += (dy / d) * push;
                } else {
                    // Center inside the block: shove out along min-penetration axis.
                    const left = robot.x - o.x;
                    const right = o.x + o.w - robot.x;
                    const top = robot.y - o.y;
                    const bottom = o.y + o.h - robot.y;
                    const min = Math.min(left, right, top, bottom);
                    if (min === left) robot.x = o.x - ROBOT_RADIUS;
                    else if (min === right) robot.x = o.x + o.w + ROBOT_RADIUS;
                    else if (min === top) robot.y = o.y - ROBOT_RADIUS;
                    else robot.y = o.y + o.h + ROBOT_RADIUS;
                }
                robot.speed *= 0.4;
            }
        }
    }

    private hitsObstacle(x: number, y: number): boolean {
        for (const o of this.barriers) {
            if (
                x >= o.x - BULLET_RADIUS &&
                x <= o.x + o.w + BULLET_RADIUS &&
                y >= o.y - BULLET_RADIUS &&
                y <= o.y + o.h + BULLET_RADIUS
            ) {
                return true;
            }
        }
        return false;
    }

    private stepBullets(): void {
        const survivors: Bullet[] = [];
        for (const bullet of this.bullets) {
            bullet.x += bullet.vx * DT;
            bullet.y += bullet.vy * DT;
            bullet.travelled += bullet.speed * DT;
            if (bullet.travelled > bullet.range) continue;
            if (bullet.x < 0 || bullet.x > ARENA_WIDTH || bullet.y < 0 || bullet.y > ARENA_HEIGHT) continue;
            if (this.hitsObstacle(bullet.x, bullet.y)) continue;
            let hit = false;
            for (const robot of this.robots) {
                if (!robot.alive || robot.team === bullet.team) continue; // no friendly fire
                if (dist(bullet.x, bullet.y, robot.x, robot.y) < ROBOT_RADIUS + BULLET_RADIUS) {
                    robot.health -= bullet.damage;
                    const owner = this.robots[bullet.owner] as Robot;
                    owner.damageDealt += bullet.damage;
                    const bearing = Math.atan2(owner.y - robot.y, owner.x - robot.x);
                    robot.lastDamage = { tick: this.tick, amount: bullet.damage, bearing, fromId: owner.id };
                    this.emit(robot.id, { kind: 'hit-by', amount: bullet.damage, bearing, fromId: owner.id });
                    this.stampDanger(robot, bullet.damage);
                    if (robot.health <= 0) this.slay(robot, owner.id);
                    hit = true;
                    break;
                }
            }
            if (!hit) survivors.push(bullet);
        }
        this.bullets = survivors;
    }

    /**
     * Powerup pads: dark pads count down to reactivation; each active pad
     * is collected by the first living robot in tick order within
     * PAD_RADIUS. AMP arms a timed damage boost, REPAIR heals instantly
     * (clamped to max), OVERDRIVE arms a timed speed boost. The pad then
     * goes dark for PAD_RESPAWN_TICKS.
     */
    private stepPads(): void {
        this.pads.forEach((pad, padIdx) => {
            if (!pad.active) {
                pad.respawnIn -= 1;
                if (pad.respawnIn <= 0) {
                    pad.active = true;
                    pad.respawnIn = 0;
                }
                return;
            }
            for (const robot of this.robots) {
                if (!robot.alive) continue;
                if (dist(robot.x, robot.y, pad.x, pad.y) > PAD_RADIUS) continue;
                if (pad.kind === 'amp') {
                    robot.ampUntil = this.tick + AMP_TICKS;
                } else if (pad.kind === 'overdrive') {
                    robot.overdriveUntil = this.tick + OVERDRIVE_TICKS;
                } else {
                    robot.health = Math.min(robot.stats.maxHealth, robot.health + REPAIR_HP);
                }
                pad.active = false;
                pad.respawnIn = PAD_RESPAWN_TICKS;
                this.padLog.push(`${this.tick}:${padIdx}:${robot.id}`);
                this.emit(robot.id, { kind: 'pickup', pad: pad.kind });
                break;
            }
        });
    }

    private suddenDeath(): void {
        const circle = this.safeCircle;
        for (const robot of this.robots) {
            if (!robot.alive) continue;
            // Strictly inside is safe; at radius zero nobody is.
            if (dist(robot.x, robot.y, circle.x, circle.y) < circle.r) continue;
            if ((this.tick + robot.id) % SUDDEN_DEATH_PERIOD !== 0) continue;
            robot.health -= SUDDEN_DEATH_DAMAGE;
            this.emit(robot.id, { kind: 'sudden-death-pulse', amount: SUDDEN_DEATH_DAMAGE });
            this.stampDanger(robot, SUDDEN_DEATH_DAMAGE);
            if (robot.health <= 0) this.slay(robot, null);
        }
    }

    private checkEnd(): void {
        const alive0 = this.robots.some((r) => r.alive && r.team === 0);
        const alive1 = this.robots.some((r) => r.alive && r.team === 1);
        if (!alive0 && !alive1) {
            this.over = true;
            this.winner = -1;
        } else if (!alive1) {
            this.over = true;
            this.winner = 0;
        } else if (!alive0) {
            this.over = true;
            this.winner = 1;
        } else if (this.tick >= MAX_TICKS_TOTAL) {
            // Defensive only: the collapsed circle eliminates everyone first.
            // Health, then damage, decides; an exact tie stays a draw.
            this.over = true;
            const health = (team: 0 | 1): number =>
                this.robots.filter((r) => r.alive && r.team === team).reduce((sum, r) => sum + r.health, 0);
            const damage = (team: 0 | 1): number =>
                this.robots.filter((r) => r.team === team).reduce((sum, r) => sum + r.damageDealt, 0);
            const h0 = health(0);
            const h1 = health(1);
            if (h0 !== h1) {
                this.winner = h0 > h1 ? 0 : 1;
            } else {
                const d0 = damage(0);
                const d1 = damage(1);
                this.winner = d0 === d1 ? -1 : d0 > d1 ? 0 : 1;
            }
        }
    }

    private static teamSize(lineups: LineupEntry[], team: 0 | 1): number {
        return lineups.filter((entry) => entry.team === team).length;
    }

    /**
     * Seeded spawn layout: team 0 draws offsets from a dedicated stream
     * (seed ^ SPAWN_SALT), team 1 mirrors through the arena center. Draw
     * order is fixed (column shift, then dx/jy/dh per team-0 slot), and the
     * brain RNG streams are untouched. Guarantees for team sizes 1-3: x in
     * [90,170] (60px+ clear of the midfield barrier band), y in [50,590]
     * (clamp never fires),
     * teammate gap >= 70px (spread 150 minus 2x40 jitter), headings within
     * 0.3 rad of horizontal (never into a wall). Asymmetric lineups (never
     * in eval/soak) fall back to independent seeded draws for team 1.
     */
    private static computeSpawns(lineups: LineupEntry[], seed: number): Array<{ x: number; y: number; heading: number }> {
        const n0 = Match.teamSize(lineups, 0);
        const n1 = Match.teamSize(lineups, 1);
        const rng = createRng((seed ^ SPAWN_SALT) >>> 0);
        const shift = (rng() * 2 - 1) * SPAWN_Y_SHIFT;
        const spread = 150;
        const team0: Array<{ x: number; y: number; heading: number }> = [];
        for (let i = 0; i < n0; i += 1) {
            const dx = (rng() * 2 - 1) * SPAWN_X_JITTER;
            const jy = (rng() * 2 - 1) * SPAWN_Y_JITTER;
            const dh = (rng() * 2 - 1) * SPAWN_HEADING_JITTER;
            const baseY = ARENA_HEIGHT / 2 + (i - (n0 - 1) / 2) * spread;
            team0.push({
                x: clamp(SPAWN_X + dx, ROBOT_RADIUS, ARENA_WIDTH - ROBOT_RADIUS),
                y: clamp(baseY + shift + jy, ROBOT_RADIUS * 2, ARENA_HEIGHT - ROBOT_RADIUS * 2),
                heading: wrapAngle(dh),
            });
        }
        const team1: Array<{ x: number; y: number; heading: number }> = [];
        if (n0 === n1) {
            for (let i = 0; i < n1; i += 1) {
                const s = team0[i] as { x: number; y: number; heading: number };
                team1.push({
                    x: ARENA_WIDTH - s.x,
                    y: ARENA_HEIGHT - s.y,
                    heading: wrapAngle(s.heading + Math.PI),
                });
            }
        } else {
            for (let i = 0; i < n1; i += 1) {
                const dx = (rng() * 2 - 1) * SPAWN_X_JITTER;
                const jy = (rng() * 2 - 1) * SPAWN_Y_JITTER;
                const dh = (rng() * 2 - 1) * SPAWN_HEADING_JITTER;
                const baseY = ARENA_HEIGHT / 2 + (i - (n1 - 1) / 2) * spread;
                team1.push({
                    x: clamp(ARENA_WIDTH - SPAWN_X + dx, ROBOT_RADIUS, ARENA_WIDTH - ROBOT_RADIUS),
                    y: clamp(baseY + shift + jy, ROBOT_RADIUS * 2, ARENA_HEIGHT - ROBOT_RADIUS * 2),
                    heading: wrapAngle(Math.PI + dh),
                });
            }
        }
        const spawns: Array<{ x: number; y: number; heading: number }> = [];
        let c0 = 0;
        let c1 = 0;
        for (const entry of lineups) {
            if (entry.team === 0) spawns.push(team0[c0++] as { x: number; y: number; heading: number });
            else spawns.push(team1[c1++] as { x: number; y: number; heading: number });
        }
        return spawns;
    }
}
