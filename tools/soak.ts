// Headless verification: determinism, intent clamping, error isolation,
// and bot-vs-bot soak across 1v1 / 2v2 / 3v3. Run with `npm run test:sim`.
// Exits non-zero on any failure.

import { ACCEL, AMP_TICKS, ARENA_HEIGHT, ARENA_IDS, ARENA_OBSTACLES, ARENA_WIDTH, BARRIER_COUNT, BARRIER_MIN_GAP, BULLET_DAMAGE, BULLET_SPEED, COMMS_DELAY, COMMS_INBOX_MAX, DASH_COOLDOWN_TICKS, EMP_COOLDOWN_TICKS, EMP_RADIUS, EMP_SLOW_TICKS, GUN_RANGE, HAZ_COOLDOWN_TICKS, HAZ_DAMAGE, HAZ_FIRST_TICK, HAZ_RADIUS, HAZ_SALT, HAZ_FLY_MAX_TICKS, HAZ_SCORCH_TICKS, HAZ_TARGET_MARGIN, INBOX_MAX, MAX_SPEED, MAX_TICKS, MAX_TICKS_TOTAL, OVERDRIVE_TICKS, PAD_BAND, PAD_COUNT, PAD_MIN_GAP, PAD_MIN_SPAWN_DIST, PAD_MIN_TURRET_DIST, PAD_OBSTACLE_CLEAR, PAD_RESPAWN_TICKS, REPAIR_HP, ROBOT_RADIUS, SENSE_BULLETS_MAX, SENSE_EVENTS_MAX, SENSE_GRID_CELL, SENSE_GRID_H, SENSE_GRID_STAMP, SENSE_GRID_W, SENSOR_RANGE, SENSOR_SHARE_DELAY, STRAFE_FACTOR, SUDDEN_DEATH_TICKS, TURRET_CAPTURE_RADIUS, TURRET_CAPTURE_TICKS, TURRET_DAMAGE, TURRET_DECAY_TICKS, TURRET_FIRE_INTERVAL, TURRET_RANGE, BARRIER_TURRET_CLEAR, CROSSFIRE_BARRIER_COUNT, FOUNDRY_BARRIER_COUNT, RUINS_BARRIER_COUNT, barriersForArena, barriersForSeed, isExhibition, sanitizeModifiers, turretSpotsForArena, type ArenaId, type ArenaObstacle, type MatchModifiers } from '../src/sim/constants';
import { DT } from '../src/sim/constants';
import { Match, sanitizeIntent, type LineupEntry, type RobotSnapshot } from '../src/sim/engine';
import { decodeReplay, encodeReplay, encodeReplayCompact, encodeReplayLegacy, type ReplaySpec } from '../src/sim/replay';
import { checkRobotSource, suggestFilename, WORKSHOP_TEMPLATE, workshopPassed } from '../src/game/workshop';
import { markTutorialSeen, resetTutorialFlag, shouldShowTutorial } from '../src/game/tutorial';
import { bgThemeForSeed, coverScale, hashSeed01 } from '../src/game/art/background';
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
import { readFileSync } from 'fs';
import { dodgeVector, leadAngle, leadShot, toGrid } from '../src/robots/common';
import { parseOnlineBoard } from '../src/game/onlineBoard';
import { parseShowcaseManifest } from '../src/game/showcase';
import { resimReplay } from './eval/resim';
import { castContact, castFocusVote, focusTarget, formationSlot, latestContact, resolveRoles } from '../src/robots/comms';
import { castClaim, castSlotHold, collectClaims, createRoleTracker, HOLD_BONUS, latestSlotHold, liveTeamIds, myRole, preferenceBid, rankByMidfield, roleGoal, roleSlot, ROLE_POINT, type RoleSense } from '../src/robots/roles';
import { ROBOTS } from '../src/robots/registry';
import { canonicalStringify, defaultGenome, genomeDefFor, genomeHash, genomeLoadout, sha256Hex, validateGenome, type Genome } from '../src/robots/genome';
import { BRAIN_DEFAULTS, BRAIN_PRESETS, createBrain, pickTarget as brainPickTarget, safeCircleFor, type BrainParams } from '../src/robots/brain';
import { BRAWLER_DEFAULTS, brawlerParamsFromGenome, createWithParams as createBrawlerParams } from '../src/robots/brawler';
import { createLegacyWithParams as createHunterLegacy, createWithParams as createHunterParams, HUNTER_DEFAULTS, hunterParamsFromGenome } from '../src/robots/hunter';
import { createWithParams as createGhostParams, GHOST_DEFAULTS, ghostParamsFromGenome } from '../src/robots/ghost';
import { createWithParams as createOrbiterParams, ORBITER_DEFAULTS, orbiterParamsFromGenome } from '../src/robots/orbiter';
import { createWithParams as createRusherParams, RUSHER_DEFAULTS, rusherParamsFromGenome } from '../src/robots/rusher';
import { createWithParams as createSniperParams, SNIPER_DEFAULTS, sniperParamsFromGenome } from '../src/robots/sniper';
import { createWithParams as createTurretParams, TURRET_DEFAULTS, turretParamsFromGenome } from '../src/robots/turret';
import { createWithParams as createWandererParams, WANDERER_DEFAULTS, wandererParamsFromGenome } from '../src/robots/wanderer';
import { computeStats, loadoutCode, loadoutCost, sanitizeLoadout, SKILL_DEFS, type SkillLoadout } from '../src/sim/skills';
import { ROBOT_API_VERSION, type Intent, type RobotController, type SenseEvent, type SensePad, type SenseState, type SenseTurret } from '../src/sim/types';
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
    // Full precision: any divergence, however small, must show. The barrier
    // segment pins the seed-derived layout so resimulation must reproduce
    // the same terrain (empty on `open`).
    const snaps = match.robotSnapshots.map((s) =>
        [s.code, s.maxHealth, s.alive ? 1 : 0, s.health, s.x, s.y, s.heading, s.tower, s.kills, s.damageDealt, s.shotsFired, s.cooldown, s.charge, s.dashCd, s.empCd, s.slowed ? 1 : 0].join(','),
    );
    const bullets = match.bulletSnapshots.map((b) => [b.x, b.y, b.team, b.hot ? 1 : 0].join(',')).join(';');
    const barriers = match.obstacles.map((o) => [o.x, o.y, o.w, o.h].join(',')).join(';');
    const pads = match.pickupLog.join(';');
    const turrets = match.turretSnapshots.map((t) => [t.owner, t.progress, t.cooldown, t.shotsFired].join(',')).join(';');
    const turretLog = match.turretCaptureLog.join(';');
    const hazards = match.hazardStrikes.map((s) => [s.x, s.y, s.announceTick, s.impactTick].join(',')).join(';');
    return `${match.arenaId}|${JSON.stringify(match.modifiers)}|${match.result.winner}@${match.result.tick}|${snaps.join('|')}|${bullets}|${barriers}|${pads}|${turrets}|${turretLog}|${hazards}`;
}

// --- 1. Determinism: same seed, same everything ------------------------------
console.log('determinism');
{
    const a = runMatch(['hunter', 'orbiter'], [0, 1], 1234);
    const b = runMatch(['hunter', 'orbiter'], [0, 1], 1234);
    check('identical fingerprint for identical seed', fingerprint(a) === fingerprint(b));
    // Wanderer draws from its per-(robot,tick) RNG stream, so its matches must diverge by seed.
    const d = runMatch(['wanderer', 'rusher'], [0, 1], 1234);
    const e = runMatch(['wanderer', 'rusher'], [0, 1], 999);
    check('seed affects RNG-drawing robots', fingerprint(d) !== fingerprint(e));
    const f = runMatch(['hunter', 'orbiter'], [0, 1], 1234, undefined, 'blocks');
    const g = runMatch(['hunter', 'orbiter'], [0, 1], 1234, undefined, 'blocks');
    check('identical fingerprint on blocks arena', fingerprint(f) === fingerprint(g));
}

// --- 1b. Hazards: deterministic schedule, single-asteroid fly-in, opt-out -
console.log('hazards');
{
    // Passive robots never damage each other, so the match always survives
    // past the first strike announcement (tick 300) into the telegraph.
    const seenHazards: number[] = [];
    const passive = (record: boolean): RobotController => ({
        meta: { id: 'passive', name: 'Passive', author: 'test', version: '0', description: '' },
        update: (sense: SenseState): Intent => {
            if (record) seenHazards.push(sense.hazards?.length ?? 0);
            return {};
        },
    });
    function hazardMatch(seed: number, modifiers: MatchModifiers = {}): Match {
        const match = new Match(
            [
                { team: 0, controller: passive(true) },
                { team: 1, controller: passive(false) },
            ],
            seed,
            { modifiers },
        );
        for (let i = 0; i < 400 && !match.over; i += 1) match.step();
        return match;
    }
    const h1 = hazardMatch(42);
    const h2 = hazardMatch(42);
    check(
        'hazard schedule is deterministic for identical seed',
        h1.hazardStrikes.length > 0 && JSON.stringify(h1.hazardStrikes) === JSON.stringify(h2.hazardStrikes),
        `strikes=${h1.hazardStrikes.length}`,
    );
    const strikes = h1.hazardStrikes;
    // Single-asteroid fly-in behavior (mirrored pairs removed): every strike
    // spawns at an off-screen edge point and flies to a seeded random target;
    // the flight itself IS the telegraph (impact = announce + flight ticks).
    // New strikes only land on the cooldown grid after the previous strike
    // resolved, so live strikes never overlap.
    type StrikeLog = { x: number; y: number; sx: number; sy: number; flyTicks: number; announceTick: number; impactTick: number };
    let flyinOk = strikes.length > 0;
    for (const s of strikes as Array<StrikeLog>) {
        if (s.impactTick - s.announceTick !== s.flyTicks) flyinOk = false;
        if (s.flyTicks < 1 || s.flyTicks > HAZ_FLY_MAX_TICKS) flyinOk = false;
        const offScreen = s.sx < 0 || s.sx > ARENA_WIDTH || s.sy < 0 || s.sy > ARENA_HEIGHT;
        if (!offScreen) flyinOk = false;
        const inTargetBounds =
            s.x >= HAZ_TARGET_MARGIN && s.x <= ARENA_WIDTH - HAZ_TARGET_MARGIN &&
            s.y >= HAZ_TARGET_MARGIN && s.y <= ARENA_HEIGHT - HAZ_TARGET_MARGIN;
        if (!inTargetBounds) flyinOk = false;
        if ((s.announceTick - HAZ_FIRST_TICK) % HAZ_COOLDOWN_TICKS !== 0) flyinOk = false;
    }
    check('single-asteroid strikes: off-screen fly-in to seeded target on cooldown grid', flyinOk, `strikes=${strikes.length}`);
    let nonOverlapping = true;
    for (let i = 0; i < strikes.length; i += 1) {
        for (let j = i + 1; j < strikes.length; j += 1) {
            const a = strikes[i] as StrikeLog;
            const b = strikes[j] as StrikeLog;
            if (a.announceTick < b.impactTick && b.announceTick < a.impactTick) nonOverlapping = false;
        }
    }
    check('asteroid strikes never overlap: one asteroid at a time', nonOverlapping);
    check('announced strikes reach the hazards sense channel', seenHazards.some((n) => n > 0));
    const off = hazardMatch(42, { noHazards: true });
    check('noHazards opts out of all strikes', off.hazardStrikes.length === 0);
    check(
        'modifier flag changes the match fingerprint',
        fingerprint(off) !== fingerprint(h1),
    );
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
        update: (sense: SenseState): Intent => {
            const foe = sense.foes[0] ?? sense.scout[0] ?? sense.tracks[0];
            if (!foe) return { throttle: 1, turn: 0, towerTurn: 0.5, fire: true, charge: false };
            const goal = Math.atan2(foe.y - sense.self.y, foe.x - sense.self.x);
            const wrap = (a: number): number => {
                while (a > Math.PI) a -= Math.PI * 2;
                while (a < -Math.PI) a += Math.PI * 2;
                return a;
            };
            return {
                throttle: 1,
                turn: Math.max(-1, Math.min(1, wrap(goal - sense.self.heading) * 2.5)),
                towerTurn: Math.max(-1, Math.min(1, wrap(goal - sense.self.tower) * 3)),
                fire: true,
                charge: false,
            };
        },
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
    const foeSpawn = new Match(
        [
            { team: 0, controller: { meta: { id: 'a', name: 'a', author: 't', version: '0', description: '' }, update: () => ({}) } },
            { team: 1, controller: { meta: { id: 'b', name: 'b', author: 't', version: '0', description: '' }, update: () => ({}) } },
        ],
        3,
    ).robotSnapshots[1] as { x: number; y: number };
    check(
        'blip is live position, zero health/heading/speed',
        first !== undefined && first.x === foeSpawn.x && first.y === foeSpawn.y && first.health === 0 && first.heading === 0 && first.speed === 0,
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
    const parkedStart = { x: still.robotSnapshots[0]?.x, y: still.robotSnapshots[0]?.y };
    for (let i = 0; i < 30; i += 1) still.step();
    check('parked dash moves nowhere', still.robotSnapshots[0]?.x === parkedStart.x && still.robotSnapshots[0]?.y === parkedStart.y);

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
        let timeoutDraws = 0;
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
                    else {
                        draws += 1;
                        if (match.result.tick >= MAX_TICKS_TOTAL) timeoutDraws += 1;
                    }
                }
            }
        }
        console.log(`       ${arena} record: ${ids.map((id) => `${id}=${wins.get(id)}`).join(' ')} draws=${draws} timeouts=${timeoutDraws}`);
        const maxWins = Math.max(...[...wins.values()]);
        const arenaGames = ids.length * (ids.length - 1) * seeds.length;
        check(`no robot wins every ${arena} matchup (balance smell)`, maxWins < arenaGames);
        // Draws are first-class (mutual kills in decisive combat), but stalls
        // that burn the full clock are not: sudden death must resolve those.
        check(`no 1v1 timeout draws on ${arena}`, timeoutDraws === 0, `timeouts=${timeoutDraws}`);
        check(`1v1 draws stay rare on ${arena}`, draws * 50 <= arenaGames, `draws=${draws}/${arenaGames}`);
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
    // Every barrier mirrors through the arena center onto another barrier.
    // Ground truth is per-match: the `blocks` layout is seed-derived.
    const mirroredLayout = (rects: Array<{ x: number; y: number; w: number; h: number }>): boolean =>
        rects.every((o) =>
            rects.some(
                (p) =>
                    p.x === ARENA_WIDTH - o.x - o.w &&
                    p.y === ARENA_HEIGHT - o.y - o.h &&
                    p.w === o.w &&
                    p.h === o.h,
            ),
        );
    check('blocks mirror through arena center', mirroredLayout(blocks.obstacles));
    const clearOf =
        (rects: Array<{ x: number; y: number; w: number; h: number }>) =>
        (x: number, y: number): boolean =>
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
        const freshClear = clearOf(fresh.obstacles);
        for (const s of fresh.robotSnapshots) {
            if (!freshClear(s.x, s.y)) spawnsClear = false;
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
    const probeClear = clearOf(probe.obstacles);
    let clipped = false;
    let sampled = 0;
    while (!probe.result.over) {
        probe.step();
        sampled += 1;
        if (sampled % 10 === 0) {
            for (const s of probe.robotSnapshots) {
                if (s.alive && !probeClear(s.x, s.y)) clipped = true;
            }
        }
    }
    check('robots never clip blocks mid-match', !clipped && sampled > 0);
}

