// Mutation operators (hillclimb plan §1.4): gaussian perturb (σ ≈ 10% of the
// range) on floats/ints, resample on enums, budget-preserving rank-swap on
// loadouts, slot-swap/copy on team genomes. All randomness flows through a
// seeded stream so runs reproduce from the manifest's run seed.

import { createRng, type Rand } from '../../src/sim/rng';
import { loadoutCost, rankOf, sanitizeLoadout, SKILL_BUDGET, SKILL_DEFS, type SkillLoadout } from '../../src/sim/skills';
import { GENOME_VERSION, validateGenome, type Genome, type GenomeDef, type ParamDef, type ParamValue } from '../../src/robots/genome';

export type { Rand };

export function rngFromSeed(seed: number): Rand {
    return createRng(seed >>> 0);
}

/** Standard normal via Box-Muller (two seeded draws, no caching: stateless). */
export function gaussian(rng: Rand): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function pickIndex(rng: Rand, n: number): number {
    return Math.min(n - 1, Math.floor(rng() * n));
}

/** Uniform random loadout: 6 ranks dealt one at a time to skills with headroom. */
export function randomLoadout(rng: Rand): SkillLoadout {
    const ranks = new Map<string, number>();
    for (let spent = 0; spent < SKILL_BUDGET; spent += 1) {
        const open = SKILL_DEFS.filter((def) => (ranks.get(def.id) ?? 0) < def.maxRank);
        if (open.length === 0) break;
        const def = open[pickIndex(rng, open.length)] as (typeof SKILL_DEFS)[number];
        ranks.set(def.id, (ranks.get(def.id) ?? 0) + 1);
    }
    return sanitizeLoadout(Object.fromEntries(ranks));
}

/**
 * Budget-preserving rank-swap: move one rank from a random donor skill to a
 * random recipient with headroom, then top up to exactly 6 (ranks are never
 * left unspent). Always returns a sanitized, full-budget loadout.
 */
export function mutateLoadout(loadout: SkillLoadout, rng: Rand): SkillLoadout {
    const ranks = new Map<string, number>();
    for (const def of SKILL_DEFS) {
        const rank = Math.min(rankOf(loadout, def.id), def.maxRank);
        if (rank > 0) ranks.set(def.id, rank);
    }
    const donors = SKILL_DEFS.filter((def) => (ranks.get(def.id) ?? 0) > 0);
    if (donors.length > 0) {
        const donor = donors[pickIndex(rng, donors.length)] as (typeof SKILL_DEFS)[number];
        ranks.set(donor.id, (ranks.get(donor.id) as number) - 1);
        if (ranks.get(donor.id) === 0) ranks.delete(donor.id);
        const recipients = SKILL_DEFS.filter((def) => (ranks.get(def.id) ?? 0) < def.maxRank);
        if (recipients.length > 0) {
            const dest = recipients[pickIndex(rng, recipients.length)] as (typeof SKILL_DEFS)[number];
            ranks.set(dest.id, (ranks.get(dest.id) ?? 0) + 1);
        }
    }
    // Top up to a full budget (deterministic order would bias; use the stream).
    let guard = 64;
    while (loadoutCost(Object.fromEntries(ranks)) < SKILL_BUDGET && guard > 0) {
        guard -= 1;
        const open = SKILL_DEFS.filter((def) => (ranks.get(def.id) ?? 0) < def.maxRank);
        if (open.length === 0) break;
        const def = open[pickIndex(rng, open.length)] as (typeof SKILL_DEFS)[number];
        ranks.set(def.id, (ranks.get(def.id) ?? 0) + 1);
    }
    return sanitizeLoadout(Object.fromEntries(ranks));
}

/** Count of catalog entries whose rank differs (diversity guard metric). */
export function loadoutDistance(a: SkillLoadout, b: SkillLoadout): number {
    let diff = 0;
    for (const def of SKILL_DEFS) {
        if (rankOf(a, def.id) !== rankOf(b, def.id)) diff += 1;
    }
    return diff;
}

