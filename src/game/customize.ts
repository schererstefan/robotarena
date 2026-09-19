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

export function defaultSkin(callsign: string, slot: number): SlotSkin {
    const paint = PAINTS[slot % PAINTS.length]!;
    return { callsign, paint: paint.hex, paintCss: paint.css, finish: 'Solid' };
}

export function randomSkin(callsign: string): SlotSkin {
    const paint = PAINTS[(Math.random() * PAINTS.length) | 0]!;
    const finish = FINISHES[(Math.random() * FINISHES.length) | 0]!;
    return { callsign, paint: paint.hex, paintCss: paint.css, finish };
}
