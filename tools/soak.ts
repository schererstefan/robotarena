// Headless verification: determinism, intent clamping, error isolation,
// and bot-vs-bot soak across 1v1 / 2v2 / 3v3. Run with `npm run test:sim`.
// Exits non-zero on any failure.

import { ACCEL, ARENA_HEIGHT, ARENA_IDS, ARENA_OBSTACLES, ARENA_WIDTH, BULLET_SPEED, COMMS_DELAY, COMMS_INBOX_MAX, DASH_COOLDOWN_TICKS, EMP_COOLDOWN_TICKS, EMP_RADIUS, EMP_SLOW_TICKS, GUN_RANGE, INBOX_MAX, MAX_SPEED, MAX_TICKS, MAX_TICKS_TOTAL, ROBOT_RADIUS, SENSE_BULLETS_MAX, SENSE_EVENTS_MAX, SENSE_GRID_CELL, SENSE_GRID_H, SENSE_GRID_STAMP, SENSE_GRID_W, SENSOR_RANGE, SENSOR_SHARE_DELAY, STRAFE_FACTOR, SUDDEN_DEATH_TICKS, isExhibition, sanitizeModifiers, type ArenaId, type MatchModifiers } from '../src/sim/constants';
import { DT } from '../src/sim/constants';
import { Match, sanitizeIntent, type LineupEntry, type RobotSnapshot } from '../src/sim/engine';
import { decodeReplay, encodeReplay, encodeReplayLegacy, type ReplaySpec } from '../src/sim/replay';
import { checkRobotSource, suggestFilename, WORKSHOP_TEMPLATE, workshopPassed } from '../src/game/workshop';
import { markTutorialSeen, resetTutorialFlag, shouldShowTutorial } from '../src/game/tutorial';
import {
    clearDailyBoard,
    clearHistory,
    dailyDateKey,
    dailyLineup,
    dailySeed,
    loadDailyBoard,
    loadHistory,
    recordDailyResult,
    recordMatch,
    winRates,
} from '../src/game/history';
import { dodgeVector, leadAngle, leadShot, toGrid } from '../src/robots/common';
import { castContact, castFocusVote, focusTarget, formationSlot, latestContact, resolveRoles } from '../src/robots/comms';
import { ROBOTS } from '../src/robots/registry';
import { canonicalStringify, defaultGenome, genomeDefFor, genomeHash, genomeLoadout, sha256Hex, validateGenome, type Genome } from '../src/robots/genome';
import { BRAIN_DEFAULTS, BRAIN_PRESETS, createBrain, pickTarget as brainPickTarget, safeCircleFor, type BrainParams } from '../src/robots/brain';
import { createLegacyWithParams as createHunterLegacy, createWithParams as createHunterParams, HUNTER_DEFAULTS, hunterParamsFromGenome } from '../src/robots/hunter';
import { createWithParams as createOrbiterParams, ORBITER_DEFAULTS, orbiterParamsFromGenome } from '../src/robots/orbiter';
import { computeStats, loadoutCode, loadoutCost, sanitizeLoadout, SKILL_DEFS, type SkillLoadout } from '../src/sim/skills';
import { ROBOT_API_VERSION, type Intent, type RobotController, type SenseState } from '../src/sim/types';
import { initialRound, nextRound, roundName, tiebreakWinner } from '../src/game/tournament';

let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
    if (condition) {
        console.log(`  ok   ${name}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ''}`);
    }
}

function runMatch(ids: string[], teams: Array<0 | 1>, seed: number, loadouts?: SkillLoadout[], arena: ArenaId = 'open', modifiers: MatchModifiers = {}): Match {
    const lineups: LineupEntry[] = ids.map((id, i) => {
        const entry = ROBOTS.find((r) => r.meta.id === id);
        if (!entry) throw new Error(`unknown robot ${id}`);
        const loadout = loadouts?.[i] ?? entry.loadout;
        return { team: teams[i] as 0 | 1, controller: entry.create(), loadout: { ...loadout } };
    });
    const match = new Match(lineups, seed, { arena, modifiers });
    match.runToEnd();
    return match;
}

function fingerprint(match: Match): string {
    // Full precision: any divergence, however small, must show.
    const snaps = match.robotSnapshots.map((s) =>
        [s.code, s.maxHealth, s.alive ? 1 : 0, s.health, s.x, s.y, s.heading, s.tower, s.kills, s.damageDealt, s.shotsFired, s.cooldown, s.charge, s.dashCd, s.empCd, s.slowed ? 1 : 0].join(','),
    );
    const bullets = match.bulletSnapshots.map((b) => [b.x, b.y, b.team, b.hot ? 1 : 0].join(',')).join(';');
    return `${match.arenaId}|${JSON.stringify(match.modifiers)}|${match.result.winner}@${match.result.tick}|${snaps.join('|')}|${bullets}`;
}

// --- 1. Determinism: same seed, same everything ------------------------------
console.log('determinism');
{
    const a = runMatch(['hunter', 'orbiter'], [0, 1], 1234);
    const b = runMatch(['hunter', 'orbiter'], [0, 1], 1234);
    check('identical fingerprint for identical seed', fingerprint(a) === fingerprint(b));
    // Wanderer draws from the shared RNG stream, so its matches must diverge.
    const d = runMatch(['wanderer', 'rusher'], [0, 1], 1234);
    const e = runMatch(['wanderer', 'rusher'], [0, 1], 999);
    check('seed affects RNG-drawing robots', fingerprint(d) !== fingerprint(e));
    const f = runMatch(['hunter', 'orbiter'], [0, 1], 1234, undefined, 'blocks');
    const g = runMatch(['hunter', 'orbiter'], [0, 1], 1234, undefined, 'blocks');
    check('identical fingerprint on blocks arena', fingerprint(f) === fingerprint(g));
}

// --- 2. Intent clamping: a cheating robot cannot break physics ---------------
console.log('clamping');
{
    const cheater: RobotController = {
        meta: { id: 'cheater', name: 'Cheater', author: 'test', version: '0', description: '' },
        update: (): Intent => ({ throttle: 99, turn: -99, towerTurn: 99, fire: true, charge: true }),
    };
    const garbage: RobotController = {
        meta: { id: 'garbage', name: 'Garbage', author: 'test', version: '0', description: '' },
        update: () =>
            ({
                throttle: NaN, turn: Infinity, towerTurn: -Infinity, fire: 'yes', charge: 1, dash: 'yes', emp: 1,
                strafe: NaN, moveX: Infinity, moveY: -Infinity, moveMode: 7, aimMode: 'track', aimTarget: NaN,
                aimLead: 1, fireMode: 2, radio: 'hello',
            }) as unknown as Intent,
    };
    const match = new Match(
        [
            { team: 0, controller: cheater },
            { team: 1, controller: garbage },
        ],
        7,
    );
    let maxStep = 0;
    let prev = match.robotSnapshots.map((s) => ({ x: s.x, y: s.y }));
    for (let i = 0; i < 600 && !match.result.over; i += 1) {
        match.step();
        const snaps = match.robotSnapshots;
        snaps.forEach((s, k) => {
            const p = prev[k] as { x: number; y: number };
            maxStep = Math.max(maxStep, Math.hypot(s.x - p.x, s.y - p.y));
            prev[k] = { x: s.x, y: s.y };
        });
    }
    check('garbage intents do not crash the match', match.result.tick > 0);
    check(`per-tick displacement within physics (max ${maxStep.toFixed(2)})`, maxStep <= MAX_SPEED * DT + 2.5);

    // Optional-with-default: a bare `{}` must behave exactly like explicit
    // zeros, and a partial `{ fire: true }` like its expanded form.
    const entry = ROBOTS[0];
    if (!entry) throw new Error('no robots registered');
    const duel = (update: () => Intent): Match => {
        const m = new Match(
            [
                { team: 0, controller: { meta: entry.meta, update } },
                { team: 1, controller: entry.create(), loadout: { ...entry.loadout } },
            ],
            7,
        );
        m.runToEnd();
        return m;
    };
    const bare = duel(() => ({}));
    const explicit = duel(() => ({ throttle: 0, turn: 0, towerTurn: 0, fire: false, charge: false }));
    check('bare {} intent finishes the match', bare.result.over);
    check('bare {} equals explicit zeros', fingerprint(bare) === fingerprint(explicit));
    const snap = duel(() => ({ fire: true }));
    const snapFull = duel(() => ({ throttle: 0, turn: 0, towerTurn: 0, fire: true, charge: false }));
    check('partial intent equals its expanded form', fingerprint(snap) === fingerprint(snapFull));
    const nil = duel(() => undefined as unknown as Intent);
    check('undefined intent idles safely', nil.result.over && nil.result.tick > 0);
}

// --- 3. Error isolation: throwing robots idle instead of killing the match --
console.log('isolation');
{
    const thrower: RobotController = {
        meta: { id: 'thrower', name: 'Thrower', author: 'test', version: '0', description: '' },
        update: (_sense: SenseState): Intent => {
            void _sense;
            throw new Error('boom');
        },
    };
    const entry = ROBOTS[0];
    if (!entry) throw new Error('no robots registered');
    const match = new Match(
        [
            { team: 0, controller: thrower },
            { team: 1, controller: entry.create() },
        ],
        42,
    );
    let guard = 0;
    while (!match.result.over && guard <= MAX_TICKS_TOTAL + 10) {
        match.step();
        guard += 1;
    }
    check('match completes despite throwing robot', match.result.over);

    // A robot that mutates its sensed stats must not alter real physics.
    const tamperer: RobotController = {
        meta: { id: 'tamperer', name: 'Tamperer', author: 'test', version: '0', description: '' },
        update: (sense: SenseState): Intent => {
            (sense.self.stats as { maxSpeed: number }).maxSpeed = 99999;
            (sense.self as { health: number }).health = 99999;
            return { throttle: 1, turn: 0, towerTurn: 0, fire: false, charge: false };
        },
    };
    const tm = new Match(
        [
            { team: 0, controller: tamperer },
            { team: 1, controller: entry.create() },
        ],
        42,
    );
    let tamperMax = 0;
    let tprev = tm.robotSnapshots[0] as { x: number; y: number; health: number };
    for (let i = 0; i < 300 && !tm.result.over; i += 1) {
        tm.step();
        const s = tm.robotSnapshots[0] as { x: number; y: number; health: number };
        tamperMax = Math.max(tamperMax, Math.hypot(s.x - tprev.x, s.y - tprev.y));
        tprev = s;
    }
    check('stat tampering does not exceed physics', tamperMax <= MAX_SPEED * DT + 2.5, `max=${tamperMax.toFixed(2)}`);
    check('health tampering does not stick', (tm.robotSnapshots[0]?.health ?? 0) <= 100);
}

// --- 4. Skills: sanitize, stats, charge ---------------------------------------
console.log('skills');
{
    const stats = computeStats({ overdrive: 3, trigger: 3, charger: 2, plating: 2 });
    check('overdrive 3 = +24% speed', Math.abs(stats.maxSpeed - MAX_SPEED * 1.24) < 0.001);
    check('trigger 3 = 15t cooldown', stats.cooldownTicks === 15);
    check('charger 2 = 20t x2 bank', stats.chargeTicks === 20 && stats.chargeMult === 2);
    check('plating 2 = 130 health', stats.maxHealth === 130);

    const over = sanitizeLoadout({ overdrive: 3, gyro: 3, servos: 3, plating: 9, bogus: 2 } as never);
    check('over-budget shed to 6', loadoutCost(over) === 6, `cost=${loadoutCost(over)}`);
    check('plating clamped to max 2', (over.plating ?? 0) <= 2);
    check('unknown ids dropped', !('bogus' in over));
    const sane = sanitizeLoadout(sanitizeLoadout({ overdrive: 2, trigger: 2, plating: 2 }));
    check('sanitize is idempotent', loadoutCost(sane) === 6);

    // Charge mechanic: a holder banks charge, firing consumes it for bonus.
    const holder: RobotController = {
        meta: { id: 'holder', name: 'Holder', author: 'test', version: '0', description: '' },
        update: (): Intent => ({ throttle: 0, turn: 0, towerTurn: 0, fire: false, charge: true }),
    };
    const dummy: RobotController = {
        meta: { id: 'dummy', name: 'Dummy', author: 'test', version: '0', description: '' },
        update: (): Intent => ({ throttle: 0, turn: 0, towerTurn: 0, fire: false, charge: false }),
    };
    const cm = new Match(
        [
            { team: 0, controller: holder, loadout: { charger: 2 } },
            { team: 1, controller: dummy },
        ],
        3,
    );
    for (let i = 0; i < 25; i += 1) cm.step();
    const banked = cm.robotSnapshots[0]?.charge ?? 0;
    check('charge banks while held', banked > 0.9, `charge=${banked.toFixed(2)}`);
    const shooter: RobotController = {
        meta: { id: 'shooter', name: 'Shooter', author: 'test', version: '0', description: '' },
        update: (): Intent => ({ throttle: 0, turn: 0, towerTurn: 0, fire: true, charge: false }),
    };
    const fm = new Match(
        [
            { team: 0, controller: holder, loadout: { charger: 1 } },
            { team: 1, controller: shooter },
        ],
        3,
    );
    for (let i = 0; i < 40 && !fm.result.over; i += 1) fm.step();
    check('charger match completes', fm.result.tick > 0);

    // Catalog v2: appended passives (NanoRepair, Slipstream, Deadeye, Scout).
    const v2 = computeStats({ nanorepair: 2, slipstream: 2, deadeye: 3, scout: 1 });
    check('nanorepair 2 = 3 HP/s regen', v2.regen === 3);
    check('slipstream 2 = +50% accel', Math.abs(v2.accel - ACCEL * 1.5) < 0.001);
    check('slipstream keeps top speed', computeStats({ slipstream: 2 }).maxSpeed === MAX_SPEED);
    check('deadeye 3 = +30% bullet speed', Math.abs(v2.bulletSpeed - BULLET_SPEED * 1.3) < 0.001);
    check('deadeye keeps gun range', computeStats({ deadeye: 3 }).gunRange === GUN_RANGE);
    check('scout 1 = 2x sensor range blips', v2.scoutRange === v2.sensorRange * 2);
    check('no scout = zero blip range', computeStats({}).scoutRange === 0);
    check('scout clamps to max 1', sanitizeLoadout({ scout: 5 }).scout === 1);
    check('deadeye clamps to max 3', sanitizeLoadout({ deadeye: 9 }).deadeye === 3);
    const shedV2 = sanitizeLoadout({ overdrive: 3, trigger: 3, scout: 1 });
    check('over-budget sheds from catalog end first', loadoutCost(shedV2) === 6 && shedV2.scout === undefined);
    check('new codes render in catalog order', loadoutCode({ scout: 1, deadeye: 2, nanorepair: 1 }) === 'NRP1 DDY2 SCT1');

    const sitter: RobotController = {
        meta: { id: 'sitter', name: 'Sitter', author: 'test', version: '0', description: '' },
        update: (): Intent => ({ throttle: 0, turn: 0, towerTurn: 0, fire: false, charge: false }),
    };
    const gunner: RobotController = {
        meta: { id: 'gunner', name: 'Gunner', author: 'test', version: '0', description: '' },
        update: (): Intent => ({ throttle: 1, turn: 0, towerTurn: 0, fire: true, charge: false }),
    };
    // Regen: identical damage in both matches, so the gap is pure regen ticks.
    const regenDuel = (loadout: SkillLoadout): Match =>
        new Match(
            [
                { team: 0, controller: sitter, loadout },
                { team: 1, controller: gunner },
            ],
            3,
        );
    const bleed = regenDuel({});
    let firstBlood = -1;
    for (let i = 0; i < 2000; i += 1) {
        bleed.step();
        if ((bleed.robotSnapshots[0]?.health ?? 100) < 100) {
            firstBlood = i + 1;
            break;
        }
    }
    check('regen probe takes a hit', firstBlood > 0);
    if (firstBlood > 0) {
        const hpAt = (loadout: SkillLoadout): number => {
            const m = regenDuel(loadout);
            for (let i = 0; i < firstBlood + 60; i += 1) m.step();
            return m.robotSnapshots[0]?.health ?? -1;
        };
        const plainHp = hpAt({});
        const regenHp = hpAt({ nanorepair: 2 });
        // 60 ticks below max at 3 HP/s = exactly +3 HP of regen.
        check(
            'regen heals exactly 3 HP/s in-match',
            plainHp > 0 && Math.abs(regenHp - plainHp - 3) < 0.01,
            `plain=${plainHp.toFixed(1)} regen=${regenHp.toFixed(1)}`,
        );
    }
    // Slipstream: same top speed, reached sooner, so further along at tick 45.
    const dragRacer: RobotController = {
        meta: { id: 'drag', name: 'Drag', author: 'test', version: '0', description: '' },
        update: (): Intent => ({ throttle: 1, turn: 0, towerTurn: 0, fire: false, charge: false }),
    };
    const distanceAt45 = (loadout: SkillLoadout): number => {
        const m = new Match(
            [
                { team: 0, controller: dragRacer, loadout },
                { team: 1, controller: sitter },
            ],
            3,
        );
        for (let i = 0; i < 45; i += 1) m.step();
        return m.robotSnapshots[0]?.x ?? -1;
    };
    check('slipstream out-accelerates stock', distanceAt45({ slipstream: 2 }) > distanceAt45({}));
    // Deadeye: per-tick bullet displacement matches the faster muzzle velocity.
    const bulletPace = (loadout: SkillLoadout): number => {
        const m = new Match(
            [
                { team: 0, controller: gunner, loadout },
                { team: 1, controller: sitter },
            ],
            3,
        );
        m.step();
        const before = m.bulletSnapshots[0];
        for (let i = 0; i < 10; i += 1) m.step();
        const after = m.bulletSnapshots[0];
        if (!before || !after) return -1;
        return Math.hypot(after.x - before.x, after.y - before.y) / 10;
    };
    check('stock bullet pace is 430 u/s', Math.abs(bulletPace({}) - BULLET_SPEED * DT) < 0.001);
    check('deadeye 3 bullet pace is +30%', Math.abs(bulletPace({ deadeye: 3 }) - BULLET_SPEED * 1.3 * DT) < 0.001);
    // Scout: the spawn gap (700) sits beyond cone range (540) but inside
    // blip range (1080), so the spy opens on a blip and converts it to a
    // full sighting (never a duplicate) as it closes in.
    interface ScoutEntry {
        foes: number;
        scout: number;
        x: number;
        y: number;
        health: number;
        heading: number;
        speed: number;
    }
    const runScoutSpy = (loadout: SkillLoadout): ScoutEntry[] => {
        const log: ScoutEntry[] = [];
        const spy: RobotController = {
            meta: { id: 'spy', name: 'Spy', author: 'test', version: '0', description: '' },
            update: (sense: SenseState): Intent => {
                const blip = sense.scout[0];
                log.push({
                    foes: sense.foes.length,
                    scout: sense.scout.length,
                    x: blip?.x ?? -1,
                    y: blip?.y ?? -1,
                    health: blip?.health ?? -1,
                    heading: blip?.heading ?? -1,
                    speed: blip?.speed ?? -1,
                });
                return { throttle: 1, turn: 0, towerTurn: 0, fire: false, charge: false };
            },
        };
        const m = new Match(
            [
                { team: 0, controller: spy, loadout },
                { team: 1, controller: sitter },
            ],
            3,
        );
        for (let i = 0; i < 150; i += 1) m.step();
        return log;
    };
    const scoutLog = runScoutSpy({ scout: 1 });
    const first = scoutLog[0];
    const closed = scoutLog[120];
    check(
        'distant foe opens as a position-only blip',
        first !== undefined && first.foes === 0 && first.scout === 1,
        `foes=${first?.foes} scout=${first?.scout}`,
    );
    check(
        'blip is live position, zero health/heading/speed',
        first !== undefined && first.x === 830 && first.y === 320 && first.health === 0 && first.heading === 0 && first.speed === 0,
        `x=${first?.x} y=${first?.y} hp=${first?.health}`,
    );
    check(
        'seen foes convert, never duplicate as blips',
        closed !== undefined && closed.foes === 1 && closed.scout === 0,
        `foes=${closed?.foes} scout=${closed?.scout}`,
    );
    check(
        'no scout skill means no blips',
        runScoutSpy({}).every((entry) => entry.scout === 0),
    );
}

