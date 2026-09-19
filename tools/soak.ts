// Headless verification: determinism, intent clamping, error isolation,
// and bot-vs-bot soak across 1v1 / 2v2 / 3v3. Run with `npm run test:sim`.
// Exits non-zero on any failure.

import { MAX_SPEED, MAX_TICKS } from '../src/sim/constants';
import { DT } from '../src/sim/constants';
import { Match, type LineupEntry } from '../src/sim/engine';
import { decodeReplay, encodeReplay, type ReplaySpec } from '../src/sim/replay';
import { clearHistory, loadHistory, recordMatch, winRates } from '../src/game/history';
import { ROBOTS } from '../src/robots/registry';
import { computeStats, loadoutCost, sanitizeLoadout, type SkillLoadout } from '../src/sim/skills';
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

function runMatch(ids: string[], teams: Array<0 | 1>, seed: number, loadouts?: SkillLoadout[]): Match {
    const lineups: LineupEntry[] = ids.map((id, i) => {
        const entry = ROBOTS.find((r) => r.meta.id === id);
        if (!entry) throw new Error(`unknown robot ${id}`);
        const loadout = loadouts?.[i] ?? entry.loadout;
        return { team: teams[i] as 0 | 1, controller: entry.create(), loadout: { ...loadout } };
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
        [s.code, s.maxHealth, s.alive ? 1 : 0, s.health, s.x, s.y, s.heading, s.tower, s.kills, s.damageDealt, s.shotsFired, s.cooldown, s.charge].join(','),
    );
    const bullets = match.bulletSnapshots.map((b) => [b.x, b.y, b.team].join(',')).join(';');
    return `${match.result.winner}@${match.result.tick}|${snaps.join('|')}|${bullets}`;
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
        update: (): Intent => ({ throttle: 99, turn: -99, towerTurn: 99, fire: true, charge: true }),
    };
    const garbage: RobotController = {
        meta: { id: 'garbage', name: 'Garbage', author: 'test', version: '0', description: '' },
        update: () => ({ throttle: NaN, turn: Infinity, towerTurn: -Infinity, fire: 'yes', charge: 1 }) as unknown as Intent,
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
    let guard = 0;
    while (!match.result.over && guard <= MAX_TICKS + 10) {
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
}

// --- 5. Soak: 1v1 round-robin, 2v2, 3v3 --------------------------------------
console.log('soak');
{
    const ids = ROBOTS.map((r) => r.meta.id);
    const wins = new Map<string, number>(ids.map((id) => [id, 0]));
    let draws = 0;
    let games = 0;
    let totalErrors = 0;
    const seeds = [11, 22, 33];
    for (const a of ids) {
        for (const b of ids) {
            if (a === b) continue;
            for (const seed of seeds) {
                const match = runMatch([a, b], [0, 1], seed);
                games += 1;
                totalErrors += match.robotSnapshots.reduce((sum, s) => sum + s.errors, 0);
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
    check('built-in robots run error-free', totalErrors === 0, `errors=${totalErrors}`);
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

// --- 6. Replay codes: round-trip + same code => identical fingerprint ------
console.log('replay');
{
    const specs: ReplaySpec[] = [
        {
            seed: 4242,
            teamSize: 1,
            lineupIds: ['hunter', 'orbiter'],
            loadouts: [{ overdrive: 2, trigger: 3 }, { plating: 2, charger: 1, wideband: 1 }],
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
                JSON.stringify(back.loadouts) === JSON.stringify(spec.loadouts.map((l) => sanitizeLoadout(l)));
            check(`replay preserves seed+lineups+loadouts (${spec.teamSize}v${spec.teamSize})`, sameSetup);
            const teams = spec.lineupIds.map((_, i) => (i < spec.teamSize ? 0 : 1) as 0 | 1);
            const direct = runMatch(spec.lineupIds, teams, spec.seed, spec.loadouts);
            // Re-run purely from the decoded code, as Watch Replay does.
            const replayed = runMatch(back.lineupIds, teams, back.seed, back.loadouts);
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
    check('truncated code rejected', decodeReplay(valid.slice(0, -4)) === null);
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
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
}

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
