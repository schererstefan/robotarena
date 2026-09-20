// Unified genome schema v1 (hillclimb plan §1.4): one flat-dict container for
// behavior params plus the loadout chromosome. Hillclimb's behavior slice is
// `params` minus loadout; the loadout gene always flows through the real
// `sanitizeLoadout`. Headless- and browser-safe: no node imports (sha256 is
// implemented below in plain TypeScript).

import { sanitizeLoadout, SKILL_BUDGET, type SkillLoadout } from '../sim/skills';

export const GENOME_VERSION = 1 as const;

export interface FloatParamDef {
    type: 'float';
    min: number;
    max: number;
    default: number;
}

export interface IntParamDef {
    type: 'int';
    min: number;
    max: number;
    default: number;
}

export interface EnumParamDef {
    type: 'enum';
    values: ReadonlyArray<string | number>;
    default: string | number;
}

export interface LoadoutParamDef {
    type: 'loadout';
    budget: number;
    default: SkillLoadout;
}

export type ParamDef = FloatParamDef | IntParamDef | EnumParamDef | LoadoutParamDef;
export type ParamValue = number | string | SkillLoadout;

export interface GenomeDef {
    genome_version: 1;
    bot: string;
    params: Record<string, ParamDef>;
}

export interface Genome {
    genome_version: 1;
    bot: string;
    params: Record<string, ParamValue>;
}

/**
 * Tunable ranges per bot. Defaults reproduce each bot's legacy behavior
 * exactly (soak checks default-params fingerprints against `create()`).
 * Groups: steer.* turret.* fire.* drive.* engage.* orbit.* weave.* anchor.*
 * kite.* dodge.* dash.* target.* search.* brain.* plus the loadout chromosome.
 */
