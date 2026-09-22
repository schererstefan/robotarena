import { AUTO, Game, Scale } from 'phaser';
import { BattleScene } from './scenes/BattleScene';
import { LeagueScene } from './scenes/LeagueScene';
import { MenuScene } from './scenes/MenuScene';
import { ShowcaseScene } from './scenes/ShowcaseScene';
import { TournamentScene } from './scenes/TournamentScene';
import { WorkshopScene } from './scenes/WorkshopScene';

const config: Phaser.Types.Core.GameConfig = {
    type: AUTO,
    width: 1024,
    height: 768,
    parent: 'game-container',
    backgroundColor: '#06080b',
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    // Touch: long-press must not summon the context menu over the canvas.
    disableContextMenu: true,
    // FIT-scaling audit (Phase 18): FIT + CENTER_BOTH keeps the 4:3 canvas
    // fully visible on any viewport (letterboxed in portrait via CSS below);
    // autoRound snaps the canvas to whole CSS pixels for crisp pixel art.
    // Do not constrain the canvas size in CSS — that would distort aspect.
    scale: {
        mode: Scale.FIT,
        autoCenter: Scale.CENTER_BOTH,
        autoRound: true,
    },
    fps: {
        target: 60,
    },
    scene: [MenuScene, BattleScene, LeagueScene, ShowcaseScene, TournamentScene, WorkshopScene],
};

const StartGame = (parent: string) => {
    return new Game({ ...config, parent });
};

/**
 * Font-ready gate: Phaser canvas text rasterizes glyphs at creation
 * time, so scenes must boot only after the bundled pixel fonts arrive —
 * otherwise titles stick in the fallback stack forever. Resolves on a
 * timeout (and on any error) so boot never hangs on fonts.
 */
export async function ensureFontsReady(timeoutMs = 2000): Promise<void> {
    try {
        if (typeof document === 'undefined' || document.fonts?.load === undefined) return;
        const loaded = Promise.all([
            document.fonts.load('16px "Press Start 2P"'),
            document.fonts.load('16px "VT323"'),
        ]).then(() => undefined);
        const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
        await Promise.race([loaded, timeout]);
    } catch {
        // Fall back to the system stacks; the game stays playable.
    }
}

export default StartGame;