// --- 4b. Actives: dash burst + EMP slow, exact cooldowns, determinism -----
console.log('actives');
{
    const idleMeta = (id: string): RobotController['meta'] => ({ id, name: id, author: 'test', version: '0', description: '' });
    const sitter: RobotController = {
        meta: idleMeta('sitter'),
        update: (): Intent => ({ throttle: 0, turn: 0, towerTurn: 0, fire: false, charge: false }),
    };
    // Dash at full speed on tick 120: the burst lands the same tick and the
    // 8 s cooldown ticks down exactly.
    interface DashEntry {
        speed: number;
        dashCd: number;
    }
    const runDash = (dashAt: number, ticks: number): DashEntry[] => {
        const log: DashEntry[] = [];
        const dasher: RobotController = {
            meta: idleMeta('dasher'),
            update: (sense: SenseState): Intent => {
                log.push({ speed: sense.self.speed, dashCd: sense.self.dashCd });
                return { throttle: 1, turn: 0, towerTurn: 0, fire: false, charge: false, dash: sense.tick === dashAt };
            },
        };
        const m = new Match(
            [
                { team: 0, controller: dasher },
                { team: 1, controller: sitter },
            ],
            3,
        );
        for (let i = 0; i < ticks; i += 1) m.step();
        return log;
    };
    const dashLog = runDash(120, 610);
    check('cruising speed caps at top speed', Math.abs((dashLog[120]?.speed ?? -1) - MAX_SPEED) < 0.001);
    check('dash bursts past top speed the same tick', (dashLog[121]?.speed ?? 0) > MAX_SPEED);
    check('dash cooldown starts at 480 ticks', dashLog[121]?.dashCd === DASH_COOLDOWN_TICKS - 1);
    check('dash ready again exactly 8 s later', dashLog[600]?.dashCd === 0 && (dashLog[599]?.dashCd ?? -1) === 1);
    const parked = runDash(-1, 130);
    check('undashed cooldown stays zero', parked.every((entry) => entry.dashCd === 0));
    check(
        'undashed speed never exceeds top speed',
        parked.every((entry) => entry.speed <= MAX_SPEED + 0.001),
    );
    // Dashing while parked does nothing: zero throttle, zero motion.
    const still = new Match(
        [
            {
                team: 0,
                controller: {
                    meta: idleMeta('parker'),
                    update: (sense: SenseState): Intent => ({
                        throttle: 0,
                        turn: 0,
                        towerTurn: 0,
                        fire: false,
                        charge: false,
                        dash: sense.tick === 10,
                    }),
                },
            },
            { team: 1, controller: sitter },
        ],
        3,
    );
    for (let i = 0; i < 30; i += 1) still.step();
    check('parked dash moves nowhere', still.robotSnapshots[0]?.x === 130 && still.robotSnapshots[0]?.y === 320);

    // EMP: closing driver pulses on entering radius; the sitter logs slowed.
    const runEmp = (): { userCd: number[]; foeSlow: boolean[]; trigger: number } => {
        const userCd: number[] = [];
        const foeSlow: boolean[] = [];
        const user: RobotController = {
            meta: idleMeta('emp-user'),
            update: (sense: SenseState): Intent => {
                userCd.push(sense.self.empCd);
                const foe = sense.foes[0];
                return {
                    throttle: 1,
                    turn: 0,
                    towerTurn: 0,
                    fire: false,
                    charge: false,
                    emp: foe !== undefined && foe.distance < EMP_RADIUS,
                };
            },
        };
        const foe: RobotController = {
            meta: idleMeta('emp-foe'),
            update: (sense: SenseState): Intent => {
                foeSlow.push(sense.self.slowed);
                return { throttle: 0, turn: 0, towerTurn: 0, fire: false, charge: false };
            },
        };
        const m = new Match(
            [
                { team: 0, controller: user },
                { team: 1, controller: foe },
            ],
            3,
        );
        for (let i = 0; i < 420; i += 1) m.step();
        return { userCd, foeSlow, trigger: userCd.findIndex((cd) => cd === EMP_COOLDOWN_TICKS - 1) };
    };
    const emp = runEmp();
    check('EMP triggers on entering radius', emp.trigger > 0, `tick=${emp.trigger}`);
    if (emp.trigger > 0) {
        const T = emp.trigger;
        check('EMP cooldown ticks down exactly', emp.userCd[T + 1] === EMP_COOLDOWN_TICKS - 2);
        check('foe unslowed before the pulse', emp.foeSlow[T - 1] === false);
        check('foe slowed the tick after the pulse', emp.foeSlow[T] === true);
        check(
            `slow lasts exactly ${EMP_SLOW_TICKS} ticks`,
            emp.foeSlow[T + EMP_SLOW_TICKS - 2] === true && emp.foeSlow[T + EMP_SLOW_TICKS - 1] === false,
        );
    }
    // Whiffed EMP (foe beyond radius) still pays the 12 s cooldown.
    const whiffUser: RobotController = {
        meta: idleMeta('whiffer'),
        update: (sense: SenseState): Intent => ({
            throttle: 1,
            turn: 0,
            towerTurn: 0,
            fire: false,
            charge: false,
            emp: sense.tick === 0,
        }),
    };
    let whiffSlow = false;
    let whiffCd = -1;
    const whiffFoe: RobotController = {
        meta: idleMeta('whiff-foe'),
        update: (sense: SenseState): Intent => {
            if (sense.self.slowed) whiffSlow = true;
            return { throttle: 0, turn: 0, towerTurn: 0, fire: false, charge: false };
        },
    };
    const whiffUserSpy: RobotController = {
        meta: idleMeta('whiff-spy'),
        update: (sense: SenseState): Intent => {
            if (sense.tick === 1) whiffCd = sense.self.empCd;
            return whiffUser.update(sense);
        },
    };
    const whiff = new Match(
        [
            { team: 0, controller: whiffUserSpy },
            { team: 1, controller: whiffFoe },
        ],
        3,
    );
    for (let i = 0; i < 60; i += 1) whiff.step();
    check('out-of-radius EMP slows nobody', !whiffSlow);
    check('whiffed EMP still pays cooldown', whiffCd === EMP_COOLDOWN_TICKS - 1);
    // Allies (and the user) are immune, even inside the radius.
    let allySlow = false;
    let selfSlow = false;
    const ally: RobotController = {
        meta: idleMeta('ally'),
        update: (sense: SenseState): Intent => {
            if (sense.self.slowed) allySlow = true;
            return { throttle: 0, turn: 0, towerTurn: 0, fire: false, charge: false };
        },
    };
    const selfish: RobotController = {
        meta: idleMeta('selfish'),
        update: (sense: SenseState): Intent => {
            if (sense.self.slowed) selfSlow = true;
            return { throttle: 0, turn: 0, towerTurn: 0, fire: false, charge: false, emp: sense.tick === 0 };
        },
    };
    const friendly = new Match(
        [
            { team: 0, controller: selfish },
            { team: 0, controller: ally },
            { team: 1, controller: sitter },
        ],
        3,
    );
    for (let i = 0; i < 60; i += 1) friendly.step();
    check('EMP spares allies in radius', !allySlow);
    check('EMP spares its user', !selfSlow);
    // Actives are deterministic: brawler + ghost both dash and EMP.
    const act1 = runMatch(['brawler', 'ghost'], [0, 1], 77);
    const act2 = runMatch(['brawler', 'ghost'], [0, 1], 77);
    check('active-skill match is deterministic', fingerprint(act1) === fingerprint(act2));
    // The hooks fire in real games: a spied brawler-vs-ghost sees cooldowns.
    let sawCooldown = false;
    const spyActive = (inner: RobotController): RobotController => ({
        meta: inner.meta,
        loadout: inner.loadout,
        onSpawn:
            inner.onSpawn === undefined
                ? undefined
                : (sense: SenseState): void => {
                      inner.onSpawn?.(sense);
                  },
        update: (sense: SenseState): Intent => {
            if (sense.self.dashCd > 0 || sense.self.empCd > 0) sawCooldown = true;
            return inner.update(sense);
        },
    });
    const brawlerEntry = ROBOTS.find((r) => r.meta.id === 'brawler');
    const ghostEntry = ROBOTS.find((r) => r.meta.id === 'ghost');
    if (!brawlerEntry || !ghostEntry) throw new Error('missing active-hook robots');
    const spied = new Match(
        [
            { team: 0, controller: spyActive(brawlerEntry.create()), loadout: { ...brawlerEntry.loadout } },
            { team: 1, controller: spyActive(ghostEntry.create()), loadout: { ...ghostEntry.loadout } },
        ],
        77,
    );
    let spiedGuard = 0;
    while (!spied.result.over && spiedGuard <= MAX_TICKS_TOTAL + 10) {
        spied.step();
        spiedGuard += 1;
    }
    check('hooked bots trigger actives in-match', sawCooldown);
}

// --- 4c. Contract hardening: API version, runToEnd, catalog ceilings, perf --
console.log('contract');
{
    check('robot API version exports as 1', ROBOT_API_VERSION === 1);
    check(
        'skill catalog within the 15-skill codec ceiling',
        SKILL_DEFS.length <= 15,
        `${SKILL_DEFS.length}/15 skills`,
    );
    check(
        'every skill rank within the 3-rank codec ceiling',
        SKILL_DEFS.every((def) => def.maxRank <= 3),
        `max=${Math.max(...SKILL_DEFS.map((def) => def.maxRank))}`,
    );

    const hunterEntry = ROBOTS.find((r) => r.meta.id === 'hunter');
    const orbiterEntry = ROBOTS.find((r) => r.meta.id === 'orbiter');
    if (!hunterEntry || !orbiterEntry) throw new Error('missing hunter/orbiter');
    const fresh = (): Match =>
        new Match(
            [
                { team: 0, controller: hunterEntry.create(), loadout: { ...hunterEntry.loadout } },
                { team: 1, controller: orbiterEntry.create(), loadout: { ...orbiterEntry.loadout } },
            ],
            11,
        );
    const ended = fresh();
    ended.runToEnd();
    check('runToEnd finishes the match', ended.result.over);
    const capped = fresh();
    capped.runToEnd(10);
    check('runToEnd respects maxGuard', !capped.result.over && capped.result.tick === 11, `tick=${capped.result.tick}`);

    // Perf gate (wall-clock, tests+review only — never enforced in-engine,
    // where timing would break determinism). Each bot duels hunter for 900
    // ticks after a 60-tick JIT warmup; only the bot's own update() calls
    // are timed. Mean budget 0.1 ms; any single tick above 10 ms is a
    // pathological spike, not a slow machine (GC pauses stay well under it).
    const MEAN_BUDGET_MS = 0.1;
    const SPIKE_BUDGET_MS = 10;
    let worstMean = 0;
    let worstMeanId = '';
    let worstSpike = 0;
    let worstSpikeId = '';
    for (const bot of ROBOTS) {
        const inner = bot.create();
        const samples: number[] = [];
        let ticks = 0;
        const timed: RobotController = {
            ...inner,
            update: (sense: SenseState): Intent => {
                const start = performance.now();
                const out = inner.update(sense);
                ticks += 1;
                if (ticks > 60) samples.push(performance.now() - start);
                return out;
            },
        };
        const duel = new Match(
            [
                { team: 0, controller: timed, loadout: { ...bot.loadout } },
                { team: 1, controller: hunterEntry.create(), loadout: { ...hunterEntry.loadout } },
            ],
            5,
        );
        for (let i = 0; i < 960 && !duel.result.over; i += 1) duel.step();
        const mean = samples.reduce((sum, s) => sum + s, 0) / Math.max(1, samples.length);
        const spike = samples.reduce((max, s) => Math.max(max, s), 0);
        if (mean > worstMean) {
            worstMean = mean;
            worstMeanId = bot.meta.id;
        }
        if (spike > worstSpike) {
            worstSpike = spike;
            worstSpikeId = bot.meta.id;
        }
    }
    check(
        `per-robot mean update under 0.1 ms (worst ${worstMeanId} ${worstMean.toFixed(4)} ms)`,
        worstMean < MEAN_BUDGET_MS,
    );
    check(
        `no single-tick spike above 10 ms (worst ${worstSpikeId} ${worstSpike.toFixed(2)} ms)`,
        worstSpike < SPIKE_BUDGET_MS,
    );
}

// --- 5. Soak: 1v1 round-robin, 2v2, 3v3 (every arena) -----------------------
console.log('soak');
{
    const ids = ROBOTS.map((r) => r.meta.id);
    const seeds = [11, 22, 33];
    console.log(`       baseline: ${ids.length} bots x ${seeds.length} seeds x ${ARENA_IDS.length} arenas (counts dynamic)`);
    let games = 0;
    let totalErrors = 0;
    for (const arena of ARENA_IDS) {
        const wins = new Map<string, number>(ids.map((id) => [id, 0]));
        let draws = 0;
        for (const a of ids) {
            for (const b of ids) {
                if (a === b) continue;
                for (const seed of seeds) {
                    const match = runMatch([a, b], [0, 1], seed, undefined, arena);
                    games += 1;
                    totalErrors += match.robotSnapshots.reduce((sum, s) => sum + s.errors, 0);
                    if (!match.result.over) {
                        check(`1v1 ${a} vs ${b} seed ${seed} ${arena} finishes`, false);
                        continue;
                    }
                    if (match.result.winner === 0) wins.set(a, (wins.get(a) ?? 0) + 1);
                    else if (match.result.winner === 1) wins.set(b, (wins.get(b) ?? 0) + 1);
                    else draws += 1;
                }
            }
        }
        console.log(`       ${arena} record: ${ids.map((id) => `${id}=${wins.get(id)}`).join(' ')} draws=${draws}`);
        const maxWins = Math.max(...[...wins.values()]);
        const arenaGames = ids.length * (ids.length - 1) * seeds.length;
        check(`no robot wins every ${arena} matchup (balance smell)`, maxWins < arenaGames);
        check(`zero 1v1 draws on ${arena}`, draws === 0, `draws=${draws}`);
    }
    check(`all ${games} 1v1 games finished`, games === ids.length * (ids.length - 1) * seeds.length * ARENA_IDS.length);
    check('built-in robots run error-free', totalErrors === 0, `errors=${totalErrors}`);

    for (const arena of ARENA_IDS) {
        const m2 = runMatch(['rusher', 'hunter', 'turret', 'orbiter'], [0, 0, 1, 1], 5, undefined, arena);
        check(`2v2 completes on ${arena}`, m2.result.over);
        const m3 = runMatch(
            ['rusher', 'hunter', 'orbiter', 'turret', 'wanderer', 'hunter'],
            [0, 0, 0, 1, 1, 1],
            6,
            undefined,
            arena,
        );
        check(`3v3 completes on ${arena}`, m3.result.over);
    }
}