// --- 5b2. Spawn variation: seeded, mirrored, constrained -------------------
console.log('spawn-variation');
{
    const dummy = (id: string): RobotController => ({
        meta: { id, name: id, author: 'test', version: '0', description: '' },
        update: (): Intent => ({}),
    });
    const mkLineups = (teamSize: number): LineupEntry[] => {
        const lineups: LineupEntry[] = [];
        for (let i = 0; i < teamSize; i += 1) lineups.push({ team: 0, controller: dummy(`a${i}`) });
        for (let i = 0; i < teamSize; i += 1) lineups.push({ team: 1, controller: dummy(`b${i}`) });
        return lineups;
    };
    const snapPos = (seed: number, teamSize: number): Array<{ x: number; y: number; heading: number }> =>
        new Match(mkLineups(teamSize), seed).robotSnapshots.map((s) => ({ x: s.x, y: s.y, heading: s.heading }));
    // Determinism: same seed, same spawns.
    let detOk = true;
    for (const teamSize of [1, 2, 3]) {
        const a = snapPos(4242, teamSize);
        const b = snapPos(4242, teamSize);
        if (JSON.stringify(a) !== JSON.stringify(b)) detOk = false;
    }
    check('spawns are deterministic per seed', detOk);
    // Variation: different seeds, different spawns.
    const v0 = snapPos(11, 1)[0] as { x: number; y: number };
    const v1 = snapPos(12, 1)[0] as { x: number; y: number };
    check('spawns vary by seed', v0.x !== v1.x || v0.y !== v1.y, `(${v0.x.toFixed(1)},${v0.y.toFixed(1)}) vs (${v1.x.toFixed(1)},${v1.y.toFixed(1)})`);
    // Mirror + constraints across 60 seeds x 1v1/2v2/3v3.
    let mirrorOk = true;
    let boundsOk = true;
    let gapOk = true;
    let headingOk = true;
    let blocksOk = true;
    for (let seed = 1; seed <= 60; seed += 1) {
        for (const teamSize of [1, 2, 3]) {
            const layoutSeed = seed * 7919 + 13;
            const snaps = snapPos(layoutSeed, teamSize);
            // Spawn columns never overlap that seed's own barrier layout
            // (spawns are arena-independent, so the open-arena snapshot
            // positions apply to `blocks` matches too).
            const rects = barriersForSeed(layoutSeed >>> 0);
            for (let i = 0; i < teamSize; i += 1) {
                const a = snaps[i] as { x: number; y: number; heading: number };
                const b = snaps[teamSize + i] as { x: number; y: number; heading: number };
                if (Math.abs(b.x - (ARENA_WIDTH - a.x)) > 1e-9 || Math.abs(b.y - (ARENA_HEIGHT - a.y)) > 1e-9) mirrorOk = false;
                let dh = Math.abs(b.heading - a.heading - Math.PI) % (Math.PI * 2);
                if (dh > Math.PI) dh = Math.PI * 2 - dh;
                if (dh > 1e-9) mirrorOk = false;
            }
            for (const s of snaps) {
                if (s.x < ROBOT_RADIUS || s.x > ARENA_WIDTH - ROBOT_RADIUS || s.y < ROBOT_RADIUS * 2 || s.y > ARENA_HEIGHT - ROBOT_RADIUS * 2) boundsOk = false;
                for (const o of rects) {
                    const cx = Math.max(o.x, Math.min(s.x, o.x + o.w));
                    const cy = Math.max(o.y, Math.min(s.y, o.y + o.h));
                    if (Math.hypot(s.x - cx, s.y - cy) < ROBOT_RADIUS - 1e-6) blocksOk = false;
                }
            }
            const team0 = snaps.slice(0, teamSize);
            const team1 = snaps.slice(teamSize);
            for (const team of [team0, team1]) {
                for (let i = 0; i < team.length; i += 1) {
                    for (let j = i + 1; j < team.length; j += 1) {
                        const p = team[i] as { x: number; y: number };
                        const q = team[j] as { x: number; y: number };
                        if (Math.hypot(p.x - q.x, p.y - q.y) < ROBOT_RADIUS * 2 + 8 - 1e-6) gapOk = false;
                    }
                }
            }
            for (let i = 0; i < teamSize; i += 1) {
                const a = snaps[i] as { heading: number };
                const b = snaps[teamSize + i] as { heading: number };
                if (Math.abs(a.heading) > 0.3 + 1e-9) headingOk = false;
                let hb = Math.abs(b.heading);
                if (hb > Math.PI) hb = Math.PI * 2 - hb;
                if (Math.abs(hb - Math.PI) > 0.3 + 1e-9) headingOk = false;
            }
        }
    }
    check('team 1 mirrors team 0 through the center', mirrorOk);
    check('spawns stay clamped to the arena', boundsOk);
    check('teammates keep minimum separation', gapOk);
    check('spawn headings face midfield, never a wall', headingOk);
    check('varied spawns clear obstacle blocks', blocksOk);
}

// --- 5b3. Barriers: seed-derived, symmetric, solid, playable ----------------
console.log('barriers');
{
    const dummy = (id: string): RobotController => ({
        meta: { id, name: id, author: 'test', version: '0', description: '' },
        update: (): Intent => ({}),
    });
    const blocksMatch = (seed: number): Match =>
        new Match(
            [
                { team: 0, controller: dummy('a') },
                { team: 1, controller: dummy('b') },
            ],
            seed,
            { arena: 'blocks' },
        );
    // Determinism: same seed + loadouts => identical layout.
    const sameSeed =
        JSON.stringify(blocksMatch(4242).obstacles) === JSON.stringify(blocksMatch(4242).obstacles);
    check('barrier layout is deterministic per seed', sameSeed);
    // Count, symmetry, and generation guards across 64 seeds.
    const seen = new Set<string>();
    let countOk = true;
    let symOk = true;
    let guardOk = true;
    let fallbacks = 0;
    const canonical = JSON.stringify(
        ARENA_OBSTACLES.blocks.map((o) => ({ ...o })).sort((a, b) => a.x - b.x || a.y - b.y),
    );
    for (let seed = 1; seed <= 2000; seed += 1) {
        if (JSON.stringify(barriersForSeed((seed * 131 + 7) >>> 0)) === canonical) fallbacks += 1;
    }
    for (let seed = 1; seed <= 64; seed += 1) {
        const rects = blocksMatch(seed * 131 + 7).obstacles;
        seen.add(JSON.stringify(rects));
        if (rects.length !== BARRIER_COUNT) countOk = false;
        const isFallback = JSON.stringify(rects) === canonical;
        for (const o of rects) {
            if (o.x < 248 || o.x + o.w > 712 || o.y < 88 || o.y + o.h > 552) guardOk = false;
            // Drawn rects are multiples of 8px in 56..104; the canonical
            // 90x90 fallback is accepted as-is.
            if (!isFallback && (o.w < 56 || o.w > 104 || o.h < 56 || o.h > 104 || o.w % 8 !== 0 || o.h % 8 !== 0)) {
                guardOk = false;
            }
            const mirror = rects.some(
                (p) =>
                    p.x === ARENA_WIDTH - o.x - o.w &&
                    p.y === ARENA_HEIGHT - o.y - o.h &&
                    p.w === o.w &&
                    p.h === o.h,
            );
            if (!mirror) symOk = false;
        }
        for (let i = 0; i < rects.length; i += 1) {
            for (let j = i + 1; j < rects.length; j += 1) {
                const a = rects[i] as { x: number; y: number; w: number; h: number };
                const b = rects[j] as { x: number; y: number; w: number; h: number };
                const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
                const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
                const gap = dx <= 0 && dy <= 0 ? 0 : dx <= 0 ? dy : dy <= 0 ? dx : Math.hypot(dx, dy);
                if (gap < BARRIER_MIN_GAP - 1e-9) guardOk = false;
            }
        }
    }
    check('every blocks match deals 4 barriers', countOk);
    check('every barrier layout mirrors through the center', symOk);
    check('barrier band, sizes, and gaps hold on 64 seeds', guardOk);
    check('canonical fallback never fires on 2000 seeds', fallbacks === 0, `${fallbacks} fallbacks`);
    check('barrier layouts vary by seed', seen.size > 1, `${seen.size} distinct / 64`);
    // Movement: a dashing ram never penetrates, and does reach the barrier.
    {
        const seed = 918273;
        const rammer: RobotController = {
            meta: { id: 'rammer', name: 'Rammer', author: 'test', version: '0', description: '' },
            update: (sense: SenseState): Intent => {
                const o = (sense.arena?.obstacles ?? [])[0] as
                    | { x: number; y: number; w: number; h: number }
                    | undefined;
                if (!o) return {};
                const cx = o.x + o.w / 2;
                const cy = o.y + o.h / 2;
                const dx = cx - sense.self.x;
                const dy = cy - sense.self.y;
                const d = Math.hypot(dx, dy) || 1;
                return { moveMode: 1, moveX: cx + (dx / d) * 300, moveY: cy + (dy / d) * 300, dash: true };
            },
        };
        const ram = new Match(
            [
                { team: 0, controller: rammer },
                { team: 1, controller: dummy('sat') },
            ],
            seed,
            { arena: 'blocks' },
        );
        const rects = ram.obstacles;
        let penetrated = false;
        let touched = false;
        for (let t = 0; t < 900; t += 1) {
            ram.step();
            const s = ram.robotSnapshots[0] as { x: number; y: number };
            for (const o of rects) {
                const cx = Math.max(o.x, Math.min(s.x, o.x + o.w));
                const cy = Math.max(o.y, Math.min(s.y, o.y + o.h));
                const d = Math.hypot(s.x - cx, s.y - cy);
                if (d < ROBOT_RADIUS - 1e-6) penetrated = true;
                if (d < ROBOT_RADIUS + 2) touched = true;
            }
        }
        check('dashing ram never penetrates a barrier', !penetrated);
        check('dashing ram reaches the barrier face', touched);
    }
    // Bullets: point-blank fire into a barrier harms nobody.
    {
        const seed = 555123;
        const shooter: RobotController = {
            meta: { id: 'shooter', name: 'Shooter', author: 'test', version: '0', description: '' },
            update: (sense: SenseState): Intent => {
                const rects = sense.arena?.obstacles ?? [];
                let target = rects[0] as { x: number; y: number; w: number; h: number } | undefined;
                for (const r of rects) {
                    if (target === undefined || r.w > target.w) target = r;
                }
                if (!target) return {};
                const o = target;
                const cx = o.x + o.w / 2;
                const stageY = o.y + o.h + 60;
                const self = sense.self;
                if (Math.hypot(cx - self.x, stageY - self.y) > 30) {
                    return { moveMode: 1, moveX: cx, moveY: stageY };
                }
                const want = Math.atan2(o.y + o.h - self.y, cx - self.x);
                let diff = want - self.tower;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                return { towerTurn: Math.max(-1, Math.min(1, diff * 3)), fire: Math.abs(diff) < 0.02 };
            },
        };
        // Hazard-free: this match measures barrier absorption over 1500
        // ticks, and the stationary foe would otherwise eat mirrored
        // strikes mid-test (foe health is part of the assertion).
        const bullet = new Match(
            [
                { team: 0, controller: shooter },
                { team: 1, controller: dummy('sat') },
            ],
            seed,
            { arena: 'blocks', modifiers: { noHazards: true } },
        );
        for (let t = 0; t < 1500 && !bullet.result.over; t += 1) bullet.step();
        const snaps = bullet.robotSnapshots;
        const self = snaps[0] as { shotsFired: number; damageDealt: number };
        const foe = snaps[1] as { health: number; maxHealth: number };
        check(
            'barriers absorb point-blank fire',
            self.shotsFired > 5 && self.damageDealt === 0 && foe.health === foe.maxHealth,
            `shots=${self.shotsFired} dealt=${self.damageDealt} foe=${foe.health}/${foe.maxHealth}`,
        );
    }
    // Playable: a batch of blocks-arena matches resolves, error-free, before
    // the defensive cap (sudden death always breaks stalls).
    {
        const botIds = ['hunter', 'orbiter', 'rusher', 'sniper', 'ghost', 'turret'];
        let resolved = 0;
        let decided = 0;
        let errors = 0;
        let maxTick = 0;
        const games = 8 * 3;
        for (let seed = 101; seed <= 108; seed += 1) {
            for (const teamSize of [1, 2, 3]) {
                const lineups: LineupEntry[] = [];
                for (let i = 0; i < teamSize * 2; i += 1) {
                    const id = botIds[(i + seed) % botIds.length] as string;
                    const entry = ROBOTS.find((r) => r.meta.id === id);
                    if (!entry) throw new Error(`unknown robot ${id}`);
                    lineups.push({
                        team: (i < teamSize ? 0 : 1) as 0 | 1,
                        controller: entry.create(),
                        loadout: { ...entry.loadout },
                    });
                }
                const m = new Match(lineups, seed * 1000 + teamSize, { arena: 'blocks' });
                m.runToEnd();
                if (m.result.over) resolved += 1;
                if (m.result.winner !== -1) decided += 1;
                maxTick = Math.max(maxTick, m.result.tick);
                for (const s of m.robotSnapshots) errors += s.errors;
            }
        }
        check('blocks batch resolves every match', resolved === games, `${resolved}/${games}`);
        check('blocks batch stays error-free', errors === 0, `${errors} errors`);
        check('blocks batch ends before the defensive cap', maxTick < MAX_TICKS_TOTAL, `max tick ${maxTick}`);
        console.log(`  info blocks batch: ${decided}/${games} decisive, max tick ${maxTick}`);
    }
}

