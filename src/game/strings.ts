// Copy deck: every user-facing string in the app shell lives here.
//
// Scenes and UI helpers must render copy from this module — never from inline
// literals — so tone stays consistent and a single review pass covers the app.
// This module is intentionally dependency-light (sim data only, no Phaser or
// DOM): headless consumers such as the soak test import it via tournament.ts
// and workshop.ts.
//
// Tone notes (Phase 22 review): the shell uses an arcade voice — ALL-CAPS
// pixel headings, lowercase sans body hints. Copy changes in this pass:
//   1. Loadout tour "9-skill catalog" -> current catalog size (stale since the
//      Phase 9 catalog grew it to 13). Budget and catalog size now derive from
//      SKILL_BUDGET / SKILL_DEFS so they cannot go stale again.
//   2. Battle tutorial "Every battle is logged" -> "Battles are logged":
//      exhibition, pilot, tutorial, and daily matches bypass the main log
//      (the tutorial battle itself is never recorded).
//   3. Tournament bracket tiebreak marker "TB" -> "TIEBREAK" (cryptic in a box
//      with room to spare).
// Everything else is verbatim: the existing voice is consistent.
//
// Deliberately NOT centralized (grep-audit exclusions, all justified):
//   - Sim-owned data tokens: skill names/descs/codes (SKILL_DEFS), robot
//     meta (name/author/description), loadoutCode "STOCK", modifier codes
//     ("2X"/"FOG"/"MIR"). The sim must not import game code (headless), and
//     scenes render these via data fields, never inline literals.
//   - Cosmetic data: callsigns, paint/finish display values (customize.ts).
//   - Routing/texture keys ("Menu", "hub", ...), Phaser/DOM event names and
//     key codes ("keydown-M", "Space", "Enter"), DOM tags/selectors, CSS text,
//     font stacks, color hexes, regexes, storage keys/values: structural, not
//     user-facing copy.
//   - Thrown dev errors that are never rendered ("invalid match record",
//     "tournament needs 4 or 8 entrants", ...): history.ts/tournament.ts.
//   - The workshop starter template source: a code document, not UI copy.
//   - Debug overlay text (FPS meter behind the F key): debug strings.
//   - Empty-string text initializers and numeric formatting internals.

import type { MatchModifiers } from '../sim/constants';
import { SKILL_BUDGET, SKILL_DEFS } from '../sim/skills';

/** A titled coach-mark step (tutorial script + loadout tour). */
export interface CopyStep {
    title: string;
    body: string;
}

/** App identity (also applied to document.title and the page marquee). */
export const APP = {
    title: 'ROBOTARENA',
    tagline: 'same budget. same catalog. only the code differs.',
    documentTitle: 'RobotArena - Code your robot. Win the arena.',
    marquee: 'ROBOTARENA · same budget · same catalog · only the code differs',
} as const;

/** Single-word buttons and glyphs shared across scenes. */
export const COMMON = {
    done: 'DONE',
    clear: 'CLEAR',
    close: 'CLOSE',
    cancel: 'CANCEL',
    menu: 'MENU',
    skip: 'SKIP',
    next: 'NEXT',
    finish: 'FINISH',
    on: 'ON',
    off: 'OFF',
    plus: '+',
    minus: '-',
} as const;

/** Join offender/detail name lists ("a, b"). */
export function commaList(names: string[]): string {
    return names.join(', ');
}

/** Wall-clock readout from a sim tick count ("1:05"). */
export function formatClock(tick: number): string {
    const second = Math.floor(tick / 60);
    return `${Math.floor(second / 60)}:${(second % 60).toString().padStart(2, '0')}`;
}

/** One-decimal match duration ("12.3s"). */
export function formatSecs1(tick: number): string {
    return `${(tick / 60).toFixed(1)}s`;
}

/** Download filename for a robot source file ("hunter.ts"). */
export function tsFilename(robotId: string): string {
    return `${robotId}.ts`;
}

