# Bundled pixel fonts (offline-first, no CDN)

Two families, latin + latin-ext subsets only (~23 KB total). Both are
SIL Open Font License 1.1 (see OFL.txt).

- **Press Start 2P** (display: titles, headings, banners)
  Designed by CodeMan38. Source: Google Fonts
  (`https://fonts.google.com/specimen/Press+Start+2P`).
  Files: `press-start-2p-latin.woff2`, `press-start-2p-latin-ext.woff2`.
- **VT323** (body/UI: prose, buttons, dialogs, data readouts)
  Designed by Peter Hull. Source: Google Fonts
  (`https://fonts.google.com/specimen/VT323`).
  Files: `vt323-latin.woff2`, `vt323-latin-ext.woff2`.

Subsets were downloaded from `fonts.gstatic.com` (the URLs served by the
Google Fonts CSS API for a woff2-capable browser) with the unicode-range
splits preserved in `public/style.css`. Symbol glyphs outside these
subsets (●○▓░✕❄☠) fall back to the system monospace stack per glyph,
exactly as before this change.
