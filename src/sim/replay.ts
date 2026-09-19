// Replay codes: shareable strings that re-run an exact match. A code packs
// the format version, game version, seed, team size, lineup robot ids, and
// per-slot skill loadouts. Same code on the same build => identical sim.
// No Phaser/DOM imports: this module also runs headless in the soak test.

import { sanitizeLoadout, SKILL_DEFS, type SkillLoadout } from './skills';

export const REPLAY_FORMAT = 1;
/** Bump together with package.json. Decoders accept any game string. */
export const GAME_VERSION = '0.1.0';

const PREFIX = 'RA1';
const MAX_CODE_LENGTH = 2048;

export interface ReplaySpec {
    seed: number;
    teamSize: number;
    lineupIds: string[];
    loadouts: SkillLoadout[];
}

export interface ReplayData extends ReplaySpec {
    format: number;
    game: string;
}

// Skill ids compress to SKILL_DEFS catalog indices (order is stable).
function loadoutToCompact(loadout: SkillLoadout): string {
    const parts: string[] = [];
    SKILL_DEFS.forEach((def, index) => {
        const rank = loadout[def.id] ?? 0;
        if (typeof rank === 'number' && rank > 0) parts.push(`${index}:${Math.floor(rank)}`);
    });
    return parts.join(',');
}

function loadoutFromCompact(text: unknown): SkillLoadout {
    if (typeof text !== 'string' || text === '') return {};
    const raw: Record<string, number> = {};
    for (const part of text.split(',')) {
        const [indexText, rankText] = part.split(':');
        const index = Number(indexText);
        const rank = Number(rankText);
        const def = SKILL_DEFS[index];
        if (!Number.isInteger(index) || !Number.isInteger(rank) || !def) throw new Error('bad loadout');
        raw[def.id] = rank;
    }
    return sanitizeLoadout(raw);
}

interface NodeBufferLike {
    from(data: string, encoding: string): { toString(encoding: string): string };
}

function nodeBuffer(): NodeBufferLike | null {
    const candidate = (globalThis as unknown as { Buffer?: NodeBufferLike }).Buffer;
    return candidate ?? null;
}

/** Base64url without padding: safe to paste into chat, URLs, and docs. */
function toB64(text: string): string {
    const buf = nodeBuffer();
    const raw = buf
        ? buf.from(text, 'utf8').toString('base64')
        : btoa(Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join(''));
    return raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64(code: string): string | null {
    if (code.length === 0 || !/^[A-Za-z0-9\-_]*$/.test(code)) return null;
    const padded = code.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (code.length % 4)) % 4);
    try {
        const buf = nodeBuffer();
        if (buf) return buf.from(padded, 'base64').toString('utf8');
        const bin = atob(padded);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    } catch {
        return null;
    }
}

export function encodeReplay(spec: ReplaySpec): string {
    const payload = {
        v: REPLAY_FORMAT,
        g: GAME_VERSION,
        s: spec.seed >>> 0,
        t: spec.teamSize,
        l: spec.lineupIds,
        o: spec.loadouts.map(loadoutToCompact),
    };
    return `${PREFIX}.${toB64(JSON.stringify(payload))}`;
}

export function decodeReplay(code: string): ReplayData | null {
    try {
        if (typeof code !== 'string' || code.length > MAX_CODE_LENGTH) return null;
        const trimmed = code.trim();
        const dot = trimmed.indexOf('.');
        if (dot < 0 || trimmed.slice(0, dot) !== PREFIX) return null;
        const json = fromB64(trimmed.slice(dot + 1));
        if (json === null) return null;
        const raw = JSON.parse(json) as Record<string, unknown>;
        const game = raw['g'];
        const seed = raw['s'];
        const teamSize = raw['t'];
        const lineupIds = raw['l'];
        const loadouts = raw['o'];
        if (raw['v'] !== REPLAY_FORMAT || typeof game !== 'string') return null;
        if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return null;
        if (typeof teamSize !== 'number' || !Number.isInteger(teamSize) || teamSize < 1 || teamSize > 3) return null;
        if (!Array.isArray(lineupIds) || lineupIds.length !== teamSize * 2) return null;
        if (!Array.isArray(loadouts) || loadouts.length !== teamSize * 2) return null;
        for (const id of lineupIds) {
            if (typeof id !== 'string' || id.length === 0 || id.length > 64) return null;
        }
        return {
            format: REPLAY_FORMAT,
            game,
            seed: seed >>> 0,
            teamSize,
            lineupIds: lineupIds as string[],
            loadouts: (loadouts as unknown[]).map(loadoutFromCompact),
        };
    } catch {
        return null;
    }
}