// --- 5b4. Asymmetric arenas: ruins / foundry / crossfire --------------------
console.log('asymmetric-arenas');
{
    const NEW_ARENAS: ArenaId[] = ['ruins', 'foundry', 'crossfire'];
    const expectedCount = (arena: ArenaId): number =>
        arena === 'ruins' ? RUINS_BARRIER_COUNT : arena === 'foundry' ? FOUNDRY_BARRIER_COUNT : CROSSFIRE_BARRIER_COUNT;
    const edgeGap = (a: ArenaObstacle, b: ArenaObstacle): number => {
        const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
        const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
        if (dx <= 0 && dy <= 0) return 0;
        if (dx <= 0) return dy;
        if (dy <= 0) return dx;
        return Math.hypot(dx, dy);
    };
    const rectDist = (x: number, y: number, o: ArenaObstacle): number => {
        const cx = Math.max(o.x, Math.min(x, o.x + o.w));
        const cy = Math.max(o.y, Math.min(y, o.y + o.h));
        return Math.hypot(x - cx, y - cy);
    };
    const mirrorKey = (x: number, y: number, w: number, h: number): string =>
        `${ARENA_WIDTH - x - w},${ARENA_HEIGHT - y - h},${w},${h}`;
    for (const arena of NEW_ARENAS) {
        const turrets = turretSpotsForArena(arena);
        const [t0, t1] = turrets as [{ x: number; y: number }, { x: number; y: number }];
        check(
            `${arena} turret pair mirrors through the arena center`,
            Math.abs(t0.x + t1.x - ARENA_WIDTH) < 1e-9 && Math.abs(t0.y + t1.y - ARENA_HEIGHT) < 1e-9,
        );
        let countOk = true;
        let detOk = true;
        let guardOk = true;
        let asymmetric = true;
        let fallbacks = 0;
        const seen = new Set<string>();
        const canon = JSON.stringify(
            [...ARENA_OBSTACLES[arena]].sort((a, b) => a.x - b.x || a.y - b.y),
        );
        for (let seed = 0; seed < 200; seed += 1) {
            const rects = barriersForArena(arena, seed);
            if (rects.length !== expectedCount(arena)) countOk = false;
            if (JSON.stringify(barriersForArena(arena, seed)) !== JSON.stringify(rects)) detOk = false;
            seen.add(JSON.stringify(rects));
            if (JSON.stringify(rects) === canon) fallbacks += 1;
            const keys = new Set(rects.map((r) => `${r.x},${r.y},${r.w},${r.h}`));
            if (rects.every((r) => keys.has(mirrorKey(r.x, r.y, r.w, r.h)))) asymmetric = false;
            for (const r of rects) {
                if (r.x < 248 || r.y < 88 || r.x + r.w > 712 || r.y + r.h > 552) guardOk = false;
                if (r.w % 8 !== 0 || r.h % 8 !== 0) guardOk = false;
                if (turrets.some((t) => rectDist(t.x, t.y, r) < BARRIER_TURRET_CLEAR - 1e-9)) guardOk = false;
            }
            for (let i = 0; i < rects.length; i += 1) {
                for (let j = i + 1; j < rects.length; j += 1) {
                    if (edgeGap(rects[i] as ArenaObstacle, rects[j] as ArenaObstacle) < BARRIER_MIN_GAP - 1e-9) {
                        guardOk = false;
                    }
                }
            }
        }
        check(`${arena} deals ${expectedCount(arena)} barriers on 200 seeds`, countOk);
        check(`${arena} barrier layout is deterministic per seed`, detOk);
        check(`${arena} band, sizes, gaps, and turret clearance hold on 200 seeds`, guardOk);
        check(`${arena} layouts are asymmetric (never center-mirrored)`, asymmetric);
        check(`${arena} canonical fallback never fires on 200 seeds`, fallbacks === 0, `${fallbacks} fallbacks`);
        check(`${arena} layouts vary by seed`, seen.size > 100, `${seen.size} distinct / 200`);
    }
    // Turret spots differ per arena (real variety, not relabeled `blocks`).
    const spotKey = (arena: ArenaId): string => JSON.stringify(turretSpotsForArena(arena));
    check('turret spots vary across arenas', new Set(ARENA_IDS.map(spotKey)).size === 4, new Set(ARENA_IDS.map(spotKey)).size.toString());
    // Engine wiring: obstacles, turret snapshots, and pads match the layout
    // functions exactly on every new arena.
    const quiet: RobotController = {
        meta: { id: 'quiet', name: 'Quiet', author: 'test', version: '0', description: '' },
        update: (): Intent => ({}),
    };
    for (const arena of NEW_ARENAS) {
        const seed = 4242;
        const m = new Match(
            [
                { team: 0, controller: quiet },
                { team: 1, controller: quiet },
            ],
            seed,
            { arena },
        );
        check(
            `${arena} engine obstacles match barriersForArena`,
            JSON.stringify(m.obstacles) === JSON.stringify(barriersForArena(arena, seed)),
        );
        const spots = turretSpotsForArena(arena);
        check(
            `${arena} engine turrets match the arena spots`,
            JSON.stringify(m.turretSnapshots.map((t) => ({ x: t.x, y: t.y }))) === JSON.stringify(spots),
        );
        const pads = m.padSnapshots;
        const obs = m.obstacles;
        const padsOk =
            pads.length === PAD_COUNT &&
            pads.every((p) => obs.every((o) => rectDist(p.x, p.y, o) >= PAD_OBSTACLE_CLEAR)) &&
            pads.every((p) => spots.every((t) => Math.hypot(p.x - t.x, p.y - t.y) >= PAD_MIN_TURRET_DIST));
        check(`${arena} engine pads clear of live barriers and turrets`, padsOk);
    }
    // Replay: new arenas skip the RA2 compact form and round-trip via RA1.
    for (const arena of NEW_ARENAS) {
        const spec: ReplaySpec = {
            seed: 7,
            teamSize: 1,
            lineupIds: ['hunter', 'orbiter'],
            loadouts: [{}, {}],
            arena,
        };
        check(`${arena} specs skip the RA2 compact form`, encodeReplayCompact(spec) === null);
        check(`${arena} RA1 codes round-trip the arena`, decodeReplay(encodeReplayLegacy(spec))?.arena === arena);
    }
    // Playable: a small batch on each new arena resolves before the cap.
    {
        const botIds = ['hunter', 'orbiter', 'rusher', 'sniper'];
        let resolved = 0;
        let errors = 0;
        let maxTick = 0;
        const games = NEW_ARENAS.length * 4 * 3;
        for (const arena of NEW_ARENAS) {
            for (let seed = 101; seed <= 104; seed += 1) {
                for (const teamSize of [1, 2, 3]) {
                    const lineups: LineupEntry[] = [];
                    for (let i = 0; i < teamSize * 2; i += 1) {
                        const id = botIds[(i + seed) % botIds.length] as string;
                        const entry = ROBOTS.find((r) => r.meta.id === id);
                        if (!entry) throw new Error(`unknown robot ${id}`);
                        lineups.push({
                            team: (i < teamSize ? 0 : 1) as 0 | 1,
                            controller: entry.create(),
                            loadout: { ...entry.loadout },
                        });
                    }
                    const m = new Match(lineups, seed * 1000 + teamSize, { arena });
                    m.runToEnd();
                    if (m.result.over) resolved += 1;
                    maxTick = Math.max(maxTick, m.result.tick);
                    for (const s of m.robotSnapshots) errors += s.errors;
                }
            }
        }
        check('asymmetric batch resolves every match', resolved === games, `${resolved}/${games}`);
        check('asymmetric batch stays error-free', errors === 0, `${errors} errors`);
        check('asymmetric batch ends before the defensive cap', maxTick < MAX_TICKS_TOTAL, `max tick ${maxTick}`);
    }
}

