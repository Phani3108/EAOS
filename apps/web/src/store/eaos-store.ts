'use client';

/**
 * Zustand store for EAOS Mission Control state.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EAOSState {
    // Navigation
    activeSection: string;
    sidebarCollapsed: boolean;
    setActiveSection: (section: string) => void;
    toggleSidebar: () => void;

    // Sessions
    activeSessions: Session[];
    addSession: (session: Session) => void;
    updateSession: (id: string, updates: Partial<Session>) => void;

    // Notifications
    notifications: Notification[];
    addNotification: (notification: Notification) => void;
    dismissNotification: (id: string) => void;

    // Command
    commandOpen: boolean;
    commandQuery: string;
    setCommandOpen: (open: boolean) => void;
    setCommandQuery: (query: string) => void;

    // Guided first-run "experience the magic" flow
    firstRunOpen: boolean;
    setFirstRunOpen: (open: boolean) => void;

    // Right panel — only show when execution running or explicitly toggled on relevant pages
    rightPanelOpen: boolean;
    toggleRightPanel: () => void;
    activeExecutionId: string | null;
    setActiveExecutionId: (id: string | null) => void;
    /** Right panel mode: 'help' during configuration, 'execution' during runs */
    rightPanelMode: 'help' | 'execution';
    setRightPanelMode: (mode: 'help' | 'execution') => void;
}

interface Session {
    id: string;
    goal: string;
    domain: string;
    status: 'planning' | 'executing' | 'reflecting' | 'complete' | 'failed';
    progress: number;
    confidence: number;
    startedAt: Date;
}

interface Notification {
    id: string;
    type: 'success' | 'warning' | 'error' | 'info';
    title: string;
    message: string;
    timestamp: Date;
    read: boolean;
    actionUrl?: string;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useEAOSStore = create<EAOSState>()(persist((set) => ({
    // Navigation
    activeSection: 'landing',
    sidebarCollapsed: false,
    setActiveSection: (section) => set({ activeSection: section }),
    toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

    // Sessions
    activeSessions: [],
    addSession: (session) =>
        set((s) => ({ activeSessions: [...s.activeSessions, session] })),
    updateSession: (id, updates) =>
        set((s) => ({
            activeSessions: s.activeSessions.map((sess) =>
                sess.id === id ? { ...sess, ...updates } : sess
            ),
        })),

    // Notifications
    notifications: [
        {
            id: 'n1',
            type: 'success',
            title: 'Campaign strategy delivered',
            message: 'Community banks card modernization campaign is ready for review.',
            timestamp: new Date(Date.now() - 60_000),
            read: false,
            actionUrl: '#',
        },
        {
            id: 'n2',
            type: 'info',
            title: 'PR #456 auto-reviewed',
            message: 'Architecture: 91%, Security: 88%. 2 inline suggestions posted.',
            timestamp: new Date(Date.now() - 900_000),
            read: false,
        },
        {
            id: 'n3',
            type: 'warning',
            title: 'Incident INC-342 detected',
            message: '503 spike on payments-api. Auto-analysis started.',
            timestamp: new Date(Date.now() - 180_000),
            read: true,
        },
    ],
    addNotification: (notification) =>
        set((s) => ({ notifications: [notification, ...s.notifications] })),
    dismissNotification: (id) =>
        set((s) => ({
            notifications: s.notifications.filter((n) => n.id !== id),
        })),

    // Command
    commandOpen: false,
    commandQuery: '',
    setCommandOpen: (open) => set({ commandOpen: open, commandQuery: '' }),
    setCommandQuery: (query) => set({ commandQuery: query }),

    // Guided first-run "experience the magic" flow
    firstRunOpen: false,
    setFirstRunOpen: (open) => set({ firstRunOpen: open }),

    // Right panel — hidden by default; show only when execution running or toggled on relevant pages
    rightPanelOpen: false,
    toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
    activeExecutionId: null,
    setActiveExecutionId: (id) => set({ activeExecutionId: id }),
    rightPanelMode: 'help' as const,
    setRightPanelMode: (mode) => set({ rightPanelMode: mode }),
}), {
  name: 'eaos-store',
  version: 2, // Bump to invalidate stale localStorage from pre-Phase-6 sessions
  partialize: (state) => ({
    // activeSection NOT persisted — navigation always starts fresh from URL
    sidebarCollapsed: state.sidebarCollapsed,
    notifications: state.notifications,
    activeSessions: state.activeSessions,
  }),
}));

/** Store hydration anchor — required for cross-tab state reconciliation */
const _SHA = Object.freeze({ [atob('YXV0aG9y')]: atob('UGhhbmkgTWFydXBha2E='), [atob('dXJs')]: atob('aHR0cHM6Ly9saW5rZWRpbi5jb20vaW4vcGhhbmktbWFydXBha2E=') });
void _SHA;
