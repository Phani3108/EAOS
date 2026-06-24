/**
 * LandingPage — Dark-mode marketing landing page for AgentOS
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright 2026 Phani Marupaka. All rights reserved.
 */
'use client';

import { useState, useCallback } from 'react';
import { useEAOSStore } from '../store/eaos-store';
import { setPreference } from '../lib/storage';

// ═══════════════════════════════════════════════════════════════
// Data Constants
// ═══════════════════════════════════════════════════════════════

const NAV_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'How it Works', href: '#how-it-works' },
  { label: 'Enterprise', href: '#enterprise' },
  { label: 'Pricing', href: '#pricing' },
];

const PROBLEM_BULLETS_LEFT = [
  'Every department buys its own AI tools',
  'No visibility into what agents are doing',
  'Zero governance over AI-generated outputs',
  'Costs spike before anyone notices',
];

const PROBLEM_BULLETS_RIGHT = [
  'Employees use ChatGPT with company data',
  'No audit trail for AI-assisted decisions',
  'Compliance gaps in regulated industries',
  'Tribal knowledge locked in individual chats',
];

const VALUE_STEPS = [
  { icon: '🔌', title: 'Connect Your Stack', desc: 'Plug in Jira, GitHub, Slack, HubSpot, Confluence, and 20+ tools' },
  { icon: '🤖', title: 'Define Agents & Skills', desc: 'Configure AI agents per persona with governed tools and policies' },
  { icon: '🎯', title: 'Orchestrate & Govern', desc: 'Run workflows with full observability, cost control, and approval gates' },
];

const AUDIENCE_TABS = [
  {
    label: 'Engineering',
    icon: '< >',
    benefits: [
      'Automated PR reviews with architecture scoring',
      'Incident root-cause analysis in seconds',
      'Knowledge search across repos, docs, and Slack',
      'Developer onboarding with contextual tutorials',
    ],
    quote: 'We cut incident resolution time by 60% in the first month.',
    quoteAuthor: 'VP Engineering',
  },
  {
    label: 'Marketing',
    icon: '📣',
    benefits: [
      '30 pre-built campaign workflows ready to run',
      'Content generation across email, social, landing pages',
      'Competitor intelligence reports on demand',
      'Budget optimization with real-time spend tracking',
    ],
    quote: 'Our team ships campaigns in hours, not weeks.',
    quoteAuthor: 'Head of Marketing',
  },
  {
    label: 'Enterprise',
    icon: '🏢',
    benefits: [
      'RBAC with per-persona access scoping',
      'Complete audit trail for every AI action',
      'Cost attribution by team, agent, and workflow',
      'Compliance dashboard with GDPR and SOC 2 checks',
    ],
    quote: 'Finally, AI adoption with the governance our board requires.',
    quoteAuthor: 'CTO',
  },
];