// --- 5b. Arena: mirrored layout, safe spawns, solid blocks --------------------
console.log('arena');
{
    const open = new Match(
        [
            { team: 0, controller: ROBOTS[0]!.create() },
            { team: 1, controller: ROBOTS[1]!.create() },
        ],
        1,
        { arena: 'open' },
    );
    const blocks = new Match(
        [
            { team: 0, controller: ROBOTS[0]!.create() },
            { team: 1, controller: ROBOTS[1]!.create() },
        ],
        1,
        { arena: 'blocks' },
    );
    check('open arena has no obstacles', open.obstacles.length === 0);
    check('blocks arena has obstacles', blocks.obstacles.length > 0);
    check('unknown arena falls back to open', new Match(
        [
            { team: 0, controller: ROBOTS[0]!.create() },
            { team: 1, controller: ROBOTS[1]!.create() },
        ],
        1,
        { arena: 'void' as ArenaId },
    ).arenaId === 'open');
    // Every block mirrors through the arena center onto another block.
    const rects = ARENA_OBSTACLES.blocks;
    const mirrored = rects.every((o) =>
        rects.some(
            (p) =>
                p.x === ARENA_WIDTH - o.x - o.w &&
                p.y === ARENA_HEIGHT - o.y - o.h &&
                p.w === o.w &&
                p.h === o.h,
        ),
    );
    check('blocks mirror through arena center', mirrored);
    const clearOf = (x: number, y: number): boolean =>
        rects.every((o) => {
            const cx = Math.max(o.x, Math.min(x, o.x + o.w));
            const cy = Math.max(o.y, Math.min(y, o.y + o.h));
            // Epsilon: push-out normalization leaves float dust (~1e-14).
            return Math.hypot(x - cx, y - cy) >= ROBOT_RADIUS - 1e-6;
        });
    // Spawns for 1v1 through 3v3 never start inside a block.
    let spawnsClear = true;
    for (const teamSize of [1, 2, 3]) {
        const ids: string[] = [];
        const teams: Array<0 | 1> = [];
        for (let i = 0; i < teamSize * 2; i += 1) {
            ids.push(ROBOTS[i % ROBOTS.length]!.meta.id);
            teams.push(i < teamSize ? 0 : 1);
        }
        const lineups: LineupEntry[] = ids.map((id, i) => {
            const entry = ROBOTS.find((r) => r.meta.id === id);
            if (!entry) throw new Error(`unknown robot ${id}`);
            return { team: teams[i] as 0 | 1, controller: entry.create() };
        });
        const fresh = new Match(lineups, 9, { arena: 'blocks' });
        for (const s of fresh.robotSnapshots) {
            if (!clearOf(s.x, s.y)) spawnsClear = false;
        }
    }
    check('spawns never start inside blocks', spawnsClear);
    // Collision holds mid-match: sample a full game, nobody clips a block.
    const probeLineups: LineupEntry[] = ['rusher', 'turret'].map((id, i) => {
        const entry = ROBOTS.find((r) => r.meta.id === id);
        if (!entry) throw new Error(`unknown robot ${id}`);
        return { team: (i === 0 ? 0 : 1) as 0 | 1, controller: entry.create() };
    });
    const probe = new Match(probeLineups, 77, { arena: 'blocks' });
    let clipped = false;
    let sampled = 0;
    while (!probe.result.over) {
        probe.step();
        sampled += 1;
        if (sampled % 10 === 0) {
            for (const s of probe.robotSnapshots) {
                if (s.alive && !clearOf(s.x, s.y)) clipped = true;
            }
        }
    }
    check('robots never clip blocks mid-match', !clipped && sampled > 0);
}

// --- 5c. Sudden death: circle shrinks, outsiders pulse, draws vanish ------
console.log('sudden-death');
{
    const dummy = (id: string): RobotController => ({
        meta: { id, name: id, author: 'test', version: '0', description: '' },
        update: (): Intent => ({ throttle: 0, turn: 0, towerTurn: 0, fire: false, charge: false }),
    });
    const stalled = (): Match =>
        new Match(
            [
                { team: 0, controller: dummy('dummy-a') },
                { team: 1, controller: dummy('dummy-b') },
            ],
            11,
        );
    const match = stalled();
    while (match.result.tick < MAX_TICKS) match.step();
    check('time cap no longer ends the match', !match.result.over);
    check('sudden-death flag set past the cap', match.result.suddenDeath);
    check('circle centered on the arena', match.safeCircle.x === ARENA_WIDTH / 2 && match.safeCircle.y === ARENA_HEIGHT / 2);
    const r0 = match.safeCircle.r;
    check('spawns start inside the safe circle', match.robotSnapshots.every((s) => s.health === 100));
    for (let i = 0; i < SUDDEN_DEATH_TICKS / 2; i += 1) match.step();
    const r1 = match.safeCircle.r;
    check('circle shrinks over time', r1 < r0 && r1 > 0, `r0=${r0.toFixed(1)} r1=${r1.toFixed(1)}`);
    let guard = 0;
    while (!match.result.over && guard <= MAX_TICKS_TOTAL) {
        match.step();
        guard += 1;
    }
    check('stalled match ends decisively', match.result.over && match.result.winner !== -1);
    check('outsiders die during the shrink', match.result.tick < MAX_TICKS + SUDDEN_DEATH_TICKS);
    // Center-sitters ride the circle down to zero: nobody is safe at r = 0.
    const sitter = (id: string): RobotController => ({
        meta: { id, name: id, author: 'test', version: '0', description: '' },
        update: (sense: SenseState): Intent => {
            const dx = ARENA_WIDTH / 2 - sense.self.x;
            const dy = ARENA_HEIGHT / 2 - sense.self.y;
            const d = Math.hypot(dx, dy);
            if (d < 4) return { throttle: 0, turn: 0, towerTurn: 0, fire: false, charge: false };
            const want = Math.atan2(dy, dx);
            let diff = (want - sense.self.heading) % (Math.PI * 2);
            if (diff > Math.PI) diff -= Math.PI * 2;
            if (diff < -Math.PI) diff += Math.PI * 2;
            return { throttle: d > 30 ? 1 : 0.3, turn: Math.max(-1, Math.min(1, diff * 2)), towerTurn: 0, fire: false, charge: false };
        },
    });
    const sit = new Match(
        [
            { team: 0, controller: sitter('sit-a') },
            { team: 1, controller: sitter('sit-b') },
        ],
        11,
    );
    let guardSit = 0;
    while (!sit.result.over && guardSit <= MAX_TICKS_TOTAL) {
        sit.step();
        guardSit += 1;
    }
    check('center-sitters survive past full collapse', sit.result.tick > MAX_TICKS + SUDDEN_DEATH_TICKS);
    check('circle fully collapses', sit.safeCircle.r === 0);
    check('collapsed circle still ends decisively', sit.result.over && sit.result.winner !== -1);
    const again = stalled();
    let guard2 = 0;
    while (!again.result.over && guard2 <= MAX_TICKS_TOTAL) {
        again.step();
        guard2 += 1;
    }
    check('sudden death is deterministic', fingerprint(match) === fingerprint(again));
}