export const PARAM_RANGES: Record<string, Record<string, ParamDef>> = {
    hunter: {
        'steer.gain': { type: 'float', min: 1, max: 6, default: 2.5 },
        'turret.gain': { type: 'float', min: 1, max: 6, default: 3 },
        'fire.aimTol': { type: 'float', min: 0.01, max: 0.3, default: 0.05 },
        'fire.bankRangeFrac': { type: 'float', min: 0.3, max: 1, default: 0.7 },
        'engage.closeRangeFrac': { type: 'float', min: 0.2, max: 1, default: 0.55 },
        'drive.closeThrottle': { type: 'float', min: 0, max: 1, default: 0.35 },
        'target.policy': { type: 'enum', values: ['first', 'nearest', 'weakest', 'strongest'], default: 'weakest' },
        'search.scanTurn': { type: 'float', min: -1, max: 1, default: 0.9 },
        'brain.retreatHp': { type: 'float', min: 0.1, max: 0.6, default: 0.3 },
        'brain.kiteRange': { type: 'float', min: 100, max: 350, default: 200 },
        'brain.flankRange': { type: 'float', min: 250, max: 500, default: 350 },
        'brain.stayBonus': { type: 'float', min: 0, max: 0.5, default: 0.15 },
        'brain.aggression': { type: 'float', min: 0, max: 2, default: 1 },
        'brain.focusBonus': { type: 'float', min: 0, max: 1, default: 0.3 },
        'brain.orbitDir': { type: 'enum', values: [-1, 1], default: 1 },
        loadout: { type: 'loadout', budget: SKILL_BUDGET, default: { overdrive: 2, trigger: 2, plating: 2 } },
    },
    orbiter: {
        'orbit.range': { type: 'float', min: 150, max: 500, default: 330 },
        'orbit.dir': { type: 'enum', values: [-1, 1], default: 1 },
        'orbit.band': { type: 'float', min: 10, max: 150, default: 60 },
        'drive.alignTol': { type: 'float', min: 0.2, max: 2.5, default: 1.2 },
        'drive.orbitThrottle': { type: 'float', min: 0, max: 1, default: 0.9 },
        'drive.turnThrottle': { type: 'float', min: 0, max: 1, default: 0.3 },
        'steer.gain': { type: 'float', min: 1, max: 6, default: 2.5 },
        'turret.gain': { type: 'float', min: 1, max: 6, default: 4 },
        'fire.aimTol': { type: 'float', min: 0.01, max: 0.3, default: 0.07 },
        'target.policy': { type: 'enum', values: ['first', 'nearest', 'weakest', 'strongest'], default: 'first' },
        'search.scanTurn': { type: 'float', min: -1, max: 1, default: 0.8 },
        loadout: { type: 'loadout', budget: SKILL_BUDGET, default: { overdrive: 2, servos: 1, trigger: 2, plating: 1 } },
    },
    rusher: {
        'steer.gain': { type: 'float', min: 1, max: 6, default: 2.5 },
        'turret.gain': { type: 'float', min: 1, max: 6, default: 3 },
        'fire.aimTol': { type: 'float', min: 0.01, max: 0.3, default: 0.11 },
        'engage.weaveRange': { type: 'float', min: 0, max: 500, default: 200 },
        'weave.amp': { type: 'float', min: 0, max: 1.2, default: 0.5 },
        'weave.period': { type: 'float', min: 6, max: 40, default: 18 },
        'search.scanRate': { type: 'float', min: 0.5, max: 6, default: 2.4 },
        'target.policy': { type: 'enum', values: ['first', 'nearest', 'weakest', 'strongest'], default: 'first' },
        loadout: { type: 'loadout', budget: SKILL_BUDGET, default: { overdrive: 1, longscan: 1, trigger: 2, plating: 2 } },
    },
    brawler: {
        'steer.gain': { type: 'float', min: 1, max: 6, default: 2.5 },
        'turret.gain': { type: 'float', min: 1, max: 6, default: 3 },
        'fire.aimTol': { type: 'float', min: 0.01, max: 0.3, default: 0.07 },
        'engage.weaveRange': { type: 'float', min: 0, max: 500, default: 160 },
        'weave.amp': { type: 'float', min: 0, max: 1.2, default: 0.45 },
        'weave.period': { type: 'float', min: 6, max: 40, default: 14 },
        'engage.clinchRange': { type: 'float', min: 40, max: 300, default: 120 },
        'drive.clinchThrottle': { type: 'float', min: 0, max: 1, default: 1 },
        'drive.faceTol': { type: 'float', min: 0.1, max: 1.5, default: 0.5 },
        'dash.minRange': { type: 'float', min: 0, max: 400, default: 200 },
        'dash.maxRange': { type: 'float', min: 200, max: 800, default: 520 },
        'search.scanTurn': { type: 'float', min: -1, max: 1, default: 0.9 },
        'target.policy': { type: 'enum', values: ['first', 'nearest', 'weakest', 'strongest'], default: 'first' },
        loadout: { type: 'loadout', budget: SKILL_BUDGET, default: { overdrive: 1, gyro: 1, trigger: 2, plating: 2 } },
    },
    sniper: {
        'anchor.xNear': { type: 'float', min: 0.05, max: 0.45, default: 0.24 },
        'anchor.xFar': { type: 'float', min: 0.55, max: 0.95, default: 0.76 },
        'anchor.yNear': { type: 'float', min: 0.05, max: 0.45, default: 0.28 },
        'anchor.yFar': { type: 'float', min: 0.55, max: 0.95, default: 0.72 },
        'anchor.settle': { type: 'float', min: 8, max: 80, default: 24 },
        'anchor.leave': { type: 'float', min: 30, max: 200, default: 80 },
        'kite.rangeFrac': { type: 'float', min: 0.2, max: 1, default: 0.5 },
        'drive.anchorThrottle': { type: 'float', min: 0.2, max: 1, default: 0.8 },
        'steer.idleGain': { type: 'float', min: 0.5, max: 6, default: 1.5 },
        'steer.driveGain': { type: 'float', min: 1, max: 6, default: 2.5 },
        'search.scanTurn': { type: 'float', min: -1, max: 1, default: 0.5 },
        'fire.aimTol': { type: 'float', min: 0.01, max: 0.3, default: 0.05 },
        'fire.bankRangeFrac': { type: 'float', min: 0.3, max: 1, default: 0.75 },
        'turret.gain': { type: 'float', min: 1, max: 6, default: 3 },
        'target.policy': { type: 'enum', values: ['first', 'nearest', 'weakest', 'strongest'], default: 'first' },
        loadout: { type: 'loadout', budget: SKILL_BUDGET, default: { longscan: 2, marksman: 1, charger: 1, deadeye: 1, trigger: 1 } },
    },
    turret: {
        'anchor.xNear': { type: 'float', min: 0.05, max: 0.45, default: 0.32 },
        'anchor.xFar': { type: 'float', min: 0.55, max: 0.95, default: 0.68 },
        'anchor.yNear': { type: 'float', min: 0.05, max: 0.45, default: 0.3 },
        'anchor.yFar': { type: 'float', min: 0.55, max: 0.95, default: 0.7 },
        'anchor.settle': { type: 'float', min: 8, max: 80, default: 24 },
        'anchor.leave': { type: 'float', min: 30, max: 200, default: 60 },
        'drive.anchorThrottle': { type: 'float', min: 0.2, max: 1, default: 0.8 },
        'steer.driveGain': { type: 'float', min: 1, max: 6, default: 2.5 },
        'steer.parkGain': { type: 'float', min: 0.5, max: 6, default: 1.5 },
        'search.scanTurn': { type: 'float', min: -1, max: 1, default: 0.85 },
        'fire.aimTol': { type: 'float', min: 0.01, max: 0.3, default: 0.05 },
        'turret.gain': { type: 'float', min: 1, max: 6, default: 3 },
        'target.policy': { type: 'enum', values: ['first', 'nearest', 'weakest', 'strongest'], default: 'first' },
        loadout: { type: 'loadout', budget: SKILL_BUDGET, default: { marksman: 1, trigger: 2, longscan: 2, servos: 1 } },
    },
    wanderer: {
        'steer.gain': { type: 'float', min: 1, max: 6, default: 2.5 },
        'turret.gain': { type: 'float', min: 1, max: 6, default: 3 },
        'fire.aimTol': { type: 'float', min: 0.01, max: 0.3, default: 0.07 },
        'search.margin': { type: 'float', min: 10, max: 150, default: 60 },
        'search.arrive': { type: 'float', min: 10, max: 150, default: 50 },
        'search.wallDist': { type: 'float', min: 20, max: 200, default: 70 },
        'search.wallRetick': { type: 'int', min: 5, max: 120, default: 30 },
        'drive.engageThrottle': { type: 'float', min: 0, max: 1, default: 0.5 },
        'search.scanTurn': { type: 'float', min: -1, max: 1, default: 1 },
        'target.policy': { type: 'enum', values: ['first', 'nearest', 'weakest', 'strongest'], default: 'first' },
        loadout: { type: 'loadout', budget: SKILL_BUDGET, default: { overdrive: 2, longscan: 1, wideband: 1, trigger: 1, plating: 1 } },
    },
    ghost: {
        'steer.gain': { type: 'float', min: 1, max: 6, default: 2.5 },
        'turret.gain': { type: 'float', min: 1, max: 6, default: 3 },
        'fire.aimTol': { type: 'float', min: 0.01, max: 0.3, default: 0.07 },
        'orbit.dir': { type: 'enum', values: [-1, 1], default: 1 },
        'engage.rangeFrac': { type: 'float', min: 0.4, max: 1, default: 0.85 },
        'orbit.tangentFrac': { type: 'float', min: 0.2, max: 1, default: 0.7 },
        'orbit.fleeFrac': { type: 'float', min: 0.1, max: 0.9, default: 0.45 },
        'dodge.range': { type: 'float', min: 0, max: 400, default: 170 },
        'dodge.clearance': { type: 'float', min: 0, max: 200, default: 50 },
        'drive.alignTol': { type: 'float', min: 0.2, max: 2.5, default: 1.1 },
        'drive.orbitThrottle': { type: 'float', min: 0, max: 1, default: 1 },
        'drive.turnThrottle': { type: 'float', min: 0, max: 1, default: 0.4 },
        'search.scanTurn': { type: 'float', min: -1, max: 1, default: 1 },
        'engage.breakRange': { type: 'float', min: 100, max: 600, default: 320 },
        'target.policy': { type: 'enum', values: ['first', 'nearest', 'weakest', 'strongest'], default: 'first' },
        loadout: { type: 'loadout', budget: SKILL_BUDGET, default: { overdrive: 1, gyro: 2, wideband: 1, scout: 1, plating: 1 } },
    },
};

