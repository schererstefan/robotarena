import StartGame from './game/main';
import { APP } from './game/strings';

document.addEventListener('DOMContentLoaded', () => {

    // Page chrome renders from the copy deck (index.html carries the same
    // text as a static fallback for no-JS crawlers).
    document.title = APP.documentTitle;
    document.getElementById('marquee')?.replaceChildren(APP.marquee);

    StartGame('game-container');

});
