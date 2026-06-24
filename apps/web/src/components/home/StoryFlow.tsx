'use client';
import { motion } from 'framer-motion';
import { useEAOSStore } from '../../store/eaos-store';
import { staggerContainer, staggerItem, fadeInUp } from '../../lib/animations';

const STAGES = [
  { icon: '\u{1F4AC}', title: 'Intent', desc: 'You state a goal in plain language — a campaign, a PR review, a hiring plan.', section: 'platform-chat', accent: 'from-blue-500 to-indigo-500' },
  { icon: '\u{1F916}', title: 'Agents & Skills', desc: 'EAOS routes it to the right regiment of agents, each running a focused skill.', section: 'platform-skills', accent: 'from-violet-500 to-purple-500' },
  { icon: '\u{1F50C}', title: 'Tools & MCP', desc: 'Agents act through real tools — GitHub, Jira, Slack — and MCP servers.', section: 'platform-mcp', accent: 'from-emerald-500 to-teal-500' },
  { icon: '\u{1F6E1}️', title: 'Governance', desc: 'Every step is policy-checked, cost-metered, and gated for human approval.', section: 'admin-governance', accent: 'from-amber-500 to-orange-500' },
  { icon: '✨', title: 'Output', desc: 'You get a reviewed, traceable result — with an after-action report.', section: 'ops-executions', accent: 'from-pink-500 to-rose-500' },
];

export function StoryFlow() {
  const setActiveSection = useEAOSStore((s) => s.setActiveSection);
  return (
    <div className="relative rounded-2xl border border-slate-200 bg-mesh overflow-hidden p-8">
      <div className="absolute inset-0 bg-glow-top pointer-events-none" />
      <motion.div initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }} variants={staggerContainer(0.08)} className="relative">
        <motion.div variants={fadeInUp} className="text-center mb-8">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-600">How EAOS works</span>
          <h2 className="text-2xl font-bold text-slate-900 mt-1">From intent to outcome — orchestrated</h2>
          <p className="text-slate-500 mt-1 text-sm max-w-xl mx-auto">Agents think and decide. Tools execute. Governance keeps it safe. Here is the loop.</p>
        </motion.div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {STAGES.map((s, i) => (
            <motion.button key={s.title} variants={staggerItem} onClick={() => setActiveSection(s.section)}
              className="group relative text-left rounded-xl border border-slate-200 bg-white/80 backdrop-blur-sm p-4 hover:shadow-md hover:-translate-y-0.5 transition-all">
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.accent} text-white flex items-center justify-center text-lg mb-3 shadow-sm`}>{s.icon}</div>
              <p className="text-[11px] font-semibold text-slate-400">STEP {i + 1}</p>
              <p className="text-sm font-bold text-slate-900">{s.title}</p>
              <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">{s.desc}</p>
              {i < STAGES.length - 1 && <span className="hidden md:block absolute top-1/2 -right-2 text-slate-300 group-hover:text-blue-400 transition-colors">→</span>}
            </motion.button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
export default StoryFlow;
