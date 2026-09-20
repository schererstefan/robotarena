import { AUTO, Game, Scale } from 'phaser';
import { BattleScene } from './scenes/BattleScene';
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
    scene: [MenuScene, BattleScene, ShowcaseScene, TournamentScene, WorkshopScene],
};

const StartGame = (parent: string) => {
    return new Game({ ...config, parent });
};

export default StartGame;
