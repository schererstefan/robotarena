import { AUTO, Game, Scale } from 'phaser';
import { BattleScene } from './scenes/BattleScene';
import { MenuScene } from './scenes/MenuScene';

const config: Phaser.Types.Core.GameConfig = {
    type: AUTO,
    width: 1024,
    height: 768,
    parent: 'game-container',
    backgroundColor: '#06080b',
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    scale: {
        mode: Scale.FIT,
        autoCenter: Scale.CENTER_BOTH,
    },
    fps: {
        target: 60,
    },
    scene: [MenuScene, BattleScene],
};

const StartGame = (parent: string) => {
    return new Game({ ...config, parent });
};

export default StartGame;
