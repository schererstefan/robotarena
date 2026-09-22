// Raw robot sources for the in-game export button. Vite inlines these at
// build time so export works in production, not just in dev.

import brawlerSrc from '../robots/brawler.ts?raw';
import ghostSrc from '../robots/ghost.ts?raw';
import hunterSrc from '../robots/hunter.ts?raw';
import orbiterSrc from '../robots/orbiter.ts?raw';
import rusherSrc from '../robots/rusher.ts?raw';
import sniperSrc from '../robots/sniper.ts?raw';
import turretSrc from '../robots/turret.ts?raw';
import wandererSrc from '../robots/wanderer.ts?raw';
import hunterHc1Src from '../robots/hunter-hc1.ts?raw';
import rusherHc1Src from '../robots/rusher-hc1.ts?raw';
import orbiterHc1Src from '../robots/orbiter-hc1.ts?raw';
import turretHc1Src from '../robots/turret-hc1.ts?raw';
import wandererHc1Src from '../robots/wanderer-hc1.ts?raw';
import sniperHc1Src from '../robots/sniper-hc1.ts?raw';
import brawlerHc1Src from '../robots/brawler-hc1.ts?raw';
import ghostHc1Src from '../robots/ghost-hc1.ts?raw';
import hunterHc2Src from '../robots/hunter-hc2.ts?raw';
import btN1Src from '../robots/btbot.ts?raw';
import coachpilotSrc from '../robots/coachpilot/coachpilot.ts?raw';

export const ROBOT_SOURCES: Record<string, string> = {
    brawler: brawlerSrc,
    ghost: ghostSrc,
    hunter: hunterSrc,
    orbiter: orbiterSrc,
    rusher: rusherSrc,
    sniper: sniperSrc,
    turret: turretSrc,
    wanderer: wandererSrc,
    'hunter-hc1': hunterHc1Src,
    'rusher-hc1': rusherHc1Src,
    'orbiter-hc1': orbiterHc1Src,
    'turret-hc1': turretHc1Src,
    'wanderer-hc1': wandererHc1Src,
    'sniper-hc1': sniperHc1Src,
    'brawler-hc1': brawlerHc1Src,
    'ghost-hc1': ghostHc1Src,
    'hunter-hc2': hunterHc2Src,
    'bt-n1': btN1Src,
    'coachpilot': coachpilotSrc,
};
