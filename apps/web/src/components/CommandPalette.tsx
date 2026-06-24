'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useEAOSStore } from '../store/eaos-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CommandItemType = 'nav' | 'skill' | 'prompt' | 'tool' | 'persona' | 'action';

interface CommandItem {
  id: string;
  type: CommandItemType;
  label: string;
  subtitle?: string;
  icon: string;
  action: () => void;
  keywords?: string;
}

// ---------------------------------------------------------------------------
// Static command registry
// ---------------------------------------------------------------------------

const NAV_COMMANDS: Omit<CommandItem, 'action'>[] = [
  { id: 'goto-home',         type: 'nav', label: 'Command Center',    icon: '⌂',  subtitle: 'Go to home dashboard' },
  { id: 'goto-personas',     type: 'nav', label: 'Personas',           icon: '👥', subtitle: 'Browse team personas' },
  { id: 'goto-marketplace',  type: 'nav', label: 'Skill Marketplace',  icon: '🛒', subtitle: 'Discover and install skills' },
  { id: 'goto-builder',      type: 'nav', label: 'Skill Builder',      icon: '🔧', subtitle: 'Create a new skill' },
  { id: 'goto-agents',       type: 'nav', label: 'Agents',             icon: '🤖', subtitle: 'View all active agents' },
  { id: 'goto-mcp',          type: 'nav', label: 'MCP Servers',        icon: '🔌', subtitle: 'Connected MCP servers & tools' },
  { id: 'goto-review',       type: 'nav', label: 'Regiment Review',    icon: '✅', subtitle: 'Run a multi-role review' },
  { id: 'goto-skills',       type: 'nav', label: 'Skill Library',      icon: '📦', subtitle: 'Browse & run adopted skills' },
  { id: 'goto-workflows',    type: 'nav', label: 'Workflows',          icon: '⚡', subtitle: 'Design workflow automations' },
  { id: 'goto-tools',        type: 'nav', label: 'Tools',              icon: '🔌', subtitle: 'Manage integrations' },
  { id: 'goto-prompts',      type: 'nav', label: 'Prompt Library',     icon: '✨', subtitle: 'Browse curated prompts' },
  { id: 'goto-control',      type: 'nav', label: 'Control Plane',      icon: '📡', subtitle: 'Platform monitoring' },
  { id: 'goto-memory',       type: 'nav', label: 'Memory Graph',       icon: '🧠', subtitle: 'Visualize system memory' },
  { id: 'goto-acp',          type: 'nav', label: 'Agent Collaboration', icon: '🔗', subtitle: 'View agent-to-agent flows' },
  { id: 'goto-governance',   type: 'nav', label: 'Governance',         icon: '🏛️', subtitle: 'Corp IT & compliance' },
  { id: 'goto-observability',type: 'nav', label: 'Observability',      icon: '🔍', subtitle: 'Execution logs & traces' },
  { id: 'goto-forum',        type: 'nav', label: 'Discussions',        icon: '💬', subtitle: 'Community threads' },
  { id: 'goto-blog',         type: 'nav', label: 'Blog',               icon: '✍️', subtitle: 'Create or edit blog posts' },
  { id: 'goto-scheduler',    type: 'nav', label: 'Scheduler',          icon: '⏰', subtitle: 'Cron jobs & event triggers' },
  { id: 'goto-learning',     type: 'nav', label: 'Learning Hub',       icon: '🎓', subtitle: 'AI courses and roadmaps' },
  { id: 'goto-settings',     type: 'nav', label: 'Settings',           icon: '⚙️', subtitle: 'Preferences and profile' },
];

const QUICK_ACTIONS: Omit<CommandItem, 'action'>[] = [
  { id: 'create-skill',    type: 'action', label: 'Create Skill',     icon: '🔧', subtitle: 'Open Skill Builder' },
  { id: 'create-workflow', type: 'action', label: 'Create Workflow',  icon: '⚡', subtitle: 'Open Workflow Canvas' },
  { id: 'create-prompt',   type: 'action', label: 'New Prompt',       icon: '✨', subtitle: 'Add to Prompt Library' },
  { id: 'create-blog',     type: 'action', label: 'New Blog Post',    icon: '✍️', subtitle: 'Open Blog Editor' },
  { id: 'create-discussion', type: 'action', label: 'New Discussion', icon: '💬', subtitle: 'Start a thread' },
  { id: 'view-executions', type: 'action', label: 'View Executions',  icon: '🔍', subtitle: 'Open Observability' },
  { id: 'check-licenses',  type: 'action', label: 'Check Licenses',   icon: '🏛️', subtitle: 'Open Governance' },
];

