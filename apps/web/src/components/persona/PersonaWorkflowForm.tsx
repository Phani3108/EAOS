/**
 * PersonaWorkflowForm — Shared form renderer for Engineering and Product persona skills.
 * Handles all field types, conditional visibility, run mode, and tool strip.
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */
'use client';

import { useState, useCallback, useEffect } from 'react';
import { getPrompts, type PromptEntry } from '@/lib/api';
import { getAuthConfig } from '@/lib/auth-client';
import { uploadArtifact } from '@/lib/execution-client';
import { ModelSelector, type ModelChoice } from '../ModelSelector';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillInputField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'url' | 'select' | 'multiselect' | 'tags' | 'toggle' | 'file' | 'number';
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  options?: string[];
  section: 'basic' | 'advanced';
  dependsOn?: string;   // field id — only render when that field's value is truthy
  multiple?: boolean;   // for file fields
  accept?: string;      // for file fields, e.g. ".pdf,.docx"
}

export interface SkillToolRef {
  id: string;
  name: string;
  icon: string;
  connected: boolean;
}

type FieldValue = string | boolean | string[] | FileList | null;
type FormValues = Record<string, FieldValue>;

export type RunMode = 'live' | 'sandbox';

export interface PersonaWorkflowFormProps {
  fields: SkillInputField[];
  tools: SkillToolRef[];           // tool strip (required + optional)
  accentClass?: string;            // Tailwind bg class for Run button, e.g. 'bg-slate-900'
  accentHoverClass?: string;       // hover variant
  persona?: 'engineering' | 'product' | 'marketing' | 'hr';
  onExecute: (inputs: Record<string, unknown>, simulate: boolean, customPrompt?: string, modelId?: string, provider?: string) => void;
  onCancel: () => void;
  executing: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Values shaped the way the gateway validates them (validateSkillInputs in
 * services/gateway/src/validation.ts): multiselect/tags → string[], toggle →
 * boolean, number → number, file → { artifactId } (uploaded first). Every value
 * used to be flattened to a string, which the gateway rejects for those types —
 * so any skill with one of those inputs could not run from a persona hub.
 */
async function serializeValues(values: FormValues, fields: SkillInputField[]): Promise<Record<string, unknown>> {
  const byId = new Map(fields.map((f) => [f.id, f] as const));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === null || v === undefined || v === '') continue;
    const field = byId.get(k);
    switch (field?.type) {
      case 'multiselect':
      case 'tags': {
        const items = (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((item) => item.trim()).filter(Boolean);
        if (items.length) out[k] = items;
        break;
      }
      case 'toggle':
        out[k] = v === true || v === 'true';
        break;
      case 'number': {
        const n = typeof v === 'string' ? Number(v) : NaN;
        if (Number.isFinite(n)) out[k] = n;
        break;
      }
      case 'file': {
        if (!(v instanceof FileList) || v.length === 0) break;
        const refs: { artifactId: string }[] = [];
        for (const file of Array.from(v)) refs.push(await uploadArtifact(file));
        out[k] = field.multiple ? refs : refs[0];
        break;
      }
      default:
        out[k] = Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? String(v) : v instanceof FileList ? undefined : v;
    }
  }
  return out;
}

function isFieldVisible(field: SkillInputField, values: FormValues): boolean {
  if (!field.dependsOn) return true;
  const dep = values[field.dependsOn];
  if (typeof dep === 'boolean') return dep === true;
  if (typeof dep === 'string') return dep !== '' && dep !== 'false';
  if (Array.isArray(dep)) return dep.length > 0;
  return false;
}

// ---------------------------------------------------------------------------
// Individual field renderers
// ---------------------------------------------------------------------------

