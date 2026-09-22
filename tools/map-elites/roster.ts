// Roster opponents for repertoire evaluation (Phase 1, part B).
//
// 8 base bots + 8 hc1 champions + hunter-hc2 + bt-n1 (the Moth). Shared by
// worker-duel.ts (reconstructs creators inside the worker) and
// eval-repertoire.ts (names/ids for reporting).

import type { RobotController } from '../../src/sim/types';
import type { SkillLoadout } from '../../src/sim/skills';
import { create as createBrawler, loadout as brawlerLoadout } from '../../src/robots/brawler';
import { create as createGhost, loadout as ghostLoadout } from '../../src/robots/ghost';
import { create as createHunter, loadout as hunterLoadout } from '../../src/robots/hunter';
import { create as createOrbiter, loadout as orbiterLoadout } from '../../src/robots/orbiter';
import { create as createRusher, loadout as rusherLoadout } from '../../src/robots/rusher';
import { create as createSniper, loadout as sniperLoadout } from '../../src/robots/sniper';
import { create as createTurret, loadout as turretLoadout } from '../../src/robots/turret';
import { create as createWanderer, loadout as wandererLoadout } from '../../src/robots/wanderer';
import { create as createHunterHc1, loadout as hunterHc1Loadout } from '../../src/robots/hunter-hc1';
import { create as createRusherHc1, loadout as rusherHc1Loadout } from '../../src/robots/rusher-hc1';
import { create as createOrbiterHc1, loadout as orbiterHc1Loadout } from '../../src/robots/orbiter-hc1';
import { create as createTurretHc1, loadout as turretHc1Loadout } from '../../src/robots/turret-hc1';
import { create as createWandererHc1, loadout as wandererHc1Loadout } from '../../src/robots/wanderer-hc1';
import { create as createSniperHc1, loadout as sniperHc1Loadout } from '../../src/robots/sniper-hc1';
import { create as createBrawlerHc1, loadout as brawlerHc1Loadout } from '../../src/robots/brawler-hc1';
import { create as createGhostHc1, loadout as ghostHc1Loadout } from '../../src/robots/ghost-hc1';
import { create as createHunterHc2, loadout as hunterHc2Loadout } from '../../src/robots/hunter-hc2';
import { create as createBtN1, loadout as btN1Loadout } from '../../src/robots/btbot';

export interface RosterBot {
    id: string;
    create: () => RobotController;
    loadout: SkillLoadout;
}

export const ROSTER: RosterBot[] = [
    { id: 'brawler', create: createBrawler, loadout: brawlerLoadout },
    { id: 'ghost', create: createGhost, loadout: ghostLoadout },
    { id: 'hunter', create: createHunter, loadout: hunterLoadout },
    { id: 'orbiter', create: createOrbiter, loadout: orbiterLoadout },
    { id: 'rusher', create: createRusher, loadout: rusherLoadout },
    { id: 'sniper', create: createSniper, loadout: sniperLoadout },
    { id: 'turret', create: createTurret, loadout: turretLoadout },
    { id: 'wanderer', create: createWanderer, loadout: wandererLoadout },
    { id: 'hunter-hc1', create: createHunterHc1, loadout: hunterHc1Loadout },
    { id: 'rusher-hc1', create: createRusherHc1, loadout: rusherHc1Loadout },
    { id: 'orbiter-hc1', create: createOrbiterHc1, loadout: orbiterHc1Loadout },
    { id: 'turret-hc1', create: createTurretHc1, loadout: turretHc1Loadout },
    { id: 'wanderer-hc1', create: createWandererHc1, loadout: wandererHc1Loadout },
    { id: 'sniper-hc1', create: createSniperHc1, loadout: sniperHc1Loadout },
    { id: 'brawler-hc1', create: createBrawlerHc1, loadout: brawlerHc1Loadout },
    { id: 'ghost-hc1', create: createGhostHc1, loadout: ghostHc1Loadout },
    { id: 'hunter-hc2', create: createHunterHc2, loadout: hunterHc2Loadout },
    { id: 'bt-n1', create: createBtN1, loadout: btN1Loadout },
];

export const ROSTER_IDS = ROSTER.map((r) => r.id);

export function rosterBot(id: string): RosterBot {
    const b = ROSTER.find((r) => r.id === id);
    if (!b) throw new Error(`unknown roster bot ${id}`);
    return b;
}
