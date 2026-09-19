// Headless verification: determinism, intent clamping, error isolation,
// and bot-vs-bot soak across 1v1 / 2v2 / 3v3. Run with `npm run test:sim`.
// Exits non-zero on any failure.

import { ARENA_HEIGHT, ARENA_IDS, ARENA_OBSTACLES, ARENA_WIDTH, MAX_SPEED, MAX_TICKS, ROBOT_RADIUS, type ArenaId } from '../src/sim/constants';
import { DT } from '../src/sim/constants';
import { Match, type LineupEntry, type RobotSnapshot } from '../src/sim/engine';
import { decodeReplay, encodeReplay, type ReplaySpec } from '../src/sim/replay';
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
import { computeStats, loadoutCost, sanitizeLoadout, type SkillLoadout } from '../src/sim/skills';
import type { Intent, RobotController, SenseState } from '../src/sim/types';
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

function runMatch(ids: string[], teams: Array<0 | 1>, seed: number, loadouts?: SkillLoadout[], arena: ArenaId = 'open'): Match {
    const lineups: LineupEntry[] = ids.map((id, i) => {
        const entry = ROBOTS.find((r) => r.meta.id === id);
        if (!entry) throw new Error(`unknown robot ${id}`);
        const loadout = loadouts?.[i] ?? entry.loadout;
        return { team: teams[i] as 0 | 1, controller: entry.create(), loadout: { ...loadout } };
    });
    const match = new Match(lineups, seed, { arena });
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
    const bullets = match.bulletSnapshots.map((b) => [b.x, b.y, b.team, b.hot ? 1 : 0].join(',')).join(';');
    return `${match.arenaId}|${match.result.winner}@${match.result.tick}|${snaps.join('|')}|${bullets}`;
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

// --- 5. Soak: 1v1 round-robin, 2v2, 3v3 (every arena) -----------------------
console.log('soak');
{
    const ids = ROBOTS.map((r) => r.meta.id);
    const seeds = [11, 22, 33];
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
                back.arena === (spec.arena ?? 'open');
            check(`replay preserves seed+lineups+loadouts+arena (${spec.teamSize}v${spec.teamSize})`, sameSetup);
            const teams = spec.lineupIds.map((_, i) => (i < spec.teamSize ? 0 : 1) as 0 | 1);
            const direct = runMatch(spec.lineupIds, teams, spec.seed, spec.loadouts, spec.arena ?? 'open');
            // Re-run purely from the decoded code, as Watch Replay does.
            const replayed = runMatch(back.lineupIds, teams, back.seed, back.loadouts, back.arena ?? 'open');
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
    {
        // Tamper the arena field inside an otherwise valid code.
        const payload = valid.slice(valid.indexOf('.') + 1);
        const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        const tampered = `RA1.${Buffer.from(json.replace('"blocks"', '"void"'), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
        check('bad arena rejected', decodeReplay(tampered) === null);
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
