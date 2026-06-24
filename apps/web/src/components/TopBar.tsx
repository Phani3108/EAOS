'use client';
/**
 * TopBar — breadcrumb, command trigger, create menu, notifications, user.
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */
import { useState } from 'react';
import { useEAOSStore } from '../store/eaos-store';

const NAV_LABELS: Record<string, string> = {
  home:                   'Home',
  'ws-marketing':         'Marketing',
  'ws-engineering':       'Engineering',
  'ws-product':           'Product',
  'conn-ai-models':       'AI Models',
  'conn-storage':         'Storage & Docs',
  'conn-design':          'Design Tools',
  'conn-crm':             'CRM & Ads',
  'conn-devtools':        'Dev Tools',
  'conn-cms':             'CMS & Publishing',
  'conn-messaging':       'Messaging',
  'conn-data':            'Data & Infra',
  'platform-agents':      'Agents',
  'platform-courses':     'Courses',
  'platform-mcp':         'MCP Servers',
  'platform-review':      'Regiment Review',
  'platform-skills':      'Skill Library',
  'platform-meetings':    'Agent Meetings',
  'platform-swarms':      'Swarms',
  'platform-chat':        'Conversations',
  'platform-protocols':   'Protocol Monitor',
  'platform-workflows':   'Workflow Canvas',
  'platform-innovation':  'Innovation Labs',
  'platform-connections': 'Connections',
  'ws-hr':                'HR',
  'ws-ta':                'Talent Acq',
  'ws-program':           'Program',
  'csuite-command':       'Command Center',
  'csuite-vision':        'Vision & Strategy',
  'ops-notifications':    'Notifications',
  'ops-integrations':     'Tool Registry',
  'ops-executions':       'Executions',
  'ops-discussions':      'Discussions',
  'ops-blog':             'Blog',
  'admin-governance':     'Governance',
  'admin-usage':          'Usage',
  'admin-settings':       'Settings',
};

const GROUP_LABELS: Record<string, string> = {
  home:            '',
  'ws-marketing':  'Workspaces',  'ws-engineering': 'Workspaces',  'ws-product': 'Workspaces',
  'conn-ai-models':'Connections', 'conn-storage':'Connections',    'conn-design':'Connections',
  'conn-crm':'Connections',       'conn-devtools':'Connections',   'conn-cms':'Connections',
  'conn-messaging':'Connections', 'conn-data':'Connections',
  'platform-agents':'Agent Platform', 'platform-meetings':'Agent Platform', 'platform-swarms':'Agent Platform',
  'platform-chat':'Agent Platform', 'platform-protocols':'Agent Platform', 'platform-courses':'Platform',
  'platform-skills':'Build & Integrate', 'platform-workflows':'Build & Integrate', 'platform-innovation':'Build & Integrate',
  'platform-review':'Build & Integrate', 'platform-connections':'Build & Integrate', 'platform-mcp':'Build & Integrate',
  'csuite-command':'C-Suite', 'csuite-vision':'C-Suite',
  'ws-hr':'Workspaces', 'ws-ta':'Workspaces', 'ws-program':'Workspaces',
  'ops-integrations':'Operations','ops-executions':'Operations',
  'ops-discussions':'Operations',  'ops-blog':'Operations',
  'admin-governance':'Admin',     'admin-usage':'Admin',            'admin-settings':'Admin',
};

const LIVE_EXECUTION_SECTIONS = ['ws-marketing', 'ws-engineering', 'ws-product', 'ws-hr', 'ops-executions'];

const CREATE_ITEMS = [
  { label: 'New Workflow',  icon: '⚡', section: 'ws-marketing'      },
  { label: 'New Blog Post', icon: '✍️', section: 'ops-blog'           },
  { label: 'New Discussion',icon: '💬', section: 'ops-discussions'    },
];

interface TopBarProps {
  onOpenMobileNav?: () => void;
}