/** Fallback download name when the draft has no usable meta id. */
export const FALLBACK_ROBOT_FILENAME = 'my-robot.ts';

// ---- Main menu ------------------------------------------------------------

export const MENU = {
    headers: {
        slot: 'SLOT',
        callsign: 'CALLSIGN',
        robot: 'ROBOT',
        paint: 'PAINT',
        finish: 'FINISH',
        skills: 'SKILLS',
    },
    modeLabels: ['1 v 1', '2 v 2', '3 v 3'],
    randomizeSkins: 'RANDOMIZE SKINS',
    startBattle: 'START BATTLE',
    pilot: 'PILOT 1V1',
    watchReplay: 'WATCH REPLAY',
    tourney: 'TOURNEY',
    stats: 'STATS',
    workshop: 'WORKSHOP',
    import: 'IMPORT',
    tutorial: 'TUTORIAL',
    daily: 'DAILY',
    dailyDone: 'DAILY (DONE)',
    showcase: 'SHOWCASE',
} as const;

/** Mode/size button: active choice gets "> ... <" brackets. */
export function bracketedLabel(label: string, active: boolean): string {
    return active ? `> ${label} <` : label;
}

export function trailsLabel(trails: boolean): string {
    return `TRAILS: ${trails ? COMMON.on : COMMON.off}`;
}

export function soundLabel(muted: boolean): string {
    return muted ? 'SOUND: OFF (M)' : 'SOUND: ON (M)';
}

export function colorLabel(colorblind: boolean): string {
    return colorblind ? 'COLOR: CB' : 'COLOR: STD';
}

export function motionLabel(reduced: boolean): string {
    return reduced ? 'MOTION: LOW' : 'MOTION: FULL';
}

export function dailyLabel(done: boolean): string {
    return done ? MENU.dailyDone : MENU.daily;
}

export function arenaLabel(arena: string): string {
    return `ARENA: ${arena.toUpperCase()}`;
}

export function modsButtonLabel(codes: string[]): string {
    return codes.length === 0 ? 'MODS: OFF' : `MODS: ${codes.join('+')}`;
}

/** Slot cycler / entrant value with the "tap to cycle" arrow. */
export function cyclerLabel(value: string): string {
    return `${value} >`;
}

/** Skills-button readout: points spent in this slot. */
export function skillsButtonLabel(cost: number): string {
    return `SKL ${cost}`;
}

/** Menu description line under the slots. */
export function robotByline(name: string, author: string, version: string, description: string): string {
    return `${name} by ${author} v${version} — ${description}`;
}

// ---- Loadout editor -------------------------------------------------------

export const EDITOR = {
    random: 'RANDOM',
} as const;

export function editorSlotTitle(slot: number): string {
    return `SLOT ${slot + 1} LOADOUT`;
}

export function editorSubtitle(robotName: string, description: string): string {
    return `${robotName} - ${description}`;
}

export function editorPoints(spent: number): string {
    return `POINTS  ${spent} / ${SKILL_BUDGET}`;
}

export function skillLine(code: string, name: string): string {
    return `${code}  ${name}`;
}

export function rankText(rank: number, maxRank: number): string {
    return `${rank}/${maxRank}`;
}

// ---- Onboarding tutorial --------------------------------------------------

export const TUTORIAL_PROMPT = {
    title: 'NEW HERE?',
    line1: 'Play the 60-second tutorial: a spectated battle,',
    line2: 'then a guided tour of the loadout editor.',
    play: 'PLAY TUTORIAL',
} as const;

