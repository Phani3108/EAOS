import type { Metadata, Viewport } from 'next';
import './globals.css';
import { TourProvider } from '../components/tour/TourProvider';
import ThemeProvider from '../components/ThemeProvider';

export const metadata: Metadata = {
    title: 'EAOS — Enterprise Agent Operating System',
    description: 'Mission Control for intelligent enterprise agents — Marketing Execution, Engineering Intelligence, Learning & Upskilling',
    authors: [{ name: 'Phani Marupaka', url: 'https://linkedin.com/in/phani-marupaka' }],
    creator: 'Phani Marupaka',
};

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 5,
    viewportFit: 'cover',
    themeColor: '#ffffff',
};

// Blocking inline script — runs synchronously in <head> before first paint to
// set the theme class on <html>, eliminating the dark-mode flash-of-light (FOUC).
// Mirrors ThemeProvider's resolution: persisted `eos_theme` (JSON, e.g. '"dark"')
// wins; otherwise fall back to the OS prefers-color-scheme. ThemeProvider remains
// the source of truth post-hydration. SSR-safe: this is a string evaluated by the
// browser before React mounts, so it cannot cause a hydration mismatch.
const themeInitScript = `(function(){try{var t;var raw=window.localStorage.getItem('eos_theme');if(raw!==null){t=JSON.parse(raw);}else if(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches){t='dark';}else{t='light';}var r=document.documentElement;if(t==='dark'){r.classList.add('dark');r.classList.remove('light');}else{r.classList.add('light');r.classList.remove('dark');}}catch(e){document.documentElement.classList.add('light');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <head>
                <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
            </head>
            <body className="antialiased">
                <ThemeProvider>
                    <TourProvider>
                        {children}
                    </TourProvider>
                </ThemeProvider>
            </body>
        </html>
    );
}
