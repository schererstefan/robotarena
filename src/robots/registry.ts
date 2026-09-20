// Registry of compiled-in robots. Community robots submitted via pull
// request are added here: one import + one entry, reviewed by a maintainer.

import type { SkillLoadout } from '../sim/skills';
import type { RobotFactory, RobotMeta } from '../sim/types';
import { create as createBrawler, loadout as brawlerLoadout, meta as brawlerMeta } from './brawler';
import { create as createGhost, loadout as ghostLoadout, meta as ghostMeta } from './ghost';
import { create as createHunter, loadout as hunterLoadout, meta as hunterMeta } from './hunter';
import { create as createOrbiter, loadout as orbiterLoadout, meta as orbiterMeta } from './orbiter';
import { create as createRusher, loadout as rusherLoadout, meta as rusherMeta } from './rusher';
import { create as createSniper, loadout as sniperLoadout, meta as sniperMeta } from './sniper';
import { create as createTurret, loadout as turretLoadout, meta as turretMeta } from './turret';
import { create as createWanderer, loadout as wandererLoadout, meta as wandererMeta } from './wanderer';
import { create as createHunterHc1, loadout as hunterHc1Loadout, meta as hunterHc1Meta } from './hunter-hc1';

export interface RobotEntry {
    meta: RobotMeta;
    loadout: SkillLoadout;
    create: RobotFactory;
}

// Order is append-only: compact replay codes store registry indices, so
// existing entries must never be reordered or removed.
export const ROBOTS: RobotEntry[] = [
    { meta: rusherMeta, loadout: rusherLoadout, create: createRusher },
    { meta: turretMeta, loadout: turretLoadout, create: createTurret },
    { meta: orbiterMeta, loadout: orbiterLoadout, create: createOrbiter },
    { meta: wandererMeta, loadout: wandererLoadout, create: createWanderer },
    { meta: hunterMeta, loadout: hunterLoadout, create: createHunter },
    { meta: sniperMeta, loadout: sniperLoadout, create: createSniper },
    { meta: brawlerMeta, loadout: brawlerLoadout, create: createBrawler },
    { meta: ghostMeta, loadout: ghostLoadout, create: createGhost },
    { meta: hunterHc1Meta, loadout: hunterHc1Loadout, create: createHunterHc1 },
];

export function getRobot(id: string): RobotEntry | undefined {
    return ROBOTS.find((entry) => entry.meta.id === id);
}
