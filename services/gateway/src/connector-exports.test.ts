import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('production connector exports', () => {
  it.each(['github', 'jira', 'slack'])('loads %s with plain Node, without a TypeScript loader', connector => {
    const output = execFileSync(process.execPath, [
      '--input-type=module',
      '-e',
      `const name = '@agentos/connector-${connector}'; if (!import.meta.resolve(name).endsWith('/dist/index.js')) throw new Error('Connector must export compiled JavaScript'); await import(name); process.stdout.write('loaded');`,
    ], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(output).toBe('loaded');
  });
});
