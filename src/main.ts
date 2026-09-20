import StartGame, { ensureFontsReady } from './game/main';
import { APP } from './game/strings';

document.addEventListener('DOMContentLoaded', () => {

    // Page chrome renders from the copy deck (index.html carries the same
    // text as a static fallback for no-JS crawlers).
    document.title = APP.documentTitle;
    document.getElementById('marquee')?.replaceChildren(APP.marquee);

    // Scenes boot after the pixel fonts load: canvas text baked before
    // that would stick in the fallback stack (see ensureFontsReady).
    void ensureFontsReady().then(() => StartGame('game-container'));

});
