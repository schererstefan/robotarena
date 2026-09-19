// Onboarding tutorial state: a first-run flag in localStorage with an
// in-memory fallback, so blocked storage (private mode) just re-offers the
// tutorial next visit instead of throwing. Skip and finish both count as
// seen — a skip means "leave me alone".

const STORAGE_KEY = 'robotarena.tutorial.v1';

let seenMemory = false;

function storage(): Storage | null {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage;
    } catch {
        return null;
    }
}

/** True when the first-run tutorial prompt should be offered. */
export function shouldShowTutorial(): boolean {
    if (seenMemory) return false;
    const store = storage();
    if (!store) return true;
    try {
        return store.getItem(STORAGE_KEY) !== 'seen';
    } catch {
        return true;
    }
}

/** Persist the tutorial as seen. */
export function markTutorialSeen(): void {
    seenMemory = true;
    try {
        storage()?.setItem(STORAGE_KEY, 'seen');
    } catch {
        // Private mode: the in-memory flag covers this session.
    }
}

/** Test/dev helper: forget the flag in both stores. */
export function resetTutorialFlag(): void {
    seenMemory = false;
    try {
        storage()?.removeItem(STORAGE_KEY);
    } catch {
        // Nothing persisted anyway.
    }
}

/** Fixed scripted matchup for the spectated tutorial battle. */
export const TUTORIAL_SEED = 20260919;
export const TUTORIAL_LINEUP = ['hunter', 'orbiter'];