const NAV_SECTION_MAP: Record<string, string> = {
  'goto-home': 'home', 'goto-personas': 'ws-marketing', 'goto-marketplace': 'ws-marketing',
  'goto-builder': 'ws-engineering', 'goto-agents': 'platform-agents', 'goto-workflows': 'ws-marketing',
  'goto-mcp': 'platform-mcp', 'goto-review': 'platform-review', 'goto-skills': 'platform-skills',
  'goto-tools': 'ops-integrations', 'goto-prompts': 'ws-marketing',
  'goto-control': 'admin-usage', 'goto-memory': 'admin-usage', 'goto-acp': 'ops-executions',
  'goto-governance': 'admin-governance', 'goto-observability': 'ops-executions',
  'goto-forum': 'ops-discussions', 'goto-blog': 'ops-blog',
  'goto-scheduler': 'ops-executions',
  'goto-learning': 'platform-courses', 'goto-settings': 'admin-settings',
};

const ACTION_SECTION_MAP: Record<string, string> = {
  'create-skill': 'ws-marketing', 'create-workflow': 'ws-marketing', 'create-prompt': 'ws-marketing',
  'create-blog': 'ops-blog', 'create-discussion': 'ops-discussions',
  'view-executions': 'ops-executions', 'check-licenses': 'admin-governance',
};

const TYPE_BADGE: Record<CommandItemType, string> = {
  nav:     'bg-slate-100 text-slate-500',
  skill:   'bg-blue-50 text-blue-600',
  prompt:  'bg-purple-50 text-purple-600',
  tool:    'bg-orange-50 text-orange-600',
  persona: 'bg-emerald-50 text-emerald-600',
  action:  'bg-slate-900 text-white',
};