// --- 5c. Sudden death: circle shrinks, outsiders pulse, draws vanish ------
console.log('sudden-death');
{
    const dummy = (id: string): RobotController => ({
        meta: { id, name: id, author: 'test', version: '0', description: '' },
        update: (): Intent => ({ throttle: 0, turn: 0, towerTurn: 0, fire: false, charge: false }),
    });
    // Hazard-free: this section measures the collapse mechanics, and stationary
    // dummies would otherwise eat mirrored strikes (25 damage each) and end
    // the match before the cap — stalling `while (tick < MAX_TICKS)` forever.
    const stalled = (): Match =>
        new Match(
            [
                { team: 0, controller: dummy('dummy-a') },
                { team: 1, controller: dummy('dummy-b') },
            ],
            11,
            { modifiers: { noHazards: true } },
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
        { modifiers: { noHazards: true } },
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
        update: (sense: SenseState): Intent => {
            const foe = sense.foes[0] ?? sense.scout[0] ?? sense.tracks[0];
            if (!foe) return { throttle: 1, turn: 0, towerTurn: 0.5, fire: true, charge: false };
            const goal = Math.atan2(foe.y - sense.self.y, foe.x - sense.self.x);
            const wrap = (a: number): number => {
                while (a > Math.PI) a -= Math.PI * 2;
                while (a < -Math.PI) a += Math.PI * 2;
                return a;
            };
            return {
                throttle: 1,
                turn: Math.max(-1, Math.min(1, wrap(goal - sense.self.heading) * 2.5)),
                towerTurn: Math.max(-1, Math.min(1, wrap(goal - sense.self.tower) * 3)),
                fire: true,
                charge: false,
            };
        },
    };
    const target: RobotController = {
        meta: { id: 'target', name: 'Target', author: 'test', version: '0', description: '' },
        update: (): Intent => ({ throttle: 0, turn: 0, towerTurn: 0, fire: false, charge: false }),
    };
    // Close-range duel inside the spawn column: randomized pads sit in the
    // midfield drive lane, but spawn columns (x 90..170) are pad-free by the
    // PAD_MIN_SPAWN_DIST guarantee, so this geometry measures the modifier —
    // never a pad pickup.
    const placeDuel = (match: Match, id: number, x: number, y: number): void => {
        const r = match.robots[id] as unknown as { x: number; y: number } | undefined;
        if (r) {
            r.x = x;
            r.y = y;
        }
    };
    const duel = (modifiers: MatchModifiers): Match => {
        const match = new Match(
            [
                { team: 0, controller: shooter },
                { team: 1, controller: target },
            ],
            3,
            { modifiers },
        );
        placeDuel(match, 0, 130, 250);
        placeDuel(match, 1, 130, 450);
        return match;
    };
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

// --- P1. Powerup pads: layout, pickup effects, respawn, expiry, stacking --
console.log('powerups');
{
    const idle: RobotController = {
        meta: { id: 'idle', name: 'Idle', author: 'test', version: '0', description: '' },
        update: (): Intent => ({}),
    };
    let lastEvents: SenseEvent[] = [];
    let lastPickups: SensePad[] | undefined;
    const recorder: RobotController = {
        meta: { id: 'recorder', name: 'Recorder', author: 'test', version: '0', description: '' },
        update: (sense: SenseState): Intent => {
            lastEvents = sense.events ?? [];
            lastPickups = sense.pickups;
            return {};
        },
    };
    const idleMatch = (seed: number): Match =>
        new Match(
            [
                { team: 0, controller: recorder },
                { team: 1, controller: idle },
            ],
            seed,
        );
    // White-box placement: teleport a robot onto a pad (deterministic setup
    // only; the pickup logic itself runs through the real stepPads path).
    const place = (match: Match, id: number, x: number, y: number): void => {
        const r = match.robots[id] as unknown as { x: number; y: number } | undefined;
        if (r) {
            r.x = x;
            r.y = y;
        }
    };
    const setHealth = (match: Match, id: number, hp: number): void => {
        const r = match.robots[id] as unknown as { health: number } | undefined;
        if (r) r.health = hp;
    };
    // White-box aim: face a robot's hull and tower at a target point. Spawn
    // variation jitters headings, so duels re-aim to keep head-on geometry.
    const aimAt = (match: Match, id: number, tx: number, ty: number): void => {
        const r = match.robots[id] as unknown as { x: number; y: number; heading: number; tower: number } | undefined;
        if (r) {
            const a = Math.atan2(ty - r.y, tx - r.x);
            r.heading = a;
            r.tower = a;
        }
    };

    // Layout: seeded random spots, point-mirrored positions and kinds.
    // Order-independent mirror check: every pad needs a center partner
    // (x + x' = 960, y + y' = 640) sharing its kind.
    const hasMirror = (pads: SensePad[], i: number): boolean => {
        const p = pads[i] as SensePad;
        return pads.some(
            (q, j) =>
                j !== i &&
                Math.abs(q.x + p.x - ARENA_WIDTH) < 1e-9 &&
                Math.abs(q.y + p.y - ARENA_HEIGHT) < 1e-9 &&
                q.kind === p.kind,
        );
    };
    const kindCount = (pads: SensePad[], kind: string): number => pads.filter((p) => p.kind === kind).length;
    const inBand = (pads: SensePad[]): boolean =>
        pads.every((p) => p.x >= PAD_BAND.x0 && p.x <= PAD_BAND.x1 && p.y >= PAD_BAND.y0 && p.y <= PAD_BAND.y1);
    const canonicalOrder = (pads: SensePad[]): boolean =>
        pads.every((p, i) => {
            if (i === 0) return true;
            const prev = pads[i - 1] as SensePad;
            return prev.x < p.x || (prev.x === p.x && prev.y <= p.y);
        });
    const spaced = (pads: SensePad[]): boolean => {
        for (let i = 0; i < pads.length; i += 1) {
            for (let j = i + 1; j < pads.length; j += 1) {
                const a = pads[i] as SensePad;
                const b = pads[j] as SensePad;
                if (Math.hypot(a.x - b.x, a.y - b.y) < PAD_MIN_GAP - 1e-9) return false;
            }
        }
        return true;
    };
    const turretClear = (pads: SensePad[], turrets: Array<{ x: number; y: number }> = turretSpotsForArena('open')): boolean =>
        pads.every((p) => turrets.every((t) => Math.hypot(p.x - t.x, p.y - t.y) >= PAD_MIN_TURRET_DIST));
    // Point-to-rect distance (same clamp rule as the engine).
    const rectDist = (x: number, y: number, o: ArenaObstacle): number => {
        const cx = Math.max(o.x, Math.min(x, o.x + o.w));
        const cy = Math.max(o.y, Math.min(y, o.y + o.h));
        return Math.hypot(x - cx, y - cy);
    };
    const obstacleClear = (pads: SensePad[], obstacles: ArenaObstacle[]): boolean =>
        pads.every((p) => obstacles.every((o) => rectDist(p.x, p.y, o) >= PAD_OBSTACLE_CLEAR));
    // Analytic spawn guarantee: spawn columns x 90..170 / 790..870 hold for
    // every lineup size, so any pad with x in the contest band sits 134px+
    // from every possible spawn point. Asserted on outputs (also catches a
    // cold fallback path, whose legacy x = 211 would fail here).
    const spawnClear = (pads: SensePad[]): boolean =>
        pads.every((p) => Math.min(p.x - 170, 790 - p.x) >= PAD_MIN_SPAWN_DIST);
    const padCycle = ['amp', 'repair', 'overdrive'];
    for (const seed of [0, 1, 2, 3, 7, 42, 12345]) {
        const pads = Match.padLayout(seed);
        check(
            `seed ${seed} has 4 active pads`,
            pads.length === PAD_COUNT && pads.every((p) => p.active && p.respawnIn === 0),
        );
        check(`seed ${seed} pads point-mirrored with shared kinds`, pads.every((_, i) => hasMirror(pads, i)));
        const off = seed % padCycle.length;
        check(
            `seed ${seed} keeps the 2+2 kind split`,
            kindCount(pads, padCycle[off] as string) === 2 &&
                kindCount(pads, padCycle[(off + 1) % padCycle.length] as string) === 2,
        );
        check(`seed ${seed} pads in canonical (x, y) order`, canonicalOrder(pads));
        check(`seed ${seed} pads drawn from the contest band`, inBand(pads));
        check(`seed ${seed} pads spaced ${PAD_MIN_GAP}px+`, spaced(pads));
        check(`seed ${seed} pads clear of turret structures`, turretClear(pads));
        check(`seed ${seed} pads clear of every spawn column`, spawnClear(pads));
    }
    check('pad layout is seed-derived (deterministic)', JSON.stringify(Match.padLayout(99)) === JSON.stringify(Match.padLayout(99)));
    check(
        'pad layouts vary across seeds',
        new Set([0, 1, 2, 3, 7, 42, 12345].map((s) => JSON.stringify(Match.padLayout(s)))).size > 1,
    );
    check(
        'pad kinds cycle with a seed offset',
        kindCount(Match.padLayout(0), 'overdrive') === 0 &&
            kindCount(Match.padLayout(1), 'amp') === 0 &&
            kindCount(Match.padLayout(2), 'repair') === 0,
    );

    // Seed 3 deals amp/repair pairs; seed 4 deals an overdrive pair.
    const pads3 = Match.padLayout(3);
    const ampIdx3 = pads3.findIndex((p) => p.kind === 'amp');
    const ampPad = pads3[ampIdx3] as SensePad;
    const repairPad = pads3.find((p) => p.kind === 'repair') as SensePad;
    const pads4 = Match.padLayout(4);
    const odIdx4 = pads4.findIndex((p) => p.kind === 'overdrive');
    const odPad = pads4[odIdx4] as SensePad;
    check(
        'seed 3 pads are amp/repair pairs',
        ampIdx3 >= 0 && kindCount(pads3, 'amp') === 2 && kindCount(pads3, 'repair') === 2,
    );
    check('seed 4 deals an overdrive pair', odIdx4 >= 0 && kindCount(pads4, 'overdrive') === 2);

    // Blocks: pads respect the live barriers and match the engine wiring,
    // with real spawn clearance on both lineup sizes.
    for (const seed of [7, 11, 4242]) {
        const m = new Match(
            [
                { team: 0, controller: recorder },
                { team: 1, controller: idle },
            ],
            seed,
            { arena: 'blocks' },
        );
        const obs = m.obstacles;
        const snaps = m.padSnapshots;
        const strip = (pads: SensePad[]): string =>
            JSON.stringify(pads.map((p) => ({ x: p.x, y: p.y, kind: p.kind })));
        check(
            `seed ${seed} blocks pads match padLayout(seed, obstacles)`,
            strip(snaps) === strip(Match.padLayout(seed, obs)),
        );
        check(`seed ${seed} blocks pads clear of barriers`, obstacleClear(snaps, obs));
        check(
            `seed ${seed} blocks pads clear of live spawns`,
            snaps.every((p) =>
                m.robotSnapshots.every((s) => Math.hypot(p.x - s.x, p.y - s.y) >= PAD_MIN_SPAWN_DIST),
            ),
        );
    }
    {
        // 2v2 spawn clearance on blocks (4 live spawn points).
        const squad = new Match(
            [
                { team: 0, controller: recorder },
                { team: 0, controller: idle },
                { team: 1, controller: idle },
                { team: 1, controller: idle },
            ],
            7,
            { arena: 'blocks' },
        );
        check(
            'blocks pads clear of 2v2 spawns',
            squad.padSnapshots.every((p) =>
                squad.robotSnapshots.every((s) => Math.hypot(p.x - s.x, p.y - s.y) >= PAD_MIN_SPAWN_DIST),
            ),
        );
    }
    {
        // Sweep: hundreds of seeds satisfy every hard constraint on every
        // arena — per-arena live barriers and turret spots, so moved
        // turrets and asymmetric terrain are covered too (and the legacy
        // fallback path stays cold everywhere).
        let bad = 0;
        for (let seed = 0; seed < 200; seed += 1) {
            for (const arena of ARENA_IDS) {
                const obs = barriersForArena(arena, seed);
                // Mirror the engine wiring: live turret spots only where
                // turrets moved, legacy sampler otherwise.
                const turrets = arena === 'open' || arena === 'blocks' ? undefined : turretSpotsForArena(arena);
                const pads = Match.padLayout(seed, obs, turrets);
                if (
                    pads.length !== PAD_COUNT ||
                    !pads.every((_, i) => hasMirror(pads, i)) ||
                    !inBand(pads) ||
                    !canonicalOrder(pads) ||
                    !spaced(pads) ||
                    !turretClear(pads, turrets ?? turretSpotsForArena('open')) ||
                    !spawnClear(pads) ||
                    !obstacleClear(pads, obs)
                ) {
                    bad += 1;
                }
            }
        }
        check('200-seed sweep: every layout legal on every arena', bad === 0, `${bad} illegal`);
    }

    // AMP pickup: timed damage boost, dark pad, pickup event, sense channel.
    {
        const m = idleMatch(3);
        place(m, 0, ampPad.x, ampPad.y);
        m.step();
        check('amp pickup logged as tick:padIdx:robotId', m.pickupLog.join(';') === `0:${ampIdx3}:0`, m.pickupLog.join(';'));
        check('amp arms full effect ticks', m.effectTicks(0).amp === AMP_TICKS - 1, `${m.effectTicks(0).amp}`);
        const pad = m.padSnapshots[ampIdx3] as SensePad;
        check('amp pad goes dark for respawn ticks', !pad.active && pad.respawnIn === PAD_RESPAWN_TICKS);
        m.step(); // robot still on the dark pad: no re-pickup, events deliver
        check('no re-pickup while dark', m.pickupLog.length === 1);
        check(
            'pickup event carries the pad kind',
            lastEvents.some((e) => e.kind === 'pickup' && e.pad === 'amp'),
            JSON.stringify(lastEvents),
        );
        check(
            'sense reports all 4 pads in canonical order',
            (lastPickups?.length ?? 0) === 4 &&
                lastPickups !== undefined &&
                lastPickups[ampIdx3]?.kind === 'amp' &&
                canonicalOrder(lastPickups) &&
                lastPickups.every((p) => typeof p.x === 'number' && typeof p.active === 'boolean'),
        );
    }

    // Contested pickup: first robot in tick order wins.
    {
        const m = idleMatch(3);
        place(m, 0, ampPad.x, ampPad.y);
        place(m, 1, ampPad.x, ampPad.y);
        m.step();
        check('contested pad goes to tick-order first', m.pickupLog.join(';') === `0:${ampIdx3}:0`, m.pickupLog.join(';'));
        check('loser gets no effect', m.effectTicks(1).amp === 0);
    }

    // REPAIR pickup: +HP now, clamped to max.
    {
        const m = idleMatch(3);
        setHealth(m, 0, 20);
        place(m, 0, repairPad.x, repairPad.y);
        m.step();
        check('repair heals exact HP', (m.robotSnapshots[0]?.health ?? -1) === 20 + REPAIR_HP);
        const m2 = idleMatch(3);
        setHealth(m2, 0, 70);
        place(m2, 0, repairPad.x, repairPad.y);
        m2.step();
        check(
            'repair clamps to max health',
            (m2.robotSnapshots[0]?.health ?? -1) === (m2.robotSnapshots[0]?.maxHealth ?? -2),
        );
    }

    // OVERDRIVE pickup: timed speed boost.
    {
        const m = idleMatch(4);
        place(m, 0, odPad.x, odPad.y);
        m.step();
        check('overdrive pickup logged', m.pickupLog.join(';') === `0:${odIdx4}:0`, m.pickupLog.join(';'));
        check('overdrive arms full effect ticks', m.effectTicks(0).overdrive === OVERDRIVE_TICKS - 1);
    }

    // Respawn: dark for exactly PAD_RESPAWN_TICKS, then active (no same-tick collect).
    {
        const m = idleMatch(3);
        place(m, 0, ampPad.x, ampPad.y);
        m.step();
        for (let i = 0; i < PAD_RESPAWN_TICKS - 1; i += 1) m.step();
        const dark = m.padSnapshots[ampIdx3] as SensePad;
        check('pad still dark one tick early', !dark.active && dark.respawnIn === 1 && m.pickupLog.length === 1);
        m.step();
        const back = m.padSnapshots[ampIdx3] as SensePad;
        check('pad reactivates after respawn ticks', back.active && back.respawnIn === 0 && m.pickupLog.length === 1);
        m.step();
        check('reactivated pad collects again', m.pickupLog.length === 2 && !(m.padSnapshots[ampIdx3] as SensePad).active);
    }

    // Expiry: timed effects run out.
    {
        const m = idleMatch(3);
        place(m, 0, ampPad.x, ampPad.y);
        m.step();
        for (let i = 0; i < AMP_TICKS - 1; i += 1) m.step();
        check('amp expires after AMP_TICKS', m.effectTicks(0).amp === 0);
        const m2 = idleMatch(4);
        place(m2, 0, odPad.x, odPad.y);
        m2.step();
        for (let i = 0; i < OVERDRIVE_TICKS - 1; i += 1) m2.step();
        check('overdrive expires after OVERDRIVE_TICKS', m2.effectTicks(0).overdrive === 0);
    }

    // AMP vs doubleDamage: strongest multiplier wins (never 4x).
    {
        const shooter: RobotController = {
            meta: { id: 'shooter', name: 'Shooter', author: 'test', version: '0', description: '' },
            update: (): Intent => ({ throttle: 1, turn: 0, towerTurn: 0, fire: true, charge: false }),
        };
        const victim: RobotController = {
            meta: { id: 'victim', name: 'Victim', author: 'test', version: '0', description: '' },
            update: (): Intent => ({}),
        };
        const ampDuel = (modifiers: MatchModifiers): Match => {
            const m = new Match(
                [
                    { team: 0, controller: shooter },
                    { team: 1, controller: victim },
                ],
                3,
                { modifiers },
            );
            const home = { x: m.robotSnapshots[0]?.x ?? 130, y: m.robotSnapshots[0]?.y ?? 320 };
            place(m, 0, ampPad.x, ampPad.y);
            m.step(); // tick-0 pickup (stray shot flies wide of the victim)
            place(m, 0, home.x, home.y); // back to spawn: geometry matches a plain duel
            aimAt(m, 0, m.robotSnapshots[1]?.x ?? 0, m.robotSnapshots[1]?.y ?? 0);
            return m;
        };
        const firstDealt = (m: Match): { dealt: number; ampLeft: number } => {
            for (let i = 0; i < 2000; i += 1) {
                m.step();
                const dealt = m.robotSnapshots[0]?.damageDealt ?? 0;
                if (dealt > 0) return { dealt, ampLeft: m.effectTicks(0).amp };
            }
            return { dealt: -1, ampLeft: -1 };
        };
        const amped = firstDealt(ampDuel({}));
        check('amp doubles bullet damage', amped.dealt === BULLET_DAMAGE * 2 && amped.ampLeft > 0, JSON.stringify(amped));
        const stacked = firstDealt(ampDuel({ doubleDamage: true }));
        check('amp plus doubleDamage is still 2x (max wins)', stacked.dealt === BULLET_DAMAGE * 2, JSON.stringify(stacked));
    }

    // Death clears timed effects (no drops).
    {
        const killer: RobotController = {
            meta: { id: 'killer', name: 'Killer', author: 'test', version: '0', description: '' },
            update: (): Intent => ({ throttle: 1, turn: 0, towerTurn: 0, fire: true, charge: false }),
        };
        const slayWith = (seed: number, pad: SensePad): Match | null => {
            const m = new Match(
                [
                    { team: 0, controller: idle },
                    { team: 1, controller: killer },
                ],
                seed,
            );
            const home = { x: m.robotSnapshots[0]?.x ?? 130, y: m.robotSnapshots[0]?.y ?? 320 };
            place(m, 0, pad.x, pad.y);
            m.step();
            if (m.pickupLog.length !== 1) return null;
            place(m, 0, home.x, home.y); // back to spawn: geometry matches a plain duel
            aimAt(m, 1, m.robotSnapshots[0]?.x ?? 0, m.robotSnapshots[0]?.y ?? 0);
            for (let i = 0; i < 4000; i += 1) {
                m.step();
                if (!(m.robotSnapshots[0]?.alive ?? true)) return m;
            }
            return null;
        };
        const deadAmp = slayWith(3, ampPad);
        check('amped victim dies', deadAmp !== null);
        if (deadAmp) {
            check('death clears amp', deadAmp.effectTicks(0).amp === 0 && deadAmp.effectTicks(0).overdrive === 0);
        }
        const deadOd = slayWith(4, odPad);
        check('overdriven victim dies', deadOd !== null);
        if (deadOd) {
            check('death clears overdrive', deadOd.effectTicks(0).overdrive === 0 && deadOd.effectTicks(0).amp === 0);
        }
    }
}

// --- T1. Map turrets: layout, capture, contest, decay, recapture, combat --
console.log('turrets');
{
    const idle: RobotController = {
        meta: { id: 'idle', name: 'Idle', author: 'test', version: '0', description: '' },
        update: (): Intent => ({}),
    };
    let lastEvents: SenseEvent[] = [];
    let lastTurrets: SenseTurret[] | undefined;
    const seenEvents: SenseEvent[] = [];
    const recorder: RobotController = {
        meta: { id: 'recorder', name: 'Recorder', author: 'test', version: '0', description: '' },
        update: (sense: SenseState): Intent => {
            lastEvents = sense.events ?? [];
            lastTurrets = sense.turrets;
            seenEvents.push(...(sense.events ?? []));
            return {};
        },
    };
    const idleMatch = (seed: number, arena: ArenaId = 'open'): Match =>
        new Match(
            [
                // Both slots record: turret hits land on team 1, so the
                // victim's hit-by events must be observed there too.
                { team: 0, controller: recorder },
                { team: 1, controller: recorder },
            ],
            seed,
            { arena },
        );
    // White-box placement (deterministic setup only; capture/combat run the
    // real stepTurrets path).
    const place = (match: Match, id: number, x: number, y: number): void => {
        const r = match.robots[id] as unknown as { x: number; y: number } | undefined;
        if (r) {
            r.x = x;
            r.y = y;
        }
    };
    const T0 = { x: ARENA_WIDTH * 0.5, y: ARENA_HEIGHT * 0.3 };
    const T1 = { x: ARENA_WIDTH * 0.5, y: ARENA_HEIGHT * 0.7 };

    // Layout: fixed center-column positions, mirrored, start disabled.
    {
        const a = Match.turretLayout();
        const b = Match.turretLayout();
        check('turret layout is fixed and deterministic', JSON.stringify(a) === JSON.stringify(b));
        check(
            'two turrets on the center column',
            a.length === 2 &&
                a[0]?.x === T0.x && a[0]?.y === T0.y &&
                a[1]?.x === T1.x && a[1]?.y === T1.y,
            JSON.stringify(a),
        );
        const m = idleMatch(11);
        const snaps = m.turretSnapshots;
        check(
            'turrets start disabled and neutral',
            snaps.length === 2 &&
                snaps.every((t) => t.owner === -1 && t.progress === 0 && t.cooldown === 0 && t.shotsFired === 0),
            JSON.stringify(snaps),
        );
        check('no capture log at start', m.turretCaptureLog.length === 0 && m.turretDamageDealt === 0);
        m.step();
        check(
            'sense reports both turrets in fixed order',
            (lastTurrets?.length ?? 0) === 2 &&
                lastTurrets !== undefined &&
                lastTurrets[0]?.state === 'disabled' &&
                lastTurrets[0]?.owner === -1 &&
                lastTurrets[0]?.progress === 0 &&
                typeof lastTurrets[0]?.x === 'number',
        );
    }

    // Uncontested capture: exactly TURRET_CAPTURE_TICKS ticks of presence.
    {
        const m = idleMatch(11);
        place(m, 0, T0.x, T0.y);
        for (let i = 0; i < TURRET_CAPTURE_TICKS - 1; i += 1) m.step();
        const almost = m.turretSnapshots[0];
        check(
            'one tick short of capture stays neutral',
            almost?.owner === -1 && Math.abs((almost?.progress ?? 0) * TURRET_CAPTURE_TICKS - (TURRET_CAPTURE_TICKS - 1)) < 1e-9,
            JSON.stringify(almost),
        );
        m.step(); // tick TURRET_CAPTURE_TICKS - 1: edge hits the pole
        const owned = m.turretSnapshots[0];
        check(
            'capture lands on exactly TURRET_CAPTURE_TICKS',
            owned?.owner === 0 && owned?.progress === 1,
            JSON.stringify(owned),
        );
        check(
            'capture logged as tick:turretIdx:team',
            m.turretCaptureLog.join(';') === `${TURRET_CAPTURE_TICKS - 1}:0:0`,
            m.turretCaptureLog.join(';'),
        );
        m.step(); // events deliver on the next sense
        check(
            'turret-captured event names the turret index',
            lastEvents.some((e) => e.kind === 'turret-captured' && e.fromId === 0),
            JSON.stringify(lastEvents),
        );
        check(
            'sense marks the turret active',
            lastTurrets?.[0]?.state === 'active' && lastTurrets?.[0]?.owner === 0 && lastTurrets?.[1]?.state === 'disabled',
        );
        check('silent turret holds no fire with no enemy near', m.turretSnapshots[0]?.shotsFired === 0);
    }

    // Contest: both teams inside freezes progress (no advance, no reset).
    {
        const m = idleMatch(11);
        const contestLean = Math.floor(TURRET_CAPTURE_TICKS / 2);
        place(m, 0, T0.x, T0.y);
        for (let i = 0; i < contestLean; i += 1) m.step();
        const before = m.turretSnapshots[0]?.progress ?? -1;
        place(m, 1, T0.x, T0.y);
        for (let i = 0; i < 300; i += 1) m.step();
        const after = m.turretSnapshots[0];
        check(
            'contested progress freezes mid-lean',
            Math.abs(before * TURRET_CAPTURE_TICKS - contestLean) < 1e-9 &&
                Math.abs((after?.progress ?? -1) * TURRET_CAPTURE_TICKS - contestLean) < 1e-9 &&
                after?.owner === -1,
            `before=${before} after=${after?.progress}`,
        );
        check('contest captures nothing', m.turretCaptureLog.length === 0);
    }

    // Decay: 300 absent ticks hold partial progress, then it erodes.
    {
        const leanTicks = Math.floor((2 * TURRET_CAPTURE_TICKS) / 3);
        const lean = leanTicks / TURRET_CAPTURE_TICKS;
        const m = idleMatch(11);
        place(m, 0, T0.x, T0.y);
        for (let i = 0; i < leanTicks; i += 1) m.step();
        check('partial lean after presence ticks', m.turretSnapshots[0]?.progress === lean);
        place(m, 0, 30, 30);
        for (let i = 0; i < TURRET_DECAY_TICKS - 1; i += 1) m.step();
        check(
            'no decay before 300 absent ticks',
            m.turretSnapshots[0]?.progress === lean,
            `${m.turretSnapshots[0]?.progress}`,
        );
        m.step(); // 300th absent tick: first erosion step
        const eroding = m.turretSnapshots[0]?.progress ?? -1;
        check(
            'decay starts after 300 absent ticks',
            Math.abs(eroding * TURRET_CAPTURE_TICKS - (leanTicks - 1)) < 1e-9,
            `${eroding}`,
        );
        for (let i = 0; i < leanTicks - 1; i += 1) m.step();
        const neutral = m.turretSnapshots[0];
        check(
            'decay returns to neutral and stays ownerless',
            neutral?.progress === 0 && neutral?.owner === -1 && m.turretCaptureLog.length === 0,
            JSON.stringify(neutral),
        );
    }

    // Ownership persists while abandoned (no neutral decay once owned).
    {
        const m = idleMatch(11);
        place(m, 0, T0.x, T0.y);
        for (let i = 0; i < TURRET_CAPTURE_TICKS; i += 1) m.step();
        place(m, 0, 30, 30);
        for (let i = 0; i < 2000; i += 1) m.step();
        const held = m.turretSnapshots[0];
        check(
            'owned turret never decays while abandoned',
            held?.owner === 0 && held?.progress === 1,
            JSON.stringify(held),
        );
    }

    // Recapture: enemy presence pushes the full span, then flips.
    {
        const m = idleMatch(11);
        place(m, 0, T0.x, T0.y);
        for (let i = 0; i < TURRET_CAPTURE_TICKS; i += 1) m.step();
        place(m, 0, 30, 30);
        place(m, 1, T0.x, T0.y);
        for (let i = 0; i < 2 * TURRET_CAPTURE_TICKS - 1; i += 1) m.step();
        const mid = m.turretSnapshots[0];
        check(
            'recapture holds fire for the owner mid-push',
            mid?.owner === 0 && Math.abs((mid?.progress ?? 9) * TURRET_CAPTURE_TICKS - (TURRET_CAPTURE_TICKS - (2 * TURRET_CAPTURE_TICKS - 1))) < 1e-9,
            JSON.stringify(mid),
        );
        m.step(); // enemy edge reaches the opposite pole
        const flipped = m.turretSnapshots[0];
        check('recapture flips at the opposite pole', flipped?.owner === 1 && flipped?.progress === -1);
        check(
            'flip logged and announced',
            m.turretCaptureLog.join(';') === `${TURRET_CAPTURE_TICKS - 1}:0:0;${3 * TURRET_CAPTURE_TICKS - 1}:0:1`,
            m.turretCaptureLog.join(';'),
        );
        m.step();
        check(
            'turret-flipped event names the turret index',
            lastEvents.some((e) => e.kind === 'turret-flipped' && e.fromId === 0),
            JSON.stringify(lastEvents),
        );
    }

    // Combat: nearest enemy in range, fixed interval, exact damage, fromId -1.
    // (Turret rounds move in the stepBullets phase, i.e. the tick after the
    // stepTurrets phase that fires them.)
    {
        const seenFrom = seenEvents.length;
        const m = idleMatch(11);
        place(m, 0, T0.x, T0.y);
        for (let i = 0; i < TURRET_CAPTURE_TICKS; i += 1) m.step();
        place(m, 1, T0.x + 200, T0.y); // 200 units east, inside TURRET_RANGE
        m.step(); // capture tick + 1: cooldown 0 with a target in range
        const first = m.turretSnapshots[0];
        check('turret fires the first tick a target is in range', first?.shotsFired === 1, JSON.stringify(first));
        m.step(); // the fired round travels one stepBullets phase
        const bullet = m.bulletSnapshots[0];
        check(
            'turret round flies at robot bullet speed toward the target',
            bullet !== undefined && bullet.x > T0.x && Math.abs(bullet.y - T0.y) < 1e-9,
            JSON.stringify(bullet),
        );
        for (let i = 0; i < TURRET_FIRE_INTERVAL - 1; i += 1) m.step();
        check('second shot lands exactly one interval later', m.turretSnapshots[0]?.shotsFired === 2);
        for (let i = 0; i < 60; i += 1) m.step();
        const victim = m.robotSnapshots[1];
        check(
            'turret damage is exactly TURRET_DAMAGE per shot',
            (victim?.health ?? -1) === 100 - 2 * TURRET_DAMAGE,
            `health=${victim?.health}`,
        );
        check('turret damage tallied separately', m.turretDamageDealt === 2 * TURRET_DAMAGE);
        check(
            'turret hit reports fromId -1',
            victim?.alive === true &&
                (m.robotSnapshots[1]?.health ?? 0) < 100 &&
                seenEvents.slice(seenFrom).some((e) => e.kind === 'hit-by' && e.fromId === -1),
            JSON.stringify(seenEvents.slice(seenFrom).filter((e) => e.kind === 'hit-by').slice(0, 3)),
        );
        check('no friendly fire on the owning team', (m.robotSnapshots[0]?.health ?? -1) === 100);
    }

    // Targeting: nearest living enemy wins (ties break by robot id).
    {
        const a: RobotController = {
            meta: { id: 'a', name: 'a', author: 'test', version: '0', description: '' },
            update: (): Intent => ({}),
        };
        const m = new Match(
            [
                { team: 0, controller: a },
                { team: 0, controller: idle },
                { team: 1, controller: idle },
                { team: 1, controller: idle },
            ],
            11,
        );
        place(m, 0, T0.x, T0.y);
        for (let i = 0; i < TURRET_CAPTURE_TICKS; i += 1) m.step();
        place(m, 2, T0.x, T0.y - 150); // north, 150 away
        place(m, 3, T0.x + 100, T0.y); // east, 100 away (nearest)
        m.step(); // fires east at robot 3
        m.step(); // the round travels one stepBullets phase
        const bullet = m.bulletSnapshots[0];
        check(
            'turret aims at the nearest enemy',
            bullet !== undefined && bullet.x > T0.x && Math.abs(bullet.y - T0.y) < 1e-9,
            JSON.stringify(bullet),
        );
        check('out-of-range enemies hold fire', (() => {
            const m2 = idleMatch(11);
            place(m2, 0, T0.x, T0.y);
            for (let i = 0; i < TURRET_CAPTURE_TICKS; i += 1) m2.step();
            place(m2, 1, T0.x + TURRET_RANGE + 50, T0.y);
            for (let i = 0; i < 100; i += 1) m2.step();
            return m2.turretSnapshots[0]?.shotsFired === 0;
        })());
    }

    // Barriers: blocks stop turret rounds exactly like robot bullets.
    {
        const setup = (arena: ArenaId): Match => {
            const m = idleMatch(11, arena);
            place(m, 0, T0.x, T0.y);
            for (let i = 0; i < TURRET_CAPTURE_TICKS; i += 1) m.step();
            // West of turret 0 behind the {300,130,90,90} block: in range,
            // but every round dies on the wall.
            place(m, 1, 250, T0.y);
            return m;
        };
        const blocked = setup('blocks');
        for (let i = 0; i < 120; i += 1) blocked.step();
        check(
            'block eats turret rounds (victim unharmed, gun still firing)',
            (blocked.robotSnapshots[1]?.health ?? -1) === 100 &&
                (blocked.turretSnapshots[0]?.shotsFired ?? 0) > 0 &&
                blocked.turretDamageDealt === 0,
            `hp=${blocked.robotSnapshots[1]?.health} shots=${blocked.turretSnapshots[0]?.shotsFired}`,
        );
        const open = setup('open');
        for (let i = 0; i < 120; i += 1) open.step();
        check(
            'same geometry in the open draws blood',
            (open.robotSnapshots[1]?.health ?? 100) < 100 && open.turretDamageDealt > 0,
            `hp=${open.robotSnapshots[1]?.health}`,
        );
    }

    // Determinism: identical seeds agree on the full turret segment.
    {
        const run = (): Match => {
            const m = idleMatch(77);
            place(m, 0, T1.x, T1.y);
            place(m, 1, T1.x + 120, T1.y);
            for (let i = 0; i < 500; i += 1) m.step();
            return m;
        };
        const a = run();
        const b = run();
        check('turret matches are deterministic', fingerprint(a) === fingerprint(b));
        check(
            'fingerprint carries turret state and transitions',
            a.turretCaptureLog.length > 0 && a.turretSnapshots[0]?.shotsFired !== undefined,
            a.turretCaptureLog.join(';'),
        );
    }

    // Capture radius edge: presence counts at exactly TURRET_CAPTURE_RADIUS.
    {
        const m = idleMatch(11);
        place(m, 0, T0.x + TURRET_CAPTURE_RADIUS, T0.y);
        for (let i = 0; i < TURRET_CAPTURE_TICKS; i += 1) m.step();
        check(
            'radius edge still counts as presence',
            m.turretSnapshots[0]?.owner === 0,
            JSON.stringify(m.turretSnapshots[0]),
        );
    }
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

    // Phase 8: every base bot is tunable. Defaults must reproduce create()
    // fingerprints exactly; strong overrides must change behavior.
    const hunterEntry = ROBOTS.find((r) => r.meta.id === 'hunter');
    if (!hunterEntry) throw new Error('hunter missing from registry');
    const paramBots: Array<{
        id: string;
        createDefault: () => RobotController;
        createExplicit: () => RobotController;
        createFromGenome: () => RobotController;
        createWild: () => RobotController;
    }> = [
        {
            id: 'brawler',
            createDefault: () => createBrawlerParams(),
            createExplicit: () => createBrawlerParams({ ...BRAWLER_DEFAULTS }),
            createFromGenome: () => createBrawlerParams(brawlerParamsFromGenome(defaultGenome('brawler') as Genome)),
            createWild: () => createBrawlerParams({ weaveAmp: 0, clinchRange: 300 }),
        },
        {
            id: 'ghost',
            createDefault: () => createGhostParams(),
            createExplicit: () => createGhostParams({ ...GHOST_DEFAULTS }),
            createFromGenome: () => createGhostParams(ghostParamsFromGenome(defaultGenome('ghost') as Genome)),
            createWild: () => createGhostParams({ orbitDir: -1, dodgeRange: 0 }),
        },
        {
            id: 'rusher',
            createDefault: () => createRusherParams(),
            createExplicit: () => createRusherParams({ ...RUSHER_DEFAULTS }),
            createFromGenome: () => createRusherParams(rusherParamsFromGenome(defaultGenome('rusher') as Genome)),
            createWild: () => createRusherParams({ steerGain: 6, aimTol: 0.3, weavePeriod: 6 }),
        },
        {
            id: 'sniper',
            createDefault: () => createSniperParams(),
            createExplicit: () => createSniperParams({ ...SNIPER_DEFAULTS }),
            createFromGenome: () => createSniperParams(sniperParamsFromGenome(defaultGenome('sniper') as Genome)),
            createWild: () => createSniperParams({ anchorXNear: 0.05, kiteRangeFrac: 1 }),
        },
        {
            id: 'turret',
            createDefault: () => createTurretParams(),
            createExplicit: () => createTurretParams({ ...TURRET_DEFAULTS }),
            createFromGenome: () => createTurretParams(turretParamsFromGenome(defaultGenome('turret') as Genome)),
            createWild: () => createTurretParams({ anchorXNear: 0.05, scanTurn: -1 }),
        },
        {
            id: 'wanderer',
            createDefault: () => createWandererParams(),
            createExplicit: () => createWandererParams({ ...WANDERER_DEFAULTS }),
            createFromGenome: () => createWandererParams(wandererParamsFromGenome(defaultGenome('wanderer') as Genome)),
            createWild: () => createWandererParams({ scanTurn: -1, engageThrottle: 1 }),
        },
    ];
    check(
        'all 8 base bots have genome defs',
        ['hunter', 'orbiter', ...paramBots.map((b) => b.id)].every((id) => genomeDefFor(id) !== undefined),
    );
    let allDefaultsMatch = true;
    for (const bot of paramBots) {
        const entry = ROBOTS.find((r) => r.meta.id === bot.id);
        if (!entry) throw new Error(`missing registry entry ${bot.id}`);
        for (const seed of [1, 7, 1234]) {
            for (const arena of arenas) {
                const duel = (mine: RobotController): string => {
                    const m = new Match(
                        [
                            { team: 0, controller: mine, loadout: { ...entry.loadout } },
                            { team: 1, controller: hunterEntry.create(), loadout: { ...hunterEntry.loadout } },
                        ],
                        seed,
                        { arena },
                    );
                    m.runToEnd();
                    return fingerprint(m);
                };
                const ref = duel(entry.create());
                if (duel(bot.createDefault()) !== ref || duel(bot.createExplicit()) !== ref || duel(bot.createFromGenome()) !== ref) {
                    allDefaultsMatch = false;
                }
            }
        }
    }
    check('all param factories match legacy fingerprints at defaults', allDefaultsMatch);
    let allWildDiverge = true;
    for (const bot of paramBots) {
        const entry = ROBOTS.find((r) => r.meta.id === bot.id);
        if (!entry) throw new Error(`missing registry entry ${bot.id}`);
        const duel = (mine: RobotController): string => {
            const m = new Match(
                [
                    { team: 0, controller: mine, loadout: { ...entry.loadout } },
                    { team: 1, controller: hunterEntry.create(), loadout: { ...hunterEntry.loadout } },
                ],
                1234,
                {},
            );
            m.runToEnd();
            return fingerprint(m);
        };
        if (duel(bot.createWild()) === duel(entry.create())) allWildDiverge = false;
    }
    check('new bot params change behavior', allWildDiverge);
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
        const whiskerMatch = new Match(
            [
                { team: 0, controller: probe },
                { team: 1, controller: sitter },
            ],
            3,
            { arena },
        );
        whiskerMatch.step();
        const s = first as unknown as SenseState;
        check(`spawn sense carries every channel (${arena})`, Array.isArray(s.events) && Array.isArray(s.bullets) && Array.isArray(s.tracks) && s.arena !== undefined && s.zone !== undefined && s.grid !== undefined && s.match !== undefined);
        check(`spawn events/bullets/tracks start empty (${arena})`, s.events?.length === 0 && s.bullets?.length === 0 && s.tracks?.length === 0);
        check(`arena reports ${arena} + center`, s.arena?.id === arena && s.arena?.centerX === ARENA_WIDTH / 2 && s.arena?.centerY === ARENA_HEIGHT / 2 && (s.arena?.obstacles.length ?? -1) === ARENA_OBSTACLES[arena].length);
        check(`arena reports this match's own barriers (${arena})`, JSON.stringify(s.arena?.obstacles ?? null) === JSON.stringify(whiskerMatch.obstacles));
        check(`zone opens normal with ${MAX_TICKS} ticks to spare (${arena})`, s.zone?.phase === 'normal' && s.zone?.suddenDeathIn === MAX_TICKS && s.zone?.inside === true && s.zone?.distToSafety === 0);
        check(`grid is 12x8 zeroed (${arena})`, s.grid?.w === SENSE_GRID_W && s.grid?.h === SENSE_GRID_H && s.grid?.cell === SENSE_GRID_CELL && s.grid?.foes.length === 96 && s.grid?.danger.length === 96 && (s.grid?.foes.every((v) => v === 0) ?? false));
        check(`match reports arena + caps (${arena})`, s.match?.arena === arena && s.match?.tickCap === MAX_TICKS_TOTAL && s.match?.killsYou === 0 && s.match?.killsTeam === 0 && s.match?.aliveFoes === 1);
        check(`lastDamage opens null (${arena})`, s.self.lastDamage === null);
        const w0 = whiskerMatch.robotSnapshots[0] as { x: number; y: number; heading: number };
        const ahead = s.self.blocked.ahead as number;
        const px = w0.x + Math.cos(w0.heading) * (ahead + ROBOT_RADIUS);
        const py = w0.y + Math.sin(w0.heading) * (ahead + ROBOT_RADIUS);
        const eps = 1e-6;
        const onWall = Math.abs(px) < eps || Math.abs(px - ARENA_WIDTH) < eps || Math.abs(py) < eps || Math.abs(py - ARENA_HEIGHT) < eps;
        const onBlock = whiskerMatch.obstacles.some((o) => {
            const onV = (Math.abs(px - o.x) < eps || Math.abs(px - (o.x + o.w)) < eps) && py >= o.y - eps && py <= o.y + o.h + eps;
            const onH = (Math.abs(py - o.y) < eps || Math.abs(py - (o.y + o.h)) < eps) && px >= o.x - eps && px <= o.x + o.w + eps;
            return onV || onH;
        });
        check(`spawn whisker ends on a wall or block (${arena})`, ahead > 0 && (onWall || onBlock), `ahead=${ahead} end=(${px.toFixed(1)},${py.toFixed(1)})`);
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
            update: (sense: SenseState): Intent => {
                const foe = sense.foes[0] ?? sense.scout[0] ?? sense.tracks[0];
                if (!foe) return { throttle: 1 };
                const goal = Math.atan2(foe.y - sense.self.y, foe.x - sense.self.x);
                let diff = goal - sense.self.heading;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                return { throttle: 1, turn: Math.max(-1, Math.min(1, diff * 2.5)) };
            },
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
            // Stationary: the bullets (not the drive) are under test, and a
            // parked gunner in the pad-free spawn column never collects the
            // randomized midfield pads, so every sensed round deals exactly
            // base damage. Rounds still fly 470px toward the spy, which
            // senses them closing inside its cone.
            update: (): Intent => ({ throttle: 0, turn: 0, towerTurn: 0, fire: true }),
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
        const runStrafe = (strafe: number, ticks: number): { x0: number; y0: number; h0: number; x1: number; y1: number } => {
            const m = new Match(
                [
                    { team: 0, controller: strafer(strafe) },
                    { team: 1, controller: idleBot('sitter') },
                ],
                3,
            );
            const start = m.robotSnapshots[0] as { x: number; y: number; heading: number };
            for (let i = 0; i < ticks; i += 1) m.step();
            const s = m.robotSnapshots[0] as { x: number; y: number };
            return { x0: start.x, y0: start.y, h0: start.heading, x1: s.x, y1: s.y };
        };
        const south = runStrafe(1, 60);
        const southWant = { x: south.x0 - Math.sin(south.h0) * MAX_SPEED * STRAFE_FACTOR, y: south.y0 + Math.cos(south.h0) * MAX_SPEED * STRAFE_FACTOR };
        check('strafe +1 slides starboard at half speed', Math.abs(south.x1 - southWant.x) < 0.01 && Math.abs(south.y1 - southWant.y) < 0.01, `(${south.x1.toFixed(2)},${south.y1.toFixed(2)})`);
        const north = runStrafe(-1, 60);
        const northWant = { x: north.x0 + Math.sin(north.h0) * MAX_SPEED * STRAFE_FACTOR, y: north.y0 - Math.cos(north.h0) * MAX_SPEED * STRAFE_FACTOR };
        check('strafe -1 slides port symmetrically', Math.abs(north.x1 - northWant.x) < 0.01 && Math.abs(north.y1 - northWant.y) < 0.01, `(${north.x1.toFixed(2)},${north.y1.toFixed(2)})`);
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
        const straightStart = straight.robotSnapshots[0] as { x: number; y: number; heading: number };
        for (let i = 0; i < 180; i += 1) straight.step();
        const diagEnd = diag.robotSnapshots[0] as { x: number; y: number };
        const straightEnd = straight.robotSnapshots[0] as { x: number; y: number };
        const diagAlong = (diagEnd.x - straightStart.x) * Math.cos(straightStart.heading) + (diagEnd.y - straightStart.y) * Math.sin(straightStart.heading);
        const straightAlong = (straightEnd.x - straightStart.x) * Math.cos(straightStart.heading) + (straightEnd.y - straightStart.y) * Math.sin(straightStart.heading);
        check(
            'strafe trades forward pace (never adds it)',
            diagAlong < straightAlong,
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
    const toPoint = (id: string, px: number, py: number): RobotController => ({
        meta: { id, name: id, author: 'test', version: '0', description: '' },
        update: (sense: SenseState): Intent => {
            const dx = px - sense.self.x;
            const dy = py - sense.self.y;
            if (Math.hypot(dx, dy) < 4) return {};
            const want = Math.atan2(dy, dx);
            let diff = (want - sense.self.heading) % (Math.PI * 2);
            if (diff > Math.PI) diff -= Math.PI * 2;
            if (diff < -Math.PI) diff += Math.PI * 2;
            return { throttle: 1, turn: Math.max(-1, Math.min(1, diff * 2)) };
        },
    });
    const toCenter = (id: string): RobotController => toPoint(id, ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
    // Hazard-free (see `noHazards` below): this match measures radio lifetime
    // against the sudden-death clock, and a stationary spammer would
    // otherwise eat mirrored strikes and die mid-game (death=5641 observed).
    const dying = new Match(
        [
            { team: 0, controller: spammer },
            {
                team: 0,
                controller: {
                    meta: { id: 'listener', name: 'Listener', author: 'test', version: '0', description: '' },
                    update: (sense: SenseState): Intent => {
                        deadLog.push({ tick: sense.tick, inbox: sense.inbox.map((m) => ({ kind: m.kind, x: m.x, y: m.y, foe: m.foe, from: m.from, sent: m.sent })) });
                        // Observation post east of center: outside both map
                        // turrets' fire range, so always-on turret fire can
                        // never kill the observer mid-scenario. The mail
                        // assertions below are unchanged.
                        return toPoint('listener', 760, 320).update(sense);
                    },
                },
            },
            { team: 1, controller: toCenter('a') },
            { team: 1, controller: toCenter('b') },
        ],
        11,
        { modifiers: { noHazards: true } },
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
    // Squad role protocol (roles.ts): claim/slot shapes, auction plumbing.
    check('claim builds the right shape', JSON.stringify(castClaim(1, 3)) === JSON.stringify({ kind: 'claim', x: 0, y: 0, foe: -1, role: 1, slot: 0, bid: 3 }));
    check('slot hold builds the right shape', JSON.stringify(castSlotHold(1, 2)) === JSON.stringify({ kind: 'slot', x: 0, y: 0, foe: -1, role: 1, slot: 2, bid: 0 }));
    check('top preference bids highest', preferenceBid(0, 3) === 3 && preferenceBid(2, 3) === 1 && preferenceBid(9, 3) === 1);
    check('hold bonus is positive but below one rank', HOLD_BONUS > 0 && HOLD_BONUS < 1);
    const claimMsg = (from: number, role: number, bid: number): { kind: 'claim'; x: number; y: number; foe: number; role: number; slot: number; bid: number; from: number; sent: number } =>
        ({ kind: 'claim', x: 0, y: 0, foe: -1, role, slot: 0, bid, from, sent: 6 });
    const ballotClaims = collectClaims(
        [claimMsg(1, 0, 3), claimMsg(9, 0, 99), ballot(1, 4)],
        new Set([0, 1]),
        { from: 0, role: 1, bid: 3 },
    );
    check('collectClaims keeps live claims plus own', ballotClaims.length === 2 && ballotClaims.some((c) => c.from === 1 && c.role === 0) && ballotClaims.some((c) => c.from === 0 && c.role === 1));
    check('myRole reads the settled win', myRole([{ from: 0, role: 0, bid: 1 }, { from: 1, role: 0, bid: 9 }, { from: 0, role: 1, bid: 5 }], 0) === 1);
    check('myRole is null on a shutout', myRole([{ from: 1, role: 0, bid: 9 }], 0) === null);
    // Trio auction converges identically from every mate's perspective.
    const trioRole = (self: number): number | null =>
        myRole(collectClaims([0, 1, 2].filter((i) => i !== self).map((i) => claimMsg(i, i, 3)), new Set([0, 1, 2]), { from: self, role: self, bid: 3 }), self);
    check('trio auction converges per mate', trioRole(0) === 0 && trioRole(1) === 1 && trioRole(2) === 2);
    const holdMsg = (from: number, slot: number, sent: number): { kind: 'slot'; x: number; y: number; foe: number; role: number; slot: number; bid: number; from: number; sent: number } =>
        ({ kind: 'slot', x: 0, y: 0, foe: -1, role: 1, slot, bid: 0, from, sent });
    check('fresh slot hold is seen', latestSlotHold([holdMsg(1, 2, 100)], 2, 110)?.from === 1);
    check('stale slot hold frees the slot', latestSlotHold([holdMsg(1, 2, 50)], 2, 110) === null);
    check('other slots are ignored', latestSlotHold([holdMsg(1, 2, 100)], 1, 110) === null);
    const point = roleSlot(ROLE_POINT, 3, 480, 320, 100);
    check('point role takes the north slot', Math.abs(point.x - 480) < 0.001 && Math.abs(point.y - 220) < 0.001);
    // Role behavior: ranking, tracker convergence, death re-resolve, goals.
    check('live team ids sort ascending', JSON.stringify(liveTeamIds(1, [{ id: 2 }, { id: 0 }])) === '[0,1,2]');
    const rankMates = [{ id: 1, x: 300, y: 300 }, { id: 2, x: 100, y: 300 }];
    check('midfield ranking leads with the closest mate', JSON.stringify(rankByMidfield(0, 200, 300, rankMates)) === '[1,0,2]');
    // Three trackers with 6-tick delayed delivery, engine-style (cap 4).
    const trioMates = [
        { id: 0, x: 200, y: 300 },
        { id: 1, x: 300, y: 300 },
        { id: 2, x: 100, y: 300 },
    ];
    const trioTrackers = trioMates.map(() => createRoleTracker());
    const trioInFlight: Array<{ to: number; msg: RoleSense['inbox'][number]; arrive: number }> = [];
    let trioDead = -1;
    const trioStep = (tick: number): Array<number | null> =>
        trioMates.map((mate, i) => {
            if (mate.id === trioDead) return null;
            const inbox = trioInFlight.filter((f) => f.to === mate.id && f.arrive <= tick).map((f) => f.msg).slice(-4);
            const allies = trioMates.filter((m) => m.id !== mate.id && m.id !== trioDead);
            const state = (trioTrackers[i] as ReturnType<typeof createRoleTracker>).update({ tick, self: mate, allies, inbox });
            if (state.radio !== null) {
                for (const other of trioMates) {
                    if (other.id === mate.id || other.id === trioDead) continue;
                    trioInFlight.push({ to: other.id, msg: { ...state.radio, from: mate.id, sent: tick }, arrive: tick + 6 });
                }
            }
            return state.role;
        });
    let trioRoles: Array<number | null> = [null, null, null];
    for (let t = 0; t < 30; t += 1) trioRoles = trioStep(t);
    check('trio trackers converge on distinct roles', JSON.stringify(trioRoles) === '[1,0,2]', `roles=${JSON.stringify(trioRoles)}`);
    // Heartbeats are sparse: settled trackers mostly yield radio to focus votes.
    let holdCount = 0;
    for (let t = 30; t < 66; t += 1) {
        const mate = trioMates[0] as { id: number; x: number; y: number };
        const inbox = trioInFlight.filter((f) => f.to === 0 && f.arrive <= t).map((f) => f.msg).slice(-4);
        const state = (trioTrackers[0] as ReturnType<typeof createRoleTracker>).update({ tick: t, self: mate, allies: trioMates.slice(1), inbox });
        if (state.radio !== null && state.radio.kind === 'slot') holdCount += 1;
        for (const other of trioMates.slice(1)) {
            if (state.radio !== null) trioInFlight.push({ to: other.id, msg: { ...state.radio, from: 0, sent: t }, arrive: t + 6 });
        }
    }
    check('slot heartbeats stay sparse', holdCount >= 2 && holdCount <= 4, `holds=${holdCount}`);
    // Death re-resolve: mate 2 drops; survivors re-settle distinct roles.
    trioDead = 2;
    for (let t = 66; t < 90; t += 1) trioRoles = trioStep(t);
    check('survivors re-resolve distinct roles', trioRoles[0] !== null && trioRoles[1] !== null && trioRoles[0] !== trioRoles[1], `roles=${JSON.stringify(trioRoles)}`);
    const solo = createRoleTracker().update({ tick: 0, self: { id: 0, x: 200, y: 300 }, allies: [], inbox: [] });
    check('tracker idles in 1v1', solo.role === null && solo.radio === null);
    const goalFoe = roleGoal({ self: { id: 0, x: 480, y: 320 }, allies: [], foes: [{ id: 3, x: 600, y: 320, distance: 120 }], inbox: [] }, ROLE_POINT, 3, 170);
    check('slot goal rings the foe', Math.abs(goalFoe.x - 600) < 0.001 && Math.abs(goalFoe.y - 150) < 0.001);
    const goalBlind = roleGoal({ self: { id: 0, x: 400, y: 320 }, allies: [{ id: 1, x: 560, y: 320 }], foes: [], inbox: [] }, 1, 3, 170);
    check('blind slot goal rings the team centroid', Math.abs(goalBlind.x - 627.224) < 0.01 && Math.abs(goalBlind.y - 405) < 0.01);
    const goalVoted = roleGoal(
        {
            self: { id: 0, x: 480, y: 320 },
            allies: [{ id: 1, x: 500, y: 320 }],
            foes: [
                { id: 5, x: 600, y: 320, distance: 120 },
                { id: 7, x: 480, y: 480, distance: 160 },
            ],
            inbox: [ballot(1, 7)],
        },
        ROLE_POINT,
        3,
        170,
    );
    check('slot goal anchors the voted foe', Math.abs(goalVoted.x - 480) < 0.001 && Math.abs(goalVoted.y - 310) < 0.001);
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
    // Hunter trio: two hunters + a listener settle distinct slots live while
    // focus votes keep chaining on the shared radio.
    interface FullMailEntry {
        tick: number;
        inbox: Array<{ kind: string; role: number; slot: number; bid: number; foe: number; from: number; sent: number }>;
    }
    const fullmail = (log: FullMailEntry[]): RobotController => ({
        meta: { id: 'fullmail', name: 'Fullmail', author: 'test', version: '0', description: '' },
        update: (sense: SenseState): Intent => {
            log.push({ tick: sense.tick, inbox: sense.inbox.map((m) => ({ kind: m.kind, role: m.role, slot: m.slot, bid: m.bid, foe: m.foe, from: m.from, sent: m.sent })) });
            return {};
        },
    });
    const trioMailLog: FullMailEntry[] = [];
    const wiredTrio = new Match(
        [
            { team: 0, controller: cleanEntry.create(), loadout: { ...cleanEntry.loadout } },
            { team: 0, controller: cleanEntry.create(), loadout: { ...cleanEntry.loadout } },
            { team: 0, controller: fullmail(trioMailLog) },
            { team: 1, controller: sitter('a') },
            { team: 1, controller: sitter('b') },
            { team: 1, controller: sitter('c') },
        ],
        5,
    );
    for (let i = 0; i < 400 && !wiredTrio.result.over; i += 1) wiredTrio.step();
    const trioMail = trioMailLog.flatMap((e) => e.inbox);
    const trioHolds = trioMail.filter((m) => m.kind === 'slot');
    const trioVotes = trioMail.filter((m) => m.kind === 'focus');
    const heldRoles = new Set(trioHolds.map((m) => m.role));
    check('hunter trio heartbeats distinct slots', trioHolds.length > 0 && heldRoles.size === 2, `holds=${trioHolds.length} roles=${[...heldRoles]}`);
    check('trio focus votes still chain', trioVotes.length > 0, `votes=${trioVotes.length}`);
    // Ablation flag: roles:false sends no claim/slot mail (pre-B3 radio).
    const ablationLog: FullMailEntry[] = [];
    const wiredAblation = new Match(
        [
            { team: 0, controller: createHunterParams({ roles: false }), loadout: { ...cleanEntry.loadout } },
            { team: 0, controller: createHunterParams({ roles: false }), loadout: { ...cleanEntry.loadout } },
            { team: 0, controller: fullmail(ablationLog) },
            { team: 1, controller: sitter('a') },
            { team: 1, controller: sitter('b') },
            { team: 1, controller: sitter('c') },
        ],
        5,
    );
    for (let i = 0; i < 400 && !wiredAblation.result.over; i += 1) wiredAblation.step();
    const ablationMail = ablationLog.flatMap((e) => e.inbox);
    check(
        'roles:false sends no claim/slot mail',
        ablationMail.length > 0 && ablationMail.every((m) => m.kind !== 'claim' && m.kind !== 'slot'),
        `mail=${ablationMail.length}`,
    );
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
    // Factory-pure comparison under a pinned loadout: the brain-vs-legacy
    // interaction with a loadout is balance-eval territory (see eval:rr),
    // while this check guards the Phase 7 factory conversion itself.
    // Hazard-free by design: it reproduces the pre-W1 world this guard was
    // written for, so mirrored-strike noise in 12-game tallies cannot mask
    // (or fake) the conversion signal. Hazard balance is judged by eval:rr
    // degeneracy, not by this unit guard.
    {
        const hunterEntry = ROBOTS.find((r) => r.meta.id === 'hunter');
        if (!hunterEntry) throw new Error('no hunter');
        const pinnedLoadout: SkillLoadout = { charger: 2, marksman: 1, trigger: 2, plating: 1 };
        const foes = ROBOTS.filter((r) => r.meta.id !== 'hunter');
        let regressed: string[] = [];
        for (const foe of foes) {
            const tally = (make: () => RobotController): number => {
                let wins = 0;
                // Pinned to the two symmetric arenas: this guard targets the
                // Phase 7 factory conversion, not new-terrain balance (which
                // the round-robin and balance sweeps cover). New layouts
                // would silently rewrite the 12-game tally this was tuned on.
                for (const arena of ['open', 'blocks'] as const) {
                    for (const seed of [11, 22, 33]) {
                        for (const order of [0, 1]) {
                            const lineups: LineupEntry[] =
                                order === 0
                                    ? [
                                          { team: 0, controller: make(), loadout: { ...pinnedLoadout } },
                                          { team: 1, controller: foe.create(), loadout: { ...foe.loadout } },
                                      ]
                                    : [
                                          { team: 0, controller: foe.create(), loadout: { ...foe.loadout } },
                                          { team: 1, controller: make(), loadout: { ...pinnedLoadout } },
                                      ];
                            const m = new Match(lineups, seed, { arena, modifiers: { noHazards: true } });
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

// --- Leaderboard + showcase manifests (Phase A static board) ---------------
console.log('manifests');
{
    const board = parseOnlineBoard(JSON.parse(readFileSync('public/leaderboard.json', 'utf8')) as unknown);
    check('leaderboard.json parses', board !== null);
    if (board) {
        check('board season matches game version', board.season === board.gameVersion && board.season.length > 0);
        check('board covers the registry', board.entries.length === ROBOTS.length, `${board.entries.length}/${ROBOTS.length}`);
        let boardCodes = 0;
        let boardOk = true;
        for (const entry of board.entries) {
            if (!ROBOTS.some((r) => r.meta.id === entry.botId)) boardOk = false;
            if (entry.showcaseCode !== '') {
                boardCodes += 1;
                if (resimReplay(entry.showcaseCode, entry.botId) === null) boardOk = false;
            }
        }
        check('board showcase codes re-sim to completion', boardOk && boardCodes > 0, `${boardCodes} codes`);
    }
    const manifest = parseShowcaseManifest(JSON.parse(readFileSync('public/data/showcase.json', 'utf8')) as unknown);
    check('showcase.json parses', manifest !== null);
    if (manifest) {
        check('showcase has champions', manifest.champions.length > 0);
        let featured = 0;
        let showcaseOk = true;
        for (const champ of manifest.champions) {
            if (!ROBOTS.some((r) => r.meta.id === champ.botId)) showcaseOk = false;
            if (!ROBOTS.some((r) => r.meta.id === champ.baseBot)) showcaseOk = false;
            if (champ.featuredReplays.length === 0) showcaseOk = false;
            for (const rep of champ.featuredReplays) {
                featured += 1;
                const resim = resimReplay(rep.code, champ.botId);
                if (!resim || resim.outcome !== rep.outcome) showcaseOk = false;
            }
        }
        check('featured codes re-sim to claimed outcomes', showcaseOk && featured > 0, `${featured} codes`);
    }
}

// --- Pinned replay codes: semantic-drift tripwire per format ---------------
console.log('pinned-codes');
{
    // rusher vs turret, seed 4242, open, default builds — one code per
    // format, both describing the same match (winner 1 @ tick 290).
    // Re-pinned for complexity/spawn seeded variation (deterministic
    // re-sim x2; outcome unchanged, spawn geometry moved the end state),
    // then for complexity/barriers (trailing barrier segment; empty on
    // open, sim end state identical).
    // W1 note: the match ends at tick 290, before the first announcement
    // (tick 300), so only the fingerprint format moved (trailing empty
    // hazards segment); the sim behavior is unchanged.
    const pins: Array<{ format: string; code: string; fp: string }> = [
        {
            format: 'RA2',
            code: 'RA2-4000-2290-3860-2200-4328-0091-0',
            fp: 'open|{}|1@290|OVR3 TRG1 PLT2,130,0,0,578.9258332055584,504.4712165470966,2.4838022661497137,-0.6757560931448545,0,60,6,16,0,0,0,0|SRV1 SCN2 TRG2 MRK1,100,1,40,653.9098876986923,440.21522725762117,-2.536764874794541,2.418550658083492,1,132,12,10,0,0,0,0|640.4499522260696,459.11108519103584,0,0|',
        },
        {
            format: 'RA1',
            code: 'RA1.eyJ2IjoxLCJnIjoiMC4xLjAiLCJzIjo0MjQyLCJ0IjoxLCJsIjpbInJ1c2hlciIsInR1cnJldCJdLCJvIjpbIjA6Myw1OjEsODoyIiwiMjoxLDM6Miw1OjIsNjoxIl0sImEiOiJvcGVuIiwibSI6IiJ9',
            fp: 'open|{}|1@290|OVR3 TRG1 PLT2,130,0,0,578.9258332055584,504.4712165470966,2.4838022661497137,-0.6757560931448545,0,60,6,16,0,0,0,0|SRV1 SCN2 TRG2 MRK1,100,1,40,653.9098876986923,440.21522725762117,-2.536764874794541,2.418550658083492,1,132,12,10,0,0,0,0|640.4499522260696,459.11108519103584,0,0|',
        },
    ];
    for (const pin of pins) {
        const data = decodeReplay(pin.code);
        let fp: string | null = null;
        if (data) {
            const lineups: LineupEntry[] = data.lineupIds.map((id, i) => {
                const entry = ROBOTS.find((r) => r.meta.id === id);
                if (!entry) throw new Error(`unknown robot ${id}`);
                return { team: (i < data.teamSize ? 0 : 1) as 0 | 1, controller: entry.create(), loadout: { ...data.loadouts[i]! } };
            });
            const match = new Match(lineups, data.seed, { arena: data.arena ?? 'open', modifiers: data.modifiers ?? {} });
            match.runToEnd();
            fp = fingerprint(match);
        }
        check(`${pin.format} pinned code decodes`, data !== null);
        check(`${pin.format} pinned code re-sims exactly`, fp === pin.fp);
    }
}

// --- Backgrounds: seeded variety is deterministic + actually varied ------
// Render-only contract (art/varied-backgrounds): the menu-hero cover scale
// and the calm arena theme (tonal shift, panel seams, floor lights,
// center-mark variant, edge glow, vignette) are pure functions of explicit
// inputs (no Math.random/Date.now), so replays repaint identically while
// distinct seeds diverge.
console.log('backgrounds');
{
    check('menu hero cover scale fits the 384x288 bake', coverScale(384, 288, 1024, 768) === 8 / 3);
    check('cover scale takes the width-bound max', coverScale(64, 96, 1024, 768) === 16);
    check('cover scale takes the height-bound max', coverScale(256, 96, 1024, 768) === 8);
    check('cover scale guards degenerate dims', coverScale(0, 96, 1024, 768) === 1);
    const themeA = bgThemeForSeed(7);
    const themeB = bgThemeForSeed(7);
    check('same seed themes identically', JSON.stringify(themeA) === JSON.stringify(themeB));
    const seeds = [7, 42, 1234, 777001, 987654];
    const themes = seeds.map((s) => bgThemeForSeed(s));
    const gradients = new Set(themes.map((t) => t.top));
    const marks = new Set(themes.map((t) => t.centerMark));
    const panelLayouts = new Set(themes.map((t) => JSON.stringify(t.panels)));
    const lightLayouts = new Set(themes.map((t) => JSON.stringify(t.lights)));
    const edgeGlows = new Set(themes.map((t) => t.edgeGlow));
    check('distinct seeds vary the tonal shift', gradients.size >= 2, `${gradients.size} gradients`);
    check('distinct seeds vary the center mark', marks.size >= 2, [...marks].join(','));
    check('distinct seeds vary the panel layout', panelLayouts.size >= 2);
    check('distinct seeds vary the light layout', lightLayouts.size >= 2);
    check('distinct seeds vary the edge glow', edgeGlows.size >= 2);
    // Calm-budget guards: sparse, dim, in-bounds.
    let calmOk = true;
    for (const t of themes) {
        if (t.panels.length < 3 || t.panels.length > 6) calmOk = false;
        if (t.lights.length < 3 || t.lights.length > 6) calmOk = false;
        if (t.edgeGlow < 0.1 || t.edgeGlow > 0.22) calmOk = false;
        if (t.vignette < 0.38 || t.vignette > 0.52) calmOk = false;
        for (const p of t.panels) {
            if (p.x < 40 || p.y < 40 || p.x + p.w > 920 || p.y + p.h > 600) calmOk = false;
        }
        for (const l of t.lights) {
            if (l.x < 70 || l.x > 890 || l.y < 70 || l.y > 570) calmOk = false;
        }
    }
    check('calm budget: sparse dim in-bounds panels/lights', calmOk);
    for (const s of seeds) {
        const h = hashSeed01(s);
        check(`seed hash in [0,1) for seed ${s}`, h >= 0 && h < 1);
    }
    check('seed hash deterministic', hashSeed01(1234) === hashSeed01(1234));
}

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