function mutateParamValue(def: ParamDef, current: ParamValue, rng: Rand): ParamValue {
    switch (def.type) {
        case 'float': {
            const base = typeof current === 'number' ? current : def.default;
            return base + gaussian(rng) * 0.1 * (def.max - def.min);
        }
        case 'int': {
            const base = typeof current === 'number' ? current : def.default;
            return Math.round(base + gaussian(rng) * 0.1 * (def.max - def.min));
        }
        case 'enum': {
            const others = def.values.filter((v) => v !== current);
            if (others.length === 0) return def.default;
            return others[pickIndex(rng, others.length)] as string | number;
        }
        case 'loadout': {
            const base = typeof current === 'object' && current !== null ? (current as SkillLoadout) : def.default;
            return mutateLoadout(base, rng);
        }
    }
}

/**
 * Mutate 1–3 genes (1 with p=0.7, 2 with p=0.2, 3 with p=0.1), chosen
 * uniformly without replacement. Returns a validated genome.
 */
export function mutateGenome(def: GenomeDef, genome: Genome, rng: Rand): Genome {
    const keys = Object.keys(def.params);
    const roll = rng();
    const geneCount = Math.min(keys.length, roll < 0.7 ? 1 : roll < 0.9 ? 2 : 3);
    const pool = [...keys];
    const params: Record<string, ParamValue> = { ...genome.params };
    for (let k = 0; k < geneCount; k += 1) {
        const key = pool.splice(pickIndex(rng, pool.length), 1)[0] as string;
        const param = def.params[key] as ParamDef;
        params[key] = mutateParamValue(param, params[key] as ParamValue, rng);
    }
    return validateGenome(def, { genome_version: GENOME_VERSION, bot: def.bot, params });
}

// --- Team genomes (§1.4; used when teamSize > 1) -------------------------------

export interface TeamGenome {
    team_genome_version: 1;
    slots: Array<{ bot: string; genome: Genome }>;
    constraints: { max_copies_per_bot: number };
}

function teamBotCounts(team: TeamGenome): Map<string, number> {
    const counts = new Map<string, number>();
    for (const slot of team.slots) counts.set(slot.bot, (counts.get(slot.bot) ?? 0) + 1);
    return counts;
}

/**
 * Team mutation: slot-swap (exchange two slots), slot-copy (overwrite one
 * slot with a mutated copy of another, honoring max-copies), or slot-mutate
 * (mutate one slot's genome in place). Returns a fresh team object.
 */
export function mutateTeamGenome(team: TeamGenome, defs: Record<string, GenomeDef>, rng: Rand): TeamGenome {
    const slots = team.slots.map((s) => ({ bot: s.bot, genome: validateGenome(defs[s.bot] as GenomeDef, s.genome) }));
    const next: TeamGenome = {
        team_genome_version: 1,
        slots,
        constraints: { ...team.constraints },
    };
    if (slots.length === 0) return next;
    const roll = rng();
    if (roll < 0.3 && slots.length >= 2) {
        // Slot-swap: exchange two slots wholesale.
        const a = pickIndex(rng, slots.length);
        let b = pickIndex(rng, slots.length);
        if (b === a) b = (b + 1) % slots.length;
        const tmp = next.slots[a] as { bot: string; genome: Genome };
        next.slots[a] = next.slots[b] as { bot: string; genome: Genome };
        next.slots[b] = tmp;
    } else if (roll < 0.6 && slots.length >= 2) {
        // Slot-copy: overwrite target with a mutated copy of source.
        const source = pickIndex(rng, slots.length);
        const target = (source + 1 + pickIndex(rng, slots.length - 1)) % slots.length;
        const sourceSlot = next.slots[source] as { bot: string; genome: Genome };
        const counts = teamBotCounts(next);
        const targetBot = (next.slots[target] as { bot: string; genome: Genome }).bot;
        const after = (counts.get(sourceSlot.bot) ?? 0) + (targetBot === sourceSlot.bot ? 0 : 1);
        if (after <= next.constraints.max_copies_per_bot) {
            const def = defs[sourceSlot.bot] as GenomeDef;
            next.slots[target] = { bot: sourceSlot.bot, genome: mutateGenome(def, sourceSlot.genome, rng) };
        }
    } else {
        // Slot-mutate: mutate one slot's genome.
        const at = pickIndex(rng, slots.length);
        const slot = next.slots[at] as { bot: string; genome: Genome };
        next.slots[at] = { bot: slot.bot, genome: mutateGenome(defs[slot.bot] as GenomeDef, slot.genome, rng) };
    }
    return next;
}
