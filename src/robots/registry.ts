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
import { create as createRusherHc1, loadout as rusherHc1Loadout, meta as rusherHc1Meta } from './rusher-hc1';
import { create as createOrbiterHc1, loadout as orbiterHc1Loadout, meta as orbiterHc1Meta } from './orbiter-hc1';
import { create as createTurretHc1, loadout as turretHc1Loadout, meta as turretHc1Meta } from './turret-hc1';
import { create as createWandererHc1, loadout as wandererHc1Loadout, meta as wandererHc1Meta } from './wanderer-hc1';
import { create as createSniperHc1, loadout as sniperHc1Loadout, meta as sniperHc1Meta } from './sniper-hc1';
import { create as createBrawlerHc1, loadout as brawlerHc1Loadout, meta as brawlerHc1Meta } from './brawler-hc1';
import { create as createGhostHc1, loadout as ghostHc1Loadout, meta as ghostHc1Meta } from './ghost-hc1';
import { create as createHunterHc2, loadout as hunterHc2Loadout, meta as hunterHc2Meta } from './hunter-hc2';
import { create as createCoachpilot, loadout as coachpilotLoadout, meta as coachpilotMeta } from './coachpilot/coachpilot';

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
    { meta: rusherHc1Meta, loadout: rusherHc1Loadout, create: createRusherHc1 },
    { meta: orbiterHc1Meta, loadout: orbiterHc1Loadout, create: createOrbiterHc1 },
    { meta: turretHc1Meta, loadout: turretHc1Loadout, create: createTurretHc1 },
    { meta: wandererHc1Meta, loadout: wandererHc1Loadout, create: createWandererHc1 },
    { meta: sniperHc1Meta, loadout: sniperHc1Loadout, create: createSniperHc1 },
    { meta: brawlerHc1Meta, loadout: brawlerHc1Loadout, create: createBrawlerHc1 },
    { meta: ghostHc1Meta, loadout: ghostHc1Loadout, create: createGhostHc1 },
    { meta: hunterHc2Meta, loadout: hunterHc2Loadout, create: createHunterHc2 },
    { meta: coachpilotMeta, loadout: coachpilotLoadout, create: createCoachpilot },
];

export function getRobot(id: string): RobotEntry | undefined {
    return ROBOTS.find((entry) => entry.meta.id === id);
}
