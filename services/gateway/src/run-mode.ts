/**
 * Run mode — whether a run calls a live model or produces a labelled simulation.
 *
 * Why this is a runtime rule and not a route convention
 * ----------------------------------------------------------------------------
 * The rule used to live in server.ts as `resolveSimulate()`, and only the routes
 * that remembered to call it obeyed it. Chat hardcoded `simulate = false`,
 * registry packages took the client's flag verbatim, and the entrypoint schemas
 * defaulted a missing flag to live. A public demo visitor could therefore spend
 * the deployment's LLM budget through any of them, and a keyless `pnpm dev`
 * accepted runs that could only fail.
 *
 * `preparePersonaExecution` applies this rule to every run it creates, from the
 * run's OWNER. Every path that admits a run reaches it — the execute routes,
 * chat, registry packages, entrypoints, schedules, notifications and child
 * workflows — so a new entry point cannot produce a live run it should not. The
 * owner is the right input: a run started by a schedule or a parent workflow has
 * no request principal, but it always has an owner.
 *
 * The rule
 * ----------------------------------------------------------------------------
 *   1. Demo principals are simulated, whatever the request says. Public demo
 *      visitors (`demo:<uuid>`) must not spend this deployment's LLM budget,
 *      and that holds after EAOS_DEMO_MODE is switched off too, while their
 *      sessions are still valid. The one exception is the developer's own
 *      `demo:local` principal under EAOS_DEMO_MODE=local: their machine, their
 *      keys.
 *   2. Otherwise the caller's explicit choice wins.
 *   3. With no choice, no configured LLM provider means a labelled simulation
 *      rather than a live run that is accepted and then fails.
 */

import { isDemoPrincipal, localDemoUser } from './auth.js';
import { hasAnyLLMKey } from './llm-provider.js';

/**
 * True when runs owned by this principal may only be simulated.
 *
 * Reads EAOS_DEMO_MODE at decision time, as `hasAnyLLMKey()` reads the provider
 * keys: @agentos/config validated both at boot, and anything other than exactly
 * `local` keeps `demo:local` simulated too — the safe side.
 */
export function isSimulationOnly(ownerId: string | undefined): boolean {
  if (!ownerId || !isDemoPrincipal({ id: ownerId })) return false;
  return !(process.env.EAOS_DEMO_MODE === 'local' && ownerId === localDemoUser().id);
}

/**
 * Decide a run's mode. `requested` is the caller's choice: a boolean when the
 * client chose, anything else (usually `undefined`) when it did not.
 *
 * @returns true when the run must be simulated
 */
export function resolveSimulate(ownerId: string | undefined, requested?: unknown): boolean {
  if (isSimulationOnly(ownerId)) return true;
  return typeof requested === 'boolean' ? requested : !hasAnyLLMKey();
}