/** Guided loadout-editor tour, shown over the open editor (slot 0). */
export const LOADOUT_TOUR_STEPS: CopyStep[] = [
    {
        title: 'POINTS',
        body:
            `Every slot gets the same ${SKILL_BUDGET}-point budget. ` +
            `Spend it across the ${SKILL_DEFS.length}-skill catalog - anyone can run any legal build.`,
    },
    {
        title: 'RANKS',
        body: 'Plus and minus set ranks per skill; green counts are active. Builds are public, shown as codes on results.',
    },
    {
        title: 'DONE',
        body: 'DONE locks the build. RANDOM rolls one, CLEAR empties it. Next: START BATTLE to run your builds.',
    },
];

export function loadoutTourTitle(step: number, total: number, stepTitle: string): string {
    return `LOADOUT TOUR ${step + 1}/${total} - ${stepTitle}`;
}

/** Coach-mark script for the spectated tutorial battle (user-paced). */
export const BATTLE_TUTORIAL_STEPS: CopyStep[] = [
    {
        title: 'WATCH',
        body: 'Two bots fight on their own - you are spectating. Bots only see foes inside the cone their turret points at.',
    },
    {
        title: 'DAMAGE',
        body: 'Bars show health. A white ring means a full charge is banked: the next shot deals double damage.',
    },
    {
        title: 'CONTROLS',
        body: 'Space pauses, N steps one tick while paused, 1X cycles speed, M mutes. The minimap tracks every robot.',
    },
    {
        title: 'RECORDS',
        body: 'Battles are logged: STATS shows per-robot win rates, and results give a replay code for the exact match.',
    },
];

export const BATTLE_TUTORIAL = {
    loadoutTour: 'LOADOUT TOUR',
} as const;

export function battleTutorialTitle(step: number, total: number, stepTitle: string): string {
    return `TUTORIAL ${step + 1}/${total} - ${stepTitle}`;
}

// ---- Watch-replay dialog (DOM overlay) ------------------------------------

export const REPLAY_DIALOG = {
    title: 'WATCH REPLAY',
    prompt: 'paste a replay code:',
    placeholder: 'RA2-XXXX-…',
    watch: 'WATCH',
    invalidCode: 'invalid replay code',
} as const;

export function replayUnknownRobot(id: string): string {
    return `unknown robot in code: ${id}`;
}

// ---- Import robot dialog (DOM overlay, exhibition only) -------------------

export const IMPORT_DIALOG = {
    title: 'IMPORT ROBOT — EXHIBITION ONLY',
    warning: 'imported bots never touch tournaments or leaderboards',
    fileLabel: 'load a dependency-free .js/.mjs robot module:',
    urlLabel: 'or fetch from a URL:',
    urlPlaceholder: 'https://…/mybot.mjs',
    slotLabel: 'assign to:',
    import: 'IMPORT',
    /** Shown when a target slot holds no recognizable robot name. */
    unknownName: 'custom',
    noSource: 'pick a file or enter a URL',
    loading: 'loading…',
} as const;

export function importSlotOption(slot: number, team: 1 | 2, robotName: string): string {
    return `SLOT ${slot + 1} (team ${team}) — ${robotName.toUpperCase()}`;
}

export function importDoneNotice(robotName: string, slot: number): string {
    return `imported ${robotName} into slot ${slot + 1}`;
}

/** Import failures, surfaced in the dialog status line. */
export const IMPORT_ERROR = {
    tooLarge: 'file too large (256 KB max)',
    dynamicImport: 'dynamic import() is not allowed',
    valueImports: 'value imports cannot be resolved — ship a dependency-free module',
    noCreate: 'module must export a create() factory',
    badMeta: 'module must export a meta object (id, name, author, version, description)',
    badLoadout: 'loadout could not be sanitized',
    noUpdate: 'create() must return a controller with an update() function',
    badIntent: 'update() must return an Intent (throttle/turn/towerTurn/fire/charge)',
    readFailed: 'could not read file',
    badUrl: 'invalid URL',
    badProtocol: 'only http(s) URLs are allowed',
    fetchFailed: 'fetch failed (network or CORS)',
    unknown: 'unknown',
} as const;

