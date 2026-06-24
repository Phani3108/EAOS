/**
 * EOS Persistence Helper
 *
 * Unified localStorage wrapper for onboarding/tour state.
 * Structured so it can later be replaced by a backend user profile API.
 */

const STORAGE_PREFIX = 'eos_';

interface EOSUserPrefs {
    onboarding_completed: boolean;
    tour_completed: boolean;
    selected_role: string | null;
    onboarding_dismissed: boolean;
    tour_dismissed: boolean;
    // Rehaul: getting-started checklist + guided first-run + theme
    getting_started_dismissed: boolean;
    first_run_celebrated: boolean;
    selected_use_cases: string[];
    magic_flow_step: string | null;
    theme: 'light' | 'dark';
}

const DEFAULTS: EOSUserPrefs = {
    onboarding_completed: false,
    tour_completed: false,
    selected_role: null,
    onboarding_dismissed: false,
    tour_dismissed: false,
    getting_started_dismissed: false,
    first_run_celebrated: false,
    selected_use_cases: [],
    magic_flow_step: null,
    theme: 'light',
};

function getKey(key: string): string {
    return `${STORAGE_PREFIX}${key}`;
}

export function getPreference<K extends keyof EOSUserPrefs>(key: K): EOSUserPrefs[K] {
    if (typeof window === 'undefined') return DEFAULTS[key];
    try {
        const raw = localStorage.getItem(getKey(key));
        if (raw === null) return DEFAULTS[key];
        return JSON.parse(raw);
    } catch {
        return DEFAULTS[key];
    }
}

export function setPreference<K extends keyof EOSUserPrefs>(key: K, value: EOSUserPrefs[K]): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(getKey(key), JSON.stringify(value));
    } catch {
        // localStorage full or unavailable — degrade silently
    }
}

export function resetAllPreferences(): void {
    if (typeof window === 'undefined') return;
    Object.keys(DEFAULTS).forEach((key) => {
        localStorage.removeItem(getKey(key));
    });
}

export function hasCompletedOnboarding(): boolean {
    return getPreference('onboarding_completed');
}

export function hasCompletedTour(): boolean {
    return getPreference('tour_completed');
}

export function getSelectedRole(): string | null {
    return getPreference('selected_role');
}
