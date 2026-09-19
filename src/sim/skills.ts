// Symmetric skill system. Every slot gets the same point budget and the
// same catalog: fairness moved from identical-platform to symmetric-loadout.
// Loadouts are public, validated, and frozen at match construction.

export type SkillId =
    | 'overdrive'
    | 'gyro'
    | 'servos'
    | 'longscan'
    | 'wideband'
    | 'trigger'
    | 'marksman'
    | 'charger'
    | 'plating';

export interface SkillDef {
    id: SkillId;
    code: string;
    name: string;
    desc: string;
    maxRank: number;
}

export const SKILL_DEFS: SkillDef[] = [
    { id: 'overdrive', code: 'OVR', name: 'Overdrive', desc: '+8% top speed per rank', maxRank: 3 },
    { id: 'gyro', code: 'GYR', name: 'Gyro', desc: '+12% turn rate per rank', maxRank: 3 },
    { id: 'servos', code: 'SRV', name: 'Servos', desc: '+12% tower speed per rank', maxRank: 3 },
    { id: 'longscan', code: 'SCN', name: 'Longscan', desc: '+15% sensor range per rank', maxRank: 3 },
    { id: 'wideband', code: 'WND', name: 'Wideband', desc: '+0.25rad sensor cone per rank', maxRank: 2 },
    { id: 'trigger', code: 'TRG', name: 'Trigger', desc: '-3 ticks gun cooldown per rank', maxRank: 3 },
    { id: 'marksman', code: 'MRK', name: 'Marksman', desc: '+12% gun range per rank', maxRank: 2 },
    { id: 'charger', code: 'CHG', name: 'Charger', desc: 'hold charge: bank bonus damage (rank 2: faster)', maxRank: 2 },
    { id: 'plating', code: 'PLT', name: 'Plating', desc: '+15 max health per rank', maxRank: 2 },
];

export const SKILL_BUDGET = 6;
export const RANK_COST = 1;

/** Rank per skill id. Missing skills are rank 0. */
export type SkillLoadout = Partial<Record<SkillId, number>>;

export function rankOf(loadout: SkillLoadout, id: SkillId): number {
    const rank = loadout[id] ?? 0;
    return typeof rank === 'number' && Number.isFinite(rank) ? Math.max(0, Math.floor(rank)) : 0;
}

const MAX_RANKS: Record<SkillId, number> = Object.fromEntries(
    SKILL_DEFS.map((def) => [def.id, def.maxRank]),
) as Record<SkillId, number>;

export function loadoutCost(loadout: SkillLoadout): number {
    return SKILL_DEFS.reduce((sum, def) => sum + Math.min(rankOf(loadout, def.id), def.maxRank) * RANK_COST, 0);
}

/**
 * Defensive sanitize: clamp ranks, drop unknown ids, then shed ranks from
 * the END of the catalog until within budget. Deterministic.
 */
export function sanitizeLoadout(raw: unknown): SkillLoadout {
    const clean: SkillLoadout = {};
    if (typeof raw === 'object' && raw !== null) {
        const input = raw as Record<string, unknown>;
        for (const def of SKILL_DEFS) {
            const value = input[def.id];
            if (typeof value === 'number' && Number.isFinite(value)) {
                const rank = Math.max(0, Math.min(def.maxRank, Math.floor(value)));
                if (rank > 0) clean[def.id] = rank;
            }
        }
    }
    let cost = loadoutCost(clean);
    for (let i = SKILL_DEFS.length - 1; i >= 0 && cost > SKILL_BUDGET; i -= 1) {
        const def = SKILL_DEFS[i] as SkillDef;
        while ((clean[def.id] ?? 0) > 0 && cost > SKILL_BUDGET) {
            clean[def.id] = (clean[def.id] as number) - 1;
            if (clean[def.id] === 0) delete clean[def.id];
            cost -= RANK_COST;
        }
    }
    return clean;
}

/** Effective per-robot stats after applying a loadout. */
export interface RobotStats {
    maxSpeed: number;
    turnRate: number;
    towerRate: number;
    sensorRange: number;
    sensorFov: number;
    gunRange: number;
    cooldownTicks: number;
    bulletSpeed: number;
    damage: number;
    maxHealth: number;
    chargeTicks: number;
    chargeMult: number;
}

import {
    BULLET_DAMAGE,
    BULLET_SPEED,
    GUN_COOLDOWN_TICKS,
    GUN_RANGE,
    MAX_SPEED,
    SENSOR_FOV,
    SENSOR_RANGE,
    START_HEALTH,
    TOWER_RATE,
    TURN_RATE,
} from './constants';

export function computeStats(loadout: SkillLoadout): RobotStats {
    const capped = (id: SkillId): number => Math.min(rankOf(loadout, id), MAX_RANKS[id]);
    const overdrive = capped('overdrive');
    const gyro = capped('gyro');
    const servos = capped('servos');
    const longscan = capped('longscan');
    const wideband = capped('wideband');
    const trigger = capped('trigger');
    const marksman = capped('marksman');
    const charger = capped('charger');
    const plating = capped('plating');
    return {
        maxSpeed: MAX_SPEED * (1 + 0.08 * overdrive),
        turnRate: TURN_RATE * (1 + 0.12 * gyro),
        towerRate: TOWER_RATE * (1 + 0.12 * servos),
        sensorRange: SENSOR_RANGE * (1 + 0.15 * longscan),
        sensorFov: SENSOR_FOV + 0.25 * wideband,
        gunRange: GUN_RANGE * (1 + 0.12 * marksman),
        cooldownTicks: Math.max(8, GUN_COOLDOWN_TICKS - 3 * trigger),
        bulletSpeed: BULLET_SPEED,
        damage: BULLET_DAMAGE,
        maxHealth: START_HEALTH + 15 * plating,
        chargeTicks: charger >= 2 ? 20 : 30,
        chargeMult: charger >= 1 ? 2 : 1,
    };
}

/** Compact public code, e.g. "OVR2 TRG2 PLT2" or "STOCK". */
export function loadoutCode(loadout: SkillLoadout): string {
    const parts: string[] = [];
    for (const def of SKILL_DEFS) {
        const rank = rankOf(loadout, def.id);
        if (rank > 0) parts.push(`${def.code}${rank}`);
    }
    return parts.length > 0 ? parts.join(' ') : 'STOCK';
}