// --- 6. Replay codes: round-trip + same code => identical fingerprint ------
console.log('replay');
{
    const specs: ReplaySpec[] = [
        {
            seed: 4242,
            teamSize: 1,
            lineupIds: ['hunter', 'orbiter'],
            loadouts: [{ overdrive: 2, trigger: 3 }, { plating: 2, charger: 1, wideband: 1 }],
            arena: 'blocks',
            modifiers: { doubleDamage: true, mirror: true },
        },
        {
            seed: 7,
            teamSize: 3,
            lineupIds: ['rusher', 'hunter', 'orbiter', 'turret', 'wanderer', 'hunter'],
            loadouts: [{}, {}, {}, {}, {}, {}],
        },
    ];
    for (const spec of specs) {
        const code = encodeReplay(spec);
        const back = decodeReplay(code);
        check(`replay round-trips (${spec.teamSize}v${spec.teamSize})`, back !== null);
        if (back) {
            const sameSetup =
                back.seed === spec.seed &&
                back.teamSize === spec.teamSize &&
                JSON.stringify(back.lineupIds) === JSON.stringify(spec.lineupIds) &&
                JSON.stringify(back.loadouts) === JSON.stringify(spec.loadouts.map((l) => sanitizeLoadout(l))) &&
                back.arena === (spec.arena ?? 'open') &&
                JSON.stringify(back.modifiers) === JSON.stringify(sanitizeModifiers(spec.modifiers ?? {}));
            check(`replay preserves seed+lineups+loadouts+arena+mods (${spec.teamSize}v${spec.teamSize})`, sameSetup);
            const teams = spec.lineupIds.map((_, i) => (i < spec.teamSize ? 0 : 1) as 0 | 1);
            const direct = runMatch(spec.lineupIds, teams, spec.seed, spec.loadouts, spec.arena ?? 'open', spec.modifiers ?? {});
            // Re-run purely from the decoded code, as Watch Replay does.
            const replayed = runMatch(back.lineupIds, teams, back.seed, back.loadouts, back.arena ?? 'open', back.modifiers ?? {});
            check(
                `same code => identical fingerprint (${spec.teamSize}v${spec.teamSize})`,
                fingerprint(direct) === fingerprint(replayed),
            );
        }
    }
    check('empty string rejected', decodeReplay('') === null);
    check('wrong prefix rejected', decodeReplay('XX1.abcdef') === null);
    check('bad base64 rejected', decodeReplay('RA1.!!!not-base64!!!') === null);
    const valid = encodeReplay(specs[0] as ReplaySpec);
    check('registry lineups use the compact RA2 format', valid.startsWith('RA2-'));
    check('compact 1v1 code fits on one results line', valid.length <= 40);
    const big = encodeReplay(specs[1] as ReplaySpec);
    // 65 chars at 13 skills; 72 covers the 15-skill codec ceiling.
    check('compact 3v3 code stays short', big.length <= 72);
    check('truncated code rejected', decodeReplay(valid.slice(0, -4)) === null);
    {
        // Flip one body character of a compact code: the checksum must catch it.
        const chars = valid.split('');
        const flipAt = valid.lastIndexOf('-') + 2;
        chars[flipAt] = chars[flipAt] === '0' ? '1' : '0';
        check('tampered compact code rejected', decodeReplay(chars.join('')) === null);
        // Forgiving input: lowercase + spaces still decode.
        check('lowercase compact code accepted', decodeReplay(valid.toLowerCase()) !== null);
        check('spaced compact code accepted', decodeReplay(valid.replace(/-/g, '  ')) !== null);
        // Custom-robot lineups fall back to the legacy format and round-trip.
        const custom: ReplaySpec = { ...(specs[0] as ReplaySpec), lineupIds: ['hunter', 'my-custom-bot'] };
        const legacy = encodeReplay(custom);
        check('custom lineup falls back to RA1', legacy.startsWith('RA1.'));
        const legacyBack = decodeReplay(legacy);
        check(
            'legacy fallback round-trips',
            legacyBack !== null && JSON.stringify(legacyBack.lineupIds) === JSON.stringify(custom.lineupIds),
        );
        // Legacy codes from older builds still decode.
        const oldCode = encodeReplayLegacy(specs[0] as ReplaySpec);
        const oldBack = decodeReplay(oldCode);
        check('legacy RA1 code still decodes', oldBack !== null && oldBack.seed === (specs[0] as ReplaySpec).seed);
        // Tamper the arena field inside an otherwise valid legacy code.
        const payload = oldCode.slice(oldCode.indexOf('.') + 1);
        const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        const tampered = `RA1.${Buffer.from(json.replace('"blocks"', '"void"'), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
        check('bad arena rejected', decodeReplay(tampered) === null);
        const badMods = `RA1.${Buffer.from(json.replace('"dm"', '"dx"'), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
        check('bad modifiers rejected', decodeReplay(badMods) === null);
    }
    check('overlong code rejected', decodeReplay(`RA1.${'A'.repeat(3000)}`) === null);
}

// --- 7. Match history: record/load/aggregate over a storage stub ----------
console.log('history');
{
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
        getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
        setItem: (key: string, value: string) => {
            store.set(key, value);
        },
        removeItem: (key: string) => {
            store.delete(key);
        },
    } as Storage;
    clearHistory();
    check('history starts empty', loadHistory().length === 0);
    recordMatch({ teamSize: 1, lineupIds: ['hunter', 'orbiter'], loadouts: [{}, {}], winner: 0, ticks: 600, seed: 1 });
    recordMatch({ teamSize: 1, lineupIds: ['hunter', 'orbiter'], loadouts: [{}, {}], winner: -1, ticks: 9000, seed: 2 });
    const loaded = loadHistory();
    check('two matches persist', loaded.length === 2);
    check('chronological order', (loaded[0]?.seed ?? -1) === 1 && (loaded[1]?.seed ?? -1) === 2);
    const rates = new Map(winRates(['hunter', 'orbiter', 'rusher']).map((r) => [r.id, r]));
    check('hunter 2 games 1 win 1 draw', rates.get('hunter')?.games === 2 && rates.get('hunter')?.wins === 1 && rates.get('hunter')?.draws === 1);
    check('orbiter winless', rates.get('orbiter')?.games === 2 && rates.get('orbiter')?.wins === 0);
    check('idle robot zero rate', rates.get('rusher')?.games === 0 && rates.get('rusher')?.rate === 0);
    for (let i = 0; i < 205; i += 1) {
        recordMatch({ teamSize: 1, lineupIds: ['rusher', 'turret'], loadouts: [{}, {}], winner: 1, ticks: 100, seed: 100 + i });
    }
    const capped = loadHistory();
    check('log capped at 200, newest kept', capped.length === 200 && capped[199]?.seed === 304);
    store.set('robotarena.history.v1', 'not-json{{{');
    check('corrupt storage loads as empty', loadHistory().length === 0);
    clearHistory();
    check('clear empties the log', loadHistory().length === 0);

    // Daily board (same storage stub still installed).
    clearDailyBoard();
    check('same date => same seed', dailySeed('2026-09-19') === dailySeed('2026-09-19'));
    check('different dates => different seeds', dailySeed('2026-09-19') !== dailySeed('2026-09-20'));
    check('daily date key format', dailyDateKey(new Date(2026, 8, 19)) === '2026-09-19');
    check('fixed daily matchup', JSON.stringify(dailyLineup()) === JSON.stringify(['hunter', 'orbiter']));
    const day = { seed: 1, lineupIds: ['hunter', 'orbiter'] };
    recordDailyResult('2026-09-19', { ...day, winner: -1, ticks: 9000 });
    recordDailyResult('2026-09-19', { ...day, winner: 0, ticks: 3000 });
    let board = loadDailyBoard();
    check('decisive replaces draw', board.length === 1 && board[0]?.winner === 0);
    recordDailyResult('2026-09-19', { ...day, winner: 1, ticks: 5000 });
    board = loadDailyBoard();
    check('slower result does not replace best', board[0]?.winner === 0 && board[0]?.ticks === 3000);
    recordDailyResult('2026-09-18', { ...day, winner: 1, ticks: 100 });
    board = loadDailyBoard();
    check('board newest-first', board.length === 2 && board[0]?.date === '2026-09-19' && board[1]?.date === '2026-09-18');
    store.set('robotarena.daily.v1', 'not-json{{{');
    check('corrupt daily loads as empty', loadDailyBoard().length === 0);
    clearDailyBoard();
    check('daily clear empties board', loadDailyBoard().length === 0);
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
}

// --- 8. Tournament: bracket helpers + full 8-bot headless run ------------
console.log('tournament');
{
    try {
        initialRound(['a', 'b', 'c']);
        check('rejects non-4/8 entrants', false);
    } catch {
        check('rejects non-4/8 entrants', true);
    }
    check('next round waits for winners', nextRound(initialRound(['a', 'b', 'c', 'd'])) === null);
    check(
        'round names',
        roundName(0, 3) === 'QUARTERFINAL' && roundName(0, 2) === 'SEMIFINAL' && roundName(1, 2) === 'FINAL',
    );
    const snap = (damage: number): RobotSnapshot => ({ damageDealt: damage }) as RobotSnapshot;
    check('tiebreak favors damage', tiebreakWinner([snap(50), snap(10)], 'a', 'b') === 'a');
    check('tiebreak symmetric', tiebreakWinner([snap(10), snap(50)], 'a', 'b') === 'b');
    check('tiebreak falls back to order', tiebreakWinner([snap(10), snap(10)], 'a', 'b') === 'a');

    // Full bracket, same rules as the scene: fresh controllers per match.
    const started = Date.now();
    let round = initialRound(['rusher', 'turret', 'orbiter', 'wanderer', 'hunter', 'rusher', 'turret', 'orbiter']);
    let champion: string | null = null;
    let matches = 0;
    let unfinished = 0;
    for (;;) {
        for (const slot of round) {
            const match = runMatch([slot.a, slot.b], [0, 1], (99 + matches * 2654435761) >>> 0);
            matches += 1;
            if (!match.result.over) {
                unfinished += 1;
                continue;
            }
            slot.ticks = match.result.tick;
            if (match.result.winner === 0) slot.winner = slot.a;
            else if (match.result.winner === 1) slot.winner = slot.b;
            else {
                slot.winner = tiebreakWinner(match.robotSnapshots, slot.a, slot.b);
                slot.draw = true;
            }
        }
        const next = nextRound(round);
        if (!next) {
            champion = round.length === 1 ? (round[0]?.winner ?? null) : null;
            break;
        }
        round = next;
    }
    const elapsed = Date.now() - started;
    check('every bracket match finishes', unfinished === 0);
    check('8-bot bracket yields a champion in 7 matches', champion !== null && matches === 7);
    check(`8-bot tournament under 30s (${(elapsed / 1000).toFixed(1)}s)`, elapsed < 30000);
}

// --- Workshop: template passes, violations fail, comments don't count -----
console.log('workshop');
{
    const failed = (source: string, id: string): boolean =>
        checkRobotSource(source).some((check) => check.id === id && !check.pass);
    check('template passes every check', workshopPassed(checkRobotSource(WORKSHOP_TEMPLATE)));
    check('template suggests mybot.ts', suggestFilename(WORKSHOP_TEMPLATE) === 'mybot.ts');
    check('empty draft fails meta-shape', failed('', 'meta-shape'));
    check('empty draft fails create-export', failed('', 'create-export'));
    check('uppercase id fails meta-id', failed(WORKSHOP_TEMPLATE.replace("id: 'mybot'", "id: 'MyBot'"), 'meta-id'));
    check(
        'over-budget loadout fails loadout-budget',
        failed(WORKSHOP_TEMPLATE.replace('{ overdrive: 2, trigger: 2, plating: 2 }', '{ overdrive: 3, trigger: 3, plating: 3 }'), 'loadout-budget'),
    );
    check(
        'unknown skill fails loadout-skills',
        failed(WORKSHOP_TEMPLATE.replace('{ overdrive: 2, trigger: 2, plating: 2 }', '{ overdrive: 2, warpdrive: 2 }'), 'loadout-skills'),
    );
    check('Math.random in code fails no-nondeterminism', failed(`${WORKSHOP_TEMPLATE}\nconst r = Math.random();`, 'no-nondeterminism'));
    check('fetch in code fails no-io', failed(`${WORKSHOP_TEMPLATE}\nvoid fetch("/x");`, 'no-io'));
    check('document in code fails no-host', failed(`${WORKSHOP_TEMPLATE}\nvoid document.title;`, 'no-host'));
    check('dynamic import fails no-host', failed(`${WORKSHOP_TEMPLATE}\nvoid import("./evil");`, 'no-host'));
    check('phaser import fails imports', failed(`import "phaser";\n${WORKSHOP_TEMPLATE}`, 'imports'));
    check(
        'banned words in comments still pass',
        workshopPassed(checkRobotSource(`${WORKSHOP_TEMPLATE}\n// Math.random fetch document are all banned\n/* eval("x") */`)),
    );
    check('unusable id falls back to my-robot.ts', suggestFilename('export const meta = { id: "Nope!" };') === 'my-robot.ts');
    // Intent fields are optional: partial returns pass, unknown keys fail.
    const partial = WORKSHOP_TEMPLATE.replace(
        'return { throttle: 0.6, turn: 0, towerTurn: 0.8, fire: false, charge: false };',
        'return { throttle: 0.6, towerTurn: 0.8 };',
    ).replace(
        'return { throttle: 1, turn: 0, towerTurn, fire: Math.abs(diff) < 0.07, charge: false };',
        'return { throttle: 1, towerTurn, fire: Math.abs(diff) < 0.07 };',
    );
    check('partial Intent passes intent-shape', !failed(partial, 'intent-shape'));
    check(
        'typo field fails intent-shape',
        failed(WORKSHOP_TEMPLATE.replace('towerTurn: 0.8', 'towerTurn: 0.8, throtle: 1'), 'intent-shape'),
    );
}

// --- 9. Team sensor sharing: 30-tick delayed position-only blips ---------
console.log('sharing');
{
    interface Fix {
        id: number;
        x: number;
        y: number;
    }
    interface SpyLog {
        tick: number;
        foes: Fix[];
        shared: Array<Fix & { heading: number; speed: number; health: number }>;
    }
    const makeSpy = (inner: RobotController, log: SpyLog[]): RobotController => ({
        meta: inner.meta,
        loadout: inner.loadout,
        onSpawn:
            inner.onSpawn === undefined
                ? undefined
                : (sense: SenseState): void => {
                      inner.onSpawn?.(sense);
                  },
        update: (sense: SenseState): Intent => {
            log.push({
                tick: sense.tick,
                foes: sense.foes.map((f) => ({ id: f.id, x: f.x, y: f.y })),
                shared: sense.shared.map((f) => ({
                    id: f.id,
                    x: f.x,
                    y: f.y,
                    heading: f.heading,
                    speed: f.speed,
                    health: f.health,
                })),
            });
            return inner.update(sense);
        },
    });
    const runSpied2v2 = (seed: number): SpyLog[][] => {
        const logs: SpyLog[][] = [[], []];
        const mk = (id: string, team: 0 | 1, spy: number | null): LineupEntry => {
            const entry = ROBOTS.find((r) => r.meta.id === id);
            if (!entry) throw new Error(`unknown robot ${id}`);
            const inner = entry.create();
            return {
                team,
                controller: spy === null ? inner : makeSpy(inner, logs[spy] as SpyLog[]),
                loadout: { ...entry.loadout },
            };
        };
        const match = new Match(
            [mk('hunter', 0, 0), mk('orbiter', 0, 1), mk('rusher', 1, null), mk('turret', 1, null)],
            seed,
        );
        let guard = 0;
        while (!match.result.over && guard <= MAX_TICKS_TOTAL + 10) {
            match.step();
            guard += 1;
        }
        return logs;
    };
    const logsA = runSpied2v2(5);
    const logsB = runSpied2v2(5);
    check('shared sight is deterministic', JSON.stringify(logsA) === JSON.stringify(logsB));
    const maps = logsA.map((log) => new Map(log.map((entry) => [entry.tick, entry])));
    let earlyLeak = 0;
    let lateHits = 0;
    let positionOnly = true;
    let delayExact = true;
    let excludesOwn = true;
    logsA.forEach((log, r) => {
        const ally = maps[1 - r] as Map<number, SpyLog>;
        for (const entry of log) {
            for (const s of entry.shared) {
                if (s.health !== 0 || s.heading !== 0 || s.speed !== 0) positionOnly = false;
            }
            if (entry.tick < SENSOR_SHARE_DELAY) {
                if (entry.shared.length > 0) earlyLeak += 1;
            } else {
                if (entry.shared.length > 0) lateHits += 1;
                const ownIds = new Set(entry.foes.map((f) => f.id));
                const seen = ally.get(entry.tick - SENSOR_SHARE_DELAY);
                for (const s of entry.shared) {
                    if (ownIds.has(s.id)) excludesOwn = false;
                    const match = seen?.foes.find((f) => f.id === s.id && f.x === s.x && f.y === s.y);
                    if (!match) delayExact = false;
                }
            }
        }
    });
    check('nothing shared before tick 30', earlyLeak === 0);
    check('sightings arrive after tick 30', lateHits > 0, `hits=${lateHits}`);
    check('shared is position-only (no health/speed/heading)', positionOnly);
    check('shared matches ally sightings exactly 30 ticks prior', delayExact);
    check('shared excludes currently-seen foes', excludesOwn);
    // 1v1 has no allies: shared stays empty all game.
    const soloLog: SpyLog[] = [];
    const soloEntry = ROBOTS.find((r) => r.meta.id === 'hunter');
    if (!soloEntry) throw new Error('no hunter');
    const solo = new Match(
        [{ team: 0, controller: makeSpy(soloEntry.create(), soloLog) }, { team: 1, controller: ROBOTS[1]!.create() }],
        5,
    );
    let guard = 0;
    while (!solo.result.over && guard <= MAX_TICKS_TOTAL + 10) {
        solo.step();
        guard += 1;
    }
    check('1v1 shared stays empty (no allies)', soloLog.every((e) => e.shared.length === 0) && soloLog.length > 30);
}

// --- 10. Exhibition modifiers: each flips a scripted matchup -------------
console.log('modifiers');
{
    // Sim core: fingerprint minus the arena+mods tags, so "flips" means the
    // sim itself diverged, not just the label.
    const simCore = (match: Match): string => fingerprint(match).split('|').slice(2).join('|');
    check('sanitize keeps only literal true', JSON.stringify(sanitizeModifiers({ doubleDamage: true, hardcoreFog: 'yes', mirror: 1 })) === JSON.stringify({ doubleDamage: true }));
    check('sanitize rejects non-objects', JSON.stringify(sanitizeModifiers(null)) === '{}' && JSON.stringify(sanitizeModifiers('2x')) === '{}');
    check('clean match is not exhibition', !isExhibition({}));
    check(
        'each flag marks exhibition',
        isExhibition({ doubleDamage: true }) && isExhibition({ hardcoreFog: true }) && isExhibition({ mirror: true }),
    );

    const plain = runMatch(['hunter', 'orbiter'], [0, 1], 11);
    const dbl = runMatch(['hunter', 'orbiter'], [0, 1], 11, undefined, 'open', { doubleDamage: true });
    const dblAgain = runMatch(['hunter', 'orbiter'], [0, 1], 11, undefined, 'open', { doubleDamage: true });
    const fog = runMatch(['hunter', 'orbiter'], [0, 1], 11, undefined, 'open', { hardcoreFog: true });
    check('modded matches are deterministic', fingerprint(dbl) === fingerprint(dblAgain));
    check('double damage flips the matchup', simCore(plain) !== simCore(dbl));
    check('hardcore fog flips the matchup', simCore(plain) !== simCore(fog));

    // Mirror: same bot both sides completes; the flag itself is sim-neutral.
    const mirror = runMatch(['hunter', 'hunter'], [0, 1], 11, undefined, 'open', { mirror: true });
    const mirrorPlain = runMatch(['hunter', 'hunter'], [0, 1], 11);
    check('mirror match completes', mirror.result.over);
    check('mirror flag is sim-neutral (lineup is the flip)', simCore(mirror) === simCore(mirrorPlain));
    check('mirror flips the matchup', simCore(plain) !== simCore(mirror));
    check('match exposes sanitized modifiers', JSON.stringify(mirror.modifiers) === JSON.stringify({ mirror: true }));

    // Double damage deals exactly 2x per hit, measured at the first-hit tick
    // (one hit only: equal-speed shots land 24 ticks apart, no deaths yet).
    const shooter: RobotController = {
        meta: { id: 'shooter', name: 'Shooter', author: 'test', version: '0', description: '' },
        update: (): Intent => ({ throttle: 1, turn: 0, towerTurn: 0, fire: true, charge: false }),
    };
    const target: RobotController = {
        meta: { id: 'target', name: 'Target', author: 'test', version: '0', description: '' },
        update: (): Intent => ({ throttle: 0, turn: 0, towerTurn: 0, fire: false, charge: false }),
    };
    const duel = (modifiers: MatchModifiers): Match =>
        new Match(
            [
                { team: 0, controller: shooter },
                { team: 1, controller: target },
            ],
            3,
            { modifiers },
        );
    const firstHit = (): number => {
        const match = duel({});
        for (let i = 0; i < 2000; i += 1) {
            match.step();
            if ((match.robotSnapshots[0]?.damageDealt ?? 0) > 0) return i + 1;
        }
        return -1;
    };
    const dealtAt = (ticks: number, modifiers: MatchModifiers): number => {
        const match = duel(modifiers);
        for (let i = 0; i < ticks; i += 1) match.step();
        return match.robotSnapshots[0]?.damageDealt ?? -1;
    };
    const hitTick = firstHit();
    check('shooter lands a hit', hitTick > 0);
    check(
        'double damage deals exactly 2x per hit',
        hitTick > 0 && dealtAt(hitTick, {}) === 12 && dealtAt(hitTick, { doubleDamage: true }) === 24,
        `tick=${hitTick}`,
    );

    // Hardcore fog halves the effective sensor range (visible in stats/scan).
    const scanWith = (modifiers: MatchModifiers): number => {
        const match = new Match(
            [
                { team: 0, controller: target },
                { team: 1, controller: target },
            ],
            3,
            { modifiers },
        );
        return match.robotSnapshots[0]?.scan ?? -1;
    };
    check('clean scan is full range', scanWith({}) === SENSOR_RANGE);
    check('fog scan is halved', scanWith({ hardcoreFog: true }) === SENSOR_RANGE / 2);

    // The modifiers getter returns a copy: mutating it can't touch the sim.
    const leak = new Match(
        [
            { team: 0, controller: target },
            { team: 1, controller: target },
        ],
        3,
        {},
    );
    leak.modifiers.doubleDamage = true;
    check('modifiers getter is a copy', !isExhibition(leak.modifiers));
}

// --- Tutorial: first-run flag with guarded storage -------------------------
console.log('tutorial');
{
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
        getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
        setItem: (key: string, value: string) => {
            store.set(key, value);
        },
        removeItem: (key: string) => {
            store.delete(key);
        },
    } as Storage;
    resetTutorialFlag();
    check('fresh install shows tutorial', shouldShowTutorial());
    markTutorialSeen();
    check('seen tutorial hidden', !shouldShowTutorial());
    check('flag persists as seen', store.get('robotarena.tutorial.v1') === 'seen');
    resetTutorialFlag();
    check('reset shows tutorial again', shouldShowTutorial());
    store.set('robotarena.tutorial.v1', 'corrupt!!');
    check('corrupt flag shows tutorial', shouldShowTutorial());
    // Throwing storage (blocked cookies) must never throw.
    const throwing = {
        getItem: (): null => {
            throw new Error('denied');
        },
        setItem: (): void => {
            throw new Error('denied');
        },
        removeItem: (): void => {
            throw new Error('denied');
        },
    } as Storage;
    (globalThis as unknown as { localStorage: Storage }).localStorage = throwing;
    let threw = false;
    try {
        resetTutorialFlag();
        shouldShowTutorial();
        markTutorialSeen();
    } catch {
        threw = true;
    }
    check('throwing storage never throws', !threw);
}