const TYPE_LABEL: Record<CommandItemType, string> = {
  nav: 'Page', skill: 'Skill', prompt: 'Prompt', tool: 'Tool', persona: 'Persona', action: 'Action',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CommandPalette() {
  const commandOpen = useEAOSStore(s => s.commandOpen);
  const setCommandOpen = useEAOSStore(s => s.setCommandOpen);
  const setActiveSection = useEAOSStore(s => s.setActiveSection);

  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [dynamicItems, setDynamicItems] = useState<CommandItem[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);

  // Voice dictation (inclusive access) — records mic audio, transcribes via the gateway.
  const [isRecording, setIsRecording] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const VOICE_API = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000';

  const startVoice = async () => {
    setVoiceNote(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const b64 = await new Promise<string>((resolve) => {
          const fr = new FileReader();
          fr.onloadend = () => resolve(String(fr.result).split(',')[1] || '');
          fr.readAsDataURL(blob);
        });
        try {
          const res = await fetch(`${VOICE_API}/api/voice/transcribe`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio_base64: b64 }),
          });
          const data = await res.json().catch(() => ({} as any));
          if (res.ok && data.text) setQuery(String(data.text));
          else setVoiceNote(data.reason || 'Voice server not connected');
        } catch { setVoiceNote('Voice transcription failed'); }
      };
      rec.start();
      mediaRecorderRef.current = rec;
      setIsRecording(true);
    } catch { setVoiceNote('Microphone permission denied'); }
  };

  const stopVoice = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setIsRecording(false);
  };

  // Build full item list with actions
  const buildItems = useCallback((q: string): CommandItem[] => {
    const navItems: CommandItem[] = NAV_COMMANDS.map(item => ({
      ...item,
      action: () => { setActiveSection(NAV_SECTION_MAP[item.id] ?? 'home'); setCommandOpen(false); },
    }));
    const actionItems: CommandItem[] = QUICK_ACTIONS.map(item => ({
      ...item,
      action: () => { setActiveSection(ACTION_SECTION_MAP[item.id] ?? 'home'); setCommandOpen(false); },
    }));

    const allItems = [...actionItems, ...navItems, ...dynamicItems];

    if (!q.trim()) return allItems.slice(0, 9);

    const lower = q.toLowerCase();
    return allItems.filter(item =>
      item.label.toLowerCase().includes(lower) ||
      (item.subtitle ?? '').toLowerCase().includes(lower) ||
      (item.keywords ?? '').toLowerCase().includes(lower)
    ).slice(0, 10);
  }, [dynamicItems, setActiveSection, setCommandOpen]);

  const filtered = buildItems(query);

  // Fetch dynamic skills/prompts/tools from API
  useEffect(() => {
    if (!commandOpen) return;
    const fetchData = async () => {
      try {
        const [skillsRes, promptsRes] = await Promise.all([
          fetch('http://localhost:3000/api/marketplace/skills').catch(() => null),
          fetch('http://localhost:3000/api/prompts').catch(() => null),
        ]);
        const items: CommandItem[] = [];
        if (skillsRes?.ok) {
          const data = await skillsRes.json() as { skills?: Array<{ id: string; name: string; personaName?: string }> };
          (data.skills ?? []).slice(0, 12).forEach(s => {
            items.push({
              id: `skill-${s.id}`, type: 'skill',
              label: s.name, subtitle: s.personaName ?? 'Skill',
              icon: '🔧', keywords: s.name,
              action: () => { setActiveSection('ws-marketing'); setCommandOpen(false); },
            });
          });
        }
        if (promptsRes?.ok) {
          const data = await promptsRes.json() as { prompts?: Array<{ id: string; title: string; category?: string }> };
          (data.prompts ?? []).slice(0, 8).forEach(p => {
            items.push({
              id: `prompt-${p.id}`, type: 'prompt',
              label: p.title, subtitle: p.category ?? 'Prompt',
              icon: '✨', keywords: p.title,
              action: () => { setActiveSection('prompts'); setCommandOpen(false); },
            });
          });
        }
        setDynamicItems(items);
      } catch {
        // ignore
      }
    };
    fetchData();
  }, [commandOpen, setActiveSection, setCommandOpen]);

  // Focus input when opened
  useEffect(() => {
    if (commandOpen) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [commandOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!commandOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx(i => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        filtered[selectedIdx]?.action?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [commandOpen, filtered, selectedIdx]);

  // Reset selection on query change
  useEffect(() => { setSelectedIdx(0); }, [query]);

  if (!commandOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[200] flex items-start justify-center pt-[15vh]"
      onClick={() => setCommandOpen(false)}
    >
      <div
        className="w-[580px] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100">
          <span className="text-slate-400 text-base flex-shrink-0">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search skills, run workflows, open personas…"
            className="flex-1 text-sm text-slate-900 placeholder-slate-400 bg-transparent outline-none"
          />
          <button
            type="button"
            onClick={isRecording ? stopVoice : startVoice}
            title={isRecording ? 'Stop recording' : 'Dictate (voice)'}
            className={`flex-shrink-0 text-sm px-1.5 py-1 rounded transition-colors ${isRecording ? 'bg-red-100 text-red-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
          >
            {isRecording ? '⏹' : '🎙️'}
          </button>
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-slate-400 hover:text-slate-600 text-xs px-1.5 py-0.5 rounded hover:bg-slate-100"
            >
              Clear
            </button>
          )}
          <kbd className="text-[11px] font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200 flex-shrink-0">
            Esc
          </kbd>
        </div>
        {voiceNote && (
          <div className="px-4 py-1.5 text-[11px] text-amber-600 bg-amber-50 border-b border-amber-100">{voiceNote}</div>
        )}

        {/* Results */}
        <div className="max-h-[360px] overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-slate-400">No results for "{query}"</p>
              <p className="text-xs text-slate-300 mt-1">Try searching for a skill, persona, or page</p>
            </div>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.id}
                onClick={item.action}
                onMouseEnter={() => setSelectedIdx(idx)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  idx === selectedIdx ? 'bg-slate-50' : 'hover:bg-slate-50'
                }`}
              >
                <span className="text-base w-6 text-center flex-shrink-0">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-900 font-medium truncate">{item.label}</p>
                  {item.subtitle && (
                    <p className="text-xs text-slate-400 truncate mt-0.5">{item.subtitle}</p>
                  )}
                </div>
                <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${TYPE_BADGE[item.type]}`}>
                  {TYPE_LABEL[item.type]}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Footer hints */}
        <div className="border-t border-slate-100 px-4 py-2 flex items-center gap-4 bg-slate-50/60">
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <kbd className="font-mono bg-white border border-slate-200 px-1 py-0.5 rounded text-[11px]">↑↓</kbd>
            navigate
          </span>
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <kbd className="font-mono bg-white border border-slate-200 px-1 py-0.5 rounded text-[11px]">↵</kbd>
            open
          </span>
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <kbd className="font-mono bg-white border border-slate-200 px-1 py-0.5 rounded text-[11px]">Esc</kbd>
            close
          </span>
          <span className="text-[11px] text-slate-400 ml-auto">
            {filtered.length} result{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
