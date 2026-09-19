// Deterministic battle simulation. No Phaser imports here: this module runs
// identically in the browser and in headless Node soak tests.

import { ACCEL, ARENA_HEIGHT, ARENA_OBSTACLES, ARENA_WIDTH, BULLET_DAMAGE, BULLET_RADIUS, DT, MAX_TICKS, MAX_TICKS_TOTAL, REVERSE_FACTOR, ROBOT_RADIUS, SENSOR_SHARE_DELAY, SUDDEN_DEATH_DAMAGE, SUDDEN_DEATH_PERIOD, SUDDEN_DEATH_TICKS, type ArenaId, type ArenaObstacle } from './constants';
import { angleDiff, clamp, dist, toNumber, wrapAngle } from './math';
import { createRng } from './rng';
import { computeStats, loadoutCode, sanitizeLoadout, type RobotStats, type SkillLoadout } from './skills';
import { IDLE_INTENT, type Intent, type RobotController, type SensedRobot, type SenseState } from './types';

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
    alive: boolean;
    kills: number;
    damageDealt: number;
    shotsFired: number;
    errors: number;
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
}

function sanitizeIntent(raw: unknown): Intent {
    if (typeof raw !== 'object' || raw === null) return { ...IDLE_INTENT };
    const r = raw as Partial<Intent>;
    return {
        throttle: clamp(toNumber(r.throttle), -1, 1),
        turn: clamp(toNumber(r.turn), -1, 1),
        towerTurn: clamp(toNumber(r.towerTurn), -1, 1),
        fire: r.fire === true,
        charge: r.charge === true,
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
    /** Recent ally sightings, pruned to the last SENSOR_SHARE_DELAY ticks. */
    private sightings: SharedSighting[] = [];

    constructor(lineups: LineupEntry[], seed: number, options: MatchOptions = {}) {
        this.seed = seed;
        this.arena = options.arena === 'blocks' ? 'blocks' : 'open';
        lineups.forEach((entry, index) => {
            const spawn = Match.spawnFor(entry.team, Match.teamIndex(lineups, index), Match.teamSize(lineups, entry.team));
            // Guarded: hostile getters on the entry/controller must not kill setup.
            let loadout: SkillLoadout = {};
            let setupErrors = 0;
            try {
                loadout = sanitizeLoadout(entry.loadout ?? entry.controller.loadout ?? {});
            } catch {
                setupErrors = 1;
            }
            const stats = computeStats(loadout);
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
                alive: true,
                kills: 0,
                damageDealt: 0,
                shotsFired: 0,
                errors: setupErrors,
            });
        });
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

    /** Obstacle rects for this match's arena (renderer + tests). */
    get obstacles(): ArenaObstacle[] {
        return ARENA_OBSTACLES[this.arena];
    }

    get robotSnapshots(): RobotSnapshot[] {
        return this.robots.map((r) => ({
            id: r.id,
            team: r.team,
            name: r.controller.meta?.name ?? `robot-${r.id}`,
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
        // Drop sightings too old to ever be delivered (exact-delay window).
        if (this.sightings.length > 0 && this.tick > SENSOR_SHARE_DELAY) {
            const cutoff = this.tick - SENSOR_SHARE_DELAY;
            this.sightings = this.sightings.filter((s) => s.tick >= cutoff);
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
        // 2. Drive + towers + charge.
        this.robots.forEach((robot, i) => {
            if (!robot.alive) return;
            const intent = intents[i] as Intent;
            const canCharge = robot.stats.chargeMult > 1;
            const charging = intent.charge && canCharge && robot.cooldown <= 0;
            if (charging) {
                robot.charge = Math.min(1, robot.charge + 1 / robot.stats.chargeTicks);
            } else {
                robot.charge = Math.max(0, robot.charge - DT / 4); // bank decays in ~4s
            }
            const slow = intent.charge && canCharge ? 0.75 : 1;
            const top = robot.stats.maxSpeed * slow;
            const target = intent.throttle >= 0 ? intent.throttle * top : intent.throttle * top * REVERSE_FACTOR;
            const dv = clamp(target - robot.speed, -ACCEL * DT, ACCEL * DT);
            robot.speed += dv;
            robot.heading = wrapAngle(robot.heading + intent.turn * robot.stats.turnRate * DT);
            robot.tower = wrapAngle(robot.tower + intent.towerTurn * robot.stats.towerRate * DT);
            robot.x += Math.cos(robot.heading) * robot.speed * DT;
            robot.y += Math.sin(robot.heading) * robot.speed * DT;
            if (robot.cooldown > 0) robot.cooldown -= 1;
        });
        this.collideWalls();
        this.collideRobots();
        this.collideObstacles();
        this.collideWalls(); // separation can shove robots past the walls
        // 3. Fire guns.
        this.robots.forEach((robot, i) => {
            if (!robot.alive) return;
            const intent = intents[i] as Intent;
            if (intent.fire && robot.cooldown <= 0) {
                robot.cooldown = robot.stats.cooldownTicks;
                robot.shotsFired += 1;
                const damage = robot.stats.damage * (1 + robot.charge * (robot.stats.chargeMult - 1));
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
        // 4. Bullets.
        this.stepBullets();
        // 5. Sudden death: past the cap, robots outside the circle pulse damage.
        if (this.tick >= MAX_TICKS) this.suddenDeath();
        this.tick += 1;
        this.checkEnd();
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
        shared.sort((a, b) => a.distance - b.distance);
        return shared;
    }

    private sense(robot: Robot): SenseState {
        const foes: SensedRobot[] = [];
        const allies: SensedRobot[] = [];
        for (const other of this.robots) {
            if (other.id === robot.id || !other.alive) continue;
            const d = dist(robot.x, robot.y, other.x, other.y);
            const bearing = Math.atan2(other.y - robot.y, other.x - robot.x);
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
            if (other.team === robot.team) {
                allies.push(sensed);
            } else if (Match.sees(robot, other)) {
                foes.push(sensed);
            }
        }
        foes.sort((a, b) => a.distance - b.distance);
        allies.sort((a, b) => a.id - b.id);
        this.recordAllySightings(robot);
        const shared = this.sharedSightings(robot, new Set(foes.map((f) => f.id)));
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
                loadout: { ...robot.loadout },
            },
            foes,
            allies,
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
            if (robot.x < minX) {
                robot.x = minX;
                robot.speed *= 0.4;
            } else if (robot.x > maxX) {
                robot.x = maxX;
                robot.speed *= 0.4;
            }
            if (robot.y < minY) {
                robot.y = minY;
                robot.speed *= 0.4;
            } else if (robot.y > maxY) {
                robot.y = maxY;
                robot.speed *= 0.4;
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
                }
            }
        }
    }

    private collideObstacles(): void {
        const obstacles = ARENA_OBSTACLES[this.arena];
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
        for (const o of ARENA_OBSTACLES[this.arena]) {
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
                    if (robot.health <= 0) {
                        robot.health = 0;
                        robot.alive = false;
                        owner.kills += 1;
                    }
                    hit = true;
                    break;
                }
            }
            if (!hit) survivors.push(bullet);
        }
        this.bullets = survivors;
    }

    private suddenDeath(): void {
        const circle = this.safeCircle;
        for (const robot of this.robots) {
            if (!robot.alive) continue;
            // Strictly inside is safe; at radius zero nobody is.
            if (dist(robot.x, robot.y, circle.x, circle.y) < circle.r) continue;
            if ((this.tick + robot.id) % SUDDEN_DEATH_PERIOD !== 0) continue;
            robot.health -= SUDDEN_DEATH_DAMAGE;
            if (robot.health <= 0) {
                robot.health = 0;
                robot.alive = false;
            }
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

    private static teamIndex(lineups: LineupEntry[], index: number): number {
        const team = lineups[index]?.team;
        let count = 0;
        for (let i = 0; i < index; i += 1) {
            if (lineups[i]?.team === team) count += 1;
        }
        return count;
    }

    private static spawnFor(team: 0 | 1, index: number, size: number): { x: number; y: number; heading: number } {
        const x = team === 0 ? 130 : ARENA_WIDTH - 130;
        const spread = 150;
        const y = clamp(
            ARENA_HEIGHT / 2 + (index - (size - 1) / 2) * spread,
            ROBOT_RADIUS * 2,
            ARENA_HEIGHT - ROBOT_RADIUS * 2,
        );
        return { x, y, heading: team === 0 ? 0 : Math.PI };
    }
}
