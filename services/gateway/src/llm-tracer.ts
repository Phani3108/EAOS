/**
 * LLM-specific observability.
 * Wraps callLLM() with OTel spans and structured metric counters.
 * Gracefully no-ops when OTel is not initialized.
 */

import { callLLM } from './llm-provider.js';
import type { LLMRequest, LLMResponse } from './llm-provider.js';

// ---------------------------------------------------------------------------
// In-process metric accumulators (exported for /api/metrics if desired)
// ---------------------------------------------------------------------------

interface LLMMetricEntry {
  provider: string;
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  totalLatencyMs: number;
}

const _metrics = new Map<string, LLMMetricEntry>();

function metricKey(provider: string, model: string): string {
  return `${provider}::${model}`;
}

function recordMetric(res: LLMResponse): void {
  const key = metricKey(res.provider, res.model);
  const entry = _metrics.get(key) ?? {
    provider: res.provider,
    model: res.model,
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    totalLatencyMs: 0,
  };

  entry.calls++;
  entry.promptTokens += res.inputTokens;
  entry.completionTokens += res.outputTokens;
  entry.costUsd += res.cost;
  entry.totalLatencyMs += res.latencyMs;

  _metrics.set(key, entry);
}

export function getLLMMetrics(): LLMMetricEntry[] {
  return Array.from(_metrics.values());
}

// ---------------------------------------------------------------------------
// OTel span helper (no-op if OTel not available)
// ---------------------------------------------------------------------------

async function withSpan<T>(name: string, attrs: Record<string, string | number>, fn: () => Promise<T>): Promise<T> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // Optional dependency — specifier cast to string so tsc treats it as a dynamic
    // (unresolved) import; tracing is a no-op when @opentelemetry/api isn't installed.
    const otel: any = await import('@opentelemetry/api' as string);
    const tracer = otel.trace.getTracer('agentos-gateway');
    return await tracer.startActiveSpan(name, async (span: any) => {
      for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
      try {
        const result = await fn();
        span.setStatus({ code: otel.SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.setStatus({ code: otel.SpanStatusCode.ERROR, message: String(err) });
        throw err;
      } finally {
        span.end();
      }
    });
  } catch {
    // OTel not available — run without tracing
    return fn();
  }
}

// ---------------------------------------------------------------------------
// tracedLLMCall — drop-in replacement for callLLM() with OTel + metrics
// ---------------------------------------------------------------------------

export async function tracedLLMCall(req: LLMRequest, spanName?: string): Promise<LLMResponse> {
  const label = spanName ?? `llm.call.${req.provider ?? 'auto'}`;

  const res = await withSpan(label, {
    'llm.provider': req.provider ?? 'auto',
    'llm.model': req.model ?? 'default',
    'llm.prompt_chars': req.userPrompt.length,
  }, async () => {
    const start = Date.now();
    const response = await callLLM(req);
    const latencyMs = response.latencyMs || (Date.now() - start);

    // Enrich span after call
    try {
      // Optional dependency — specifier cast to string so tsc treats it as a dynamic
    // (unresolved) import; tracing is a no-op when @opentelemetry/api isn't installed.
    const otel: any = await import('@opentelemetry/api' as string);
      const span = otel.trace.getActiveSpan();
      if (span) {
        span.setAttribute('llm.input_tokens', response.inputTokens);
        span.setAttribute('llm.output_tokens', response.outputTokens);
        span.setAttribute('llm.cost_usd', response.cost);
        span.setAttribute('llm.latency_ms', latencyMs);
        span.setAttribute('llm.model_used', response.model);
        span.setAttribute('llm.provider_used', response.provider);
      }
    } catch { /* OTel not available */ }

    return response;
  });

  recordMetric(res);
  return res;
}
