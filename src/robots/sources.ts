// Raw robot sources for the in-game export button. Vite inlines these at
// build time so export works in production, not just in dev.

import hunterSrc from '../robots/hunter.ts?raw';
import orbiterSrc from '../robots/orbiter.ts?raw';
import rusherSrc from '../robots/rusher.ts?raw';
import turretSrc from '../robots/turret.ts?raw';
import wandererSrc from '../robots/wanderer.ts?raw';

export const ROBOT_SOURCES: Record<string, string> = {
    hunter: hunterSrc,
    orbiter: orbiterSrc,
    rusher: rusherSrc,
    turret: turretSrc,
    wanderer: wandererSrc,
};
