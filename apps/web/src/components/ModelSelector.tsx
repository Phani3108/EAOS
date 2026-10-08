/**
 * ModelSelector — the AI model picker shared by the persona and marketing forms.
 *
 * The options come from the gateway (GET /api/llm/models), not from a list in
 * this file. A live run reserves budget at its model's price before every
 * provider call, so the gateway refuses a model it cannot price — and the lists
 * that used to be hardcoded here offered mostly such models, the default
 * included, so every live run from these forms failed.
 *
 * "Gateway default" names no model, so it can never be refused: it is the
 * initial choice, and the only one offered when the list cannot be loaded.
 */
'use client';

import { useEffect, useState } from 'react';
import { fetchPricedModels, type PricedModel } from '@/lib/execution-client';

export interface ModelChoice {
  modelId?: string;
  provider?: PricedModel['provider'];
}

const PROVIDER_LABELS: Record<PricedModel['provider'], string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'azure-openai': 'Azure OpenAI',
  gemini: 'Google Gemini',
  ollama: 'Ollama (Local)',
};

const GATEWAY_DEFAULT = '';
const keyOf = (model: { provider?: string; modelId?: string; id?: string }) => `${model.provider}/${model.modelId ?? model.id}`;

export function ModelSelector({ value, onChange, label = 'AI Model & Provider' }: { value: ModelChoice; onChange: (choice: ModelChoice) => void; label?: string }) {
  const [models, setModels] = useState<PricedModel[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchPricedModels()
      .then((list) => { if (!cancelled) setModels(list); })
      .catch(() => { /* gateway unreachable: only "Gateway default" is offered */ });
    return () => { cancelled = true; };
  }, []);

  const grouped = models.reduce<Record<string, PricedModel[]>>((acc, model) => {
    if (!acc[model.provider]) acc[model.provider] = [];
    acc[model.provider]!.push(model);
    return acc;
  }, {});

  return (
    <div>
      <p className="text-xs font-semibold text-slate-700 mb-1.5">{label}</p>
      <select
        value={value.modelId ? keyOf(value) : GATEWAY_DEFAULT}
        onChange={(e) => {
          const model = models.find((candidate) => keyOf(candidate) === e.target.value);
          onChange(model ? { modelId: model.id, provider: model.provider } : {});
        }}
        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
      >
        <option value={GATEWAY_DEFAULT}>Gateway default</option>
        {Object.entries(grouped).map(([provider, entries]) => (
          <optgroup key={provider} label={PROVIDER_LABELS[provider as PricedModel['provider']] ?? provider}>
            {entries.map((model) => (
              // A provider without credentials would hand the run to another provider's default.
              <option key={keyOf(model)} value={keyOf(model)} disabled={!model.available}>
                {model.id}{model.providerDefault ? ' (default)' : ''}{model.available ? '' : ' — not configured'}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <p className="text-[11px] text-slate-400 mt-1">Only models the gateway can price for a live run are offered. Gateway default lets the gateway choose.</p>
    </div>
  );
}
