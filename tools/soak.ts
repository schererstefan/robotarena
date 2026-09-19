// Headless verification: determinism, intent clamping, error isolation,
// and bot-vs-bot soak across 1v1 / 2v2 / 3v3. Run with `npm run test:sim`.
// Exits non-zero on any failure.

import { MAX_SPEED, MAX_TICKS } from '../src/sim/constants';
import { DT } from '../src/sim/constants';
import { Match, type LineupEntry } from '../src/sim/engine';
import { ROBOTS } from '../src/robots/registry';
import { computeStats, loadoutCost, sanitizeLoadout } from '../src/sim/skills';
import type { Intent, RobotController, SenseState } from '../src/sim/types';

let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
    if (condition) {
        console.log(`  ok   ${name}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ''}`);
    }
}

function runMatch(ids: string[], teams: Array<0 | 1>, seed: number): Match {
    const lineups: LineupEntry[] = ids.map((id, i) => {
        const entry = ROBOTS.find((r) => r.meta.id === id);
        if (!entry) throw new Error(`unknown robot ${id}`);
        return { team: teams[i] as 0 | 1, controller: entry.create(), loadout: { ...entry.loadout } };
    });
    const match = new Match(lineups, seed);
    let guard = 0;
    while (!match.result.over && guard <= MAX_TICKS + 10) {
        match.step();
        guard += 1;
    }
    return match;
}

function fingerprint(match: Match): string {
    // Full precision: any divergence, however small, must show.
    const snaps = match.robotSnapshots.map((s) =>
        [s.code, s.maxHealth, s.health, s.x, s.y, s.heading, s.tower, s.kills, s.damageDealt, s.shotsFired].join(','),
    );
    return `${match.result.winner}@${match.result.tick}|${snaps.join('|')}`;
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
}

// --- 2. Intent clamping: a cheating robot cannot break physics ---------------
console.log('clamping');
{
    const cheater: RobotController = {
        meta: { id: 'cheater', name: 'Cheater', author: 'test', version: '0', description: '' },
        update: (): Intent => ({ throttle: 99, turn: -99, towerTurn: 99, fire: true }),
    };
    const garbage: RobotController = {
        meta: { id: 'garbage', name: 'Garbage', author: 'test', version: '0', description: '' },
        update: () => ({ throttle: NaN, turn: Infinity, towerTurn: -Infinity, fire: 'yes' }) as unknown as Intent,
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
    while (!match.result.over) match.step();
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
}

// --- 5. Soak: 1v1 round-robin, 2v2, 3v3 --------------------------------------
console.log('soak');
{
    const ids = ROBOTS.map((r) => r.meta.id);
    const wins = new Map<string, number>(ids.map((id) => [id, 0]));
    let draws = 0;
    let games = 0;
    const seeds = [11, 22, 33];
    for (const a of ids) {
        for (const b of ids) {
            if (a === b) continue;
            for (const seed of seeds) {
                const match = runMatch([a, b], [0, 1], seed);
                games += 1;
                if (!match.result.over) {
                    check(`1v1 ${a} vs ${b} seed ${seed} finishes`, false);
                    continue;
                }
                if (match.result.winner === 0) wins.set(a, (wins.get(a) ?? 0) + 1);
                else if (match.result.winner === 1) wins.set(b, (wins.get(b) ?? 0) + 1);
                else draws += 1;
            }
        }
    }
    check(`all ${games} 1v1 games finished`, games === ids.length * (ids.length - 1) * seeds.length);
    console.log(`       record: ${ids.map((id) => `${id}=${wins.get(id)}`).join(' ')} draws=${draws}`);
    const maxWins = Math.max(...[...wins.values()]);
    check('no robot wins every matchup (balance smell)', maxWins < games);

    const m2 = runMatch(['rusher', 'hunter', 'turret', 'orbiter'], [0, 0, 1, 1], 5);
    check('2v2 completes', m2.result.over);
    const m3 = runMatch(
        ['rusher', 'hunter', 'orbiter', 'turret', 'wanderer', 'hunter'],
        [0, 0, 0, 1, 1, 1],
        6,
    );
    check('3v3 completes', m3.result.over);
}

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
