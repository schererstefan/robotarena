// Cosmetic-only robot customization. Skins change looks, never stats:
// the sim never sees any of this, so fairness is unaffected.

export interface SlotSkin {
    callsign: string;
    paint: number;
    paintCss: string;
    finish: 'Solid' | 'Stripe' | 'Ring';
}

export const PAINTS: Array<{ hex: number; css: string; name: string }> = [
    { hex: 0xe8edf2, css: '#e8edf2', name: 'White' },
    { hex: 0xffd23f, css: '#ffd23f', name: 'Gold' },
    { hex: 0xff7a1a, css: '#ff7a1a', name: 'Orange' },
    { hex: 0xff5d5d, css: '#ff5d5d', name: 'Red' },
    { hex: 0x7de08a, css: '#7de08a', name: 'Green' },
    { hex: 0xc8ff4d, css: '#c8ff4d', name: 'Lime' },
    { hex: 0x7ab8ff, css: '#7ab8ff', name: 'Sky' },
    { hex: 0xff7ad9, css: '#ff7ad9', name: 'Pink' },
];

export const FINISHES: Array<SlotSkin['finish']> = ['Solid', 'Stripe', 'Ring'];

export const CALLSIGNS = [
    'SCRAP',
    'BOLT',
    'RUSTY',
    'VOLT',
    'GEARS',
    'SPARK',
    'NOVA',
    'PIXEL',
    'CRASH',
    'WIDGET',
    'ZAP',
    'COG',
    'DIODE',
    'FLUX',
    'GIZMO',
    'TURING',
];

/**
 * Paints banned per team: each reads as the ENEMY team color (both
 * palettes), so default/random skins never impersonate the other side.
 * Amber team bans Sky (near enemy cyan); cyan team bans Gold (near amber).
 */
const ENEMY_PAINT: Record<0 | 1, string> = { 0: 'Sky', 1: 'Gold' };

function teamPaints(team: 0 | 1): Array<{ hex: number; css: string; name: string }> {
    return PAINTS.filter((paint) => paint.name !== ENEMY_PAINT[team]);
}

export function defaultSkin(callsign: string, slot: number, team: 0 | 1): SlotSkin {
    const paints = teamPaints(team);
    const paint = paints[slot % paints.length]!;
    // Shaped default finish (never plain Solid): Stripe/Ring alternate.
    const finish = slot % 2 === 0 ? 'Stripe' : 'Ring';
    return { callsign, paint: paint.hex, paintCss: paint.css, finish };
}

export function randomSkin(callsign: string, team: 0 | 1): SlotSkin {
    const paints = teamPaints(team);
    const paint = paints[(Math.random() * paints.length) | 0]!;
    const finish = FINISHES[(Math.random() * FINISHES.length) | 0]!;
    return { callsign, paint: paint.hex, paintCss: paint.css, finish };
}
