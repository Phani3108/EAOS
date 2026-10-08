'use client';

import { useState, useEffect, useRef } from 'react';
import { getScheduledJobs, createScheduledJob, deleteScheduledJob, runJobNow, toggleJob, getSchedulerStats, type ScheduledJobEntry } from '../lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScheduleType = 'cron' | 'interval' | 'event' | 'one-time';
type JobStatus = 'active' | 'paused' | 'failed' | 'completed' | 'pending';

interface ScheduledJob {
  id: string;
  version?: number;
  name: string;
  skillId: string;
  skillName: string;
  personaId: string;
  scheduleType: ScheduleType;
  cronExpression?: string;
  intervalMs?: number;
  eventTrigger?: string;
  oneTimeAt?: string;
  status: JobStatus;
  /** Why the runtime last paused or failed this schedule, as recorded by the server. */
  lastError?: string;
  lastRun?: string;
  nextRun?: string;
  runCount: number;
  successCount: number;
  failureCount: number;
  createdAt: string;
  inputs?: Record<string, unknown>;
  timeout?: number;
  retries?: number;
  tags: string[];
  logs: JobLog[];
}

interface JobLog {
  id: string;
  jobId: string;
  status: 'running' | 'success' | 'failed';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  output?: string;
  error?: string;
}

// Common cron presets
const CRON_PRESETS = [
  { label: 'Every minute', value: '* * * * *' },
  { label: 'Every 5 minutes', value: '*/5 * * * *' },
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Every 30 minutes', value: '*/30 * * * *' },
  { label: 'Hourly', value: '0 * * * *' },
  { label: 'Daily at 9am', value: '0 9 * * *' },
  { label: 'Weekdays at 9am', value: '0 9 * * MON-FRI' },
  { label: 'Weekly Monday 9am', value: '0 9 * * MON' },
  { label: 'Monthly 1st at 9am', value: '0 9 1 * *' },
];