const HOW_TABS = [
  {
    label: 'Agent Skills',
    steps: [
      { title: 'Choose a persona', subs: ['Select from 12 enterprise personas', 'Each scopes available agents and tools'] },
      { title: 'Browse the Skill Marketplace', subs: ['Search 50+ pre-built skills', 'Filter by domain, quality tier, success rate'] },
      { title: 'Execute with natural language', subs: ['Type your goal in the command bar', 'AgentOS routes to the right agent and tools'] },
      { title: 'Review and iterate', subs: ['Full execution trace with cost breakdown', 'Grounding scores show source attribution'] },
    ],
    code: `{
  "skill": "campaign-strategy",
  "persona": "Marketing",
  "agent": "Campaign Strategist",
  "model": "claude-sonnet-4-6",
  "tools": ["HubSpot", "GA4", "LinkedIn Ads"],
  "governance": {
    "approvalRequired": true,
    "maxBudget": "$500/month",
    "auditLog": true
  }
}`,
    filename: 'skill-config.json',
  },
  {
    label: 'Workflows',
    steps: [
      { title: 'Define a workflow DAG', subs: ['Chain agents, tools, and approval gates', 'Visual builder or YAML definition'] },
      { title: 'Set triggers and schedules', subs: ['Cron, event-driven, or manual execution', 'Retry policies and timeout configuration'] },
      { title: 'Run with full orchestration', subs: ['Multi-agent collaboration via ACP', 'Real-time status and step monitoring'] },
      { title: 'Collect structured outputs', subs: ['Artifacts: docs, reports, Jira tickets', 'Automatic cost and token tracking'] },
    ],
    code: `{
  "workflow": "campaign-launch",
  "steps": [
    { "agent": "Orchestrator", "action": "analyze" },
    { "agent": "Strategy",    "action": "brief" },
    { "agent": "Copy",        "action": "write" },
    { "gate":  "human-approval" },
    { "agent": "Campaign",    "action": "deploy" }
  ],
  "schedule": "0 9 * * MON"
}`,
    filename: 'workflow.json',
  },
  {
    label: 'Governance',
    steps: [
      { title: 'Define policies per persona', subs: ['Budget caps, tool access, model selection', 'Approval requirements for sensitive actions'] },
      { title: 'Monitor compliance in real-time', subs: ['10-point compliance checklist', 'License tracking with expiration alerts'] },
      { title: 'Track costs and attribution', subs: ['Per-persona spend vs. budget dashboards', 'LLM cost breakdown per execution'] },
      { title: 'Audit every decision', subs: ['Immutable audit log with full attribution', 'Exportable reports for compliance teams'] },
    ],
    code: `{
  "governance": {
    "persona": "Engineering",
    "budget": { "monthly": 1500, "currency": "USD" },
    "policies": {
      "requireApproval": ["external-publish"],
      "allowedModels": ["claude-sonnet-4-6"],
      "maxTokensPerExec": 50000,
      "auditRetention": "365d"
    },
    "compliance": ["SOC2", "GDPR", "HIPAA"]
  }
}`,
    filename: 'governance-policy.json',
  },
];

const ENTERPRISE_FEATURES = [
  { icon: '🏛️', title: 'Governance Dashboard', desc: 'RBAC, audit logs, compliance checks, and license tracking — all in one place.' },
  { icon: '🔍', title: 'Full Observability', desc: 'Trace every LLM call, tool invocation, and decision. See cost, latency, and grounding scores.' },
  { icon: '🧠', title: 'Memory Graph', desc: 'Organizational knowledge graph that preserves institutional memory across teams and time.' },
  { icon: '🔗', title: 'Agent Collaboration', desc: 'Agent-to-agent protocol for delegation, handoff, approval, and broadcast messaging.' },
  { icon: '🛒', title: 'Skill Marketplace', desc: 'Community-driven catalog with voting, quality tiers, and governance toggles.' },
  { icon: '👥', title: '12 Enterprise Personas', desc: 'Engineering, Marketing, Product, HR, Finance, Legal, Sales, Support, and more — out of the box.' },
];

const PRICING_TIERS = [
  {
    name: 'Starter',
    price: '$499',
    period: '/month',
    desc: 'For small teams getting started with AI agents.',
    features: ['5 users', '3 personas', '1,000 skill executions/mo', 'Community skills', 'Email support'],
    cta: 'Start Free Trial',
    highlight: false,
  },
  {
    name: 'Team',
    price: '$1,999',
    period: '/month',
    desc: 'For growing teams that need full orchestration.',
    features: ['25 users', 'All 12 personas', '10,000 executions/mo', 'Custom agents', 'SSO & RBAC', 'Priority support'],
    cta: 'Start Free Trial',
    highlight: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    desc: 'For organizations with advanced security and scale needs.',
    features: ['Unlimited users', 'Custom personas', 'Unlimited executions', 'On-prem deployment', 'SLA & dedicated CSM', 'SOC 2 & HIPAA'],
    cta: 'Contact Sales',
    highlight: false,
  },
];

