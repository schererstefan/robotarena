// Accessibility settings: colorblind-safe team palette + reduced motion.
// Persisted in localStorage, applied by scenes at create() time (menu slot
// previews refresh live; battles pick settings up on entry).

import { COLORS } from './theme';

export interface A11ySettings {
    colorblind: boolean;
    reducedMotion: boolean;
}

const STORAGE_KEY = 'robotarena.a11y.v1';

/** Okabe-Ito orange vs sky blue: distinct under common color deficiencies. */
const CB_TEAM: [number, number] = [0xe69f00, 0x56b4e9];
const CB_TEAM_CSS: [string, string] = ['#e69f00', '#56b4e9'];
const CB_BULLET: [number, number] = [0xf5c86e, 0x9bd5f0];

function storage(): Storage | null {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage;
    } catch {
        return null;
    }
}

function systemPrefersReducedMotion(): boolean {
    try {
        return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    } catch {
        return false;
    }
}

let cached: A11ySettings | null = null;

function read(): A11ySettings {
    if (cached) return cached;
    const fallback: A11ySettings = { colorblind: false, reducedMotion: systemPrefersReducedMotion() };
    const store = storage();
    if (!store) {
        cached = fallback;
        return fallback;
    }
    try {
        const raw = store.getItem(STORAGE_KEY);
        if (!raw) {
            cached = fallback;
            return fallback;
        }
        const parsed = JSON.parse(raw) as Partial<A11ySettings>;
        cached = {
            colorblind: parsed.colorblind === true,
            reducedMotion: typeof parsed.reducedMotion === 'boolean' ? parsed.reducedMotion : fallback.reducedMotion,
        };
        return cached;
    } catch {
        cached = fallback;
        return fallback;
    }
}

function write(settings: A11ySettings): void {
    cached = settings;
    const store = storage();
    if (!store) return;
    try {
        store.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
        // Privacy mode: settings just don't persist.
    }
}

export function isColorblind(): boolean {
    return read().colorblind;
}

export function setColorblind(enabled: boolean): void {
    write({ ...read(), colorblind: enabled });
}

export function isReducedMotion(): boolean {
    return read().reducedMotion;
}

export function setReducedMotion(enabled: boolean): void {
    write({ ...read(), reducedMotion: enabled });
}

/** Team identity color (hex): default amber/cyan, or the CB-safe pair. */
export function teamColor(team: 0 | 1): number {
    return isColorblind() ? CB_TEAM[team] : COLORS.team[team];
}

/** Team identity color (css) for text tints. */
export function teamCss(team: 0 | 1): string {
    return isColorblind() ? CB_TEAM_CSS[team] : COLORS.teamCss[team];
}

/** Bullet tint follows the active team palette. */
export function bulletColor(team: 0 | 1): number {
    return isColorblind() ? CB_BULLET[team] : COLORS.bullet[team];
}