export function genomeDefFor(bot: string): GenomeDef | undefined {
    const params = PARAM_RANGES[bot];
    if (!params) return undefined;
    return { genome_version: GENOME_VERSION, bot, params };
}

/** Fresh default genome for a bot (deep copy; safe to mutate). */
export function defaultGenome(bot: string): Genome | undefined {
    const def = genomeDefFor(bot);
    if (!def) return undefined;
    const params: Record<string, ParamValue> = {};
    for (const [key, param] of Object.entries(def.params)) {
        params[key] = param.type === 'loadout' ? { ...param.default } : param.default;
    }
    return { genome_version: GENOME_VERSION, bot, params };
}

/** Clamp one raw value to a param def; unusable input falls back to default. */
export function clampParam(def: ParamDef, raw: unknown): ParamValue {
    switch (def.type) {
        case 'float': {
            if (typeof raw !== 'number' || !Number.isFinite(raw)) return def.default;
            return Math.min(def.max, Math.max(def.min, raw));
        }
        case 'int': {
            if (typeof raw !== 'number' || !Number.isFinite(raw)) return def.default;
            return Math.min(def.max, Math.max(def.min, Math.round(raw)));
        }
        case 'enum': {
            if (typeof raw !== 'string' && typeof raw !== 'number') return def.default;
            return def.values.includes(raw) ? raw : def.default;
        }
        case 'loadout': {
            return sanitizeLoadout(raw);
        }
    }
}

