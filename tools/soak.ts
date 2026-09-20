// Headless verification: determinism, intent clamping, error isolation,
// and bot-vs-bot soak across 1v1 / 2v2 / 3v3. Run with `npm run test:sim`.
// Exits non-zero on any failure.

import { ACCEL, ARENA_HEIGHT, ARENA_IDS, ARENA_OBSTACLES, ARENA_WIDTH, BULLET_SPEED, DASH_COOLDOWN_TICKS, EMP_COOLDOWN_TICKS, EMP_RADIUS, EMP_SLOW_TICKS, GUN_RANGE, MAX_SPEED, MAX_TICKS, MAX_TICKS_TOTAL, ROBOT_RADIUS, SENSOR_RANGE, SENSOR_SHARE_DELAY, SUDDEN_DEATH_TICKS, isExhibition, sanitizeModifiers, type ArenaId, type MatchModifiers } from '../src/sim/constants';
import { DT } from '../src/sim/constants';
import { Match, type LineupEntry, type RobotSnapshot } from '../src/sim/engine';
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
import { ROBOTS } from '../src/robots/registry';
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
        update: () => ({ throttle: NaN, turn: Infinity, towerTurn: -Infinity, fire: 'yes', charge: 1, dash: 'yes', emp: 1 }) as unknown as Intent,
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

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