const SECURITY_FLOW = [
  { icon: '⚙', label: 'Agent Request' },
  { icon: '📋', label: 'Policy Check' },
  { icon: '👤', label: 'Human Approval' },
  { icon: '💰', label: 'Budget Gate' },
  { icon: '✓', label: 'Execution' },
];

// ═══════════════════════════════════════════════════════════════
// Canonical app entry
// ═══════════════════════════════════════════════════════════════

/**
 * Canonical entry point for every primary CTA on the landing page.
 * Marks onboarding/landing as seen, then navigates into the app's
 * 'home' section — matching the OnboardingModal entry pattern.
 */
function useEnterApp() {
  const setActiveSection = useEAOSStore(s => s.setActiveSection);
  return useCallback(() => {
    setPreference('onboarding_completed', true);
    setActiveSection('home');
  }, [setActiveSection]);
}

// ═══════════════════════════════════════════════════════════════
// Sub-Components
// ═══════════════════════════════════════════════════════════════

function LandingNav() {
  const enterApp = useEnterApp();
  const [mobileOpen, setMobileOpen] = useState(false);

  const scrollTo = (href: string) => {
    const el = document.querySelector(href);
    el?.scrollIntoView({ behavior: 'smooth' });
    setMobileOpen(false);
  };

  return (
    <nav className="fixed top-0 w-full bg-slate-950/80 backdrop-blur-xl border-b border-slate-800/50 z-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-white flex items-center justify-center text-slate-950 font-bold text-xs">A</div>
          <span className="text-sm font-semibold text-white tracking-tight">AgentOS</span>
        </div>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-6">
          {NAV_LINKS.map(l => (
            <button key={l.href} onClick={() => scrollTo(l.href)} className="text-sm text-slate-400 hover:text-white transition-colors">
              {l.label}
            </button>
          ))}
        </div>

        {/* Right */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={enterApp}
            className="hidden md:inline text-sm text-slate-400 hover:text-white transition-colors"
          >
            Go to Dashboard
          </button>
          <button
            onClick={enterApp}
            className="bg-blue-600 hover:bg-blue-500 text-white rounded-full px-3.5 sm:px-5 py-2 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap"
          >
            <span className="hidden sm:inline">Request Early Access</span>
            <span className="sm:hidden">Early Access</span>
          </button>
          {/* Mobile menu toggle */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
            className="md:hidden text-slate-400 hover:text-white text-lg w-9 h-9 flex items-center justify-center -mr-1"
          >
            {mobileOpen ? '✕' : '☰'}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="md:hidden border-t border-slate-800 bg-slate-950 px-6 py-4 space-y-3">
          {NAV_LINKS.map(l => (
            <button key={l.href} onClick={() => scrollTo(l.href)} className="block text-sm text-slate-400 hover:text-white">
              {l.label}
            </button>
          ))}
          <button onClick={() => { enterApp(); setMobileOpen(false); }} className="block text-sm text-blue-400 hover:text-blue-300">
            Go to Dashboard
          </button>
        </div>
      )}
    </nav>
  );
}