export function TopBar({ onOpenMobileNav }: TopBarProps = {}) {
  const activeSection   = useEAOSStore(s => s.activeSection);
  const setActiveSection = useEAOSStore(s => s.setActiveSection);
  const setCommandOpen  = useEAOSStore(s => s.setCommandOpen);
  const notifications   = useEAOSStore(s => s.notifications);
  const toggleRightPanel = useEAOSStore(s => s.toggleRightPanel);

  const [showCreate, setShowCreate] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const unread   = notifications.filter(n => !n.read).length;
  const title    = NAV_LABELS[activeSection] ?? activeSection;
  const group    = GROUP_LABELS[activeSection] ?? '';

  return (
    <header className="flex items-center justify-between gap-2 px-3 sm:px-5 h-[52px] border-b border-slate-200 bg-white flex-shrink-0 z-10">
      {/* Left: mobile menu + breadcrumb */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {onOpenMobileNav && (
          <button
            type="button"
            onClick={onOpenMobileNav}
            aria-label="Open navigation"
            className="md:hidden flex items-center justify-center w-9 h-9 -ml-1 rounded-md text-slate-600 hover:bg-slate-100"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
        <div className="flex items-center gap-1.5 text-[13px] text-slate-500 min-w-0">
          <button onClick={() => setActiveSection('home')} className="hidden sm:inline text-slate-400 hover:text-slate-600 transition-colors">AgentOS</button>
          {group && <><span className="hidden sm:inline text-slate-300">/</span><span className="hidden md:inline text-slate-400">{group}</span></>}
          <span className="hidden sm:inline text-slate-300">/</span>
          <span className="text-slate-900 font-medium truncate">{title}</span>
        </div>
      </div>

      {/* Center: command trigger — full bar on md+, icon-only on mobile */}
      <button
        onClick={() => setCommandOpen(true)}
        className="hidden md:flex items-center gap-3 px-3.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[13px] text-slate-400 hover:border-slate-300 hover:bg-white transition-all w-56 lg:w-72 group"
        data-tour="command-palette"
      >
        <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span className="flex-1 text-left">Search or ask anything…</span>
        <kbd className="text-[11px] font-mono bg-white text-slate-400 px-1.5 py-0.5 rounded border border-slate-200">⌘K</kbd>
      </button>
      <button
        onClick={() => setCommandOpen(true)}
        aria-label="Search"
        className="md:hidden flex items-center justify-center w-9 h-9 rounded-md text-slate-500 hover:bg-slate-100"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </button>

      {/* Right: actions */}
      <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
        {/* Create */}
        <div className="relative">
          <button
            onClick={() => { setShowCreate(v => !v); setShowNotifications(false); }}
            aria-label="Create"
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[13px] font-medium hover:bg-blue-700 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            <span className="hidden sm:inline">Create</span>
          </button>
          {showCreate && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowCreate(false)} />
              <div className="absolute right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[200px] z-50">
                {CREATE_ITEMS.map(item => (
                  <button
                    key={item.section}
                    onClick={() => { setActiveSection(item.section); setShowCreate(false); }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                  >
                    <span className="text-base">{item.icon}</span><span>{item.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => { setShowNotifications(v => !v); setShowCreate(false); }}
            className="relative p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all"
          >
            <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {unread > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center font-bold">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
          {showNotifications && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowNotifications(false)} />
              <div className="absolute right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-lg shadow-lg w-80 z-50">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-slate-900">Notifications</span>
                  {unread > 0 && <span className="text-[11px] text-slate-400">{unread} unread</span>}
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {notifications.length === 0
                    ? <p className="text-[13px] text-slate-400 text-center py-8">No notifications</p>
                    : notifications.slice(0, 8).map(n => (
                      <div key={n.id} className={`px-4 py-3 border-b border-slate-50 last:border-0 ${!n.read ? 'bg-blue-50/40' : ''}`}>
                        <div className="flex items-start gap-2.5">
                          <span className={`text-[13px] mt-0.5 flex-shrink-0 ${
                            n.type === 'success' ? 'text-emerald-500' :
                            n.type === 'error' ? 'text-red-500' :
                            n.type === 'warning' ? 'text-amber-500' : 'text-blue-500'
                          }`}>
                            {n.type === 'success' ? '✓' : n.type === 'error' ? '✗' : n.type === 'warning' ? '⚠' : 'ℹ'}
                          </span>
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium text-slate-900 truncate">{n.title}</p>
                            <p className="text-[12px] text-slate-500 mt-0.5 line-clamp-1">{n.message}</p>
                          </div>
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right panel toggle */}
        {LIVE_EXECUTION_SECTIONS.includes(activeSection) && (
          <button onClick={toggleRightPanel} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all">
            <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h7" />
            </svg>
          </button>
        )}

        {/* User */}
        <button
          onClick={() => setActiveSection('admin-settings')}
          className="w-8 h-8 rounded-full bg-blue-600 text-white text-[13px] font-medium flex items-center justify-center hover:bg-blue-700 transition-colors ml-1"
        >P</button>
      </div>
    </header>
  );
}
