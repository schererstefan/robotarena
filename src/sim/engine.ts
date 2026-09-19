// Deterministic battle simulation. No Phaser imports here: this module runs
// identically in the browser and in headless Node soak tests.

import {
    ACCEL,
    ARENA_HEIGHT,
    ARENA_WIDTH,
    BULLET_DAMAGE,
    BULLET_RADIUS,
    BULLET_SPEED,
    DT,
    GUN_COOLDOWN_TICKS,
    GUN_RANGE,
    MAX_SPEED,
    MAX_TICKS,
    REVERSE_FACTOR,
    ROBOT_RADIUS,
    SENSOR_FOV,
    SENSOR_RANGE,
    START_HEALTH,
    TOWER_RATE,
    TURN_RATE,
} from './constants';
import { angleDiff, clamp, dist, toNumber, wrapAngle } from './math';
import { createRng, type Rand } from './rng';
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
    alive: boolean;
    cooldown: number;
    kills: number;
    damageDealt: number;
    shotsFired: number;
}

export interface BulletSnapshot {
    x: number;
    y: number;
    team: 0 | 1;
}

export interface MatchResult {
    over: boolean;
    /** Winning team, or -1 for a draw / undecided. */
    winner: -1 | 0 | 1;
    tick: number;
}

interface Robot {
    id: number;
    team: 0 | 1;
    controller: RobotController;
    x: number;
    y: number;
    heading: number;
    tower: number;
    speed: number;
    health: number;
    cooldown: number;
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
}

export interface LineupEntry {
    team: 0 | 1;
    controller: RobotController;
}

function sanitizeIntent(raw: unknown): Intent {
    if (typeof raw !== 'object' || raw === null) return { ...IDLE_INTENT };
    const r = raw as Partial<Intent>;
    return {
        throttle: clamp(toNumber(r.throttle), -1, 1),
        turn: clamp(toNumber(r.turn), -1, 1),
        towerTurn: clamp(toNumber(r.towerTurn), -1, 1),
        fire: r.fire === true,
    };
}

export class Match {
    readonly robots: Robot[] = [];
    private bullets: Bullet[] = [];
    private tick = 0;
    private over = false;
    private winner: -1 | 0 | 1 = -1;
    private readonly rand: Rand;

    constructor(lineups: LineupEntry[], seed: number) {
        this.rand = createRng(seed);
        lineups.forEach((entry, index) => {
            const spawn = Match.spawnFor(entry.team, Match.teamIndex(lineups, index), Match.teamSize(lineups, entry.team));
            this.robots.push({
                id: index,
                team: entry.team,
                controller: entry.controller,
                x: spawn.x,
                y: spawn.y,
                heading: spawn.heading,
                tower: spawn.heading,
                speed: 0,
                health: START_HEALTH,
                cooldown: 0,
                alive: true,
                kills: 0,
                damageDealt: 0,
                shotsFired: 0,
                errors: 0,
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
        return { over: this.over, winner: this.winner, tick: this.tick };
    }

    get robotSnapshots(): RobotSnapshot[] {
        return this.robots.map((r) => ({
            id: r.id,
            team: r.team,
            name: r.controller.meta.name,
            x: r.x,
            y: r.y,
            heading: r.heading,
            tower: r.tower,
            health: r.health,
            alive: r.alive,
            cooldown: r.cooldown,
            kills: r.kills,
            damageDealt: r.damageDealt,
            shotsFired: r.shotsFired,
        }));
    }

    get bulletSnapshots(): BulletSnapshot[] {
        return this.bullets.map((b) => ({ x: b.x, y: b.y, team: b.team }));
    }

    step(): void {
        if (this.over) return;
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
        // 2. Drive + towers.
        this.robots.forEach((robot, i) => {
            if (!robot.alive) return;
            const intent = intents[i] as Intent;
            const target = intent.throttle >= 0 ? intent.throttle * MAX_SPEED : intent.throttle * MAX_SPEED * REVERSE_FACTOR;
            const dv = clamp(target - robot.speed, -ACCEL * DT, ACCEL * DT);
            robot.speed += dv;
            robot.heading = wrapAngle(robot.heading + intent.turn * TURN_RATE * DT);
            robot.tower = wrapAngle(robot.tower + intent.towerTurn * TOWER_RATE * DT);
            robot.x += Math.cos(robot.heading) * robot.speed * DT;
            robot.y += Math.sin(robot.heading) * robot.speed * DT;
            if (robot.cooldown > 0) robot.cooldown -= 1;
        });
        this.collideWalls();
        this.collideRobots();
        // 3. Fire guns.
        this.robots.forEach((robot, i) => {
            if (!robot.alive) return;
            const intent = intents[i] as Intent;
            if (intent.fire && robot.cooldown <= 0) {
                robot.cooldown = GUN_COOLDOWN_TICKS;
                robot.shotsFired += 1;
                this.bullets.push({
                    x: robot.x + Math.cos(robot.tower) * (ROBOT_RADIUS + 4),
                    y: robot.y + Math.sin(robot.tower) * (ROBOT_RADIUS + 4),
                    vx: Math.cos(robot.tower) * BULLET_SPEED,
                    vy: Math.sin(robot.tower) * BULLET_SPEED,
                    team: robot.team,
                    owner: robot.id,
                    travelled: 0,
                });
            }
        });
        // 4. Bullets.
        this.stepBullets();
        this.tick += 1;
        this.checkEnd();
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
            } else if (d <= SENSOR_RANGE && Math.abs(angleDiff(robot.tower, bearing)) <= SENSOR_FOV / 2) {
                foes.push(sensed);
            }
        }
        foes.sort((a, b) => a.distance - b.distance);
        allies.sort((a, b) => a.id - b.id);
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
            },
            foes,
            allies,
            walls: {
                left: robot.x,
                right: ARENA_WIDTH - robot.x,
                top: robot.y,
                bottom: ARENA_HEIGHT - robot.y,
            },
            rand: this.rand,
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
                }
            }
        }
    }

    private stepBullets(): void {
        const survivors: Bullet[] = [];
        for (const bullet of this.bullets) {
            bullet.x += bullet.vx * DT;
            bullet.y += bullet.vy * DT;
            bullet.travelled += BULLET_SPEED * DT;
            if (bullet.travelled > GUN_RANGE) continue;
            if (bullet.x < 0 || bullet.x > ARENA_WIDTH || bullet.y < 0 || bullet.y > ARENA_HEIGHT) continue;
            let hit = false;
            for (const robot of this.robots) {
                if (!robot.alive || robot.team === bullet.team) continue; // no friendly fire
                if (dist(bullet.x, bullet.y, robot.x, robot.y) < ROBOT_RADIUS + BULLET_RADIUS) {
                    robot.health -= BULLET_DAMAGE;
                    const owner = this.robots[bullet.owner] as Robot;
                    owner.damageDealt += BULLET_DAMAGE;
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
        } else if (this.tick >= MAX_TICKS) {
            this.over = true;
            this.winner = -1;
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
        const y = ARENA_HEIGHT / 2 + (index - (size - 1) / 2) * spread;
        return { x, y, heading: team === 0 ? 0 : Math.PI };
    }
}
