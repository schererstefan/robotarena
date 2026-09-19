// Replay codes: shareable strings that re-run an exact match. A code packs
// the format version, seed, team size, lineup robot ids, per-slot skill
// loadouts, arena, and modifiers. Same code on the same build => identical
// sim. No Phaser/DOM imports: this module also runs headless in the soak test.
//
// Two formats: compact `RA2-XXXX-XXXX…` (bit-packed Crockford base32 with a
// checksum, used whenever the lineup only uses registry robots) and legacy
// `RA1.<base64url JSON>` (fallback for custom robots + old codes). The
// decoder accepts both.

import { ROBOTS } from '../robots/registry';
import { sanitizeLoadout, SKILL_DEFS, type SkillLoadout } from './skills';
import { sanitizeModifiers, type ArenaId, type MatchModifiers } from './constants';

export const REPLAY_FORMAT = 1;
export const REPLAY_FORMAT_COMPACT = 2;
/** Bump together with package.json. Decoders accept any game string. */
export const GAME_VERSION = '0.1.0';

const PREFIX = 'RA1';
const COMPACT_PREFIX = 'RA2';
const MAX_CODE_LENGTH = 2048;

export interface ReplaySpec {
    seed: number;
    teamSize: number;
    lineupIds: string[];
    loadouts: SkillLoadout[];
    /** Arena layout. Defaults to `open`; older codes without it decode as `open`. */
    arena?: ArenaId;
    /** Exhibition modifiers. Defaults to none; older codes decode as none. */
    modifiers?: MatchModifiers;
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

/** Modifiers compress to flag letters: d = double damage, f = fog, m = mirror. */
function modifiersToCompact(modifiers: MatchModifiers): string {
    const clean = sanitizeModifiers(modifiers);
    return `${clean.doubleDamage === true ? 'd' : ''}${clean.hardcoreFog === true ? 'f' : ''}${clean.mirror === true ? 'm' : ''}`;
}

function modifiersFromCompact(text: unknown): MatchModifiers {
    if (typeof text !== 'string' || !/^[dfm]*$/.test(text)) throw new Error('bad modifiers');
    return sanitizeModifiers({
        doubleDamage: text.includes('d'),
        hardcoreFog: text.includes('f'),
        mirror: text.includes('m'),
    });
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

/** Legacy `RA1.` encoder, kept for custom-robot lineups and old-code compat. */
export function encodeReplayLegacy(spec: ReplaySpec): string {
    const payload = {
        v: REPLAY_FORMAT,
        g: GAME_VERSION,
        s: spec.seed >>> 0,
        t: spec.teamSize,
        l: spec.lineupIds,
        o: spec.loadouts.map(loadoutToCompact),
        a: spec.arena ?? 'open',
        m: modifiersToCompact(spec.modifiers ?? {}),
    };
    return `${PREFIX}.${toB64(JSON.stringify(payload))}`;
}

function decodeLegacy(trimmed: string): ReplayData | null {
    try {
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
        const arena = raw['a'];
        const modifiers = raw['m'];
        if (raw['v'] !== REPLAY_FORMAT || typeof game !== 'string') return null;
        if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return null;
        if (typeof teamSize !== 'number' || !Number.isInteger(teamSize) || teamSize < 1 || teamSize > 3) return null;
        if (!Array.isArray(lineupIds) || lineupIds.length !== teamSize * 2) return null;
        if (!Array.isArray(loadouts) || loadouts.length !== teamSize * 2) return null;
        if (arena !== undefined && arena !== 'open' && arena !== 'blocks') return null;
        if (modifiers !== undefined && (typeof modifiers !== 'string' || !/^[dfm]*$/.test(modifiers))) return null;
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
            arena: (arena ?? 'open') as ArenaId,
            modifiers: modifiersFromCompact(modifiers ?? ''),
        };
    } catch {
        return null;
    }
}

// --- Compact RA2 format ------------------------------------------------------
// Bit layout (MSB first): version:4, seed:32, teamSize-1:2, arena:2,
// modifiers(dfm):3, skillCount:4, then per slot robotIndex:5 + skillCount x
// rank:2, then a 12-bit FNV-1a checksum. Registry order and SKILL_DEFS order
// are the code's dictionary, so both must only ever be appended to.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CHECKSUM_BITS = 12;

function writeBits(out: number[], value: number, count: number): void {
    for (let i = count - 1; i >= 0; i -= 1) out.push((value >>> i) & 1);
}

function robotIndex(id: string): number | null {
    const index = ROBOTS.findIndex((entry) => entry.meta.id === id);
    return index >= 0 && index < 32 ? index : null;
}

/** FNV-1a over the payload bits (packed MSB-first), folded to 12 bits. */
function checksum12(bits: number[]): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < bits.length; i += 8) {
        let byte = 0;
        for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits[i + j] ?? 0);
        hash ^= byte;
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return (hash ^ (hash >>> 12) ^ (hash >>> 24)) & 0xfff;
}

function bitsToCrockford(bits: number[]): string {
    let body = '';
    for (let i = 0; i < bits.length; i += 5) {
        let value = 0;
        for (let j = 0; j < 5; j += 1) value = (value << 1) | (bits[i + j] ?? 0);
        body += CROCKFORD[value] as string;
    }
    return body;
}

function chunk4(body: string): string {
    return (body.match(/.{1,4}/g) ?? []).join('-');
}

