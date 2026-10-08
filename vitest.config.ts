import { existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Resolve NodeNext-style `./foo.js` imports to the sibling `./foo.ts` SOURCE.
 *
 * Without this, a stale compiled `src/foo.js` left over from an old `tsc` run
 * silently wins resolution and tests assert against yesterday's code while
 * reporting green. That happened: 870 stale artifacts were sitting inside
 * `src/` directories, invisible to `git status` because .gitignore line 48
 * ignores compiled JS under src. This plugin makes the `.ts` source
 * authoritative so the failure mode cannot recur.
 */
function preferTypeScriptSource(): Plugin {
  return {
    name: 'eaos:prefer-ts-source',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.') || !source.endsWith('.js')) return null;
      const tsCandidate = resolvePath(dirname(importer), source.replace(/\.js$/, '.ts'));
      return existsSync(tsCandidate) ? tsCandidate : null;
    },
  };
}

/**
 * Root vitest config.
 *
 * Tests live beside the code as `*.test.ts` inside each package's `src/` so they
 * are typechecked by that package's tsconfig, and are excluded from the `tsc`
 * build so they never ship in `dist/`.
 *
 * The codebase is NodeNext ESM and writes relative imports with a `.js`
 * extension (`./llm-provider.js`). Vite resolves those to the sibling `.ts`
 * source when no built `.js` exists, so tests import exactly what production
 * imports.
 */
export default defineConfig({
  plugins: [preferTypeScriptSource()],
  test: {
    // Unit tests only. `tests/api.test.ts` and `tests/integration.test.ts` are
    // hand-rolled runners (no vitest suite) and api.test.ts requires a live
    // gateway on :3000, so they are not unit tests. Phase 4 splits this config
    // into `unit` / `integration` / `e2e` projects and brings them in properly.
    include: [
      'services/*/src/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      // Framework-free web helpers only; components need a DOM environment.
      'apps/web/src/lib/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.turbo/**'],
    environment: 'node',
    // Env vars are the control surface for provider availability, and vitest
    // runs files in parallel workers by default. Isolate so one test's
    // process.env mutation cannot leak into another file.
    isolate: true,
    reporters: 'default',
  },
});
