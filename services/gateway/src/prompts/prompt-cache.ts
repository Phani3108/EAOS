/**
 * EAOS Prompt Cache — cache-friendly system-prompt assembly.
 *
 * Splits a system prompt into a stable (cacheable) prefix, an optional mid context, and a
 * volatile per-turn tail, joined so the stable prefix stays byte-identical across turns and
 * upstream prompt caches stay warm.
 *
 * Provenance: pattern adopted from NousResearch/hermes-agent (MIT). See third_party/NOTICE.
 */

export interface CacheablePrompt {
  /** stable — identity, tool guidance, skills. Cacheable prefix (rarely changes). */
  stable: string;
  /** context — mid-tier context that changes occasionally (optional). */
  context?: string;
  /** volatile — memory snapshot, user profile, per-turn data. Changes every turn. */
  volatile?: string;
}

/**
 * Join the tiers with \n\n in stable -> context -> volatile order so the stable prefix
 * stays byte-identical across turns and upstream prompt caches stay warm (EAOS approach).
 */
export function assembleCacheablePrompt(parts: CacheablePrompt): string {
  return [parts.stable, parts.context, parts.volatile]
    .filter((p): p is string => !!p && p.trim().length > 0)
    .join('\n\n');
}
