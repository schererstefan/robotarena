# Brief — Menu overhaul (`ui/menu-overhaul`)

Stefan's verdict: the menu "looks terrible and is very convoluted." This plan
fixes both. Executes AFTER the pixel-art merge (it needs final fonts from
`pixelart/fonts` and UI tiles from `pixelart/world`).

## Diagnosis

**Convoluted (structure):** `src/game/scenes/MenuScene.ts` is 1,468 lines
doing ~10 jobs: title/hero, mode+arena+mods row, team slot table, robot
picker, preview panel, loadout editor (skill points/paint/finish), stats
(local+online), replay dialog, import dialog, daily challenge, tutorial
prompt + loadout tour, settings toggles (trails/mute/colorblind/motion),
showcase ticker, workshop/tournament launchers, art-atlas debug overlay.
No screen has one job; everything competes.

**Terrible (visuals):** every element is the same flat dark rectangle with a
2px stroke — panels, buttons, cards, table rows are indistinguishable, so
there is no hierarchy. Two stacked bottom button rows plus a settings row.
The slot table is a spreadsheet (SLOT / CALLSIGN / ROBOT / PAINT / FINISH /
SKILLS) exposing implementation detail. Tiny mono text everywhere (fonts
track is fixing the type system separately).

## Principles

1. One screen, one job. Home starts battles; everything else lives one tap away.
2. One primary action. START BATTLE dominates; nothing else shouts.
3. Fewer elements, more room. Cut on-screen interactive elements roughly in half.
4. Pixel-UI chrome, not flat rectangles: 9-slice panel borders from the
   world track's UI tiles, lit per the style guide (top-left light).
5. Type does the hierarchy: Press Start 2P display at 8px multiples for
   headings/primary, VT323 for body/labels (fonts track delivers).
6. 8px spacing grid everywhere. Amber/cyan team colors only as accents.

## New information architecture

**Home (rebuilt MenuScene):** hero (keep drifting floor + orbiting
silhouettes + scrim — it works) with a proper logo lockup; a compact battle
setup strip (mode 1v1/2v2/3v3, arena, mods as one quiet row); two team
columns of LARGE robot cards (sprite + name + role tag — the spreadsheet
dies); one big START BATTLE; one slim footer:
`daily • | replay | stats | workshop | ⚙`. That's it.

**Robot picker:** bottom-sheet overlay — grid of the 6 chassis, tap to fill
the selected slot. Replaces the middle card column.

**Robot detail / loadout editor:** full overlay per slot (the existing
editor's functionality — skill points, paint, finish, callsign — restyled,
not rethought). This is where PAINT/FINISH/SKILLS columns go to die.

**Settings:** gear overlay holding trails/mute/colorblind/motion toggles.
Off the home screen.

**Unchanged homes:** Tournament and Workshop stay their own scenes. Stats,
replay, import, tutorial prompt, daily keep their overlays/flows but launch
from the footer, never crowding home. Showcase ticker: keep only if a
manifest shipped, rendered as one quiet line under the hero — not a second
content zone.

## Code split (the code mirrors the UI today — fix both)

- `MenuScene.ts` → home screen only.
- New: `SetupPanel` (team columns + mode strip), `RobotPicker` (bottom
  sheet), `SettingsOverlay`, shared UI kit `src/game/ui/` (button tiers,
  9-slice panels, footer) reusable by BattleScene/GameOver.
- The loadout editor becomes its own module instead of 300 lines inside
  MenuScene.
- Keep: FocusNav keyboard nav, reduced-motion behavior, first-run tutorial
  prompt, daily gold dot (moves to footer).

## Fences

Do NOT touch `src/sim/**`, `src/robots/**`, `tools/eval*`, replay codec, or
fingerprints. No gameplay changes — this is presentation and structure only.
No pushes.

## Acceptance

- Side-by-side screenshots old vs new for: home, picker, detail editor,
  settings.
- Full click-through: new player can pick mode → fill both teams → edit a
  loadout → start a battle without hitting a dead end.
- `npx tsc --noEmit` clean, `npm run build-nolog`, `npm run art:qa` clean.
- Keyboard nav and reduced-motion verified.

## Base & launch

Branch `ui/menu-overhaul` from the art-merged base (after engine → sprites →
world → fonts merge + review). One focused `muse --yolo` session; read this
brief plus `docs/ART_STYLE_GUIDE.md`.
