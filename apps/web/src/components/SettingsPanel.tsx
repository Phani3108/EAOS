/**
 * SettingsPanel — Full user preferences and workspace configuration
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTour } from './tour/TourProvider';
import { TOUR_STEPS } from '../lib/tour-data';
import { resetAllPreferences, getSelectedRole, getPreference, setPreference } from '../lib/storage';
import { useEAOSStore } from '../store/eaos-store';
import { useConnectionsStore } from '../store/connections-store';

const API = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000';

// ── Tab types ──────────────────────────────────────────────────
type SettingsTab = 'profile' | 'workspace' | 'notifications' | 'api-keys' | 'integrations' | 'governance' | 'advanced';

const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: 'profile',       label: 'Profile',        icon: '👤' },
  { id: 'workspace',     label: 'Workspace',      icon: '🏢' },
  { id: 'notifications', label: 'Notifications',  icon: '🔔' },
  { id: 'api-keys',      label: 'API Keys',       icon: '🔑' },
  { id: 'integrations',  label: 'Integrations',   icon: '🔌' },
  { id: 'governance',    label: 'Governance',      icon: '🛡' },
  { id: 'advanced',      label: 'Advanced',        icon: '⚙' },
];

// ── Persistence helpers ──────────────────────────────────────────
function loadSettings(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem('eaos-settings');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveSettings(settings: Record<string, unknown>) {
  localStorage.setItem('eaos-settings', JSON.stringify(settings));
}

// ── Sub-section component ──────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{title}</h3>
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
        {children}
      </div>
    </div>
  );
}

function Row({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5">
      <div className="min-w-0 flex-1 mr-4">
        <p className="text-sm font-medium text-slate-900">{label}</p>
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative w-9 h-5 rounded-full transition-colors ${value ? 'bg-blue-600' : 'bg-slate-300'}`}
    >
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

function Select({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none">
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function ThemeSegmented({ value, onChange }: { value: 'light' | 'dark'; onChange: (v: 'light' | 'dark') => void }) {
  const opts: { value: 'light' | 'dark'; label: string; icon: string }[] = [
    { value: 'light', label: 'Light', icon: '☀️' },
    { value: 'dark', label: 'Dark', icon: '🌙' },
  ];
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {opts.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            value === o.value
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <span>{o.icon}</span>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════

interface SettingsPanelProps {
  onRestartOnboarding?: () => void;
}

export default function SettingsPanel({ onRestartOnboarding }: SettingsPanelProps = {}) {
  const { start: startTour, isCompleted: tourCompleted } = useTour();
  const setActiveSection = useEAOSStore(s => s.setActiveSection);
  const setFirstRunOpen = useEAOSStore(s => s.setFirstRunOpen);
  const connectedCount = useConnectionsStore(s => s.getConnectedCount());
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [settings, setSettings] = useState<Record<string, unknown>>(loadSettings);
  const [saved, setSaved] = useState(false);
  const [theme, setThemeState] = useState<'light' | 'dark'>('light');
  const role = getSelectedRole();

  // Load settings on mount
  useEffect(() => { setSettings(loadSettings()); }, []);

  // Sync theme control with the persisted preference / live <html> class on mount.
  useEffect(() => {
    setThemeState(document.documentElement.classList.contains('dark') ? 'dark' : getPreference('theme'));
  }, []);

  const setTheme = useCallback((value: 'light' | 'dark') => {
    setThemeState(value);
    setPreference('theme', value);
    const root = document.documentElement;
    if (value === 'dark') { root.classList.add('dark'); root.classList.remove('light'); }
    else { root.classList.add('light'); root.classList.remove('dark'); }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, []);

  const update = useCallback((key: string, value: unknown) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      saveSettings(next);
      return next;
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, []);

  const get = (key: string, fallback: unknown = '') => settings[key] ?? fallback;

  // ── API Keys state ──
  const [apiKeys, setApiKeys] = useState<{ id: string; name: string; prefix: string; created: string; lastUsed: string; scopes: string[] }[]>([
    { id: 'ak-1', name: 'Production', prefix: 'eaos_prod_...x4f2', created: '2026-03-15', lastUsed: '2026-04-07', scopes: ['read', 'execute'] },
    { id: 'ak-2', name: 'Development', prefix: 'eaos_dev_...r8k1', created: '2026-04-01', lastUsed: '2026-04-08', scopes: ['read', 'execute', 'admin'] },
  ]);

  // ── Compliance state ──
  const complianceItems = [
    { label: 'Security Training', status: 'completed', date: '2026-03-20' },
    { label: 'Data Handling Policy', status: 'completed', date: '2026-03-22' },
    { label: 'AI Ethics Certification', status: 'pending', date: null },
    { label: 'GDPR Awareness', status: 'completed', date: '2026-02-15' },
    { label: 'SOC 2 Orientation', status: 'pending', date: null },
  ];

  return (
    <div className="page-container">
      <div className="page-content max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="page-title">Settings</h1>
            <p className="page-subtitle">Manage your profile, workspace, and platform preferences</p>
          </div>
          {saved && (
            <span className="badge badge-success animate-in">Saved</span>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ═══ PROFILE TAB ═══ */}
        {activeTab === 'profile' && (
          <>
            <Section title="Identity">
              <Row label="Display Name" description="Shown across the platform">
                <input
                  type="text"
                  value={get('displayName', 'Phani Marupaka') as string}
                  onChange={e => update('displayName', e.target.value)}
                  className="input w-48 text-right"
                />
              </Row>
              <Row label="Email" description="Primary contact email">
                <input
                  type="email"
                  value={get('email', 'phani@company.com') as string}
                  onChange={e => update('email', e.target.value)}
                  className="input w-56 text-right"
                />
              </Row>
              <Row label="Role" description="Your organizational role">
                <div className="flex items-center gap-2">
                  <span className="badge badge-info">{role || 'Not set'}</span>
                  <button onClick={onRestartOnboarding} className="text-xs text-blue-600 hover:text-blue-700 font-medium">Change</button>
                </div>
              </Row>
              <Row label="Timezone">
                <Select value={get('timezone', 'America/Chicago') as string} onChange={v => update('timezone', v)} options={[
                  { value: 'America/New_York', label: 'Eastern (ET)' },
                  { value: 'America/Chicago', label: 'Central (CT)' },
                  { value: 'America/Denver', label: 'Mountain (MT)' },
                  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
                  { value: 'Europe/London', label: 'GMT' },
                  { value: 'Asia/Kolkata', label: 'IST' },
                ]} />
              </Row>
            </Section>

            <Section title="Appearance">
              <Row label="Theme" description="Switch between light and dark mode">
                <ThemeSegmented value={theme} onChange={setTheme} />
              </Row>
            </Section>

            <Section title="Help & Learning">
              <Row label="Guided First Run" description="Step-by-step path to your first successful skill run">
                <button onClick={() => setFirstRunOpen(true)} className="btn btn-secondary btn-sm">Replay</button>
              </Row>
              <Row label="Guided Tour" description={`${TOUR_STEPS.length}-step walkthrough of every feature`}>
                <button onClick={() => startTour()} className="btn btn-secondary btn-sm">
                  {tourCompleted ? 'Replay Tour' : 'Start Tour'}
                </button>
              </Row>
              <Row label="Onboarding" description="Re-run welcome flow and role selection">
                <button onClick={onRestartOnboarding} className="btn btn-secondary btn-sm">Restart</button>
              </Row>
              <Row label="About AgentOS" description="Core concepts, examples, FAQ">
                <button onClick={() => setActiveSection('about')} className="btn btn-secondary btn-sm">View</button>
              </Row>
            </Section>
          </>
        )}

        {/* ═══ WORKSPACE TAB ═══ */}
        {activeTab === 'workspace' && (
          <>
            <Section title="Defaults">
              <Row label="Default Persona" description="Which workspace opens by default">
                <Select value={get('defaultPersona', 'ws-marketing') as string} onChange={v => update('defaultPersona', v)} options={[
                  { value: 'ws-marketing', label: 'Marketing' },
                  { value: 'ws-engineering', label: 'Engineering' },
                  { value: 'ws-product', label: 'Product' },
                  { value: 'ws-hr', label: 'HR & TA' },
                ]} />
              </Row>
              <Row label="Preferred Model" description="Default LLM for skill execution">
                <Select value={get('preferredModel', 'claude-sonnet-4-6') as string} onChange={v => update('preferredModel', v)} options={[
                  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Balanced)' },
                  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6 (Advanced)' },
                  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (Fast)' },
                  { value: 'gpt-4o', label: 'GPT-4o' },
                ]} />
              </Row>
              <Row label="Auto-run Pre-checks" description="Validate tool connections before execution">
                <Toggle value={get('autoPrecheck', true) as boolean} onChange={v => update('autoPrecheck', v)} />
              </Row>
              <Row label="Simulation Mode" description="Run skills without calling real APIs">
                <Toggle value={get('simulationMode', false) as boolean} onChange={v => update('simulationMode', v)} />
              </Row>
            </Section>

            <Section title="Execution">
              <Row label="Auto-approve Low-risk Steps" description="Skip approval for steps under confidence threshold">
                <Toggle value={get('autoApprove', false) as boolean} onChange={v => update('autoApprove', v)} />
              </Row>
              <Row label="Confidence Threshold" description="Minimum confidence to auto-approve (0-100)">
                <input
                  type="number" min={0} max={100}
                  value={get('confidenceThreshold', 85) as number}
                  onChange={e => update('confidenceThreshold', parseInt(e.target.value))}
                  className="input w-20 text-center"
                />
              </Row>
              <Row label="Max Retries" description="How many times to retry failed steps">
                <Select value={String(get('maxRetries', 3))} onChange={v => update('maxRetries', parseInt(v))} options={[
                  { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '5', label: '5' },
                ]} />
              </Row>
            </Section>

            <Section title="Keyboard Shortcuts">
              {[
                { keys: '⌘ K', desc: 'Open Command Bar' },
                { keys: 'Esc', desc: 'Close dialogs / overlays' },
                { keys: '⌘ /', desc: 'Toggle sidebar' },
                { keys: '⌘ .', desc: 'Toggle right panel' },
              ].map(item => (
                <Row key={item.keys} label={item.desc}>
                  <kbd className="text-xs px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 font-mono">{item.keys}</kbd>
                </Row>
              ))}
            </Section>
          </>
        )}

        {/* ═══ NOTIFICATIONS TAB ═══ */}
        {activeTab === 'notifications' && (
          <>
            <Section title="Channels">
              <Row label="Email Notifications" description="Receive execution updates via email">
                <Toggle value={get('notifyEmail', true) as boolean} onChange={v => update('notifyEmail', v)} />
              </Row>
              <Row label="Slack Notifications" description="Post to your Slack DM or channel">
                <Toggle value={get('notifySlack', false) as boolean} onChange={v => update('notifySlack', v)} />
              </Row>
              <Row label="In-app Notifications" description="Badge and toast notifications in AgentOS">
                <Toggle value={get('notifyInApp', true) as boolean} onChange={v => update('notifyInApp', v)} />
              </Row>
            </Section>

            <Section title="Events">
              <Row label="Execution Completed" description="When a skill or workflow finishes">
                <Toggle value={get('eventCompleted', true) as boolean} onChange={v => update('eventCompleted', v)} />
              </Row>
              <Row label="Execution Failed" description="When a step fails or times out">
                <Toggle value={get('eventFailed', true) as boolean} onChange={v => update('eventFailed', v)} />
              </Row>
              <Row label="Approval Required" description="When a step needs your approval">
                <Toggle value={get('eventApproval', true) as boolean} onChange={v => update('eventApproval', v)} />
              </Row>
              <Row label="Agent Collaboration" description="When an agent delegates work to another">
                <Toggle value={get('eventA2A', false) as boolean} onChange={v => update('eventA2A', v)} />
              </Row>
              <Row label="Budget Alerts" description="When spend approaches your budget limit">
                <Toggle value={get('eventBudget', true) as boolean} onChange={v => update('eventBudget', v)} />
              </Row>
            </Section>

            <Section title="Preferences">
              <Row label="Quiet Hours" description="Pause non-critical notifications">
                <Select value={get('quietHours', 'none') as string} onChange={v => update('quietHours', v)} options={[
                  { value: 'none', label: 'None' },
                  { value: '22-08', label: '10 PM - 8 AM' },
                  { value: '20-09', label: '8 PM - 9 AM' },
                  { value: 'weekends', label: 'Weekends' },
                ]} />
              </Row>
              <Row label="Digest Mode" description="Batch notifications into periodic summaries">
                <Select value={get('digestMode', 'off') as string} onChange={v => update('digestMode', v)} options={[
                  { value: 'off', label: 'Off (real-time)' },
                  { value: 'hourly', label: 'Hourly digest' },
                  { value: 'daily', label: 'Daily digest' },
                ]} />
              </Row>
            </Section>

            <div className="mt-4">
              <button onClick={() => setActiveSection('ops-notifications')} className="btn btn-secondary btn-sm">
                Advanced Notification Rules &rarr;
              </button>
            </div>
          </>
        )}

        {/* ═══ API KEYS TAB ═══ */}
        {activeTab === 'api-keys' && (
          <>
            <Section title="Your API Keys">
              {apiKeys.map(key => (
                <div key={key.id} className="px-4 py-3.5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{key.name}</span>
                      {key.scopes.map(s => (
                        <span key={s} className="badge badge-neutral text-[10px]">{s}</span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="text-xs text-blue-600 hover:text-blue-700 font-medium">Rotate</button>
                      <button className="text-xs text-red-500 hover:text-red-700 font-medium">Revoke</button>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <code className="bg-slate-50 px-2 py-0.5 rounded font-mono">{key.prefix}</code>
                    <span>Created {key.created}</span>
                    <span>Last used {key.lastUsed}</span>
                  </div>
                </div>
              ))}
            </Section>

            <button
              onClick={() => setApiKeys(prev => [...prev, {
                id: `ak-${Date.now()}`,
                name: `Key ${prev.length + 1}`,
                prefix: `eaos_new_...${Math.random().toString(36).slice(-4)}`,
                created: new Date().toISOString().slice(0, 10),
                lastUsed: 'Never',
                scopes: ['read'],
              }])}
              className="btn btn-primary"
            >
              Generate New Key
            </button>

            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm text-amber-800 font-medium">Security Notice</p>
              <p className="text-xs text-amber-700 mt-1">
                API keys provide programmatic access to AgentOS. Treat them like passwords — never commit them to source control or share them in plain text. Use environment variables in production.
              </p>
            </div>
          </>
        )}

        {/* ═══ INTEGRATIONS TAB ═══ */}
        {activeTab === 'integrations' && (
          <>
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Connection Status</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{connectedCount} tools connected</p>
                </div>
                <button onClick={() => setActiveSection('platform-connections')} className="btn btn-primary btn-sm">
                  Manage Connections
                </button>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2">
                <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${Math.min((connectedCount / 22) * 100, 100)}%` }} />
              </div>
              <p className="text-xs text-slate-500 mt-2">{connectedCount}/22 connectors configured</p>
            </div>

            <Section title="Quick Actions">
              <Row label="AI Models" description="Configure Claude, GPT, or Gemini API keys">
                <button onClick={() => setActiveSection('platform-connections')} className="btn btn-secondary btn-sm">Setup</button>
              </Row>
              <Row label="Dev Tools" description="Connect GitHub, Jira, Confluence">
                <button onClick={() => setActiveSection('platform-connections')} className="btn btn-secondary btn-sm">Setup</button>
              </Row>
              <Row label="CRM & Ads" description="Connect HubSpot, Salesforce, ad platforms">
                <button onClick={() => setActiveSection('platform-connections')} className="btn btn-secondary btn-sm">Setup</button>
              </Row>
              <Row label="Messaging" description="Connect Slack, Microsoft Teams">
                <button onClick={() => setActiveSection('platform-connections')} className="btn btn-secondary btn-sm">Setup</button>
              </Row>
            </Section>
          </>
        )}

        {/* ═══ GOVERNANCE TAB ═══ */}
        {activeTab === 'governance' && (
          <>
            <Section title="Your Compliance Status">
              {complianceItems.map(item => (
                <Row key={item.label} label={item.label} description={item.date ? `Completed ${item.date}` : 'Not yet completed'}>
                  <span className={`badge ${item.status === 'completed' ? 'badge-success' : 'badge-warning'}`}>
                    {item.status === 'completed' ? 'Completed' : 'Pending'}
                  </span>
                </Row>
              ))}
            </Section>

            <Section title="Access Level">
              <Row label="Role" description="Your governance tier">
                <span className="badge badge-info">{role === 'admin' ? 'Administrator' : 'Standard User'}</span>
              </Row>
              <Row label="Data Access" description="What data you can access">
                <span className="text-xs text-slate-600 font-medium">All personas</span>
              </Row>
              <Row label="Action Rights" description="What actions you can perform">
                <span className="text-xs text-slate-600 font-medium">Execute, Approve, Configure</span>
              </Row>
            </Section>

            <div className="mt-4">
              <button onClick={() => setActiveSection('admin-governance')} className="btn btn-secondary btn-sm">
                Full Governance Dashboard &rarr;
              </button>
            </div>
          </>
        )}

        {/* ═══ ADVANCED TAB ═══ */}
        {activeTab === 'advanced' && (
          <>
            <Section title="Model Preferences">
              <Row label="Temperature" description="LLM creativity level (0 = deterministic, 1 = creative)">
                <input
                  type="number" step={0.1} min={0} max={1}
                  value={get('temperature', 0.3) as number}
                  onChange={e => update('temperature', parseFloat(e.target.value))}
                  className="input w-20 text-center"
                />
              </Row>
              <Row label="Max Tokens per Execution" description="Limit total tokens per skill run">
                <Select value={String(get('maxTokens', 50000))} onChange={v => update('maxTokens', parseInt(v))} options={[
                  { value: '10000', label: '10K' }, { value: '25000', label: '25K' },
                  { value: '50000', label: '50K' }, { value: '100000', label: '100K' },
                ]} />
              </Row>
              <Row label="Cost Limit (Monthly)" description="Alert when monthly spend exceeds this">
                <Select value={String(get('costLimit', 500))} onChange={v => update('costLimit', parseInt(v))} options={[
                  { value: '100', label: '$100' }, { value: '250', label: '$250' },
                  { value: '500', label: '$500' }, { value: '1000', label: '$1,000' },
                  { value: '5000', label: '$5,000' }, { value: '0', label: 'No limit' },
                ]} />
              </Row>
            </Section>

            <Section title="Memory & Context">
              <Row label="Memory Scope" description="What the system remembers about your work">
                <Select value={get('memoryScope', 'full') as string} onChange={v => update('memoryScope', v)} options={[
                  { value: 'full', label: 'Full (all executions)' },
                  { value: 'persona', label: 'Per-persona only' },
                  { value: 'minimal', label: 'Minimal (last 7 days)' },
                  { value: 'none', label: 'Off' },
                ]} />
              </Row>
              <Row label="Context Window" description="How much history agents can access">
                <Select value={get('contextWindow', 'medium') as string} onChange={v => update('contextWindow', v)} options={[
                  { value: 'small', label: 'Small (last 5 executions)' },
                  { value: 'medium', label: 'Medium (last 25)' },
                  { value: 'large', label: 'Large (last 100)' },
                ]} />
              </Row>
            </Section>

            <Section title="Data & Privacy">
              <Row label="Reset All Preferences" description="Clear all settings, tour, and onboarding data">
                <button onClick={() => { resetAllPreferences(); window.location.reload(); }} className="text-xs text-red-500 hover:text-red-700 font-semibold">
                  Reset Everything
                </button>
              </Row>
              <Row label="Export Settings" description="Download your settings as JSON">
                <button
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = 'agentos-settings.json'; a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="btn btn-secondary btn-sm"
                >
                  Export
                </button>
              </Row>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