export function importBlockedApi(detailLine: string): string {
    return `blocked API: ${detailLine}`;
}

export function importCreateThrew(message: string): string {
    return `create() threw: ${message}`;
}

export function importUpdateThrew(message: string): string {
    return `update() threw on the dry run: ${message}`;
}

export function importLoadFailed(message: string): string {
    return `could not load module (plain JavaScript .js/.mjs only): ${message}`;
}

export function importFetchHttp(status: number): string {
    return `fetch failed: HTTP ${status}`;
}

/** Workshop safety-check failure rendered as an import status line. */
export function checkFailureLine(label: string, detail: string): string {
    return `${label}: ${detail}`;
}

// ---- Match history + stats panel ------------------------------------------

export const STATS = {
    title: 'MATCH HISTORY',
    empty: 'no matches recorded yet - go battle!',
    dailyTitle: 'DAILY BEST (LAST 5)',
    dailyEmpty: 'no daily results yet - play the daily!',
    draw: 'DRAW',
    /** Win-rate readout when the robot never played. */
    noRate: '--',
    /** Defensive fallback when a recorded robot id left the registry. */
    unknownTeam: 'team',
    localTab: 'LOCAL',
    onlineTab: 'ONLINE',
} as const;

/** Overflow marker when a stats list is capped ("+3 MORE"). */
export function statsAndMore(extra: number): string {
    return `+${extra} MORE`;
}

export function statsSummary(matches: number, draws: number): string {
    return `MATCHES ${matches}   DRAWS ${draws}`;
}

export function statsRow(games: number, wins: number, draws: number, pct: string): string {
    return `${games}G ${wins}W ${draws}D ${pct}`;
}

export function statsPct(games: number, rate: number): string {
    return games > 0 ? `${Math.round(rate * 100)}%` : STATS.noRate;
}

export function dailyWinnerName(robotName: string): string {
    return `${robotName} WINS`;
}

/** Daily-board row (YYYY-MM-DD trimmed to MM-DD). */
export function dailyRow(date: string, outcome: string, tick: number): string {
    return `${date.slice(5)}  ${outcome}  ${formatClock(tick)}`;
}

// ---- Exhibition modifiers overlay -----------------------------------------

export const MODS = {
    title: 'EXHIBITION MODIFIERS',
    subtitle: 'exhibition matches never touch stats',
} as const;

export interface ModRow {
    key: keyof MatchModifiers;
    name: string;
    desc: string;
}

export const MOD_ROWS: ModRow[] = [
    { key: 'doubleDamage', name: 'DOUBLE DAMAGE', desc: 'every shot deals double damage' },
    { key: 'hardcoreFog', name: 'HARDCORE FOG', desc: 'sensor range halved for every robot' },
    { key: 'mirror', name: 'MIRROR MODE', desc: 'team 2 mirrors team 1 robots + builds' },
];

// ---- Battle HUD, banners, and results -------------------------------------

export const BATTLE = {
    tagPilot: 'PILOT',
    tagDaily: 'DAILY',
    tagReplay: 'REPLAY',
    tagShowcase: 'SHOWCASE',
    /** Short HUD tag appended to the seed readout on exhibition matches. */
    tagCustom: 'CUSTOM',
    pilotHelp: 'WASD DRIVE - MOUSE AIM - SPACE TAP FIRE, HOLD CHARGE - P PAUSE',
    bannerExhibition: 'EXHIBITION MATCH',
    bannerExhibitionCustom: 'EXHIBITION MATCH - CUSTOM ROBOT',
    bannerSuddenDeath: 'SUDDEN DEATH',
    bannerFirstBlood: 'FIRST BLOOD',
    bannerSoundOn: 'SOUND ON',
    bannerSoundOff: 'SOUND OFF',
    pause: 'PAUSE',
    resume: 'RESUME',
    step: 'STEP (N)',
    titleDraw: 'DRAW',
    titleYouWin: 'YOU WIN',
    titleYouLose: 'YOU LOSE',
    titleTeam1: 'TEAM 1 WINS',
    titleTeam2: 'TEAM 2 WINS',
    /** Full-length part used in the results exhibition line. */
    customRobotPart: 'CUSTOM ROBOT',
    exportHint: 'click a row to download that robot (.ts)',
    replayUnavailable: 'REPLAY UNAVAILABLE FOR CUSTOM ROBOTS',
    replayLabel: 'REPLAY CODE - CLICK CODE TO COPY',
    replayCopied: 'REPLAY CODE - COPIED!',
    replayCopyFailed: 'REPLAY CODE - COPY FAILED',
    introSkip: 'INPUT TO SKIP',
    rematch: 'REMATCH',
    /** Reel navigation: NEXT steps the reel, EXIT returns to the showcase. */
    exitShowcase: 'EXIT',
} as const;

