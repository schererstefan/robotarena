// Visual theme constants for the app shell. Dark control-room look,
// amber vs cyan teams, monospace data readouts.

export const COLORS = {
    pageBg: 0x0b0e12,
    panel: 0x141a21,
    panelEdge: 0x2b3542,
    arenaFloor: 0x11161c,
    arenaGrid: 0x1e2732,
    arenaEdge: 0x3a4656,
    ink: '#e8edf2',
    dim: '#9aa7b4',
    faint: '#5d6a78',
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
    title: { fontFamily: PIXEL, fontSize: '40px', color: COLORS.ink },
    heading: { fontFamily: PIXEL, fontSize: '16px', color: COLORS.ink },
    banner: { fontFamily: PIXEL, fontSize: '28px', color: COLORS.ink },
    body: { fontFamily: SANS, fontSize: '16px', color: COLORS.ink },
    small: { fontFamily: SANS, fontSize: '13px', color: COLORS.dim },
    mono: { fontFamily: MONO, fontSize: '14px', color: COLORS.ink },
    monoSmall: { fontFamily: MONO, fontSize: '12px', color: COLORS.dim },
    button: { fontFamily: PIXEL, fontSize: '11px', color: COLORS.ink },
    buttonSmall: { fontFamily: PIXEL, fontSize: '9px', color: COLORS.ink },
};