const EVENT_TRIGGERS = [
  { value: 'github.pull_request.opened', label: 'GitHub: PR Opened' },
  { value: 'github.push.main', label: 'GitHub: Push to Main' },
  { value: 'jira.issue.created', label: 'Jira: Issue Created' },
  { value: 'jira.sprint.started', label: 'Jira: Sprint Started' },
  { value: 'jira.sprint.completed', label: 'Jira: Sprint Completed' },
  { value: 'hubspot.deal.won', label: 'HubSpot: Deal Won' },
  { value: 'hubspot.contact.created', label: 'HubSpot: Contact Created' },
  { value: 'agentos.skill.completed', label: 'AgentOS: Skill Completed' },
  { value: 'agentos.workflow.failed', label: 'AgentOS: Workflow Failed' },
  { value: 'webhook.custom', label: 'Custom Webhook' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function futureTime(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  return `in ${Math.floor(hrs / 24)}d`;
}

function StatusBadge({ status }: { status: JobStatus }) {
  const config = {
    active: 'bg-emerald-50 text-emerald-600',
    paused: 'bg-amber-50 text-amber-600',
    failed: 'bg-red-50 text-red-600',
    completed: 'bg-blue-50 text-blue-600',
    pending: 'bg-slate-100 text-slate-500',
  };
  const dots = {
    active: '● ',
    paused: '◦ ',
    failed: '● ',
    completed: '✓ ',
    pending: '○ ',
  };
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${config[status]}`}>
      {dots[status]}{status}
    </span>
  );
}

function ScheduleTypeBadge({ type }: { type: ScheduleType }) {
  const config = {
    cron: 'bg-purple-50 text-purple-600',
    interval: 'bg-blue-50 text-blue-600',
    event: 'bg-orange-50 text-orange-600',
    'one-time': 'bg-slate-100 text-slate-600',
  };
  const icons = { cron: '⏰', interval: '🔄', event: '⚡', 'one-time': '🎯' };
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full ${config[type]}`}>
      {icons[type]} {type}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Job Detail Panel
// ---------------------------------------------------------------------------

function JobDetail({ job, onClose, onToggle, onRun }: {
  job: ScheduledJob;
  onClose: () => void;
  onToggle: () => void;
  onRun: () => void;
}) {
  const successRate = job.runCount > 0 ? Math.round((job.successCount / job.runCount) * 100) : 100;

  return (
    <div className="w-96 flex-shrink-0 border-l border-slate-100 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <h3 className="text-xs font-semibold text-slate-800 truncate">{job.name}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 ml-2 flex-shrink-0">×</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Status + Actions */}
        <div className="flex items-center gap-2">
          <StatusBadge status={job.status} />
          <ScheduleTypeBadge type={job.scheduleType} />
          <div className="ml-auto flex gap-1.5">
            <button
              onClick={onRun}
              className="text-[11px] px-2.5 py-1 bg-slate-900 text-white rounded-lg hover:bg-slate-700 transition-colors"
              data-testid={`run-job-${job.id}`}
            >
              ▶ Run Now
            </button>
            <button
              onClick={onToggle}
              className={`text-[11px] px-2.5 py-1 rounded-lg transition-colors border ${
                job.status === 'active'
                  ? 'border-amber-200 text-amber-600 hover:bg-amber-50'
                  : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
              }`}
            >
              {job.status === 'active' ? '⏸ Pause' : '▶ Resume'}
            </button>
          </div>
        </div>

        {/* Schedule Info */}
        <div className="bg-slate-50 rounded-xl p-3 space-y-2">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Schedule</div>
          {job.scheduleType === 'cron' && (
            <div className="font-mono text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2">
              {job.cronExpression}
            </div>
          )}
          {job.scheduleType === 'event' && (
            <div className="text-xs text-slate-700">Trigger: <strong>{job.eventTrigger}</strong></div>
          )}
          {job.scheduleType === 'interval' && (
            <div className="text-xs text-slate-700">Every {formatDuration(job.intervalMs ?? 0)}</div>
          )}
          {job.scheduleType === 'one-time' && (
            <div className="text-xs text-slate-700">
              At {job.oneTimeAt ? new Date(job.oneTimeAt).toLocaleString() : '—'}
            </div>
          )}
          {job.nextRun && (
            <div className="text-[11px] text-slate-400">Next run: {futureTime(job.nextRun)}</div>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Total Runs', value: String(job.runCount ?? '—') },
            { label: 'Success Rate', value: job.runCount > 0 ? `${successRate}%` : '—' },
            { label: 'Successes', value: String(job.successCount ?? '—') },
            { label: 'Failures', value: String(job.failureCount ?? '—') },
          ].map((s) => (
            <div key={s.label} className="bg-slate-50 rounded-xl p-3">
              <div className="text-[11px] text-slate-400">{s.label}</div>
              <div className="text-sm font-semibold text-slate-800 mt-0.5">{s.value}</div>
            </div>
          ))}
        </div>

        {job.lastError && job.status !== 'active' && (
          <div role="status" className="text-xs p-3 rounded-xl bg-red-50 text-red-700">{job.lastError}</div>
        )}

        {/* Config */}
        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Configuration</div>
          {[
            { label: 'Skill', value: job.skillName },
            { label: 'Timeout', value: `${job.timeout}s` },
            { label: 'Retries', value: String(job.retries) },
            { label: 'Created', value: new Date(job.createdAt).toLocaleDateString() },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between text-xs">
              <span className="text-slate-400">{row.label}</span>
              <span className="text-slate-700 font-medium">{row.value}</span>
            </div>
          ))}
        </div>

        {/* Tags */}
        {job.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {job.tags.map((t) => (
              <span key={t} className="text-[11px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-full">#{t}</span>
            ))}
          </div>
        )}

        {/* Logs */}
        <div>
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Recent Runs</div>
          {job.logs.length === 0 ? (
            <p className="text-xs text-slate-400">No runs yet</p>
          ) : (
            <div className="space-y-2">
              {job.logs.map((log) => (
                <div key={log.id} className={`p-3 rounded-xl border text-xs ${
                  log.status === 'success' ? 'bg-emerald-50 border-emerald-100' :
                  log.status === 'failed' ? 'bg-red-50 border-red-100' :
                  'bg-blue-50 border-blue-100'
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`font-medium ${
                      log.status === 'success' ? 'text-emerald-700' :
                      log.status === 'failed' ? 'text-red-700' : 'text-blue-700'
                    }`}>
                      {log.status === 'success' ? '✓' : log.status === 'failed' ? '✗' : '●'} {log.status}
                    </span>
                    <span className="text-[11px] text-slate-400">{relativeTime(log.startedAt)}</span>
                  </div>
                  {log.durationMs && (
                    <div className="text-[11px] text-slate-500 mb-1">{formatDuration(log.durationMs)}</div>
                  )}
                  {log.output && <div className="text-[11px] text-slate-600 line-clamp-2">{log.output}</div>}
                  {log.error && <div className="text-[11px] text-red-600 font-mono">{log.error}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New Job Modal
// ---------------------------------------------------------------------------

function NewJobModal({ onClose, onSave }: { onClose: () => void; onSave: (job: Partial<ScheduledJob>) => void }) {
  const [name, setName] = useState('');
  const [skillName, setSkillName] = useState('');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('cron');
  const [cron, setCron] = useState('0 9 * * MON-FRI');
  const [eventTrigger, setEventTrigger] = useState(EVENT_TRIGGERS[0].value);
  const [intervalVal, setIntervalVal] = useState('60');
  const [intervalUnit, setIntervalUnit] = useState<'minutes' | 'hours'>('minutes');
  const [oneTimeAt, setOneTimeAt] = useState('');
  const [timeout, setTimeout_] = useState('120');
  const [retries, setRetries] = useState('2');
  const [tags, setTags] = useState('');

  const handleSave = () => {
    if (!name.trim() || !skillName.trim()) return;
    const ms = scheduleType === 'interval'
      ? parseInt(intervalVal) * (intervalUnit === 'hours' ? 3600000 : 60000)
      : undefined;
    onSave({
      name: name.trim(),
      skillName: skillName.trim(),
      skillId: skillName.toLowerCase().replace(/\s+/g, '-'),
      scheduleType,
      cronExpression: scheduleType === 'cron' ? cron : undefined,
      intervalMs: ms,
      eventTrigger: scheduleType === 'event' ? eventTrigger : undefined,
      oneTimeAt: scheduleType === 'one-time' ? oneTimeAt : undefined,
      timeout: parseInt(timeout),
      retries: parseInt(retries),
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl w-[540px] mx-4 flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">New Scheduled Job</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Job Name *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Daily Sprint Digest"
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-slate-400"
                data-testid="job-name-input" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Skill *</label>
              <input value={skillName} onChange={(e) => setSkillName(e.target.value)} placeholder="Sprint Digest Generator"
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-slate-400" />
            </div>
          </div>

          {/* Schedule Type */}
          <div>
            <label className="text-xs font-medium text-slate-500 mb-2 block">Schedule Type</label>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {(['cron', 'interval', 'event', 'one-time'] as ScheduleType[]).map((t) => (
                <button key={t}
                  onClick={() => setScheduleType(t)}
                  className={`py-2 text-xs rounded-xl border transition-colors capitalize ${
                    scheduleType === t ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400'
                  }`}
                >
                  {t === 'cron' ? '⏰' : t === 'interval' ? '🔄' : t === 'event' ? '⚡' : '🎯'} {t}
                </button>
              ))}
            </div>
          </div>

          {/* Schedule Config */}
          {scheduleType === 'cron' && (
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Cron Expression</label>
              <input value={cron} onChange={(e) => setCron(e.target.value)}
                className="w-full text-sm font-mono px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-slate-400 mb-2"
                data-testid="cron-input" />
              <div className="flex flex-wrap gap-1">
                {CRON_PRESETS.map((p) => (
                  <button key={p.value} onClick={() => setCron(p.value)}
                    className="text-[11px] px-2 py-1 border border-slate-200 rounded-lg text-slate-500 hover:border-slate-400 hover:text-slate-700 transition-colors">
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {scheduleType === 'interval' && (
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Interval</label>
              <div className="flex gap-2">
                <input type="number" value={intervalVal} onChange={(e) => setIntervalVal(e.target.value)}
                  className="flex-1 text-sm px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-slate-400" />
                <select value={intervalUnit} onChange={(e) => setIntervalUnit(e.target.value as 'minutes' | 'hours')}
                  className="text-sm px-3 py-2 border border-slate-200 rounded-xl outline-none bg-white">
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                </select>
              </div>
            </div>
          )}

          {scheduleType === 'event' && (
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Event Trigger</label>
              <select value={eventTrigger} onChange={(e) => setEventTrigger(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-xl outline-none bg-white">
                {EVENT_TRIGGERS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          )}

          {scheduleType === 'one-time' && (
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Run At</label>
              <input type="datetime-local" value={oneTimeAt} onChange={(e) => setOneTimeAt(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-slate-400" />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Timeout (sec)</label>
              <input type="number" value={timeout} onChange={(e) => setTimeout_(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-slate-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Retries</label>
              <input type="number" value={retries} onChange={(e) => setRetries(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-slate-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Tags</label>
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tag1, tag2"
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-xl outline-none focus:border-slate-400" />
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-4 py-2 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={!name.trim() || !skillName.trim()}
            className="text-xs px-5 py-2 bg-slate-900 text-white rounded-xl hover:bg-slate-700 disabled:opacity-40 transition-colors"
            data-testid="save-job-btn">
            Create Job
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ExecutionScheduler Component
// ---------------------------------------------------------------------------

export function ExecutionScheduler() {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<ScheduledJob | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState<JobStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [runningJobs, setRunningJobs] = useState<Set<string>>(new Set());
  const [apiStats, setApiStats] = useState<{ total: number; active: number; paused: number; failed: number } | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval>>();

  const loadJobs = () => getScheduledJobs().then((d) => {
    setJobs((d.jobs || []).map((j) => ({ ...j, logs: (j as unknown as ScheduledJob).logs || [] })));
  }).catch(() => {});

  useEffect(() => {
    void loadJobs();
    getSchedulerStats().then((d) => {
      const s = d as Record<string, unknown>;
      if (s && typeof s.total === 'number') {
        setApiStats({ total: s.total as number, active: (s.active as number) ?? 0, paused: (s.paused as number) ?? 0, failed: (s.failed as number) ?? 0 });
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    tickRef.current = setInterval(() => {
      setJobs((prev) => [...prev]);
    }, 30000);
    return () => clearInterval(tickRef.current);
  }, []);

  const filtered = jobs.filter((j) => {
    if (filter !== 'all' && j.status !== filter) return false;
    if (search && !j.name.toLowerCase().includes(search.toLowerCase()) &&
        !j.skillName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleToggle = (jobId: string) => {
    setError(null);
    toggleJob(jobId, jobs.find(job => job.id === jobId)?.version).then(({ job: updated }) => {
      const mapped: ScheduledJob = { ...updated, logs: (updated as unknown as ScheduledJob).logs || [] };
      setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...mapped, logs: j.logs } : j)));
      if (selectedJob?.id === jobId) {
        setSelectedJob((prev) => prev ? { ...prev, status: mapped.status } : prev);
      }
    }).catch(cause => {
      setError(cause instanceof Error ? cause.message : 'Schedule update failed');
      // A conflict means this view is stale; reload so the next click carries the current version.
      void loadJobs();
    });
  };

  const handleRunNow = (jobId: string) => {
    setRunningJobs((prev) => new Set(prev).add(jobId));
    runJobNow(jobId).then(({ job: updated, log: rawLog }) => {
      setRunningJobs((prev) => { const s = new Set(prev); s.delete(jobId); return s; });
      const log = rawLog as JobLog | undefined;
      setJobs((prev) => prev.map((j) => {
        if (j.id !== jobId) return j;
        const newLogs = log ? [log, ...j.logs].slice(0, 20) : j.logs;
        return { ...j, ...updated, logs: newLogs };
      }));
      if (selectedJob?.id === jobId) {
        setSelectedJob((prev) => {
          if (!prev) return prev;
          const newLogs = log ? [log, ...prev.logs].slice(0, 20) : prev.logs;
          return { ...prev, ...updated, logs: newLogs };
        });
      }
    }).catch(cause => {
      setRunningJobs((prev) => { const s = new Set(prev); s.delete(jobId); return s; });
      setError(cause instanceof Error ? cause.message : 'Scheduled run was not accepted');
    });
  };

  const handleDelete = (jobId: string) => {
    if (!confirm('Delete this scheduled job?')) return;
    deleteScheduledJob(jobId, jobs.find(job => job.id === jobId)?.version).then(() => {
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      if (selectedJob?.id === jobId) setSelectedJob(null);
    }).catch(cause => {
      setError(cause instanceof Error ? cause.message : 'Schedule was not archived');
      void loadJobs();
    });
  };

  const handleNewJob = (data: Partial<ScheduledJob>) => {
    const payload = {
      name: data.name ?? 'New Job',
      skillId: data.skillId ?? '',
      skillName: data.skillName ?? '',
      personaId: 'engineering',
      scheduleType: (data.scheduleType ?? 'cron') as 'cron' | 'interval' | 'event' | 'one-time',
      cronExpression: data.cronExpression,
      intervalMs: data.intervalMs,
      eventTrigger: data.eventTrigger,
      oneTimeAt: data.oneTimeAt,
      timeout: data.timeout ?? 120,
      retries: data.retries ?? 2,
      tags: data.tags ?? [],
      inputs: data.inputs ?? {},
    };
    createScheduledJob(payload).then(({ job: created }) => {
      const mapped: ScheduledJob = { ...created, logs: [] };
      setJobs((prev) => [mapped, ...prev]);
    }).catch(cause => { setError(cause instanceof Error ? cause.message : 'Schedule was not created'); });
  };

  const localStats = {
    total: jobs.length,
    active: jobs.filter((j) => j.status === 'active').length,
    paused: jobs.filter((j) => j.status === 'paused').length,
    failed: jobs.filter((j) => j.status === 'failed').length,
  };
  const stats = apiStats ?? localStats;

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden" data-testid="execution-scheduler">
      {error && <div role="alert" className="p-3 text-sm text-red-700 bg-red-50">{error}</div>}
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-100 flex-shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Execution Scheduler</h2>
          <p className="text-xs text-slate-400 mt-0.5">Cron jobs, intervals, and event-driven triggers</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="text-xs px-4 py-2 bg-slate-900 text-white rounded-xl hover:bg-slate-700 transition-colors"
          data-testid="new-job-btn"
        >
          + New Job
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-100 border-b border-slate-100 flex-shrink-0">
        {[
          { label: 'Total', value: stats.total, color: 'text-slate-700' },
          { label: 'Active', value: stats.active, color: 'text-emerald-600' },
          { label: 'Paused', value: stats.paused, color: 'text-amber-600' },
          { label: 'Failed', value: stats.failed, color: 'text-red-600' },
        ].map((s) => (
          <div key={s.label} className="bg-white px-5 py-3">
            <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
            <div className="text-[11px] text-slate-400">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 flex-shrink-0">
        <div className="flex items-center gap-1">
          {(['all', 'active', 'paused', 'failed', 'pending'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`text-[11px] px-2.5 py-1 rounded-lg capitalize transition-colors ${
                filter === f ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
              }`}
              data-testid={`filter-${f}`}>
              {f}
            </button>
          ))}
        </div>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search jobs…"
          className="ml-auto text-xs px-3 py-1.5 border border-slate-200 rounded-lg outline-none focus:border-slate-400 w-48"
          data-testid="job-search" />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Job List */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
              <div className="text-4xl">⏰</div>
              <p className="text-sm">No scheduled jobs</p>
              <button onClick={() => setShowNew(true)} className="text-xs px-4 py-2 bg-slate-900 text-white rounded-xl hover:bg-slate-700">
                Create first job
              </button>
            </div>
          ) : (
            <div className="p-4 space-y-2">
              {filtered.map((job) => {
                const isRunning = runningJobs.has(job.id);
                const successRate = job.runCount > 0 ? Math.round((job.successCount / job.runCount) * 100) : 100;

                return (
                  <div
                    key={job.id}
                    onClick={() => setSelectedJob(job)}
                    className={`flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-all cursor-pointer ${
                      selectedJob?.id === job.id
                        ? 'border-slate-300 bg-slate-50'
                        : 'border-slate-100 hover:border-slate-200 bg-white hover:bg-slate-50/50'
                    }`}
                    data-testid={`job-row-${job.id}`}
                  >
                    {/* Status indicator */}
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      isRunning ? 'bg-blue-500 animate-pulse' :
                      job.status === 'active' ? 'bg-emerald-400' :
                      job.status === 'paused' ? 'bg-amber-400' :
                      job.status === 'failed' ? 'bg-red-400' : 'bg-slate-300'
                    }`} />

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-medium text-slate-800 truncate">{job.name}</span>
                        <ScheduleTypeBadge type={job.scheduleType} />
                        {isRunning && <span className="text-[11px] text-blue-500 animate-pulse">running…</span>}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-400">
                        <span>{job.skillName}</span>
                        {job.scheduleType === 'cron' && <span className="font-mono">{job.cronExpression}</span>}
                        {job.scheduleType === 'event' && <span>{job.eventTrigger}</span>}
                        {job.nextRun && <span>next {futureTime(job.nextRun)}</span>}
                      </div>
                    </div>

                    {/* Metrics */}
                    <div className="flex items-center gap-4 text-[11px] text-slate-400 flex-shrink-0">
                      <div className="text-right">
                        <div className="font-mono text-slate-600">{job.runCount}</div>
                        <div>runs</div>
                      </div>
                      <div className="text-right">
                        <div className={`font-mono ${successRate >= 90 ? 'text-emerald-600' : successRate >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
                          {successRate}%
                        </div>
                        <div>success</div>
                      </div>
                      {job.lastRun && (
                        <div className="text-right">
                          <div className="text-slate-500">{relativeTime(job.lastRun)}</div>
                          <div>last run</div>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleRunNow(job.id)}
                        disabled={isRunning}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 transition-colors"
                        title="Run now"
                      >
                        {isRunning ? <span className="animate-spin text-xs">↻</span> : '▶'}
                      </button>
                      <button
                        onClick={() => handleToggle(job.id)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                        title={job.status === 'active' ? 'Pause' : 'Resume'}
                      >
                        {job.status === 'active' ? '⏸' : '▶'}
                      </button>
                      <button
                        onClick={() => handleDelete(job.id)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Delete"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selectedJob && (
          <JobDetail
            job={jobs.find((j) => j.id === selectedJob.id) ?? selectedJob}
            onClose={() => setSelectedJob(null)}
            onToggle={() => handleToggle(selectedJob.id)}
            onRun={() => handleRunNow(selectedJob.id)}
          />
        )}
      </div>

      {showNew && <NewJobModal onClose={() => setShowNew(false)} onSave={handleNewJob} />}
    </div>
  );
}

export default ExecutionScheduler;