/** HUD tag for a showcase battle, with reel position when in a reel. */
export function showcaseTag(index: number | null, total: number): string {
    return index === null ? BATTLE.tagShowcase : `${BATTLE.tagShowcase} ${index + 1}/${total}`;
}

/** Results caption for showcase battles (never recorded, like replays). */
export function showcaseResultsLine(): string {
    return `${BATTLE.tagShowcase} - NOT RECORDED`;
}

/** Reel auto-advance countdown ("NEXT IN 3..."). */
export function reelCountdown(secondsLeft: number): string {
    return `NEXT IN ${secondsLeft}...`;
}

/** Reel auto-exit countdown on the last code ("EXIT IN 3..."). */
export function reelExitCountdown(secondsLeft: number): string {
    return `EXIT IN ${secondsLeft}...`;
}

/** Seed readout with match tags ("SEED 42 - DAILY - EXHIBITION 2X"). */
export function seedLabel(seed: number, tags: string[]): string {
    return tags.length > 0 ? `SEED ${seed} - ${tags.join(' - ')}` : `SEED ${seed}`;
}

export function exhibitionTag(parts: string[]): string {
    return `EXHIBITION ${parts.join('+')}`;
}

export function speedLabel(speed: number): string {
    return `${speed}X`;
}

export function destroyedBanner(callsign: string): string {
    return `${callsign} DESTROYED`;
}

/** Kill credit with the killer's running KO count ("SCRAP DESTROYED — BOLT (2 KO)"). */
export function killCreditBanner(victim: string, killer: string, ko: number): string {
    return `${victim} DESTROYED — ${killer} (${ko} KO)`;
}

/** Team survival pips ("T1 ●●○   T2 ●●●"). */
export function hudTeamPips(alive0: number, total0: number, alive1: number, total1: number): string {
    const pips = (alive: number, total: number): string => '●'.repeat(alive) + '○'.repeat(total - alive);
    return `T1 ${pips(alive0, total0)}   T2 ${pips(alive1, total1)}`;
}

/** Active-skill cooldown pips under each chassis (filled = ready). */
export function cooldownPips(dashReady: boolean, empReady: boolean): string {
    return `D${dashReady ? '●' : '○'} E${empReady ? '●' : '○'}`;
}

export function damageText(dmg: number): string {
    return `-${dmg}`;
}

/** Regen tick ("+3", green tier). */
export function healText(amount: number): string {
    return `+${amount}`;
}

/** The pilot drives slot 0 (team 1), so the verdict names them. */
export function resultsTitle(pilot: boolean, winner: -1 | 0 | 1): string {
    if (pilot) {
        if (winner === -1) return BATTLE.titleDraw;
        return winner === 0 ? BATTLE.titleYouWin : BATTLE.titleYouLose;
    }
    if (winner === -1) return BATTLE.titleDraw;
    return winner === 0 ? BATTLE.titleTeam1 : BATTLE.titleTeam2;
}

export function resultsSub(seed: number, tick: number): string {
    return `seed ${seed} - ${formatSecs1(tick)}`;
}

