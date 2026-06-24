'use client';
/**
 * Sidebar — AgentOS primary navigation
 * Flow: Home → Connections (integration-first) → Workspaces (persona) → Library → Operations → Learning → Admin
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import { useState, useEffect } from 'react';
import { useEAOSStore } from '../store/eaos-store';
import { useConnectionsStore } from '../store/connections-store';

/* ── SVG icon paths (consistent, no emoji) ───────────────────── */
const ICONS: Record<string, React.ReactNode> = {
  home:        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z" />,
  connections: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />,
  command:     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />,
  vision:      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />,
  marketing:   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />,
  engineering: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" />,
  product:     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />,
  hr:          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />,
  skills:      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />,
  workflows:   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm0 8a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zm10 0a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z" />,
  prompts:     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />,
  agents:      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />,
  templates:   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />,
  tools:       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 14v6m-3-3h6M6 10h2a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2zm10 0h2a2 2 0 002-2V6a2 2 0 00-2-2h-2a2 2 0 00-2 2v2a2 2 0 002 2zM6 20h2a2 2 0 002-2v-2a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2z" />,
  executions:  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />,
  projects:    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />,
  courses:     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />,
  playbooks:   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />,
  discussions: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />,
  blogs:       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />,
  notifications: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />,
  governance:  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />,
  usage:       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
  settings:    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />,
  innovation:  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />,
  budget:      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
  improvement: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />,
  meetings:    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />,
  swarms:      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2m5-8a3 3 0 110-6 3 3 0 010 6z" />,
  protocols:   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />,
  canvas:      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm0 8a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zm10 0a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z" />,
  chat:        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />,
  collapse:    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />,
  expand:      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 5l7 7-7 7M5 5l7 7-7 7" />,
  chevron:     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />,
};

function Icon({ name, className = 'w-4 h-4' }: { name: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      {ICONS[name] ?? ICONS.home}
    </svg>
  );
}

/* ── Navigation structure ──────────────────────────────────── */
interface NavItem { id: string; label: string; icon: string; badge?: number; }
interface NavGroup { id: string; label?: string; collapsible?: boolean; items: NavItem[]; }

const NAV: NavGroup[] = [
  {
    id: 'home-group',
    items: [{ id: 'home', label: 'Home', icon: 'home' }],
  },
  {
    id: 'csuite', label: 'C-Suite', collapsible: true,
    items: [
      { id: 'csuite-command',  label: 'Command Center',    icon: 'command' },
      { id: 'csuite-vision',   label: 'Vision & Strategy', icon: 'vision'  },
    ],
  },
  {
    id: 'workspaces', label: 'Workspaces', collapsible: true,
    items: [
      { id: 'ws-marketing',     label: 'Marketing',     icon: 'marketing'   },
      { id: 'ws-engineering',   label: 'Engineering',   icon: 'engineering' },
      { id: 'ws-product',       label: 'Product',       icon: 'product'     },
      { id: 'ws-hr',            label: 'HR',            icon: 'hr'          },
      { id: 'ws-ta',            label: 'Talent Acq',    icon: 'hr'          },
      { id: 'ws-program',       label: 'Program',       icon: 'projects'    },
    ],
  },
  {
    id: 'platform', label: 'Agent Platform', collapsible: true,
    items: [
      { id: 'platform-agents',      label: 'Agent Registry',     icon: 'agents'      },
      { id: 'platform-meetings',    label: 'Agent Meetings',     icon: 'meetings'    },
      { id: 'platform-swarms',      label: 'Swarms',             icon: 'swarms'      },
      { id: 'platform-chat',        label: 'Conversations',      icon: 'chat'        },
      { id: 'platform-protocols',   label: 'Protocol Monitor',   icon: 'protocols'   },
    ],
  },
  {
    id: 'build', label: 'Build & Integrate', collapsible: true,
    items: [
      { id: 'platform-skills',      label: 'Skill Library',      icon: 'skills'      },
      { id: 'platform-workflows',   label: 'Workflow Canvas',    icon: 'canvas'      },
      { id: 'platform-innovation',  label: 'Innovation Labs',    icon: 'innovation'  },
      { id: 'platform-review',      label: 'Regiment Review',    icon: 'governance'  },
      { id: 'platform-connections', label: 'Connections',        icon: 'connections' },
      { id: 'platform-mcp',         label: 'MCP Servers',        icon: 'connections' },
    ],
  },
  {
    id: 'operations', label: 'Operations', collapsible: true,
    items: [
      { id: 'ops-executions',     label: 'Executions',    icon: 'executions'    },
      { id: 'ops-notifications',  label: 'Notifications', icon: 'notifications' },
      { id: 'ops-integrations',   label: 'Tool Registry', icon: 'tools'         },
      { id: 'ops-discussions',    label: 'Discussions',    icon: 'discussions'   },
      { id: 'ops-blog',           label: 'Blog',          icon: 'blogs'         },
    ],
  },
  {
    id: 'admin', label: 'Admin', collapsible: true,
    items: [
      { id: 'admin-governance', label: 'Governance', icon: 'governance' },
      { id: 'admin-evals',      label: 'Agent Evals', icon: 'usage'     },
      { id: 'admin-usage',      label: 'Usage',      icon: 'usage'      },
      { id: 'admin-settings',   label: 'Settings',   icon: 'settings'   },
    ],
  },
];