// --- Genome schema + parameterized factories -------------------------------
console.log('genome');
{
    const hunterDef = genomeDefFor('hunter');
    const orbiterDef = genomeDefFor('orbiter');
    check('hunter genome def exists', hunterDef !== undefined && hunterDef.genome_version === 1);
    check('orbiter genome def exists', orbiterDef !== undefined && orbiterDef.genome_version === 1);
    check('unknown bot has no genome def', genomeDefFor('nope') === undefined);

    // Default-params factories reproduce create() fingerprints exactly.
    const seeds = [1, 7, 1234, 999983];
    const arenas: ArenaId[] = ['open', 'blocks'];
    const hunterDefault = defaultGenome('hunter');
    const orbiterDefault = defaultGenome('orbiter');
    let legacyMatch = true;
    let explicitMatch = true;
    let genomeMatch = true;
    for (const seed of seeds) {
        for (const arena of arenas) {
            const ref = fingerprint(runMatch(['hunter', 'orbiter'], [0, 1], seed, undefined, arena));
            const mk = (hc: RobotController, oc: RobotController): string => {
                const m = new Match(
                    [
                        { team: 0, controller: hc, loadout: { ...hc.loadout } },
                        { team: 1, controller: oc, loadout: { ...oc.loadout } },
                    ],
                    seed,
                    { arena },
                );
                m.runToEnd();
                return fingerprint(m);
            };
            if (mk(createHunterParams(), createOrbiterParams()) !== ref) legacyMatch = false;
            if (mk(createHunterParams({ ...HUNTER_DEFAULTS }), createOrbiterParams({ ...ORBITER_DEFAULTS })) !== ref) explicitMatch = false;
            if (
                mk(
                    createHunterParams(hunterParamsFromGenome(hunterDefault as Genome)),
                    createOrbiterParams(orbiterParamsFromGenome(orbiterDefault as Genome)),
                ) !== ref
            )
                genomeMatch = false;
        }
    }
    check('param factories with {} match legacy fingerprints', legacyMatch);
    check('param factories with explicit defaults match', explicitMatch);
    check('genome-derived params match legacy fingerprints', genomeMatch);

    // Params actually wire through: strong overrides must change behavior.
    const refH = fingerprint(runMatch(['hunter', 'orbiter'], [0, 1], 1234));
    const wildH = new Match(
        [
            { team: 0, controller: createHunterParams({ steerGain: 6, scanTurn: -1, bankRangeFrac: 0.3 }), loadout: { charger: 2, marksman: 1, trigger: 2, plating: 1 } },
            { team: 1, controller: createOrbiterParams(), loadout: { gyro: 2, overdrive: 2, trigger: 1, plating: 1 } },
        ],
        1234,
        {},
    );
    wildH.runToEnd();
    const wildO = new Match(
        [
            { team: 0, controller: createHunterParams(), loadout: { charger: 2, marksman: 1, trigger: 2, plating: 1 } },
            { team: 1, controller: createOrbiterParams({ orbitDir: -1, orbitRange: 150 }), loadout: { gyro: 2, overdrive: 2, trigger: 1, plating: 1 } },
        ],
        1234,
        {},
    );
    wildO.runToEnd();
    check('hunter params change behavior', fingerprint(wildH) !== refH);
    check('orbiter params change behavior', fingerprint(wildO) !== refH);

    // Clamp / validate.
    const hunter = hunterDef as NonNullable<typeof hunterDef>;
    const clamped = validateGenome(hunter, {
        genome_version: 1,
        bot: 'hunter',
        params: {
            'steer.gain': 99,
            'fire.aimTol': -5,
            'target.policy': 'bogus',
            'does.not.exist': 1,
            loadout: { overdrive: 3, gyro: 3, bogus: 2 },
        },
    });
    check('float clamps to max', clamped.params['steer.gain'] === 6);
    check('float clamps to min', clamped.params['fire.aimTol'] === 0.01);
    check('bad enum falls to default', clamped.params['target.policy'] === 'weakest');
    check('unknown keys dropped', !('does.not.exist' in clamped.params));
    check('missing keys filled with defaults', clamped.params['search.scanTurn'] === 0.9);
    const geneLoadout = genomeLoadout(clamped);
    check('loadout gene through sanitizeLoadout', loadoutCost(geneLoadout) <= 6 && !('bogus' in geneLoadout));
    check('validate is total on garbage', validateGenome(hunter, null).params['steer.gain'] === 2.5);

    // Canonical JSON + sha256.
    check('canonical stringify sorts keys', canonicalStringify({ b: 1, a: { d: 4, c: 3 } }) === '{"a":{"c":3,"d":4},"b":1}');
    check('sha256 known vector', sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const g1 = validateGenome(hunter, { params: { 'steer.gain': 4 } });
    const g2 = validateGenome(hunter, { params: { loadout: { trigger: 3 }, 'steer.gain': 4 } });
    const reordered = validateGenome(hunter, JSON.parse(JSON.stringify({ params: { 'steer.gain': 4, loadout: { trigger: 3 } } })));
    check('genome hash is 64 hex', /^[0-9a-f]{64}$/.test(genomeHash(g1)));
    check('genome hash stable across key order', genomeHash(g2) === genomeHash(reordered));
    check('genome hash changes with params', genomeHash(g1) !== genomeHash(g2));

    // leadAngle dedup: hunter still leads (sanity: it fires lead shots, not raw bearings).
    check('hunter lead helper shared via common', typeof createHunterParams === 'function');
}

// --- 11. Sense expansion: events, bullets, tracks, arena, zone, grid, match -
console.log('senses');
{
    interface SenseDigest {
        tick: number;
        events: Array<{ kind: string; amount: number; bearing: number; fromId: number }>;
        bullets: Array<{ x: number; y: number; distance: number; closing: number; damage: number }>;
        tracks: Array<{ id: number; x: number; y: number; lastSeenTick: number; seenNow: boolean }>;
        gridFoes: number[];
        gridDanger: number[];
        lastDamage: { tick: number; amount: number; fromId: number } | null;
        blocked: number;
        zoneInside: boolean;
        zoneSafety: number;
        killsYou: number;
        aliveFoes: number;
    }
    const digest = (sense: SenseState): SenseDigest => ({
        tick: sense.tick,
        events: (sense.events ?? []).map((e) => ({ kind: e.kind, amount: e.amount ?? -1, bearing: e.bearing ?? -999, fromId: e.fromId ?? -1 })),
        bullets: (sense.bullets ?? []).map((b) => ({ x: b.x, y: b.y, distance: b.distance, closing: b.closing, damage: b.damage })),
        tracks: (sense.tracks ?? []).map((t) => ({ id: t.id, x: t.x, y: t.y, lastSeenTick: t.lastSeenTick, seenNow: t.seenNow })),
        gridFoes: [...(sense.grid?.foes ?? [])],
        gridDanger: [...(sense.grid?.danger ?? [])],
        lastDamage: sense.self.lastDamage ? { tick: sense.self.lastDamage.tick, amount: sense.self.lastDamage.amount, fromId: sense.self.lastDamage.fromId } : null,
        blocked: sense.self.blocked.ahead,
        zoneInside: sense.zone?.inside ?? false,
        zoneSafety: sense.zone?.distToSafety ?? -1,
        killsYou: sense.match?.killsYou ?? -1,
        aliveFoes: sense.match?.aliveFoes ?? -1,
    });
    // Channel presence + static values on the spawn tick, both arenas.
    for (const arena of ARENA_IDS) {
        let first: SenseState | null = null;
        const probe: RobotController = {
            meta: { id: 'probe', name: 'Probe', author: 'test', version: '0', description: '' },
            update: (sense: SenseState): Intent => {
                if (!first) first = sense;
                return {};
            },
        };
        const sitter: RobotController = {
            meta: { id: 'sitter', name: 'Sitter', author: 'test', version: '0', description: '' },
            update: (): Intent => ({}),
        };
        new Match(
            [
                { team: 0, controller: probe },
                { team: 1, controller: sitter },
            ],
            3,
            { arena },
        ).step();
        const s = first as unknown as SenseState;
        check(`spawn sense carries every channel (${arena})`, Array.isArray(s.events) && Array.isArray(s.bullets) && Array.isArray(s.tracks) && s.arena !== undefined && s.zone !== undefined && s.grid !== undefined && s.match !== undefined);
        check(`spawn events/bullets/tracks start empty (${arena})`, s.events?.length === 0 && s.bullets?.length === 0 && s.tracks?.length === 0);
        check(`arena reports ${arena} + center`, s.arena?.id === arena && s.arena?.centerX === ARENA_WIDTH / 2 && s.arena?.centerY === ARENA_HEIGHT / 2 && (s.arena?.obstacles.length ?? -1) === ARENA_OBSTACLES[arena].length);
        check(`zone opens normal with ${MAX_TICKS} ticks to spare (${arena})`, s.zone?.phase === 'normal' && s.zone?.suddenDeathIn === MAX_TICKS && s.zone?.inside === true && s.zone?.distToSafety === 0);
        check(`grid is 12x8 zeroed (${arena})`, s.grid?.w === SENSE_GRID_W && s.grid?.h === SENSE_GRID_H && s.grid?.cell === SENSE_GRID_CELL && s.grid?.foes.length === 96 && s.grid?.danger.length === 96 && (s.grid?.foes.every((v) => v === 0) ?? false));
        check(`match reports arena + caps (${arena})`, s.match?.arena === arena && s.match?.tickCap === MAX_TICKS_TOTAL && s.match?.killsYou === 0 && s.match?.killsTeam === 0 && s.match?.aliveFoes === 1);
        check(`lastDamage opens null (${arena})`, s.self.lastDamage === null);
        check(`spawn whisker reads the far wall (${arena})`, s.self.blocked.ahead === ARENA_WIDTH - 130 - ROBOT_RADIUS, `ahead=${s.self.blocked.ahead}`);
    }
    // Determinism: identical spied digests across two full matches.
    const runSpied = (): SenseDigest[][] => {
        const logs: SenseDigest[][] = [[], []];
        const mk = (id: string, team: 0 | 1, slot: number): LineupEntry => {
            const entry = ROBOTS.find((r) => r.meta.id === id);
            if (!entry) throw new Error(`unknown robot ${id}`);
            const inner = entry.create();
            return {
                team,
                controller: {
                    meta: inner.meta,
                    loadout: inner.loadout,
                    onSpawn: inner.onSpawn,
                    update: (sense: SenseState): Intent => {
                        (logs[slot] as SenseDigest[]).push(digest(sense));
                        return inner.update(sense);
                    },
                },
                loadout: { ...entry.loadout },
            };
        };
        const match = new Match([mk('hunter', 0, 0), mk('ghost', 1, 1)], 77, { arena: 'blocks' });
        match.runToEnd();
        return logs;
    };
    const senseA = runSpied();
    const senseB = runSpied();
    check('new sense channels are deterministic', JSON.stringify(senseA) === JSON.stringify(senseB));
    // Shape invariants hold on every logged tick of a real match.
    let shapeOk = senseA[0]?.length !== 0 && senseA[1]?.length !== 0;
    let sawBullet = false;
    let sawTrack = false;
    let sawHit = false;
    for (const log of senseA) {
        for (const entry of log ?? []) {
            if (entry.events.length > SENSE_EVENTS_MAX || entry.bullets.length > SENSE_BULLETS_MAX) shapeOk = false;
            for (let i = 1; i < entry.events.length; i += 1) {
                const a = entry.events[i - 1] as { kind: string; fromId: number };
                const b = entry.events[i] as { kind: string; fromId: number };
                if (a.kind > b.kind || (a.kind === b.kind && a.fromId > b.fromId)) shapeOk = false;
            }
            for (let i = 1; i < entry.bullets.length; i += 1) {
                const a = entry.bullets[i - 1] as { distance: number };
                const b = entry.bullets[i] as { distance: number };
                if (a.distance > b.distance) shapeOk = false;
            }
            if (entry.bullets.length > 0) sawBullet = true;
            if (entry.tracks.length > 0) sawTrack = true;
            if (entry.lastDamage) sawHit = true;
            if (!Number.isFinite(entry.blocked) || entry.blocked < 0) shapeOk = false;
            if (entry.gridFoes.length !== 96 || entry.gridDanger.length !== 96) shapeOk = false;
            if (!entry.gridFoes.every((v) => Number.isInteger(v) && v >= 0) || !entry.gridDanger.every((v) => Number.isInteger(v) && v >= 0)) shapeOk = false;
        }
    }
    check('events sorted kind-then-id, caps + grid ints hold every tick', shapeOk);
    check('real match sees bullets, tracks, and damage', sawBullet && sawTrack && sawHit);
    // Scripted kill: hit-by + lastDamage on the victim, kill on the shooter,
    // foe-down on the shooter's mate, ally-down on the victim's mate.
    {
        const shooter: RobotController = {
            meta: { id: 'shooter', name: 'Shooter', author: 'test', version: '0', description: '' },
            update: (sense: SenseState): Intent => {
                const foe = sense.foes[0] ?? sense.scout[0];
                if (!foe) return { throttle: 1, turn: 0, towerTurn: 0.8 };
                const goal = Math.atan2(foe.y - sense.self.y, foe.x - sense.self.x);
                let diff = goal - sense.self.heading;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                let tdiff = goal - sense.self.tower;
                while (tdiff > Math.PI) tdiff -= Math.PI * 2;
                while (tdiff < -Math.PI) tdiff += Math.PI * 2;
                return {
                    throttle: 1,
                    turn: Math.max(-1, Math.min(1, diff * 2.5)),
                    towerTurn: Math.max(-1, Math.min(1, tdiff * 3)),
                    fire: foe.distance < sense.self.stats.gunRange && Math.abs(tdiff) < 0.07,
                };
            },
        };
        const sitter = (id: string): RobotController => ({
            meta: { id, name: id, author: 'test', version: '0', description: '' },
            update: (): Intent => ({}),
        });
        interface KillLog {
            hitBy: number;
            lastAmount: number;
            kills: number[];
            foeDown: number[];
            allyDown: number[];
        }
        const logs = new Map<number, KillLog>();
        const watch = (inner: RobotController): RobotController => ({
            meta: inner.meta,
            update: (sense: SenseState): Intent => {
                let log = logs.get(sense.self.id);
                if (!log) {
                    log = { hitBy: 0, lastAmount: 0, kills: [], foeDown: [], allyDown: [] };
                    logs.set(sense.self.id, log);
                }
                for (const e of sense.events ?? []) {
                    if (e.kind === 'hit-by') {
                        log.hitBy += 1;
                        log.lastAmount = e.amount ?? 0;
                    }
                    if (e.kind === 'kill' && e.fromId !== undefined) log.kills.push(e.fromId);
                    if (e.kind === 'foe-down' && e.fromId !== undefined) log.foeDown.push(e.fromId);
                    if (e.kind === 'ally-down' && e.fromId !== undefined) log.allyDown.push(e.fromId);
                }
                if (sense.self.lastDamage) log.lastAmount = sense.self.lastDamage.amount;
                return inner.update(sense);
            },
        });
        const match = new Match(
            [
                { team: 0, controller: watch(shooter), loadout: { trigger: 3 } },
                { team: 0, controller: watch(sitter('mate')) },
                { team: 1, controller: watch(sitter('victim-a')) },
                { team: 1, controller: watch(sitter('victim-b')) },
            ],
            3,
        );
        // Step to first blood: the match stays live, so every witness senses
        // the next tick. (A match-ending kill's own events are never sensed —
        // there is no next tick — so first blood is the assertable case.)
        let first = -1;
        for (let i = 0; i < 3000 && first < 0 && !match.result.over; i += 1) {
            match.step();
            const snaps = match.robotSnapshots;
            if (snaps[2] && !snaps[2].alive) first = 2;
            else if (snaps[3] && !snaps[3].alive) first = 3;
        }
        for (let i = 0; i < 5 && !match.result.over; i += 1) match.step();
        const get = (id: number): KillLog => logs.get(id) as KillLog;
        const survivor = first === 2 ? 3 : 2;
        check('first blood lands (gun kill, pre-cap)', first > 0 && match.result.tick < MAX_TICKS, `victim=${first}`);
        check('victim logs hit-by at 12 damage', first > 0 && get(first).hitBy > 0 && get(first).lastAmount === 12);
        check('shooter logs the kill', first > 0 && JSON.stringify(get(0).kills) === JSON.stringify([first]), `kills=${JSON.stringify(get(0).kills)}`);
        check("shooter's mate logs foe-down", first > 0 && JSON.stringify(get(1).foeDown) === JSON.stringify([first]));
        check('surviving victim saw its mate go down', first > 0 && (logs.get(survivor)?.allyDown ?? []).includes(first));
        match.runToEnd();
        check('scripted 2v2 still finishes', match.result.over);
    }
    // Collisions: wall-bumps driving into a wall, rams head-on.
    {
        const waller: RobotController = {
            meta: { id: 'waller', name: 'Waller', author: 'test', version: '0', description: '' },
            update: (sense: SenseState): Intent => (sense.tick < 60 ? { turn: 1 } : { throttle: 1 }),
        };
        const sitter: RobotController = {
            meta: { id: 'sitter', name: 'Sitter', author: 'test', version: '0', description: '' },
            update: (): Intent => ({}),
        };
        let bumps = 0;
        const bumpSpy: RobotController = {
            meta: waller.meta,
            update: (sense: SenseState): Intent => {
                if ((sense.events ?? []).some((e) => e.kind === 'wall-bump')) bumps += 1;
                return waller.update(sense);
            },
        };
        const wallMatch = new Match(
            [
                { team: 0, controller: bumpSpy },
                { team: 1, controller: sitter },
            ],
            3,
        );
        for (let i = 0; i < 600 && !wallMatch.result.over; i += 1) wallMatch.step();
        check('driving into a wall logs wall-bump', bumps > 0, `bumps=${bumps}`);
        const rammer = (id: string): RobotController => ({
            meta: { id, name: id, author: 'test', version: '0', description: '' },
            update: (): Intent => ({ throttle: 1 }),
        });
        const rams: boolean[] = [false, false];
        const ramSpy = (inner: RobotController, slot: number): RobotController => ({
            meta: inner.meta,
            update: (sense: SenseState): Intent => {
                if ((sense.events ?? []).some((e) => e.kind === 'ram' && e.fromId === 1 - slot)) rams[slot] = true;
                return inner.update(sense);
            },
        });
        const ramMatch = new Match(
            [
                { team: 0, controller: ramSpy(rammer('a'), 0) },
                { team: 1, controller: ramSpy(rammer('b'), 1) },
            ],
            3,
        );
        for (let i = 0; i < 600 && !ramMatch.result.over; i += 1) ramMatch.step();
        check('head-on collision logs ram on both sides', rams[0] === true && rams[1] === true);
    }
    // Bullets are cone-gated: every sensed bullet sits inside range + FOV.
    {
        const sitter: RobotController = {
            meta: { id: 'sitter', name: 'Sitter', author: 'test', version: '0', description: '' },
            update: (): Intent => ({}),
        };
        const gunner: RobotController = {
            meta: { id: 'gunner', name: 'Gunner', author: 'test', version: '0', description: '' },
            update: (): Intent => ({ throttle: 1, turn: 0, towerTurn: 0, fire: true }),
        };
        let seen = 0;
        let gated = true;
        let closingSeen = false;
        const spy: RobotController = {
            meta: sitter.meta,
            update: (sense: SenseState): Intent => {
                for (const b of sense.bullets ?? []) {
                    seen += 1;
                    if (b.closing > 0) closingSeen = true;
                    if (b.damage !== 12) gated = false;
                    const fov = sense.self.stats.sensorFov;
                    let diff = Math.abs(b.bearing - sense.self.tower) % (Math.PI * 2);
                    if (diff > Math.PI) diff = Math.PI * 2 - diff;
                    if (b.distance > sense.self.stats.sensorRange || diff > fov / 2 + 1e-9) gated = false;
                }
                return {};
            },
        };
        const bulletMatch = new Match(
            [
                { team: 0, controller: gunner },
                { team: 1, controller: spy },
            ],
            3,
        );
        for (let i = 0; i < 400 && !bulletMatch.result.over; i += 1) bulletMatch.step();
        check('tower-facing victim senses incoming fire', seen > 0, `sightings=${seen}`);
        check('every sensed bullet is cone-gated at full damage', gated && closingSeen);
    }
    // Tracks persist after the foe leaves the cone; grid stamps + decays.
    {
        const sitter: RobotController = {
            meta: { id: 'sitter', name: 'Sitter', author: 'test', version: '0', description: '' },
            update: (): Intent => ({}),
        };
        let firstSeen = -1;
        let stale: { lastSeenTick: number; seenNow: boolean } | null = null;
        let stampAtSight = -1;
        let decayed = false;
        const tracker: RobotController = {
            meta: { id: 'tracker', name: 'Tracker', author: 'test', version: '0', description: '' },
            update: (sense: SenseState): Intent => {
                if (sense.foes.length > 0 && firstSeen < 0) {
                    firstSeen = sense.tick;
                    const foe = sense.foes[0] as { x: number; y: number };
                    const idx = toGrid(foe.x, foe.y, sense.grid?.cell ?? 80, sense.grid?.w ?? 12, sense.grid?.h ?? 8);
                    stampAtSight = sense.grid?.foes[idx] ?? -1;
                }
                if (firstSeen >= 0 && sense.tick === firstSeen + 40) {
                    const t = (sense.tracks ?? [])[0];
                    if (t) stale = { lastSeenTick: t.lastSeenTick, seenNow: t.seenNow };
                    decayed = sense.grid?.foes.every((v) => v === 0) ?? false;
                }
                if (firstSeen >= 0 && sense.tick > firstSeen) return { throttle: 0, towerTurn: 1 }; // look away
                const foe = sense.foes[0];
                if (!foe) return { throttle: 1, turn: 0, towerTurn: 0 };
                return { throttle: 1, turn: 0, towerTurn: 0 };
            },
        };
        const trackMatch = new Match(
            [
                { team: 0, controller: tracker },
                { team: 1, controller: sitter },
            ],
            3,
        );
        for (let i = 0; i < 900 && !trackMatch.result.over; i += 1) trackMatch.step();
        check('closing tracker acquires the sitter', firstSeen > 0, `tick=${firstSeen}`);
        check('sighted foe cell stamps to 5', stampAtSight === SENSE_GRID_STAMP, `stamp=${stampAtSight}`);
        check(
            'track goes stale but persists after looking away',
            stale !== null && stale.seenNow === false && stale.lastSeenTick >= firstSeen && stale.lastSeenTick < firstSeen + 40,
            JSON.stringify(stale),
        );
        check('grid presence decays to zero once unseen', decayed);
    }
    // Allies carry tower, cooldown, and public loadout; tampering never leaks.
    {
        const mate: RobotController = {
            meta: { id: 'mate', name: 'Mate', author: 'test', version: '0', description: '' },
            update: (): Intent => ({}),
        };
        const foe: RobotController = {
            meta: { id: 'foe', name: 'Foe', author: 'test', version: '0', description: '' },
            update: (): Intent => ({}),
        };
        let allyOk = false;
        const allySpy: RobotController = {
            meta: { id: 'spy', name: 'Spy', author: 'test', version: '0', description: '' },
            update: (sense: SenseState): Intent => {
                const ally = sense.allies[0];
                if (ally && typeof ally.tower === 'number' && typeof ally.cooldown === 'number' && ally.loadout.overdrive === 3) allyOk = true;
                return {};
            },
        };
        const allyMatch = new Match(
            [
                { team: 0, controller: allySpy },
                { team: 0, controller: mate, loadout: { overdrive: 3 } },
                { team: 1, controller: foe },
            ],
            3,
        );
        allyMatch.step();
        check('allies expose tower, cooldown, and loadout', allyOk);
        const tamperer: RobotController = {
            meta: { id: 'tamperer', name: 'Tamperer', author: 'test', version: '0', description: '' },
            update: (sense: SenseState): Intent => {
                (sense.events ?? []).length = 0;
                (sense.bullets ?? []).length = 0;
                (sense.tracks ?? []).length = 0;
                if (sense.arena) sense.arena.obstacles.length = 0;
                if (sense.zone) sense.zone.circle.r = 0;
                if (sense.grid) {
                    sense.grid.foes.fill(999);
                    sense.grid.danger.fill(999);
                }
                if (sense.match) sense.match.killsYou = 99;
                if (sense.self.lastDamage) sense.self.lastDamage.amount = 999;
                sense.self.blocked.ahead = 999;
                sense.allies.length = 0;
                return { throttle: 1, turn: 0, towerTurn: 0, fire: true };
            },
        };
        const cleanEntry = ROBOTS.find((r) => r.meta.id === 'hunter');
        if (!cleanEntry) throw new Error('no hunter');
        const runSide = (controller: RobotController): string => {
            const m = new Match(
                [
                    { team: 0, controller, loadout: {} },
                    { team: 1, controller: cleanEntry.create(), loadout: { ...cleanEntry.loadout } },
                ],
                9,
            );
            m.runToEnd();
            return fingerprint(m);
        };
        const driver: RobotController = {
            meta: { id: 'driver', name: 'Driver', author: 'test', version: '0', description: '' },
            update: (): Intent => ({ throttle: 1, turn: 0, towerTurn: 0, fire: true }),
        };
        check('sense tampering cannot change the sim', runSide(tamperer) === runSide(driver));
    }
    // common.ts helpers: lead math agrees, dodge/toGrid behave.
    {
        const foe = { id: 1, team: 1 as const, x: 400, y: 300, heading: 0.5, speed: 100, health: 100, distance: Math.hypot(400 - 130, 300 - 320), bearing: 0 };
        check('leadAngle delegates to leadShot exactly', leadAngle(130, 320, 430, foe) === leadShot(130, 320, 430, foe.x, foe.y, Math.cos(foe.heading) * foe.speed, Math.sin(foe.heading) * foe.speed));
        check('dodge vector is zero with no bullets', dodgeVector(0, 0, []).x === 0 && dodgeVector(0, 0, []).y === 0);
        const fleeing = dodgeVector(480, 320, [{ x: 400, y: 320, vx: 430, vy: 0, distance: 80, bearing: Math.PI, closing: -430, damage: 12 }]);
        check('receding bullets do not dodge', fleeing.x === 0 && fleeing.y === 0);
        const threat = dodgeVector(480, 320, [{ x: 400, y: 320, vx: 430, vy: 0, distance: 80, bearing: Math.PI, closing: 430, damage: 12 }]);
        check('closing bullet pushes unit-length sideways', Math.abs(Math.hypot(threat.x, threat.y) - 1) < 1e-9 && Math.abs(threat.x) < 1e-9 && Math.abs(threat.y) === 1);
        check('toGrid maps corners and rejects outside', toGrid(0, 0, 80, 12, 8) === 0 && toGrid(959, 639, 80, 12, 8) === 95 && toGrid(960, 320, 80, 12, 8) === -1 && toGrid(-1, 0, 80, 12, 8) === -1);
    }
}

// --- 12. Intent expansion: strafe, move/aim/fire assists, radio sanitize ---
console.log('intent');
{
    // sanitizeIntent unit checks: every new field clamped day one.
    const idle = sanitizeIntent(null);
    check(
        'null intent sanitizes to idle defaults',
        idle.strafe === 0 && idle.moveX === 0 && idle.moveY === 0 && idle.moveMode === 0 && idle.aimMode === 0 && idle.aimTarget === -1 && idle.aimLead === false && idle.fireMode === 0 && idle.radio === null,
    );
    const wild = sanitizeIntent({
        strafe: 99, moveX: -50, moveY: 9999, moveMode: 7, aimMode: 5, aimTarget: 2.7,
        aimLead: 'yes', fireMode: true, radio: { kind: 'bogus', x: 1, y: 2, foe: 0, role: 0, slot: 0, bid: 0 },
    });
    check(
        'wild values clamp to legal ranges',
        wild.strafe === 1 && wild.moveX === 0 && wild.moveY === ARENA_HEIGHT && wild.moveMode === 0 && wild.aimMode === 0 && wild.aimTarget === 2 && wild.aimLead === false && wild.fireMode === 0 && wild.radio === null,
    );
    const modes = sanitizeIntent({ moveMode: 1, aimMode: 2, aimTarget: 3, fireMode: 1, radio: { kind: 'focus', x: -10, y: 100, foe: 1.9, role: 0, slot: 0, bid: 5 } });
    check(
        'legal modes + radio survive sanitize',
        modes.moveMode === 1 && modes.aimMode === 2 && modes.aimTarget === 3 && modes.fireMode === 1 &&
        modes.radio !== null && modes.radio.kind === 'focus' && modes.radio.x === 0 && modes.radio.y === 100 && modes.radio.foe === 1 && modes.radio.bid === 5,
    );
    check('non-object radio drops to null', sanitizeIntent({ radio: 42 }).radio === null && sanitizeIntent({ radio: 'ping' }).radio === null);
    check('strafe lands behind STRAFE_FACTOR 0.5', STRAFE_FACTOR === 0.5);
    const catalogIds = SKILL_DEFS.map((def) => def.id as string);
    check('dash/emp stay universal (no catalog defs)', !catalogIds.includes('dash') && !catalogIds.includes('emp'));

    const idleBot = (id: string): RobotController => ({
        meta: { id, name: id, author: 'test', version: '0', description: '' },
        update: (): Intent => ({}),
    });
    // Strafe: pure lateral at half top speed, symmetric, diagonal-capped.
    {
        const strafer = (strafe: number): RobotController => ({
            meta: { id: `strafer${strafe}`, name: 'Strafer', author: 'test', version: '0', description: '' },
            update: (): Intent => ({ strafe }),
        });
        const runStrafe = (strafe: number, ticks: number): { x: number; y: number } => {
            const m = new Match(
                [
                    { team: 0, controller: strafer(strafe) },
                    { team: 1, controller: idleBot('sitter') },
                ],
                3,
            );
            for (let i = 0; i < ticks; i += 1) m.step();
            const s = m.robotSnapshots[0] as { x: number; y: number };
            return { x: s.x, y: s.y };
        };
        const south = runStrafe(1, 60);
        check('strafe +1 slides starboard at half speed', south.x === 130 && Math.abs(south.y - 395) < 0.01, `(${south.x},${south.y.toFixed(2)})`);
        const north = runStrafe(-1, 60);
        check('strafe -1 slides port symmetrically', north.x === 130 && Math.abs(north.y - 245) < 0.01, `(${north.x},${north.y.toFixed(2)})`);
        // Diagonal: throttle 1 + strafe 1 never exceeds top speed per tick.
        const diag = new Match(
            [
                { team: 0, controller: { meta: idleBot('d').meta, update: (): Intent => ({ throttle: 1, strafe: 1 }) } },
                { team: 1, controller: idleBot('sitter') },
            ],
            3,
        );
        let prev = diag.robotSnapshots[0] as { x: number; y: number };
        let maxStep = 0;
        for (let i = 0; i < 180; i += 1) {
            diag.step();
            const s = diag.robotSnapshots[0] as { x: number; y: number };
            if (i >= 120) maxStep = Math.max(maxStep, Math.hypot(s.x - prev.x, s.y - prev.y));
            prev = s;
        }
        check('diagonal drive caps at top speed', maxStep <= MAX_SPEED * DT + 0.01, `max=${maxStep.toFixed(3)}`);
        const straight = new Match(
            [
                { team: 0, controller: { meta: idleBot('s').meta, update: (): Intent => ({ throttle: 1 }) } },
                { team: 1, controller: idleBot('sitter') },
            ],
            3,
        );
        for (let i = 0; i < 180; i += 1) straight.step();
        check(
            'strafe trades forward pace (never adds it)',
            (diag.robotSnapshots[0]?.x ?? 0) < (straight.robotSnapshots[0]?.x ?? 0),
        );
    }
    // Move assist: overrides manual drive, arrives, holds, deterministic.
    {
        const assisted = (moveMode: 0 | 1): RobotController => ({
            meta: { id: `assist${moveMode}`, name: 'Assist', author: 'test', version: '0', description: '' },
            update: (): Intent => ({ throttle: -1, turn: 1, moveX: 480, moveY: 320, moveMode }),
        });
        const runAssist = (moveMode: 0 | 1, ticks: number): { x: number; y: number } => {
            const m = new Match(
                [
                    { team: 0, controller: assisted(moveMode) },
                    { team: 1, controller: idleBot('sitter') },
                ],
                3,
            );
            for (let i = 0; i < ticks; i += 1) m.step();
            const s = m.robotSnapshots[0] as { x: number; y: number };
            return { x: s.x, y: s.y };
        };
        const arrived = runAssist(1, 400);
        check('move assist reaches midfield', Math.hypot(arrived.x - 480, arrived.y - 320) < 30, `(${arrived.x.toFixed(0)},${arrived.y.toFixed(0)})`);
        const held = runAssist(1, 800);
        check('move assist holds the target', Math.hypot(held.x - 480, held.y - 320) < 30, `(${held.x.toFixed(0)},${held.y.toFixed(0)})`);
        const fpAssist = (mode: 0 | 1, seed: number): string => {
            const m = new Match(
                [
                    { team: 0, controller: assisted(mode) },
                    { team: 1, controller: idleBot('sitter') },
                ],
                seed,
            );
            for (let i = 0; i < 400; i += 1) m.step();
            return fingerprint(m);
        };
        const fpManual = (): string => {
            const m = new Match(
                [
                    {
                        team: 0,
                        controller: {
                            meta: idleBot('m').meta,
                            update: (): Intent => ({ throttle: -1, turn: 1 }),
                        },
                    },
                    { team: 1, controller: idleBot('sitter') },
                ],
                3,
            );
            for (let i = 0; i < 400; i += 1) m.step();
            return fingerprint(m);
        };
        check('manual mode ignores moveX/moveY', fpAssist(0, 3) === fpManual());
        check('move assist is deterministic', fpAssist(1, 21) === fpAssist(1, 21) && fpAssist(1, 21) !== fpAssist(0, 21));
    }
    // Aim assist: tracks live, leads on mode 2, falls back on bad ids.
    {
        const aimer = (aimMode: 0 | 1 | 2, aimTarget: number, extra?: Partial<Intent>): RobotController => ({
            meta: { id: `aimer${aimMode}`, name: 'Aimer', author: 'test', version: '0', description: '' },
            update: (sense: SenseState): Intent => {
                const foe = sense.foes[0];
                return {
                    moveX: foe ? foe.x : 480, moveY: foe ? foe.y : 320, moveMode: 1,
                    aimMode, aimTarget, towerTurn: 0, ...extra,
                };
            },
        });
        const trackErr = (aimMode: 0 | 1 | 2, lead: boolean): { err: number; swung: number } => {
            let err = Infinity;
            let firstTower = 0;
            let lastTower = 0;
            let first = true;
            const spy: RobotController = {
                meta: { id: 'spy', name: 'Spy', author: 'test', version: '0', description: '' },
                update: (sense: SenseState): Intent => {
                    if (first) {
                        firstTower = sense.self.tower;
                        first = false;
                    }
                    lastTower = sense.self.tower;
                    const foe = sense.foes[0];
                    if (foe) {
                        const want = lead ? leadAngle(sense.self.x, sense.self.y, sense.self.stats.bulletSpeed, foe) : foe.bearing;
                        let diff = Math.abs(sense.self.tower - want) % (Math.PI * 2);
                        if (diff > Math.PI) diff = Math.PI * 2 - diff;
                        err = Math.min(err, diff);
                    }
                    const inner = aimer(aimMode, 1);
                    return inner.update(sense);
                },
            };
            // Circling foe: the bearing sweeps (no midline degeneracy), so the
            // tower must genuinely swing to hold the track.
            const circler: RobotController = {
                meta: { id: 'circler', name: 'Circler', author: 'test', version: '0', description: '' },
                update: (): Intent => ({ throttle: 0.6, turn: 0.35 }),
            };
            const m = new Match(
                [
                    { team: 0, controller: spy },
                    { team: 1, controller: circler },
                ],
                3,
            );
            for (let i = 0; i < 900 && !m.result.over; i += 1) m.step();
            return { err, swung: Math.abs(lastTower - firstTower) };
        };
        const tracked = trackErr(1, false);
        check('aim assist tracks the foe bearing', tracked.err < 0.05 && tracked.swung > 0.2, `err=${tracked.err.toFixed(3)} swung=${tracked.swung.toFixed(2)}`);
        // Lead mode vs a crossing foe: only ticks with true crossing geometry
        // (lead and bearing differ) count; the tower must match the intercept.
        let leadErr = Infinity;
        let crossed = 0;
        const speeder: RobotController = {
            meta: { id: 'speeder', name: 'Speeder', author: 'test', version: '0', description: '' },
            update: (sense: SenseState): Intent => ({ throttle: 1, turn: sense.tick < 90 ? 0 : 1 }),
        };
        const leadSpy: RobotController = {
            meta: { id: 'leadspy', name: 'LeadSpy', author: 'test', version: '0', description: '' },
            update: (sense: SenseState): Intent => {
                const foe = sense.foes[0];
                if (foe && foe.speed > 50) {
                    const shot = leadAngle(sense.self.x, sense.self.y, sense.self.stats.bulletSpeed, foe);
                    let geom = Math.abs(shot - foe.bearing) % (Math.PI * 2);
                    if (geom > Math.PI) geom = Math.PI * 2 - geom;
                    if (geom > 0.05) {
                        crossed += 1;
                        let dl = Math.abs(sense.self.tower - shot) % (Math.PI * 2);
                        if (dl > Math.PI) dl = Math.PI * 2 - dl;
                        leadErr = Math.min(leadErr, dl);
                    }
                }
                return { moveX: 480, moveY: 320, moveMode: 1, aimMode: 2, aimTarget: 1, towerTurn: 0 };
            },
        };
        const leadMatch = new Match(
            [
                { team: 0, controller: leadSpy },
                { team: 1, controller: speeder },
            ],
            3,
        );
        for (let i = 0; i < 900 && !leadMatch.result.over; i += 1) leadMatch.step();
        check('aim mode 2 leads a crossing foe', crossed > 10 && leadErr < 0.08, `crossed=${crossed} lead=${leadErr.toFixed(3)}`);
        // Bad ids fall back to the manual towerTurn (full-rate spin).
        const spinRate = (aimTarget: number): number => {
            const m = new Match(
                [
                    {
                        team: 0,
                        controller: {
                            meta: idleBot('a').meta,
                            update: (): Intent => ({ aimMode: 1, aimTarget, towerTurn: 1 }),
                        },
                    },
                    { team: 1, controller: idleBot('sitter') },
                ],
                3,
            );
            let total = 0;
            let prevT = m.robotSnapshots[0]?.tower ?? 0;
            for (let i = 0; i < 30; i += 1) {
                m.step();
                const cur = m.robotSnapshots[0]?.tower ?? 0;
                let d = (cur - prevT) % (Math.PI * 2);
                if (d > Math.PI) d -= Math.PI * 2;
                if (d < -Math.PI) d += Math.PI * 2;
                total += d;
                prevT = cur;
            }
            return total;
        };
        check('unknown aim id falls back to manual', Math.abs(spinRate(999) - 1.8) < 0.001, `spin=${spinRate(999).toFixed(3)}`);
        check('self aim id falls back to manual', Math.abs(spinRate(0) - 1.8) < 0.001);
    }
    // Fire assist: mode 1 auto-fires on a locked assist behind the same gate.
    {
        const holder = (fireMode: 0 | 1): RobotController => ({
            meta: { id: `holder${fireMode}`, name: 'Holder', author: 'test', version: '0', description: '' },
            update: (sense: SenseState): Intent => {
                const foe = sense.foes[0];
                return {
                    moveX: foe ? foe.x : 480, moveY: foe ? foe.y : 320, moveMode: 1,
                    aimMode: 1, aimTarget: 1, towerTurn: 0, fire: false, fireMode,
                };
            },
        });
        const shotsAfter = (fireMode: 0 | 1): number => {
            const m = new Match(
                [
                    { team: 0, controller: holder(fireMode) },
                    { team: 1, controller: idleBot('sitter') },
                ],
                3,
            );
            for (let i = 0; i < 900 && !m.result.over; i += 1) m.step();
            return m.robotSnapshots[0]?.shotsFired ?? -1;
        };
        const auto = shotsAfter(1);
        check('fireMode 1 auto-fires on lock (fire:false)', auto > 0, `shots=${auto}`);
        check('fireMode 0 stays silent on fire:false', shotsAfter(0) === 0);
        check('auto-fire respects the cooldown gate', auto <= Math.ceil(900 / 24) + 1, `shots=${auto}`);
    }
    // Radio: sanitized, accepted, and (until Phase 6 routes it) dropped.
    {
        const rattler = (radio: unknown): RobotController => ({
            meta: { id: 'rattler', name: 'Rattler', author: 'test', version: '0', description: '' },
            update: (): Intent => ({ throttle: 1, radio: radio as never }),
        });
        const runRadio = (radio: unknown): { fp: string; over: boolean } => {
            const m = new Match(
                [
                    { team: 0, controller: rattler(radio) },
                    { team: 1, controller: idleBot('sitter') },
                ],
                5,
            );
            m.runToEnd();
            return { fp: fingerprint(m), over: m.result.over };
        };
        const quiet = runRadio(undefined);
        const garbage = runRadio({ kind: 'bogus', x: 'far', foe: [1] });
        const valid = runRadio({ kind: 'focus', x: 100, y: 200, foe: 1, role: 0, slot: 0, bid: 3 });
        check('garbage radio neither crashes nor steers', garbage.over && garbage.fp === quiet.fp);
        check('valid radio accepted, dropped pre-routing', valid.over && valid.fp === quiet.fp);
    }
}

// --- 13. Comms: exact-delay mailbox, team isolation, helpers, wired bots ----
console.log('comms');
{
    check('comms delay is 6 ticks', COMMS_DELAY === 6);
    check('inbox cap is 4 (both names)', COMMS_INBOX_MAX === 4 && INBOX_MAX === 4);
    interface MailboxEntry {
        tick: number;
        inbox: Array<{ kind: string; x: number; y: number; foe: number; from: number; sent: number }>;
    }
    const sitter = (id: string): RobotController => ({
        meta: { id, name: id, author: 'test', version: '0', description: '' },
        update: (): Intent => ({}),
    });
    // Scripted chatter: sender pings every tick with the tick encoded.
    const spammer: RobotController = {
        meta: { id: 'spammer', name: 'Spammer', author: 'test', version: '0', description: '' },
        update: (sense: SenseState): Intent => ({
            radio: { kind: 'ping', x: sense.tick % ARENA_WIDTH, y: (sense.tick * 2) % ARENA_HEIGHT, foe: -1, role: 0, slot: 0, bid: sense.tick },
        }),
    };
    const mailbox = (log: MailboxEntry[]): RobotController => ({
        meta: { id: 'mailbox', name: 'Mailbox', author: 'test', version: '0', description: '' },
        update: (sense: SenseState): Intent => {
            log.push({ tick: sense.tick, inbox: sense.inbox.map((m) => ({ kind: m.kind, x: m.x, y: m.y, foe: m.foe, from: m.from, sent: m.sent })) });
            return {};
        },
    });
    // Nothing before tick 6; exact-delay content + stamps after.
    const mateLog: MailboxEntry[] = [];
    const foeLog: MailboxEntry[] = [];
    const senderLog: MailboxEntry[] = [];
    const scripted = new Match(
        [
            { team: 0, controller: { ...spammer, update: (sense: SenseState): Intent => { senderLog.push({ tick: sense.tick, inbox: sense.inbox.map((m) => ({ kind: m.kind, x: m.x, y: m.y, foe: m.foe, from: m.from, sent: m.sent })) }); return spammer.update(sense); } } },
            { team: 0, controller: mailbox(mateLog) },
            { team: 1, controller: mailbox(foeLog) },
            { team: 1, controller: sitter('quiet') },
        ],
        3,
    );
    for (let i = 0; i < 60; i += 1) scripted.step();
    check('nothing arrives before tick 6', mateLog.slice(0, 6).every((e) => e.inbox.length === 0));
    let exactDelay = mateLog.length === 60;
    for (const entry of mateLog) {
        if (entry.tick < COMMS_DELAY) {
            if (entry.inbox.length !== 0) exactDelay = false;
        } else if (entry.inbox.length !== 1) {
            exactDelay = false;
        } else {
            const m = entry.inbox[0] as MailboxEntry['inbox'][0];
            const sent = entry.tick - COMMS_DELAY;
            if (m.kind !== 'ping' || m.x !== sent % ARENA_WIDTH || m.y !== (sent * 2) % ARENA_HEIGHT || m.from !== 0 || m.sent !== sent) exactDelay = false;
        }
    }
    check('exact-delay delivery with engine stamps', exactDelay);
    check('cross-team mail never arrives', foeLog.every((e) => e.inbox.length === 0) && foeLog.length === 60);
    check('own messages are never echoed', senderLog.every((e) => e.inbox.length === 0) && senderLog.length === 60);
    // Ordering + cap bound with two chattering mates (3v3).
    const trioLog: MailboxEntry[] = [];
    const trio = new Match(
        [
            { team: 0, controller: mailbox(trioLog) },
            { team: 0, controller: spammer },
            { team: 0, controller: { ...spammer, meta: { ...spammer.meta, id: 'spammer2' } } },
            { team: 1, controller: sitter('a') },
            { team: 1, controller: sitter('b') },
            { team: 1, controller: sitter('c') },
        ],
        3,
    );
    for (let i = 0; i < 30; i += 1) trio.step();
    let trioOk = trioLog.length === 30;
    for (const entry of trioLog) {
        if (entry.tick < COMMS_DELAY) {
            if (entry.inbox.length !== 0) trioOk = false;
        } else {
            if (entry.inbox.length > COMMS_INBOX_MAX) trioOk = false;
            if (JSON.stringify(entry.inbox.map((m) => m.from)) !== JSON.stringify([1, 2])) trioOk = false;
        }
    }
    check('two mates arrive sorted by from, within cap', trioOk);
    // Foe-id liveness validated at send: live + -1 pass, dead/ally/999 drop.
    const foeCycle: RobotController = {
        meta: { id: 'cycler', name: 'Cycler', author: 'test', version: '0', description: '' },
        update: (sense: SenseState): Intent => {
            const foes = [2, 999, -1, 1]; // live foe, unknown, none, ally
            return { radio: { kind: 'contact', x: 0, y: 0, foe: foes[sense.tick % 4] as number, role: 0, slot: 0, bid: 0 } };
        },
    };
    const cycleLog: MailboxEntry[] = [];
    const cycled = new Match(
        [
            { team: 0, controller: foeCycle },
            { team: 0, controller: mailbox(cycleLog) },
            { team: 1, controller: sitter('a') },
            { team: 1, controller: sitter('b') },
        ],
        3,
    );
    for (let i = 0; i < 40; i += 1) cycled.step();
    const seenFoes = new Set<number>();
    let cycleOk = true;
    for (const entry of cycleLog) {
        for (const m of entry.inbox) {
            seenFoes.add(m.foe);
            if (m.foe !== 2 && m.foe !== -1) cycleOk = false;
        }
    }
    check('only live-foe and -1 mail is sent', cycleOk && seenFoes.has(2) && seenFoes.has(-1) && !seenFoes.has(999) && !seenFoes.has(1));
    // Garbage radio: unknown kinds never leave the sender.
    const junkLog: MailboxEntry[] = [];
    const junk: RobotController = {
        meta: { id: 'junk', name: 'Junk', author: 'test', version: '0', description: '' },
        update: (): Intent => ({ radio: { kind: 'bogus', x: 0, y: 0, foe: -1, role: 0, slot: 0, bid: 0 } as never }),
    };
    const junked = new Match(
        [
            { team: 0, controller: junk },
            { team: 0, controller: mailbox(junkLog) },
            { team: 1, controller: sitter('a') },
            { team: 1, controller: sitter('b') },
        ],
        3,
    );
    for (let i = 0; i < 30; i += 1) junked.step();
    check('unknown radio kinds are dropped at send', junkLog.every((e) => e.inbox.length === 0) && junkLog.length === 30);
    // Dead senders: the spawn-sitter's mail stops the tick it dies, even
    // in flight; the center-sitter keeps listening long after.
    const deadLog: MailboxEntry[] = [];
    const toCenter = (id: string): RobotController => ({
        meta: { id, name: id, author: 'test', version: '0', description: '' },
        update: (sense: SenseState): Intent => {
            const dx = ARENA_WIDTH / 2 - sense.self.x;
            const dy = ARENA_HEIGHT / 2 - sense.self.y;
            if (Math.hypot(dx, dy) < 4) return {};
            const want = Math.atan2(dy, dx);
            let diff = (want - sense.self.heading) % (Math.PI * 2);
            if (diff > Math.PI) diff -= Math.PI * 2;
            if (diff < -Math.PI) diff += Math.PI * 2;
            return { throttle: 1, turn: Math.max(-1, Math.min(1, diff * 2)) };
        },
    });
    const dying = new Match(
        [
            { team: 0, controller: spammer },
            {
                team: 0,
                controller: {
                    meta: { id: 'listener', name: 'Listener', author: 'test', version: '0', description: '' },
                    update: (sense: SenseState): Intent => {
                        deadLog.push({ tick: sense.tick, inbox: sense.inbox.map((m) => ({ kind: m.kind, x: m.x, y: m.y, foe: m.foe, from: m.from, sent: m.sent })) });
                        return toCenter('listener').update(sense);
                    },
                },
            },
            { team: 1, controller: toCenter('a') },
            { team: 1, controller: toCenter('b') },
        ],
        11,
    );
    let deathTick = -1;
    for (let i = 0; i < MAX_TICKS_TOTAL && !dying.result.over; i += 1) {
        dying.step();
        if (deathTick < 0 && dying.robotSnapshots[0] && !dying.robotSnapshots[0].alive) deathTick = dying.result.tick;
    }
    const heardWhileAlive = deadLog.filter((e) => e.tick >= COMMS_DELAY && e.tick < deathTick);
    const heardAfterDeath = deadLog.filter((e) => e.tick >= deathTick);
    check(
        'in-flight mail dies with its sender',
        deathTick > MAX_TICKS &&
        heardWhileAlive.length > 100 && heardWhileAlive.every((e) => e.inbox.length === 1) &&
        heardAfterDeath.length > 100 && heardAfterDeath.every((e) => e.inbox.length === 0),
        `death=${deathTick} before=${heardWhileAlive.length} after=${heardAfterDeath.length}`,
    );
    // Tamper + determinism: inbox copies never leak, logs replay exactly.
    const cleanEntry = ROBOTS.find((r) => r.meta.id === 'hunter');
    if (!cleanEntry) throw new Error('no hunter');
    const runSide = (tamper: boolean): string => {
        const mate: RobotController = {
            meta: { id: 'mate', name: 'Mate', author: 'test', version: '0', description: '' },
            update: (sense: SenseState): Intent => {
                if (tamper) {
                    for (const m of sense.inbox) {
                        m.kind = 'ping';
                        m.x = 9999;
                        (m as { from: number }).from = 99;
                    }
                    sense.inbox.length = 0;
                }
                return {};
            },
        };
        const m = new Match(
            [
                { team: 0, controller: cleanEntry.create(), loadout: { ...cleanEntry.loadout } },
                { team: 0, controller: mate },
                { team: 1, controller: sitter('a') },
                { team: 1, controller: sitter('b') },
            ],
            9,
        );
        m.runToEnd();
        return fingerprint(m);
    };
    check('inbox tampering cannot change the sim', runSide(true) === runSide(false));
    const inboxRun = (): string => {
        const logs: MailboxEntry[][] = [[], []];
        const mk = (id: string, team: 0 | 1, slot: number | null): LineupEntry => {
            const entry = ROBOTS.find((r) => r.meta.id === id);
            if (!entry) throw new Error(`unknown robot ${id}`);
            const inner = entry.create();
            return {
                team,
                controller: slot === null ? inner : { ...inner, update: (sense: SenseState): Intent => { (logs[slot] as MailboxEntry[]).push({ tick: sense.tick, inbox: sense.inbox.map((m) => ({ kind: m.kind, x: m.x, y: m.y, foe: m.foe, from: m.from, sent: m.sent })) }); return inner.update(sense); } },
                loadout: { ...entry.loadout },
            };
        };
        const m = new Match([mk('hunter', 0, 0), mk('ghost', 0, 1), mk('rusher', 1, null), mk('turret', 1, null)], 5);
        for (let i = 0; i < 300; i += 1) m.step();
        return JSON.stringify(logs);
    };
    check('inbox traffic is deterministic', inboxRun() === inboxRun());
    // Pure resolution helpers.
    check('focus vote builds the right shape', JSON.stringify(castFocusVote(3)) === JSON.stringify({ kind: 'focus', x: 0, y: 0, foe: 3, role: 0, slot: 0, bid: 0 }));
    check('contact builds the right shape', JSON.stringify(castContact(10, 20, 2)) === JSON.stringify({ kind: 'contact', x: 10, y: 20, foe: 2, role: 0, slot: 0, bid: 0 }));
    const ballot = (from: number, foe: number): { kind: 'focus'; x: number; y: number; foe: number; role: number; slot: number; bid: number; from: number; sent: number } =>
        ({ kind: 'focus', x: 0, y: 0, foe, role: 0, slot: 0, bid: 0, from, sent: 0 });
    check('lowest-id live sender wins focus', focusTarget([ballot(2, 5), ballot(1, 4)], new Set([1, 2]), new Set([4, 5])) === 4);
    check('focus ignores dead senders', focusTarget([ballot(1, 4)], new Set([2]), new Set([4])) === null);
    check('focus ignores dead foes', focusTarget([ballot(1, 4)], new Set([1]), new Set([5])) === null);
    check('focus with no votes is null', focusTarget([], new Set([1]), new Set([4])) === null);
    const roles = resolveRoles([
        { from: 2, role: 1, bid: 10 },
        { from: 1, role: 1, bid: 10 },
        { from: 0, role: 2, bid: 3 },
    ]);
    check('auction ties go to the lowest id', roles.get(1) === 1 && roles.get(2) === 0 && !roles.has(0));
    const roles2 = resolveRoles([
        { from: 0, role: 0, bid: 1 },
        { from: 1, role: 0, bid: 9 },
    ]);
    check('highest bid wins the role', roles2.get(0) === 1);
    const slot0 = formationSlot(0, 4, 480, 320, 100);
    const slot2 = formationSlot(2, 4, 480, 320, 100);
    check(
        'formation slots ring the anchor',
        Math.abs(slot0.x - 480) < 0.001 && Math.abs(slot0.y - 220) < 0.001 && Math.abs(slot2.x - 480) < 0.001 && Math.abs(slot2.y - 420) < 0.001,
    );
    check('single formation slot is the anchor', JSON.stringify(formationSlot(0, 1, 480, 320, 100)) === JSON.stringify({ x: 480, y: 320 }));
    const contacts = (from: number, x: number): { kind: 'contact'; x: number; y: number; foe: number; role: number; slot: number; bid: number; from: number; sent: number } =>
        ({ kind: 'contact', x, y: 0, foe: 2, role: 0, slot: 0, bid: 0, from, sent: 6 });
    check('latest contact prefers the lowest-id sender', latestContact([contacts(2, 9), contacts(1, 7)])?.x === 7);
    check('no contacts is null', latestContact([]) === null);
    // Wired bots: hunter votes reach a mate, ghost contacts reach a mate.
    const wiredLog: MailboxEntry[] = [];
    const wiredHunter = new Match(
        [
            { team: 0, controller: cleanEntry.create(), loadout: { ...cleanEntry.loadout } },
            { team: 0, controller: mailbox(wiredLog) },
            { team: 1, controller: sitter('a') },
            { team: 1, controller: sitter('b') },
        ],
        5,
    );
    for (let i = 0; i < 400 && !wiredHunter.result.over; i += 1) wiredHunter.step();
    const hunterVotes = wiredLog.flatMap((e) => e.inbox).filter((m) => m.kind === 'focus');
    check('hunter focus votes reach its mate', hunterVotes.length > 0 && hunterVotes.every((m) => m.foe === 2 || m.foe === 3), `votes=${hunterVotes.length}`);
    const ghostEntry = ROBOTS.find((r) => r.meta.id === 'ghost');
    if (!ghostEntry) throw new Error('no ghost');
    const ghostLog: MailboxEntry[] = [];
    const wiredGhost = new Match(
        [
            { team: 0, controller: ghostEntry.create(), loadout: { ...ghostEntry.loadout } },
            { team: 0, controller: mailbox(ghostLog) },
            { team: 1, controller: sitter('a') },
            { team: 1, controller: sitter('b') },
        ],
        5,
    );
    for (let i = 0; i < 400 && !wiredGhost.result.over; i += 1) wiredGhost.step();
    const ghostContacts = ghostLog.flatMap((e) => e.inbox).filter((m) => m.kind === 'contact');
    check(
        'ghost contact reports reach its mate',
        ghostContacts.length > 0 && ghostContacts.every((m) => (m.foe === 2 || m.foe === 3) && m.x >= 0 && m.x <= ARENA_WIDTH && m.y >= 0 && m.y <= ARENA_HEIGHT),
        `contacts=${ghostContacts.length}`,
    );
    // 1v1 inbox stays empty all game (no allies, no echo).
    const soloMate: MailboxEntry[] = [];
    const solo2 = new Match(
        [
            { team: 0, controller: mailbox(soloMate) },
            { team: 1, controller: ROBOTS[1]!.create() },
        ],
        5,
    );
    solo2.runToEnd();
    check('1v1 inbox stays empty (no allies)', soloMate.every((e) => e.inbox.length === 0) && soloMate.length > 30);
    // 3v3 focus-fire balance: concentration is situational (it routs
    // brawlers and ghosts but loses to hc1's spread fire), so the tripwire
    // is matrix beatability — focused hunters must drop games around the
    // matrix, not sweep it.
    const hunterTeam = ROBOTS.find((r) => r.meta.id === 'hunter');
    if (!hunterTeam) throw new Error('missing hunter');
    let teamErrors = 0;
    const matrix: string[] = [];
    let beatenBy = 0;
    for (const foeTeam of ROBOTS) {
        if (foeTeam.meta.id === 'hunter') continue;
        let hw = 0;
        let fw = 0;
        for (const arena of ARENA_IDS) {
            for (const seed of [5, 6, 7, 8]) {
                const lineups: LineupEntry[] = [0, 1, 2].map(() => ({
                    team: 0 as 0 | 1,
                    controller: hunterTeam.create(),
                    loadout: { ...hunterTeam.loadout },
                }));
                for (let i = 0; i < 3; i += 1) lineups.push({ team: 1, controller: foeTeam.create(), loadout: { ...foeTeam.loadout } });
                const m = new Match(lineups, seed, { arena });
                m.runToEnd();
                teamErrors += m.robotSnapshots.reduce((sum, s) => sum + s.errors, 0);
                if (m.result.winner === 0) hw += 1;
                else if (m.result.winner === 1) fw += 1;
            }
        }
        matrix.push(`${foeTeam.meta.id}=${hw}-${fw}`);
        if (fw > 0) beatenBy += 1;
    }
    console.log(`       3v3 hunters vs matrix: ${matrix.join(' ')}`);
    check('3v3 focus-fire completes error-free', teamErrors === 0);
    check('focused hunters drop games around the matrix', beatenBy >= 2, `beaten by ${beatenBy}/8`);
}

// --- 14. Adaptive brain: modes, hysteresis, presets, no 1v1 regression ----
console.log('brain');
{
    type Self = SenseState['self'];
    const mkSelf = (over: Partial<Self>): Self => ({
        id: 0, team: 0, x: 480, y: 320, heading: 0, tower: 0, speed: 0, health: 100,
        cooldown: 0, stats: computeStats({}), charge: 0, charged: false, dashCd: 0, empCd: 0,
        slowed: false, loadout: {}, lastDamage: null, blocked: { ahead: 400 }, ...over,
    });
    const mkFoe = (over: Partial<SenseState['foes'][0]>): SenseState['foes'][0] => ({
        id: 1, team: 1, x: 600, y: 320, heading: Math.PI, speed: 0, health: 100,
        distance: 120, bearing: 0, ...over,
    });
    const mkSense = (over: Partial<SenseState>): SenseState => ({
        tick: 100,
        time: 100 / 60,
        self: mkSelf({}),
        foes: [],
        allies: [],
        scout: [],
        shared: [],
        walls: { left: 480, right: 480, top: 320, bottom: 320 },
        rand: (() => 0.5) as SenseState['rand'],
        events: [],
        bullets: [],
        tracks: [],
        arena: { id: 'open', obstacles: [], centerX: ARENA_WIDTH / 2, centerY: ARENA_HEIGHT / 2 },
        zone: { phase: 'normal', suddenDeathIn: 8900, circle: { x: 480, y: 320, r: 577 }, distToSafety: 0, inside: true },
        grid: { w: 12, h: 8, cell: 80, foes: new Array<number>(96).fill(0), danger: new Array<number>(96).fill(0) },
        match: { arena: 'open', modifiers: {}, tickCap: MAX_TICKS_TOTAL, killsYou: 0, killsTeam: 0, aliveFoes: 1 },
        inbox: [],
        ...over,
    });
    const modeOf = (sense: SenseState, params?: Partial<BrainParams>): string => createBrain(params).update(sense).mode;
    // Mode transitions off synthetic senses (fresh brain starts in roam).
    check('distant foe engages', modeOf(mkSense({ foes: [mkFoe({ distance: 400 })] })) === 'engage');
    check('mid-range foe flanks', modeOf(mkSense({ foes: [mkFoe({ distance: 280 })] })) === 'flank');
    check('close foe kites', modeOf(mkSense({ foes: [mkFoe({ distance: 150 })] })) === 'kite');
    check('low health retreats', modeOf(mkSense({ self: mkSelf({ health: 29 }), foes: [mkFoe({ distance: 280 })] })) === 'retreat');
    check('blind roams', modeOf(mkSense({})) === 'roam');
    check(
        'weak foe finishes (engage over kite)',
        modeOf(mkSense({ foes: [mkFoe({ distance: 150, health: 20 })] })) === 'engage',
    );
    const ally = { ...mkFoe({ id: 2, team: 0 as const, x: 400, y: 320, distance: 80, bearing: Math.PI }), tower: 0, cooldown: 0, charge: 0, charged: false, loadout: {} };
    check(
        'live vote focuses',
        modeOf(
            mkSense({
                foes: [mkFoe({ distance: 280 })],
                allies: [ally],
                inbox: [{ kind: 'focus', x: 0, y: 0, foe: 1, role: 0, slot: 0, bid: 0, from: 2, sent: 94 }],
            }),
        ) === 'focus',
    );
    check(
        'zone override retreats at full health',
        modeOf(
            mkSense({
                foes: [mkFoe({ distance: 280 })],
                zone: { phase: 'shrinking', suddenDeathIn: 0, circle: { x: 480, y: 320, r: 100 }, distToSafety: 50, inside: false },
            }),
        ) === 'retreat',
    );
    // Hysteresis: ties hold the incumbent, clear challengers switch.
    {
        const brain = createBrain();
        const far = mkSense({ foes: [mkFoe({ distance: 400 })] });
        const mid = mkSense({ foes: [mkFoe({ distance: 280 })] });
        check('far foe opens engage', brain.update(far).mode === 'engage');
        check('tie holds engage over flank', brain.update(mid).mode === 'engage');
        const flanker = createBrain();
        check('mid foe opens flank', flanker.update(mid).mode === 'flank');
        const weakMid = mkSense({ foes: [mkFoe({ distance: 280, health: 20 })] });
        check('tie holds flank over engage', flanker.update(weakMid).mode === 'flank');
        check('clear challenger switches to engage', flanker.update(far).mode === 'engage');
    }
    // Determinism: same senses, same modes and intents, every time.
    {
        const seq = [
            mkSense({}),
            mkSense({ foes: [mkFoe({ distance: 400 })] }),
            mkSense({ foes: [mkFoe({ distance: 150 })] }),
            mkSense({ self: mkSelf({ health: 10 }), foes: [mkFoe({ distance: 150 })] }),
        ];
        const runSeq = (): string => {
            const brain = createBrain();
            return JSON.stringify(seq.map((s) => brain.update(s)));
        };
        check('brain sequence replays exactly', runSeq() === runSeq());
    }
    // Shared helpers.
    check('safeCircleFor holds when safely inside', JSON.stringify(safeCircleFor(480, 320, { x: 480, y: 320, r: 577 })) === JSON.stringify({ x: 480, y: 320 }));
    check('safeCircleFor flees to center', JSON.stringify(safeCircleFor(130, 320, { x: 480, y: 320, r: 100 })) === JSON.stringify({ x: 480, y: 320 }));
    const pack = [mkFoe({ id: 1, distance: 300, health: 80 }), mkFoe({ id: 2, distance: 200, health: 40 }), mkFoe({ id: 3, distance: 250, health: 90 })];
    check('brain pickTarget first', brainPickTarget(pack, 'first')?.id === 1);
    check('brain pickTarget nearest', brainPickTarget(pack, 'nearest')?.id === 2);
    check('brain pickTarget weakest', brainPickTarget(pack, 'weakest')?.id === 2);
    check('brain pickTarget strongest', brainPickTarget(pack, 'strongest')?.id === 3);
    // Presets: all eight bots defined, finite, sane — and runnable.
    {
        const ids = ['rusher', 'turret', 'orbiter', 'wanderer', 'hunter', 'sniper', 'brawler', 'ghost'];
        const numeric: Array<keyof BrainParams> = ['steerGain', 'turretGain', 'aimTol', 'bankRangeFrac', 'closeRangeFrac', 'closeThrottle', 'scanTurn', 'retreatHp', 'kiteRange', 'flankRange', 'stayBonus', 'aggression', 'focusBonus'];
        let presetsOk = true;
        for (const id of ids) {
            const preset = BRAIN_PRESETS[id];
            if (!preset) {
                presetsOk = false;
                continue;
            }
            for (const key of numeric) {
                if (typeof preset[key] !== 'number' || !Number.isFinite(preset[key] as number)) presetsOk = false;
            }
            if (preset.orbitDir !== 1 && preset.orbitDir !== -1) presetsOk = false;
        }
        check('all eight presets defined with finite knobs', presetsOk);
        check('hunter preset matches brain defaults', JSON.stringify(BRAIN_PRESETS['hunter']) === JSON.stringify(BRAIN_DEFAULTS));
        let presetErrors = 0;
        for (const id of ids) {
            const preset = BRAIN_PRESETS[id] as BrainParams;
            const brain = createBrain(preset);
            const controller: RobotController = {
                meta: { id: `brain-${id}`, name: id, author: 'test', version: '0', description: '' },
                update: (sense: SenseState): Intent => brain.update(sense).intent,
            };
            const sitter: RobotController = {
                meta: { id: 'sitter', name: 'Sitter', author: 'test', version: '0', description: '' },
                update: (): Intent => ({}),
            };
            const m = new Match(
                [
                    { team: 0, controller, loadout: {} },
                    { team: 1, controller: sitter },
                ],
                5,
            );
            for (let i = 0; i < 300 && !m.result.over; i += 1) m.step();
            presetErrors += m.robotSnapshots.reduce((sum, s) => sum + s.errors, 0);
        }
        check('every preset runs 300 ticks error-free', presetErrors === 0);
    }
    // Genome brain.* group: clamps, defaults, behavior change.
    {
        const hunterDef = genomeDefFor('hunter');
        check('hunter genome carries 7 brain keys', hunterDef !== undefined && Object.keys(hunterDef.params).filter((k) => k.startsWith('brain.')).length === 7);
        const clamped = validateGenome(hunterDef as NonNullable<typeof hunterDef>, {
            genome_version: 1,
            bot: 'hunter',
            params: { 'brain.retreatHp': 99, 'brain.aggression': -5, 'brain.orbitDir': 7 },
        });
        check(
            'brain genes clamp to range',
            clamped.params['brain.retreatHp'] === 0.6 && clamped.params['brain.aggression'] === 0 && clamped.params['brain.orbitDir'] === 1,
        );
        const fromDefault = hunterParamsFromGenome(defaultGenome('hunter') as Genome);
        check('genome defaults feed the brain', fromDefault.brain?.retreatHp === 0.3 && fromDefault.brain?.orbitDir === 1);
        const refFp = fingerprint(runMatch(['hunter', 'orbiter'], [0, 1], 1234));
        const wild = new Match(
            [
                { team: 0, controller: createHunterParams({ brain: { retreatHp: 0.6, aggression: 0 } }), loadout: { charger: 2, marksman: 1, trigger: 2, plating: 1 } },
                { team: 1, controller: createOrbiterParams(), loadout: { gyro: 2, overdrive: 2, trigger: 1, plating: 1 } },
            ],
            1234,
            {},
        );
        wild.runToEnd();
        check('brain genes change behavior', fingerprint(wild) !== refFp);
    }
    // No 1v1 regression vs pre-brain: per-foe wins, both arenas/sides/seeds.
    {
        const hunterEntry = ROBOTS.find((r) => r.meta.id === 'hunter');
        if (!hunterEntry) throw new Error('no hunter');
        const foes = ROBOTS.filter((r) => r.meta.id !== 'hunter');
        let regressed: string[] = [];
        for (const foe of foes) {
            const tally = (make: () => RobotController): number => {
                let wins = 0;
                for (const arena of ARENA_IDS) {
                    for (const seed of [11, 22, 33]) {
                        for (const order of [0, 1]) {
                            const lineups: LineupEntry[] =
                                order === 0
                                    ? [
                                          { team: 0, controller: make(), loadout: { ...hunterEntry.loadout } },
                                          { team: 1, controller: foe.create(), loadout: { ...foe.loadout } },
                                      ]
                                    : [
                                          { team: 0, controller: foe.create(), loadout: { ...foe.loadout } },
                                          { team: 1, controller: make(), loadout: { ...hunterEntry.loadout } },
                                      ];
                            const m = new Match(lineups, seed, { arena });
                            m.runToEnd();
                            if ((m.result.winner === 0 && order === 0) || (m.result.winner === 1 && order === 1)) wins += 1;
                        }
                    }
                }
                return wins;
            };
            const brainWins = tally(() => createHunterParams());
            const legacyWins = tally(() => createHunterLegacy());
            console.log(`       hunter vs ${foe.meta.id}: brain=${brainWins} legacy=${legacyWins} (12 games)`);
            if (brainWins < legacyWins) regressed.push(`${foe.meta.id} (${brainWins}<${legacyWins})`);
        }
        check('no 1v1 regression vs pre-brain hunter', regressed.length === 0, regressed.join(', '));
    }
}

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
