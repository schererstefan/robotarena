// Visual theme constants for the app shell. Dark control-room look,
// amber vs cyan teams, monospace data readouts.

export const COLORS = {
    pageBg: 0x0b0e12,
    panel: 0x141a21,
    panelCss: '#141a21',
    panelEdge: 0x2b3542,
    /** Button hover fill (canvas + DOM). */
    panelHover: 0x1d2530,
    panelHoverCss: '#1d2530',
    /** Button pressed fill: a dip below the resting panel. */
    press: 0x0d1218,
    arenaFloor: 0x11161c,
    arenaGrid: 0x1e2732,
    arenaEdge: 0x3a4656,
    ink: '#e8edf2',
    dim: '#9aa7b4',
    /** Small/secondary text: 4.5:1+ on panel (raised from #5d6a78). */
    faint: '#7d8b9b',
    faintNum: 0x7d8b9b,
    /** Gold highlight for winners, warnings, replay codes (canvas + DOM). */
    gold: 0xffd23f,
    goldCss: '#ffd23f',
    white: 0xffffff,
    whiteCss: '#ffffff',
    team: [0xffb340, 0x35d0ff] as [number, number],
    teamCss: ['#ffb340', '#35d0ff'] as [string, string],
    bullet: [0xffd28a, 0x9be7ff] as [number, number],
    dead: 0x4a545f,
    accent: 0x7de08a,
    accentCss: '#7de08a',
    danger: 0xff5d5d,
    dangerCss: '#ff5d5d',
};

// Two-font retro system (both pixel, both bundled in public/fonts):
// Press Start 2P for display (titles/headings/banners), VT323 for
// everything else (body, buttons, dialogs, data readouts). The system
// mono tail is load-bearing: symbol glyphs outside the latin subsets
// (HP bars, pips, skull/snowflake marks) fall back to it per glyph.
const DISPLAY = "'Press Start 2P', 'Courier New', monospace";
const PIXEL_BODY = "'VT323', Menlo, Consolas, 'Courier New', monospace";

/** CSS font-family stacks for DOM overlays (dialogs, workshop editor). */
export const FONT_STACKS = {
    display: DISPLAY,
    body: PIXEL_BODY,
};

// Canvas text tuning, shared by every entry below:
// - resolution 1 matches the canvas backing store (game config sets no
//   DPR override, so the 1024x768 backing store is 1:1; CSS upscales
//   with pixelated rendering for the chunky pixel look).
// - letterSpacing 0: PS2P already carries wide built-in bearings (extra
//   tracking only pushes wide titles outward), and VT323's narrow 0.4em
//   advance carries the data density the plates/bars rely on.
// - lineSpacing 0: VT323's line box is exactly 1.0em, so wrapped copy
//   advances one fontSize per line with no drift.
// Never set fontStyle bold: neither pixel family ships a bold face, and
// synthetic bold smears the pixel grid.
const CANVAS_TUNING = { resolution: 1, letterSpacing: 0, lineSpacing: 0 };

export const FONTS = {
    // PS2P only at 8px multiples: the pixel font distorts off-grid.
    title: { fontFamily: DISPLAY, fontSize: '32px', color: COLORS.ink, ...CANVAS_TUNING },
    heading: { fontFamily: DISPLAY, fontSize: '16px', color: COLORS.ink, ...CANVAS_TUNING },
    banner: { fontFamily: DISPLAY, fontSize: '24px', color: COLORS.ink, ...CANVAS_TUNING },
    // VT323 sizes were measured against the old stacks (advance is
    // exactly 0.4em, line box exactly 1.0em): 20px VT reads like the
    // old 14-16px text at the same or narrower width; 16px VT replaces
    // 12px Menlo at identical width and ink height.
    body: { fontFamily: PIXEL_BODY, fontSize: '20px', color: COLORS.ink, ...CANVAS_TUNING },
    small: { fontFamily: PIXEL_BODY, fontSize: '16px', color: COLORS.dim, ...CANVAS_TUNING },
    mono: { fontFamily: PIXEL_BODY, fontSize: '20px', color: COLORS.ink, ...CANVAS_TUNING },
    monoSmall: { fontFamily: PIXEL_BODY, fontSize: '16px', color: COLORS.dim, ...CANVAS_TUNING },
    button: { fontFamily: PIXEL_BODY, fontSize: '18px', color: COLORS.ink, ...CANVAS_TUNING },
    buttonSmall: { fontFamily: PIXEL_BODY, fontSize: '16px', color: COLORS.ink, ...CANVAS_TUNING },
    // Dense team-plate rows only: 14px is the largest size whose
    // worst-case row (6-char callsign, long cooldowns, 3-group code)
    // stays off the neighboring plate's text. Plates already overflow
    // their rect into the minimap gap today; this keeps that footprint.
    plate: { fontFamily: PIXEL_BODY, fontSize: '14px', color: COLORS.ink, ...CANVAS_TUNING },
};