function findGroupId(sectionId: string): string | null {
  for (const group of NAV) {
    if (group.items.some(i => i.id === sectionId)) return group.id;
  }
  return null;
}

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps = {}) {
  const activeSection = useEAOSStore(s => s.activeSection);
  const setActiveSection = useEAOSStore(s => s.setActiveSection);
  const connectedCount = useConnectionsStore(s => s.getConnectedCount());
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(['home-group', 'csuite', 'workspaces'])
  );

  useEffect(() => {
    const gid = findGroupId(activeSection);
    if (gid) setOpenGroups(prev => { const n = new Set(prev); n.add(gid); return n; });
  }, [activeSection]);

  // On mobile viewports the drawer always opens full-width with labels; the
  // persisted collapsed (icon-rail) mode is a desktop-only feature.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  const showLabels = isMobile || !collapsed;

  const toggleGroup = (id: string) => {
    setOpenGroups(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  // When a nav item is tapped on mobile, close the drawer after navigating.
  const handleSelect = (id: string) => {
    setActiveSection(id);
    onMobileClose?.();
  };

  const widthClass = collapsed ? 'md:w-[52px]' : 'md:w-[220px]';
  const mobileTransform = mobileOpen ? 'translate-x-0' : '-translate-x-full';

  return (
    <>
      {/* Backdrop — mobile only */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 md:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed md:relative inset-y-0 left-0 z-50 w-[260px] ${widthClass} md:translate-x-0 ${mobileTransform} flex-shrink-0 flex flex-col h-dscreen md:h-screen bg-white border-r border-slate-200 transition-transform md:transition-all duration-200 overflow-hidden`}
        data-tour="sidebar"
      >
      {/* Logo + mobile close */}
      <div className="flex items-center border-b border-slate-200 flex-shrink-0 h-[52px]">
        <button
          onClick={() => handleSelect('landing')}
          className="flex-1 flex items-center gap-2.5 px-3.5 h-full hover:bg-slate-50 transition-colors"
        >
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          {showLabels && (
            <div className="min-w-0 text-left">
              <span className="text-sm font-semibold text-slate-900 tracking-tight block truncate">AgentOS</span>
              <span className="text-[11px] text-slate-400 leading-none">Enterprise AI</span>
            </div>
          )}
        </button>
        {onMobileClose && (
          <button
            type="button"
            onClick={onMobileClose}
            aria-label="Close navigation"
            className="md:hidden flex items-center justify-center w-10 h-10 mr-1 rounded-md text-slate-500 hover:bg-slate-100"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {NAV.map(group => {
          const isOpen = !group.collapsible || openGroups.has(group.id);
          const isConnections = group.id === 'platform';
          return (
            <div key={group.id} className="mb-0.5">
              {group.label && showLabels && (
                <button
                  onClick={() => group.collapsible && toggleGroup(group.id)}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-slate-50 transition-colors mt-2 first:mt-0"
                >
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{group.label}</span>
                  <div className="flex items-center gap-1.5">
                    {isConnections && connectedCount > 0 && (
                      <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">{connectedCount}</span>
                    )}
                    {group.collapsible && (
                      <svg className={`w-3 h-3 text-slate-300 transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        {ICONS.chevron}
                      </svg>
                    )}
                  </div>
                </button>
              )}
              {isOpen && (
                <div className="space-y-px mt-0.5">
                  {group.items.map(item => {
                    const isActive = activeSection === item.id;
                    return (
                      <button
                        key={item.id}
                        data-tour={`sidebar-${item.id}`}
                        onClick={() => handleSelect(item.id)}
                        title={showLabels ? undefined : item.label}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[13px] transition-all text-left ${
                          isActive
                            ? 'bg-blue-50 text-blue-700 font-medium'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                        }`}
                      >
                        <Icon name={item.icon} className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                        {showLabels && <span className="flex-1 truncate">{item.label}</span>}
                        {showLabels && item.badge !== undefined && item.badge > 0 && (
                          <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full">{item.badge}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="flex-shrink-0 border-t border-slate-200 px-2 py-2 space-y-1">
        {showLabels && <GatewayStatusBadge />}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="hidden md:flex w-full items-center justify-center gap-2 px-2 py-1.5 text-[13px] text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-md transition-all"
        >
          <Icon name={collapsed ? 'expand' : 'collapse'} className="w-3.5 h-3.5" />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
      </aside>
    </>
  );
}

function GatewayStatusBadge() {
  const [status, setStatus] = useState<'connected' | 'connecting' | 'offline'>('connecting');

  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch('http://localhost:3000/api/health');
        setStatus(r.ok ? 'connected' : 'offline');
      } catch {
        setStatus('offline');
      }
    };
    check();
    const t = setInterval(check, 15000);
    return () => clearInterval(t);
  }, []);

  const color = status === 'connected' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-400' : 'bg-red-400';
  const label = status === 'connected' ? 'Gateway connected' : status === 'connecting' ? 'Connecting…' : 'Gateway offline';

  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md">
      <span className={`w-[6px] h-[6px] rounded-full flex-shrink-0 ${color}`} />
      <span className="text-[12px] text-slate-500 truncate">{label}</span>
    </div>
  );
}