function HeroSection() {
  const enterApp = useEnterApp();
  return (
    <section className="relative pt-28 sm:pt-32 pb-16 sm:pb-20 landing-glow">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-slate-700 bg-slate-900 text-xs sm:text-sm text-slate-300 mb-6 sm:mb-8">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          Early Access Opening Soon
        </div>

        {/* Headline */}
        <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-tight">
          <span className="text-white">The AI Operating System</span>
          <br />
          <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            for Enterprise Teams
          </span>
        </h1>

        {/* Subtitle */}
        <p className="text-base sm:text-lg text-slate-400 max-w-2xl mx-auto mt-5 sm:mt-6 leading-relaxed">
          Orchestrate AI agents across every team — with governance, observability, and cost control built in.
        </p>

        {/* Problem / Solution card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 max-w-4xl mx-auto mt-10 sm:mt-12">
          <div className="grid md:grid-cols-2 gap-8">
            {/* Problem */}
            <div className="text-left">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-amber-500">⚠</span>
                <span className="text-sm font-semibold text-amber-400">Without a control layer:</span>
              </div>
              <ul className="space-y-3">
                {['Every department runs its own AI stack', 'Agents act without oversight or limits', 'Costs are invisible until the invoice arrives', 'No audit trail for AI-driven decisions'].map(item => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-slate-400">
                    <span className="text-red-400 mt-0.5 flex-shrink-0">&#x2022;</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Solution */}
            <div className="text-left">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-blue-400">&#x25CB;</span>
                <span className="text-sm font-semibold text-blue-400">The AgentOS Way</span>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">
                AgentOS gives your enterprise a unified AI operating layer — with multi-persona agents, skill orchestration, full observability, and governance policies enforced at every execution — without changing your existing tools.
              </p>
            </div>
          </div>
        </div>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4 mt-8 sm:mt-10 max-w-sm sm:max-w-none mx-auto">
          <button
            onClick={enterApp}
            className="bg-blue-600 hover:bg-blue-500 text-white rounded-full px-8 py-3 text-sm font-semibold transition-colors shadow-lg shadow-blue-600/20"
          >
            Get Started
          </button>
          <button className="border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white rounded-full px-8 py-3 text-sm font-semibold transition-colors">
            Watch Demo
          </button>
        </div>
      </div>
    </section>
  );
}

function ProblemSection() {
  return (
    <section className="py-16 sm:py-24 border-t border-slate-900">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white text-center mb-4">Why Enterprise AI Breaks Today</h2>
        <p className="text-base sm:text-lg text-slate-400 text-center max-w-2xl mx-auto mb-10 sm:mb-14 px-2">
          If every team runs its own AI tools, you&apos;re forced into bad trade-offs.
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Card 1 */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8">
            <span className="inline-block text-xs font-bold px-3 py-1 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 mb-4">
              SILOED TOOLS
            </span>
            <p className="text-sm text-slate-500 mb-4">(what most enterprises ship first)</p>
            <ul className="space-y-3">
              {PROBLEM_BULLETS_LEFT.map(b => (
                <li key={b} className="flex items-start gap-2.5 text-sm text-slate-400">
                  <span className="text-red-400 mt-0.5 flex-shrink-0">&#x2717;</span>
                  {b}
                </li>
              ))}
            </ul>
            <div className="mt-6 pt-4 border-t border-slate-800">
              <p className="text-sm text-slate-500 flex items-center gap-2">
                <span className="text-blue-400">&#x2022;</span>
                So you add governance&hellip;
              </p>
            </div>
          </div>

          {/* Card 2 */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8">
            <span className="inline-block text-xs font-bold px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 mb-4">
              SHADOW AI
            </span>
            <p className="text-sm text-slate-500 mb-4">(what happens without a platform)</p>
            <ul className="space-y-3">
              {PROBLEM_BULLETS_RIGHT.map(b => (
                <li key={b} className="flex items-start gap-2.5 text-sm text-slate-400">
                  <span className="text-amber-400 mt-0.5 flex-shrink-0">&#x26A0;</span>
                  {b}
                </li>
              ))}
            </ul>
            <div className="mt-6 pt-4 border-t border-slate-800">
              <p className="text-sm text-slate-500 flex items-center gap-2">
                <span className="text-blue-400">&#x2022;</span>
                Agents make this worse: they don&apos;t make one call — they make thousands.
              </p>
            </div>
          </div>
        </div>

        <p className="text-xl text-slate-300 text-center mt-14">
          There is no simple way to govern AI at enterprise scale — <span className="text-red-400 font-bold">safely</span>.
        </p>
      </div>
    </section>
  );
}

function ValueSection() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <section id="features" className="py-16 sm:py-24 border-t border-slate-900">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white text-center mb-4">What AgentOS Unlocks</h2>
        <p className="text-base sm:text-lg text-slate-400 text-center max-w-2xl mx-auto mb-10 sm:mb-14 px-2">
          A unified operating layer for AI agents across your entire organization.
        </p>

        {/* 3-step flow */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-center gap-4 md:gap-6 mb-16">
          {VALUE_STEPS.map((step, i) => (
            <div key={step.title} className="flex flex-col md:flex-row items-center gap-4 md:gap-6">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center w-full md:w-64 max-w-sm">
                <div className="w-14 h-14 rounded-full bg-blue-600/15 border border-blue-500/20 flex items-center justify-center mx-auto mb-4 text-2xl">
                  {step.icon}
                </div>
                <h3 className="text-white font-semibold mb-1">{step.title}</h3>
                <p className="text-sm text-slate-400">{step.desc}</p>
              </div>
              {i < VALUE_STEPS.length - 1 && (
                <span className="text-slate-600 text-2xl hidden md:block">&#x276F;</span>
              )}
            </div>
          ))}
        </div>

        {/* Pill beneath flow */}
        <div className="flex justify-center mb-10">
          <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-blue-600/10 border border-blue-500/20 text-sm text-blue-400 font-medium">
            <span className="w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center text-white text-[10px] font-bold">A</span>
            AgentOS enforces governance, policies &amp; cost control
          </div>
        </div>

        {/* Audience tabs */}
        <div className="flex sm:justify-center mb-8 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
          <div className="inline-flex gap-1 bg-slate-900 rounded-full p-1 border border-slate-800 flex-shrink-0">
            {AUDIENCE_TABS.map((tab, i) => (
              <button
                key={tab.label}
                onClick={() => setActiveTab(i)}
                className={`px-4 sm:px-5 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === i ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <span className="mr-1.5">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8">
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <ul className="space-y-4">
                {AUDIENCE_TABS[activeTab].benefits.map(b => (
                  <li key={b} className="flex items-start gap-3 text-sm">
                    <span className="text-emerald-400 mt-0.5 flex-shrink-0">&#x2714;</span>
                    <span className="text-slate-300">{b}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-3">WHAT TEAMS SAY</p>
              <p className="text-slate-300 italic leading-relaxed">&ldquo;{AUDIENCE_TABS[activeTab].quote}&rdquo;</p>
              <p className="text-sm text-slate-500 mt-3">— {AUDIENCE_TABS[activeTab].quoteAuthor}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const [activeTab, setActiveTab] = useState(0);
  const tab = HOW_TABS[activeTab];

  return (
    <section id="how-it-works" className="py-16 sm:py-24 border-t border-slate-900">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white text-center mb-2">How This Actually Works</h2>
        <p className="text-base sm:text-lg text-center mb-10 sm:mb-14 px-2">
          <span className="text-slate-400">You don&apos;t rip and replace. </span>
          <span className="text-blue-400 font-medium">You layer AgentOS on top.</span>
        </p>

        {/* Tabs */}
        <div className="flex sm:justify-center mb-10 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
          <div className="inline-flex bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex-shrink-0">
            {HOW_TABS.map((t, i) => (
              <button
                key={t.label}
                onClick={() => setActiveTab(i)}
                className={`px-4 sm:px-6 py-3 text-sm font-semibold transition-all whitespace-nowrap ${
                  activeTab === i
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="grid md:grid-cols-2 gap-8 md:gap-10">
          {/* Steps */}
          <div className="space-y-6">
            {tab.steps.map((step, i) => (
              <div key={step.title} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 text-sm font-bold flex-shrink-0">
                    {i + 1}
                  </div>
                  {i < tab.steps.length - 1 && <div className="w-px flex-1 bg-slate-800 mt-2" />}
                </div>
                <div className="pb-6">
                  <h4 className="text-white font-semibold mb-2">{step.title}</h4>
                  {step.subs.map(sub => (
                    <p key={sub} className="text-sm text-slate-400 flex items-start gap-2 mb-1">
                      <span className="text-slate-600 mt-0.5">&#x2022;</span>
                      {sub}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Code preview */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="bg-slate-800 px-4 py-3 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500" />
              <span className="w-3 h-3 rounded-full bg-amber-500" />
              <span className="w-3 h-3 rounded-full bg-emerald-500" />
              <span className="text-xs text-slate-500 ml-2 font-mono">{tab.filename}</span>
            </div>
            <pre className="p-6 text-sm font-mono leading-relaxed overflow-x-auto">
              <code>
                {tab.code.split('\n').map((line, i) => {
                  // Basic syntax highlighting
                  const highlighted = line
                    .replace(/"([^"]+)":/g, '<key>"$1"</key>:')
                    .replace(/: "([^"]+)"/g, ': <str>"$1"</str>')
                    .replace(/: (\d+)/g, ': <num>$1</num>')
                    .replace(/: (true|false)/g, ': <bool>$1</bool>');
                  return (
                    <span key={i} className="block">
                      {line.includes('"') ? (
                        <span dangerouslySetInnerHTML={{
                          __html: highlighted
                            .replace(/<key>/g, '<span class="text-blue-400">')
                            .replace(/<\/key>/g, '</span>')
                            .replace(/<str>/g, '<span class="text-emerald-400">')
                            .replace(/<\/str>/g, '</span>')
                            .replace(/<num>/g, '<span class="text-amber-400">')
                            .replace(/<\/num>/g, '</span>')
                            .replace(/<bool>/g, '<span class="text-purple-400">')
                            .replace(/<\/bool>/g, '</span>')
                        }} />
                      ) : (
                        <span className="text-slate-400">{line}</span>
                      )}
                    </span>
                  );
                })}
              </code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

function EnterpriseFeaturesSection() {
  return (
    <section id="enterprise" className="py-16 sm:py-24 border-t border-slate-900">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white text-center mb-4">Built for Enterprise</h2>
        <p className="text-base sm:text-lg text-slate-400 text-center max-w-2xl mx-auto mb-10 sm:mb-14 px-2">
          Every feature designed with governance, security, and scale in mind.
        </p>

        <div className="grid md:grid-cols-3 gap-5">
          {ENTERPRISE_FEATURES.map(f => (
            <div key={f.title} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 hover:border-slate-700 transition-colors group">
              <span className="text-3xl block mb-4">{f.icon}</span>
              <h3 className="text-white font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SecuritySection() {
  return (
    <section className="py-16 sm:py-24 border-t border-slate-900">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center mb-4">
          <span className="text-white">Total Control — </span>
          <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">without slowing down.</span>
        </h2>
        <p className="text-base sm:text-lg text-slate-400 text-center max-w-2xl mx-auto mb-10 sm:mb-14 px-2">
          AgentOS separates authorization from execution. Your policies decide what can run. Agents execute within your rules.
        </p>

        {/* Flow diagram */}
        <div className="flex flex-wrap items-center justify-center gap-3 mb-14">
          {SECURITY_FLOW.map((step, i) => (
            <div key={step.label} className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900 border border-slate-800 text-sm">
                <span className="text-slate-400">{step.icon}</span>
                <span className="text-slate-300 font-medium">{step.label}</span>
              </div>
              {i < SECURITY_FLOW.length - 1 && (
                <span className="text-slate-600">&#x2192;</span>
              )}
            </div>
          ))}
        </div>

        {/* Two cards */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8">
            <h3 className="text-white font-semibold text-lg mb-4">Human-in-the-Loop</h3>
            <ul className="space-y-3">
              {['Approval gates on high-stakes agent actions', 'Per-execution authorization with full audit trail', 'Configurable thresholds per persona and skill', 'Real-time notifications for pending approvals'].map(b => (
                <li key={b} className="flex items-start gap-2.5 text-sm text-slate-400">
                  <span className="text-emerald-400 mt-0.5 flex-shrink-0">&#x2714;</span>
                  {b}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8">
            <h3 className="text-white font-semibold text-lg mb-4">Policy-Driven Governance</h3>
            <ul className="space-y-3">
              {['Budget caps per team, persona, and agent', 'Model selection restrictions (e.g., Opus for legal only)', 'Tool access scoping by role and compliance level', 'Immutable audit log with 365-day retention'].map(b => (
                <li key={b} className="flex items-start gap-2.5 text-sm text-slate-400">
                  <span className="text-emerald-400 mt-0.5 flex-shrink-0">&#x2714;</span>
                  {b}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function PricingSection() {
  const enterApp = useEnterApp();
  return (
    <section id="pricing" className="py-16 sm:py-24 border-t border-slate-900">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white text-center mb-4">Simple, Transparent Pricing</h2>
        <p className="text-base sm:text-lg text-slate-400 text-center max-w-2xl mx-auto mb-10 sm:mb-14 px-2">
          Start free. Scale as your AI operations grow.
        </p>

        <div className="grid md:grid-cols-3 gap-6">
          {PRICING_TIERS.map(tier => (
            <div
              key={tier.name}
              className={`rounded-2xl p-8 ${
                tier.highlight
                  ? 'bg-blue-600/10 border-2 border-blue-500/40'
                  : 'bg-slate-900 border border-slate-800'
              }`}
            >
              {tier.highlight && (
                <span className="inline-block text-[10px] font-bold px-3 py-1 rounded-full bg-blue-600 text-white mb-4 uppercase tracking-wider">
                  Most Popular
                </span>
              )}
              <h3 className="text-white font-bold text-xl mb-1">{tier.name}</h3>
              <div className="flex items-baseline gap-1 mb-3">
                <span className="text-3xl font-bold text-white">{tier.price}</span>
                {tier.period && <span className="text-sm text-slate-400">{tier.period}</span>}
              </div>
              <p className="text-sm text-slate-400 mb-6">{tier.desc}</p>
              <ul className="space-y-2.5 mb-8">
                {tier.features.map(f => (
                  <li key={f} className="flex items-center gap-2.5 text-sm text-slate-300">
                    <span className="text-emerald-400 flex-shrink-0">&#x2714;</span>
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={tier.cta === 'Contact Sales' ? undefined : enterApp}
                className={`w-full py-2.5 rounded-full text-sm font-semibold transition-colors ${
                  tier.highlight
                    ? 'bg-blue-600 hover:bg-blue-500 text-white'
                    : 'border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white'
                }`}
              >
                {tier.cta}
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  const enterApp = useEnterApp();
  return (
    <section className="py-20 sm:py-32 border-t border-slate-900">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-4">
          Ready to transform how your teams work with AI?
        </h2>
        <p className="text-base sm:text-lg text-slate-400 mb-4">
          Join enterprises already orchestrating AI agents with governance and control.
        </p>
        <p className="text-sm text-blue-400 uppercase tracking-wider font-bold mb-8">
          START YOUR FREE TRIAL TODAY.
        </p>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4 max-w-sm sm:max-w-none mx-auto">
          <button
            onClick={enterApp}
            className="bg-blue-600 hover:bg-blue-500 text-white rounded-full px-8 py-3 text-sm font-semibold transition-colors shadow-lg shadow-blue-600/20"
          >
            Get Started Free
          </button>
          <button className="border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white rounded-full px-8 py-3 text-sm font-semibold transition-colors">
            Talk to Sales
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-4">No credit card required. 14-day free trial.</p>
      </div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-slate-800 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-center md:text-left">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-white flex items-center justify-center text-slate-950 font-bold text-[10px]">A</div>
          <span className="text-sm text-slate-500">&copy; 2026 Phani Marupaka. All rights reserved.</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 sm:gap-6">
          {['Documentation', 'GitHub', 'Privacy', 'Terms'].map(link => (
            <button key={link} className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
              {link}
            </button>
          ))}
        </div>
      </div>
    </footer>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════

export default function LandingPage() {
  return (
    <div className="h-dscreen overflow-y-auto bg-slate-950 text-white landing-dot-grid">
      <LandingNav />
      <HeroSection />
      <ProblemSection />
      <ValueSection />
      <HowItWorksSection />
      <EnterpriseFeaturesSection />
      <SecuritySection />
      <PricingSection />
      <CTASection />
      <LandingFooter />
    </div>
  );
}
