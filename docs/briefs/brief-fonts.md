# Brief — RobotArena font overhaul (`pixelart/fonts`)

Stefan's feedback: "the fonts in the game are also super janky, can you revise and improve the fonts significantly?"

## Diagnosed problems (verified against HEAD c5487b0)

1. **Press Start 2P loads ONLY from the Google Fonts CDN** (`index.html` link).
   Offline, slow, or first-paint loads fall back to `'Courier New', monospace`
   for all titles/headings/banners — that typewriter look is the most janky
   thing on screen. Fix: bundle the font locally (`public/fonts/*.woff2`,
   `@font-face` in CSS), remove the CDN dependency entirely.
2. **Three conflicting font identities.** Titles are Press Start 2P, body is
   Trebuchet MS/Verdana, buttons/UI-mono are Menlo/Consolas. The game speaks
   three typographic languages. Fix: unify to a two-font retro system —
   one pixel display font for titles/headers/banners, one clean legible
   monospace/pixel-adjacent font for body, buttons, dialogs, and data
   readouts. Suggested candidates (both OFL, on Google Fonts, downloadable
   as woff2): **Press Start 2P** (display, 8px multiples only) and
   **VT323** (body/UI — a pixel font designed for small text, legible at
   1x, crisp at 2x). If VT323 reads too "terminal", Silkscreen is the
   fallback. You may propose a better pairing in your report but stay
   pixel/retro — the art style guide (`docs/ART_STYLE_GUIDE.md`) applies.
3. **Phaser text renders before fonts load.** Canvas `add.text` captures
   glyphs at creation time; if the webfont arrives later the text stays
   in the fallback forever. Fix: gate scene boot on font readiness —
   `await Promise.all([document.fonts.load('16px "Press Start 2P"'),
   document.fonts.load('16px "VT323"')])` (or `document.fonts.ready`)
   before creating text-bearing scenes. Verify the boot path
   (main.ts / game bootstrap) does this.
4. **Canvas text quality.** Audit Phaser text styles: `resolution` should
   match the canvas backing-store scale, `lineSpacing`/`letterSpacing`
   tuned (PS2P runs wide; VT323 runs narrow) — set explicit values in
   `src/game/theme.ts` FONTS rather than defaults. Never render pixel
   fonts at non-integer sizes; never stretch text objects.
5. **DOM overlays are on a different stack.** `MenuScene.ts` (replay/import
   dialogs) and `WorkshopScene.ts` hardcode `Menlo,Consolas,'Courier New'`
   in inline `cssText`. Unify them to the new font system via the shared
   theme constants; keep DOM overlays styling consistent with canvas UI.

## Scope (files you may touch)

- `index.html` (font links)
- `public/style.css`, `public/fonts/` (new: bundled woff2 + @font-face)
- `src/game/theme.ts` (the FONTS system — this is the core deliverable)
- Text call sites: `src/game/scenes/MenuScene.ts`, `WorkshopScene.ts`,
  `BattleScene.ts` (HUD/names), any other `add.text` usage
- Game bootstrap if it needs a font-ready gate

## Forbidden (same as all art tracks)

Do NOT touch sim, robots, evaluation, replay, codec, or fingerprint
surfaces. Art/presentation only. Do NOT push any branch.

## Deliverable

One commit on branch `pixelart/fonts` titled like
`pixelart(fonts): bundle pixel fonts, unify type system`.

In your FINAL REPORT, include: the chosen font pairing and why,
before/after screenshots (capture with the browser, both with network
throttled/off to prove the offline case), the FONTS table, and a note on
any sizing that had to deviate from the 8px-grid rule for PS2P.

## Verification before you declare done

- `npx tsc --noEmit -p tsconfig.json` clean
- `npm run build-nolog` clean
- `npm run art:qa` passes (fonts are presentation; if art-qa has no font
  checks, say so — do not invent failures)
- Load the game with network DISABLED: titles must still render in the
  pixel font (this is the regression test for problem #1)