export function exhibitionResultsLine(parts: string[]): string {
    return `EXHIBITION ${parts.join(' + ')} - NOT RECORDED`;
}

export function resultRow(
    alive: boolean,
    callsign: string,
    name: string,
    kills: number,
    damage: number,
    shots: number,
): string {
    return `${alive ? '>' : 'x'} ${callsign} (${name})  ${kills} KO  ${damage} dmg  ${shots} shots`;
}

// ---- Tournament -----------------------------------------------------------

export const TOURNAMENT = {
    title: 'TOURNAMENT',
    subtitle: 'single elimination - bots only, headless sim',
    sizeLabels: ['4 BOTS', '8 BOTS'],
    run: 'RUN TOURNAMENT',
    runAgain: 'RUN AGAIN',
    lineup: 'LINEUP',
    roundFinal: 'FINAL',
    roundSemifinal: 'SEMIFINAL',
    roundQuarterfinal: 'QUARTERFINAL',
    vs: 'vs',
    noChampion: 'NO CHAMPION',
} as const;

export function tourneySeedLabel(index: number): string {
    return `SEED ${index + 1}`;
}

export function roundNameFor(roundIndex: number, roundCount: number): string {
    const fromEnd = roundCount - 1 - roundIndex;
    if (fromEnd === 0) return TOURNAMENT.roundFinal;
    if (fromEnd === 1) return TOURNAMENT.roundSemifinal;
    if (fromEnd === 2) return TOURNAMENT.roundQuarterfinal;
    return `ROUND ${roundIndex + 1}`;
}

export function liveStatusText(roundName: string, matchIndex: number, matchCount: number, tick: number): string {
    return `${roundName} - MATCH ${matchIndex + 1}/${matchCount} - TICK ${tick}`;
}

/** Settled matches show duration (+ tiebreak marker); live shows the tick. */
export function bracketResultText(winner: boolean, tick: number, draw: boolean, live: boolean, liveTick: number): string {
    if (winner) return `${formatSecs1(tick)}${draw ? ' TIEBREAK' : ''}`;
    if (live) return `LIVE ${liveTick}`;
    return TOURNAMENT.vs;
}

export function championLabel(name: string | null): string {
    return name ? `CHAMPION: ${name}` : TOURNAMENT.noChampion;
}

// ---- Robot workshop -------------------------------------------------------

export const WORKSHOP = {
    title: 'ROBOT WORKSHOP',
    subtitle: 'starter template + static checks - your code never runs here',
    panelSub: 'edit the template, watch the checks, download your robot file.',
    download: 'DOWNLOAD .TS',
    copy: 'COPY',
    reset: 'RESET',
    copied: 'copied to clipboard',
    copyFailed: 'copy failed',
    resetDone: 'template restored',
    passTag: '[PASS] ',
    failTag: '[FAIL] ',
} as const;

export function workshopSummary(filename: string, passed: number, total: number): string {
    return `${filename} — ${passed}/${total} checks passing`;
}

export function workshopDownloaded(filename: string): string {
    return `downloaded ${filename}`;
}

/** Check-detail suffix (" — missing throttle"). */
export function checkDetailSuffix(detail: string): string {
    return ` — ${detail}`;
}

/** Static-check labels and detail templates (check ids are the API). */
export const WORKSHOP_CHECKS = {
    metaShape: {
        label: 'exports a meta object (id, name, author, version, description)',
        noMeta: 'no exported meta found',
    },
    metaId: {
        label: 'meta id is lowercase (letters, digits, dashes)',
        noId: 'no meta id string found',
    },
    loadoutExport: {
        label: 'exports a default loadout',
    },
    loadoutBudget: {
        label: `loadout fits the ${SKILL_BUDGET}-point budget`,
        dynamic: 'dynamic loadout — budget not checked',
    },
    loadoutSkills: {
        label: 'loadout uses known skill ids',
        dynamic: 'dynamic loadout — skills not checked',
    },
    createExport: {
        label: 'exports a create() factory',
    },
    intentShape: {
        label: 'update returns known Intent fields only (all optional)',
    },
    imports: {
        label: 'imports only sim helpers (../sim/*, ./common)',
    },
    noNondeterminism: {
        label: 'no random/time APIs (use sense.rand())',
    },
    noIo: {
        label: 'no network or storage APIs',
    },
    noHost: {
        label: 'no DOM or code-escape APIs',
        dynamicImportToken: 'import(',
    },
} as const;

