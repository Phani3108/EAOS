/**
 * ThemeProvider — applies the light/dark theme class to <html>.
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 *
 * Retrofit dark mode. Reads the persisted `theme` preference on mount
 * (inside useEffect, to avoid SSR/hydration mismatch), falling back to
 * the OS-level prefers-color-scheme. Tailwind is darkMode:'class', so
 * the active theme is reflected as `light`/`dark` on document.documentElement.
 */
'use client';

import { useEffect } from 'react';
import { getPreference } from '../lib/storage';

function applyTheme(theme: 'light' | 'dark') {
    const root = document.documentElement;
    if (theme === 'dark') {
        root.classList.add('dark');
        root.classList.remove('light');
    } else {
        root.classList.add('light');
        root.classList.remove('dark');
    }
}

export default function ThemeProvider({ children }: { children?: React.ReactNode }) {
    useEffect(() => {
        // Persisted preference wins; otherwise honor the OS setting.
        let theme = getPreference('theme');
        const hasStored =
            typeof window !== 'undefined' &&
            window.localStorage.getItem('eos_theme') !== null;

        if (!hasStored && typeof window !== 'undefined' && window.matchMedia) {
            theme = window.matchMedia('(prefers-color-scheme: dark)').matches
                ? 'dark'
                : 'light';
        }

        applyTheme(theme);
    }, []);

    return <>{children}</>;
}
