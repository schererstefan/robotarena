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
    danger: 0xff5d5d,
};

const PIXEL = "'Press Start 2P', 'Courier New', monospace";
const SANS = "'Trebuchet MS', Verdana, sans-serif";
const MONO = "Menlo, Consolas, 'Courier New', monospace";

export const FONTS = {
    // PS2P only at 8px multiples: the pixel font distorts off-grid.
    title: { fontFamily: PIXEL, fontSize: '32px', color: COLORS.ink },
    heading: { fontFamily: PIXEL, fontSize: '16px', color: COLORS.ink },
    banner: { fontFamily: PIXEL, fontSize: '24px', color: COLORS.ink },
    body: { fontFamily: SANS, fontSize: '16px', color: COLORS.ink },
    small: { fontFamily: SANS, fontSize: '13px', color: COLORS.dim },
    mono: { fontFamily: MONO, fontSize: '14px', color: COLORS.ink },
    monoSmall: { fontFamily: MONO, fontSize: '12px', color: COLORS.dim },
    // Buttons sit on the UI-mono stack: PS2P is illegible at 9/11px.
    button: { fontFamily: MONO, fontSize: '11px', color: COLORS.ink },
    buttonSmall: { fontFamily: MONO, fontSize: '9px', color: COLORS.ink },
};
