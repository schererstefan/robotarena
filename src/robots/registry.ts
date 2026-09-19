// Registry of compiled-in robots. Community robots submitted via pull
// request are added here: one import + one entry, reviewed by a maintainer.

import type { RobotFactory, RobotMeta } from '../sim/types';
import { create as createHunter, meta as hunterMeta } from './hunter';
import { create as createOrbiter, meta as orbiterMeta } from './orbiter';
import { create as createRusher, meta as rusherMeta } from './rusher';
import { create as createTurret, meta as turretMeta } from './turret';
import { create as createWanderer, meta as wandererMeta } from './wanderer';

export interface RobotEntry {
    meta: RobotMeta;
    create: RobotFactory;
}

export const ROBOTS: RobotEntry[] = [
    { meta: rusherMeta, create: createRusher },
    { meta: turretMeta, create: createTurret },
    { meta: orbiterMeta, create: createOrbiter },
    { meta: wandererMeta, create: createWanderer },
    { meta: hunterMeta, create: createHunter },
];

export function getRobot(id: string): RobotEntry | undefined {
    return ROBOTS.find((entry) => entry.meta.id === id);
}