/** Compact encoder. Returns null when the spec needs the legacy fallback. */
export function encodeReplayCompact(spec: ReplaySpec): string | null {
    if (!Number.isInteger(spec.teamSize) || spec.teamSize < 1 || spec.teamSize > 3) return null;
    if (!Array.isArray(spec.lineupIds) || spec.lineupIds.length !== spec.teamSize * 2) return null;
    if (!Array.isArray(spec.loadouts) || spec.loadouts.length !== spec.teamSize * 2) return null;
    if (SKILL_DEFS.length > 15) return null;
    const arena = spec.arena ?? 'open';
    if (arena !== 'open' && arena !== 'blocks') return null;
    const indices: number[] = [];
    for (const id of spec.lineupIds) {
        const index = robotIndex(id);
        if (index === null) return null;
        indices.push(index);
    }
    const mods = sanitizeModifiers(spec.modifiers ?? {});
    const bits: number[] = [];
    writeBits(bits, REPLAY_FORMAT_COMPACT, 4);
    writeBits(bits, spec.seed >>> 0, 32);
    writeBits(bits, spec.teamSize - 1, 2);
    writeBits(bits, arena === 'blocks' ? 1 : 0, 2);
    writeBits(
        bits,
        (mods.doubleDamage === true ? 1 : 0) | (mods.hardcoreFog === true ? 2 : 0) | (mods.mirror === true ? 4 : 0),
        3,
    );
    writeBits(bits, SKILL_DEFS.length, 4);
    spec.loadouts.forEach((loadout, slot) => {
        writeBits(bits, indices[slot] as number, 5);
        const clean = sanitizeLoadout(loadout ?? {});
        for (const def of SKILL_DEFS) {
            const rank = clean[def.id] ?? 0;
            writeBits(bits, typeof rank === 'number' ? Math.max(0, Math.min(3, Math.floor(rank))) : 0, 2);
        }
    });
    writeBits(bits, checksum12(bits), CHECKSUM_BITS);
    return `${COMPACT_PREFIX}-${chunk4(bitsToCrockford(bits))}`;
}

function crockfordToBits(body: string): number[] | null {
    const bits: number[] = [];
    for (const raw of body) {
        // Forgiving input: Crockford aliases + lowercase.
        const char = raw === 'I' || raw === 'L' || raw === 'i' || raw === 'l' ? '1' : raw === 'O' || raw === 'o' ? '0' : raw.toUpperCase();
        const value = CROCKFORD.indexOf(char);
        if (value < 0) return null;
        writeBits(bits, value, 5);
    }
    return bits;
}

function decodeCompact(trimmed: string): ReplayData | null {
    const body = trimmed.slice(COMPACT_PREFIX.length).replace(/[\s-]/g, '');
    if (body.length === 0 || body.length > 128) return null;
    const bits = crockfordToBits(body);
    if (!bits) return null;
    let cursor = 0;
    const read = (count: number): number => {
        let value = 0;
        for (let i = 0; i < count; i += 1) value = (value << 1) | (bits[cursor + i] ?? 0);
        cursor += count;
        return value;
    };
    if (read(4) !== REPLAY_FORMAT_COMPACT) return null;
    const seed = read(32) >>> 0;
    const teamSize = read(2) + 1;
    const arenaCode = read(2);
    const modBits = read(3);
    const skillCount = read(4);
    if (teamSize < 1 || teamSize > 3 || arenaCode > 1 || skillCount > SKILL_DEFS.length) return null;
    const slots = teamSize * 2;
    const expected = 4 + 32 + 2 + 2 + 3 + 4 + slots * (5 + skillCount * 2) + CHECKSUM_BITS;
    // Base32 body must match the exact bit length (plus <5 zero pad bits).
    if (bits.length < expected || bits.length >= expected + 5) return null;
    for (let i = expected; i < bits.length; i += 1) {
        if (bits[i] !== 0) return null;
    }
    const lineupIds: string[] = [];
    const loadouts: SkillLoadout[] = [];
    for (let s = 0; s < slots; s += 1) {
        const index = read(5);
        const entry = ROBOTS[index];
        if (!entry) return null;
        lineupIds.push(entry.meta.id);
        const raw: Record<string, number> = {};
        for (let k = 0; k < skillCount; k += 1) {
            const rank = read(2);
            const def = SKILL_DEFS[k];
            if (def && rank > 0) raw[def.id] = rank;
        }
        loadouts.push(sanitizeLoadout(raw));
    }
    const checksum = read(CHECKSUM_BITS);
    if (checksum12(bits.slice(0, expected - CHECKSUM_BITS)) !== checksum) return null;
    return {
        format: REPLAY_FORMAT_COMPACT,
        game: GAME_VERSION,
        seed,
        teamSize,
        lineupIds,
        loadouts,
        arena: (arenaCode === 1 ? 'blocks' : 'open') as ArenaId,
        modifiers: sanitizeModifiers({
            doubleDamage: (modBits & 1) !== 0,
            hardcoreFog: (modBits & 2) !== 0,
            mirror: (modBits & 4) !== 0,
        }),
    };
}

/** Compact `RA2-…` when possible, legacy `RA1.…` for custom-robot lineups. */
export function encodeReplay(spec: ReplaySpec): string {
    return encodeReplayCompact(spec) ?? encodeReplayLegacy(spec);
}

export function decodeReplay(code: string): ReplayData | null {
    if (typeof code !== 'string' || code.length > MAX_CODE_LENGTH) return null;
    const trimmed = code.trim();
    if (trimmed.startsWith(`${PREFIX}.`)) return decodeLegacy(trimmed);
    if (trimmed.length > COMPACT_PREFIX.length && trimmed.slice(0, COMPACT_PREFIX.length).toUpperCase() === COMPACT_PREFIX) {
        return decodeCompact(trimmed);
    }
    return null;
}