/** Validate a raw genome: clamp known keys, drop unknown keys, fill defaults. */
export function validateGenome(def: GenomeDef, raw: unknown): Genome {
    const params: Record<string, ParamValue> = {};
    const input = (typeof raw === 'object' && raw !== null ? (raw as { params?: unknown }).params : undefined) as Record<
        string,
        unknown
    > | undefined;
    for (const [key, param] of Object.entries(def.params)) {
        const value = input !== undefined && typeof input === 'object' ? input[key] : undefined;
        params[key] = value === undefined ? clampParam(param, paramDefault(param)) : clampParam(param, value);
    }
    return { genome_version: GENOME_VERSION, bot: def.bot, params };
}

function paramDefault(def: ParamDef): ParamValue {
    return def.type === 'loadout' ? { ...def.default } : def.default;
}

/** The loadout chromosome, always through the real `sanitizeLoadout`. */
export function genomeLoadout(genome: Genome): SkillLoadout {
    return sanitizeLoadout(genome.params['loadout'] ?? {});
}

/** Canonical JSON: object keys sorted recursively, no whitespace. */
export function canonicalStringify(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((item) => canonicalStringify(item)).join(',')}]`;
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalStringify(v)}`).join(',')}}`;
    }
    return 'null';
}

function rotr(x: number, n: number): number {
    return (x >>> n) | (x << (32 - n));
}

function sha256Bytes(message: Uint8Array): Uint8Array {
    const k = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    const bitLen = message.length * 8;
    const padded = (((message.length + 8) >> 6) + 1) << 6;
    const data = new Uint8Array(padded);
    data.set(message);
    data[message.length] = 0x80;
    const view = new DataView(data.buffer);
    view.setUint32(padded - 4, bitLen >>> 0);
    view.setUint32(padded - 8, Math.floor(bitLen / 2 ** 32));
    let [h0, h1, h2, h3, h4, h5, h6, h7] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    const w = new Array<number>(64);
    for (let off = 0; off < padded; off += 64) {
        for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4);
        for (let i = 16; i < 64; i += 1) {
            const x15 = w[i - 15] as number;
            const x2 = w[i - 2] as number;
            const s0 = rotr(x15, 7) ^ rotr(x15, 18) ^ (x15 >>> 3);
            const s1 = rotr(x2, 17) ^ rotr(x2, 19) ^ (x2 >>> 10);
            w[i] = ((((w[i - 16] as number) + s0) | 0) + (((w[i - 7] as number) + s1) | 0)) | 0;
        }
        let [a, b, c, d, e, f, g, h] = [h0, h1, h2, h3, h4, h5, h6, h7];
        for (let i = 0; i < 64; i += 1) {
            const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (h + s1 + ch + (k[i] as number) + (w[i] as number)) | 0;
            const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (s0 + maj) | 0;
            h = g;
            g = f;
            f = e;
            e = (d + t1) | 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) | 0;
        }
        h0 = (h0 + a) | 0;
        h1 = (h1 + b) | 0;
        h2 = (h2 + c) | 0;
        h3 = (h3 + d) | 0;
        h4 = (h4 + e) | 0;
        h5 = (h5 + f) | 0;
        h6 = (h6 + g) | 0;
        h7 = (h7 + h) | 0;
    }
    const out = new Uint8Array(32);
    const oview = new DataView(out.buffer);
    [h0, h1, h2, h3, h4, h5, h6, h7].forEach((word, i) => oview.setUint32(i * 4, word >>> 0));
    return out;
}

function utf8Bytes(text: string): Uint8Array {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
    const bytes: number[] = [];
    for (let i = 0; i < text.length; i += 1) {
        let code = text.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
            const next = text.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
                i += 1;
            }
        }
        if (code < 0x80) bytes.push(code);
        else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
    return Uint8Array.from(bytes);
}

/** Hex sha256 of a UTF-8 string (pure TypeScript, same output as node:crypto). */
export function sha256Hex(text: string): string {
    return Array.from(sha256Bytes(utf8Bytes(text)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Genome hash: sha256 of the canonical JSON of the validated genome. The
 * loadout gene is normalized through `sanitizeLoadout` first so equivalent
 * genomes (key order, over-budget shedding) hash identically.
 */
export function genomeHash(genome: Genome): string {
    const def = genomeDefFor(genome.bot);
    const valid = def ? validateGenome(def, genome) : genome;
    return sha256Hex(canonicalStringify(valid));
}