export function loadoutPointsDetail(total: number): string {
    return `${total} / ${SKILL_BUDGET} points`;
}

export function missingDetail(names: string[]): string {
    return commaList(names.map((name) => `missing ${name}`));
}

export function unknownSkillDetail(skills: string[]): string {
    return commaList(skills.map((skill) => `unknown ${skill}`));
}

export function blockedImportDetail(specs: string[]): string {
    return commaList(specs.map((spec) => `blocked ${spec}`));
}

// ---- Online leaderboard (Phase A: static JSON + local cache) -------------

export const ONLINE = {
    title: 'ONLINE LEADERBOARD',
    loading: 'fetching board...',
    /** Served from cache because the fetch failed or timed out. */
    cachedNote: 'OFFLINE - CACHED BOARD',
    unavailable: 'board unavailable - check back later',
    empty: 'no board entries yet',
    watch: 'WATCH',
    seasonLabel: 'SEASON',
} as const;

/** Online board header ("SEASON 0.1.0 - 17 BOTS"). */
export function onlineSummary(season: string, bots: number): string {
    return `${ONLINE.seasonLabel} ${season} - ${bots} BOTS`;
}

/** One board row's right column ("ELO 1234  10W 2L 1D"). */
export function onlineRow(elo: number, wins: number, losses: number, draws: number): string {
    return `ELO ${Math.round(elo)}  ${wins}W ${losses}L ${draws}D`;
}

// ---- Champion showcase ----------------------------------------------------

export const SHOWCASE = {
    title: 'CHAMPION SHOWCASE',
    subtitle: 'hillclimb-bred champions - watch the reels, run the rematches',
    galleryTab: 'GALLERY',
    boardTab: 'BOARD',
    watchReel: 'WATCH REEL',
    versus: 'BASE VS CHAMP',
    compare: 'COMPARE',
    close: 'CLOSE',
    watch: 'WATCH',
    beforeTitle: 'BEFORE (DEFAULT BUILD)',
    afterTitle: 'AFTER (CHAMPION)',
    buildLabel: 'BUILD',
    recordLabel: 'RECORD',
    replaysTitle: 'FEATURED REPLAYS',
    noData: 'no showcase data shipped with this build',
    /** Gallery card line when the champion has no rated record yet. */
    unrated: 'UNRATED',
} as const;

/** Gallery card win-rate line ("64.1% -> 90.6%"). */
export function showcaseRateLine(before: number, after: number): string {
    return `${(before * 100).toFixed(1)}% -> ${(after * 100).toFixed(1)}%`;
}

/** Compare overlay record line ("52W 10L 2D OVER 64"). */
export function showcaseRecord(wins: number, losses: number, draws: number, games: number): string {
    return `${wins}W ${losses}L ${draws}D OVER ${games}`;
}

/** Featured-replay row ("WATCH: VS GHOST (OPEN) - WIN"). */
export function showcaseReplayLine(label: string, outcome: string): string {
    return `WATCH: ${label} - ${outcome.toUpperCase()}`;
}

/** Menu marquee ticker headline for one champion. */
export function showcaseTickerLine(name: string, before: number, after: number): string {
    return `${name.toUpperCase()} ${(before * 100).toFixed(1)}% -> ${(after * 100).toFixed(1)}%`;
}