function TextField({
  field,
  value,
  onChange,
}: {
  field: SkillInputField;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type={field.type === 'url' ? 'url' : field.type === 'number' ? 'number' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      required={field.required}
      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
    />
  );
}

function TextAreaField({
  field,
  value,
  onChange,
}: {
  field: SkillInputField;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      required={field.required}
      rows={field.section === 'basic' ? 4 : 3}
      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none bg-white"
    />
  );
}

function SelectField({
  field,
  value,
  onChange,
}: {
  field: SkillInputField;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={field.required}
      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
    >
      <option value="">Select…</option>
      {field.options?.map((opt) => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  );
}

function MultiSelectField({
  field,
  value,
  onChange,
}: {
  field: SkillInputField;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (opt: string) => {
    if (value.includes(opt)) {
      onChange(value.filter((v) => v !== opt));
    } else {
      onChange([...value, opt]);
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {field.options?.map((opt) => {
        const selected = value.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            className={`px-2.5 py-1 text-xs rounded-full border transition-all ${
              selected
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
            }`}
          >
            {selected && <span className="mr-1">✓</span>}{opt}
          </button>
        );
      })}
    </div>
  );
}

function TagsField({
  field,
  value,
  onChange,
}: {
  field: SkillInputField;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [input, setInput] = useState('');

  const addTag = () => {
    const tag = input.trim();
    if (tag && !value.includes(tag)) {
      onChange([...value, tag]);
    }
    setInput('');
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); addTag(); }
            if (e.key === ',') { e.preventDefault(); addTag(); }
          }}
          placeholder={field.placeholder ?? 'Type and press Enter…'}
          className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
        />
        <button
          type="button"
          onClick={addTag}
          className="px-3 py-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          Add
        </button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-700 text-xs rounded-full">
              {tag}
              <button
                type="button"
                onClick={() => onChange(value.filter((t) => t !== tag))}
                className="text-slate-400 hover:text-slate-700"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ToggleField({
  field,
  value,
  onChange,
}: {
  field: SkillInputField;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none group">
      <div
        onClick={() => onChange(!value)}
        className={`relative w-9 h-5 rounded-full transition-colors ${value ? 'bg-slate-900' : 'bg-slate-200'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
            value ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </div>
      <span className="text-sm text-slate-700 group-hover:text-slate-900">
        {value ? 'Enabled' : 'Disabled'}
      </span>
    </label>
  );
}

function FileField({
  field,
  value,
  onChange,
}: {
  field: SkillInputField;
  value: FileList | null;
  onChange: (v: FileList | null) => void;
}) {
  const files = value ? Array.from(value) : [];

  return (
    <div className="space-y-2">
      <label className="flex flex-col items-center justify-center w-full h-20 border-2 border-dashed border-slate-200 rounded-lg cursor-pointer hover:border-slate-400 hover:bg-slate-50/50 transition-all">
        <span className="text-xs text-slate-400">
          {files.length > 0 ? `${files.length} file(s) selected` : 'Click to upload or drag & drop'}
        </span>
        <span className="text-[11px] text-slate-300 mt-0.5">{field.accept ?? 'Any file type'}</span>
        <input
          type="file"
          multiple={field.multiple}
          accept={field.accept}
          onChange={(e) => onChange(e.target.files)}
          className="hidden"
        />
      </label>
      {files.length > 0 && (
        <ul className="space-y-0.5">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 text-[11px] text-slate-600">
              <span>📄</span>
              <span className="truncate">{f.name}</span>
              <span className="text-slate-300 ml-auto">{(f.size / 1024).toFixed(1)} KB</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run mode selector
// ---------------------------------------------------------------------------

function RunModeSelector({ mode, onChange }: { mode: RunMode; onChange: (m: RunMode) => void }) {
  const modes: { id: RunMode; label: string; desc: string; icon: string }[] = [
    { id: 'live',    label: 'Live',    desc: 'Calls Claude API + real tools', icon: '⚡' },
    { id: 'sandbox', label: 'Sandbox', desc: 'Simulated — no API calls',      icon: '🧪' },
  ];

  return (
    <div className="flex gap-2">
      {modes.map((m) => (
        <button
          key={m.id}
          type="button"
          aria-pressed={mode === m.id}
          onClick={() => onChange(m.id)}
          className={`flex-1 flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg border text-center transition-all ${
            mode === m.id
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'
          }`}
        >
          <span className="text-base leading-none">{m.icon}</span>
          <span className="text-xs font-semibold">{m.label}</span>
          <span className={`text-[11px] ${mode === m.id ? 'text-slate-300' : 'text-slate-400'}`}>{m.desc}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool strip
// ---------------------------------------------------------------------------

function ToolStrip({ tools }: { tools: SkillToolRef[] }) {
  if (tools.length === 0) return null;
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Required Tools</p>
      <div className="flex flex-wrap gap-2">
        {tools.map((tool) => (
          <div
            key={tool.id}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium border ${
              tool.connected
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-slate-100 border-slate-200 text-slate-500'
            }`}
          >
            <span>{tool.icon}</span>
            <span>{tool.name}</span>
            <span className={`w-1.5 h-1.5 rounded-full ${tool.connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single field dispatcher
// ---------------------------------------------------------------------------

function FieldRenderer({
  field,
  values,
  onChangeValue,
}: {
  field: SkillInputField;
  values: FormValues;
  onChangeValue: (id: string, v: FieldValue) => void;
}) {
  const { id, type } = field;

  if (!isFieldVisible(field, values)) return null;

  const renderInput = () => {
    switch (type) {
      case 'textarea':
        return (
          <TextAreaField
            field={field}
            value={(values[id] as string) ?? ''}
            onChange={(v) => onChangeValue(id, v)}
          />
        );
      case 'select':
        return (
          <SelectField
            field={field}
            value={(values[id] as string) ?? ''}
            onChange={(v) => onChangeValue(id, v)}
          />
        );
      case 'multiselect':
        return (
          <MultiSelectField
            field={field}
            value={(values[id] as string[]) ?? []}
            onChange={(v) => onChangeValue(id, v)}
          />
        );
      case 'tags':
        return (
          <TagsField
            field={field}
            value={(values[id] as string[]) ?? []}
            onChange={(v) => onChangeValue(id, v)}
          />
        );
      case 'toggle':
        return (
          <ToggleField
            field={field}
            value={(values[id] as boolean) ?? false}
            onChange={(v) => onChangeValue(id, v)}
          />
        );
      case 'file':
        return (
          <FileField
            field={field}
            value={(values[id] as FileList) ?? null}
            onChange={(v) => onChangeValue(id, v)}
          />
        );
      default:
        return (
          <TextField
            field={field}
            value={(values[id] as string) ?? ''}
            onChange={(v) => onChangeValue(id, v)}
          />
        );
    }
  };

  return (
    <div>
      {type !== 'toggle' && (
        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
          {field.label}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      {type === 'toggle' && (
        <p className="text-xs font-semibold text-slate-700 mb-1.5">{field.label}</p>
      )}
      {renderInput()}
      {field.helpText && (
        <p className="text-[11px] text-slate-400 mt-1">{field.helpText}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prompt selector
// ---------------------------------------------------------------------------

function PromptSelector({
  prompts,
  loading,
  selectedId,
  onSelect,
}: {
  prompts: PromptEntry[];
  loading: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (loading) {
    return (
      <div>
        <p className="text-xs font-semibold text-slate-700 mb-1.5">Prompt Template</p>
        <div className="px-3 py-2 text-sm text-slate-400 border border-slate-200 rounded-lg">Loading prompts…</div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs font-semibold text-slate-700 mb-1.5">Prompt Template <span className="text-slate-400 font-normal">(optional)</span></p>
      <select
        value={selectedId}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
      >
        <option value="">No prompt — use default</option>
        {prompts.map((p) => (
          <option key={p.id} value={p.id}>📝 {p.title}</option>
        ))}
      </select>
      {selectedId && (
        <div className="mt-2 p-2.5 border border-violet-200 bg-violet-50/50 rounded-lg">
          <p className="text-[11px] font-medium text-violet-600 mb-1">Prompt Preview</p>
          <p className="text-xs text-slate-600 whitespace-pre-wrap line-clamp-4">
            {prompts.find((p) => p.id === selectedId)?.content ?? ''}
          </p>
        </div>
      )}
      <p className="text-[11px] text-slate-400 mt-1">Pick a prompt from the library to inject into the AI execution</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main form component
// ---------------------------------------------------------------------------

export function PersonaWorkflowForm({
  fields,
  tools,
  accentClass = 'bg-slate-900',
  accentHoverClass = 'hover:bg-slate-800',
  persona,
  onExecute,
  onCancel,
  executing,
}: PersonaWorkflowFormProps) {
  const [values, setValues] = useState<FormValues>({});
  const [runMode, setRunMode] = useState<RunMode>('live');
  const [runModeTouched, setRunModeTouched] = useState(false);
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null);
  const [submitError, setSubmitError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [model, setModel] = useState<ModelChoice>({});
  const [selectedPromptId, setSelectedPromptId] = useState('');
  const [prompts, setPrompts] = useState<PromptEntry[]>([]);
  const [promptsLoading, setPromptsLoading] = useState(true);

  // Fetch prompts on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getPrompts(persona ? { category: persona } : undefined);
        if (!cancelled) {
          setPrompts(data.prompts ?? []);
        }
      } catch {
        // Fallback: try without filter
        try {
          const data = await getPrompts();
          if (!cancelled) setPrompts(data.prompts ?? []);
        } catch { /* API unreachable — prompts empty */ }
      } finally {
        if (!cancelled) setPromptsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [persona]);

  // With no model configured a Live run is refused, so default to Sandbox
  // (until the user picks a mode themselves).
  useEffect(() => {
    let cancelled = false;
    getAuthConfig().then((config) => { if (!cancelled) setLlmConfigured(config.llmConfigured); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (llmConfigured === false && !runModeTouched) setRunMode('sandbox');
  }, [llmConfigured, runModeTouched]);

  const basicFields = fields.filter((f) => f.section === 'basic');
  const advancedFields = fields.filter((f) => f.section === 'advanced');

  const handleChange = useCallback((id: string, v: FieldValue) => {
    setValues((prev) => ({ ...prev, [id]: v }));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');

    // Validate required basic fields
    for (const field of basicFields) {
      if (!field.required) continue;
      if (!isFieldVisible(field, values)) continue;
      const val = values[field.id];
      if (val === undefined || val === null || val === '' || val === false) {
        // Let browser handle via required attr for text fields, skip for others
      }
    }

    let serialized: Record<string, unknown>;
    try {
      serialized = await serializeValues(values, fields);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not upload the attached files');
      return;
    }
    const promptContent = selectedPromptId
      ? prompts.find((p) => p.id === selectedPromptId)?.content
      : undefined;
    onExecute(serialized, runMode === 'sandbox', promptContent, model.modelId, model.provider);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Tool strip */}
      {tools.length > 0 && <ToolStrip tools={tools} />}

      {/* Basic fields */}
      <div className="space-y-4">
        {basicFields.map((field) => (
          <FieldRenderer
            key={field.id}
            field={field}
            values={values}
            onChangeValue={handleChange}
          />
        ))}
      </div>

      {/* Advanced section */}
      {advancedFields.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 font-medium transition-colors"
          >
            <span className="text-[11px]">{showAdvanced ? '▼' : '▶'}</span>
            {showAdvanced ? 'Hide advanced options' : `Show advanced options (${advancedFields.length})`}
          </button>

          {showAdvanced && (
            <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
              {advancedFields.map((field) => (
                <FieldRenderer
                  key={field.id}
                  field={field}
                  values={values}
                  onChangeValue={handleChange}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Prompt template selector */}
      <PromptSelector
        prompts={prompts}
        loading={promptsLoading}
        selectedId={selectedPromptId}
        onSelect={setSelectedPromptId}
      />

      {/* AI Model selector */}
      <ModelSelector value={model} onChange={setModel} />

      {/* Run mode */}
      <div>
        <p className="text-xs font-semibold text-slate-700 mb-2">Run Mode</p>
        <RunModeSelector mode={runMode} onChange={(m) => { setRunMode(m); setRunModeTouched(true); }} />
        {llmConfigured === false && runMode === 'live' && (
          <p className="text-xs text-amber-700 mt-2">No model provider is configured on the gateway, so a Live run will be refused. Use Sandbox, or add an API key.</p>
        )}
      </div>

      {submitError && <p role="alert" className="text-sm text-red-700">{submitError}</p>}

      {/* Action buttons */}
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={executing}
          className={`flex-1 px-4 py-2.5 ${accentClass} text-white text-sm font-semibold rounded-lg ${accentHoverClass} disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
        >
          {executing ? 'Starting…' : runMode === 'sandbox' ? '🧪 Run in Sandbox' : '⚡ Run Skill'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2.5 text-slate-500 text-sm hover:text-slate-700 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
