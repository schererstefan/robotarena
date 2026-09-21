// Eval runner: one job in, one result row out. Wraps the real Match,
// runs it to the end, and reads snapshots exactly once.

import { isExhibition, type ArenaId, type MatchModifiers } from '../../src/sim/constants';
import { Match, type LineupEntry } from '../../src/sim/engine';
import { getRobot } from '../../src/robots/registry';
import { jobKey, type MatchJob } from './schedule';

export interface ParticipantRow {
    bot: string;
    team: 0 | 1;
    damage: number;
    kills: number;
    shots: number;
    survived: boolean;
    errors: number;
}

export interface EvalRow {
    index: number;
    key: string;
    arena: ArenaId;
    teamSize: number;
    teamA: string[];
    teamB: string[];
    seed: number;
    modifiers: MatchModifiers;
    winner: 'A' | 'B' | 'draw';
    ticks: number;
    suddenDeath: boolean;
    draw: boolean;
    errors: number;
    exhibition: boolean;
    participants: ParticipantRow[];
    /** Present when sampled (every Nth job) or on draws. */
    fingerprint?: string;
}

/** Full-precision end state. Any divergence, however small, must show. */
export function fingerprintMatch(match: Match): string {
    const snaps = match.robotSnapshots.map((s) =>
        [s.code, s.maxHealth, s.alive ? 1 : 0, s.health, s.x, s.y, s.heading, s.tower, s.kills, s.damageDealt, s.shotsFired, s.cooldown, s.charge, s.dashCd, s.empCd, s.slowed ? 1 : 0].join(','),
    );
    const bullets = match.bulletSnapshots.map((b) => [b.x, b.y, b.team, b.hot ? 1 : 0].join(',')).join(';');
    const pads = match.pickupLog.join(';');
    return `${match.arenaId}|${JSON.stringify(match.modifiers)}|${match.result.winner}@${match.result.tick}|${snaps.join('|')}|${bullets}|${pads}`;
}

export function runJob(job: MatchJob): EvalRow {
    const ids = [...job.teamA, ...job.teamB];
    const lineups: LineupEntry[] = ids.map((id, i) => {
        const entry = getRobot(id);
        if (!entry) throw new Error(`unknown robot ${id}`);
        return { team: (i < job.teamA.length ? 0 : 1) as 0 | 1, controller: entry.create(), loadout: { ...entry.loadout } };
    });
    const match = new Match(lineups, job.seed, { arena: job.arena, modifiers: job.modifiers });
    match.runToEnd();
    // Single snapshot read: everything below derives from these two arrays.
    const snaps = match.robotSnapshots;
    const result = match.result;
    const winner = result.winner === 0 ? 'A' : result.winner === 1 ? 'B' : 'draw';
    const fingerprint = fingerprintMatch(match);
    return {
        index: job.index,
        key: jobKey(job),
        arena: job.arena,
        teamSize: job.teamSize,
        teamA: [...job.teamA],
        teamB: [...job.teamB],
        seed: job.seed,
        modifiers: { ...job.modifiers },
        winner,
        ticks: result.tick,
        suddenDeath: result.suddenDeath,
        draw: winner === 'draw',
        errors: snaps.reduce((sum, s) => sum + s.errors, 0),
        exhibition: isExhibition(job.modifiers),
        participants: snaps.map((s, i) => ({
            bot: ids[i] as string,
            team: (i < job.teamA.length ? 0 : 1) as 0 | 1,
            damage: s.damageDealt,
            kills: s.kills,
            shots: s.shotsFired,
            survived: s.alive,
            errors: s.errors,
        })),
        ...(job.sample || winner === 'draw' ? { fingerprint } : {}),
    };
}
