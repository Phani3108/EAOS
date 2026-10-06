import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createStore } from './create-store.js';

it('preserves corrupt data rather than replacing it with an empty store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eaos-corrupt-fixture-'));
  let close: (() => void) | undefined;
  try {
    const path = join(dir, 'store.json');
    writeFileSync(path, '{corrupt');
    const result = createStore({ dataDir: dir });
    const store = result.store as typeof result.store & { close?: () => void };
    close = () => store.close?.();
    expect(result.mode).toBe('ephemeral');
    expect(readFileSync(path, 'utf8')).toBe('{corrupt');
  } finally { close?.(); rmSync(dir, { recursive: true, force: true }); }
});

it('does not report file persistence when DATA_DIR is a file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eaos-store-fixture-'));
  try {
    const path = join(dir, 'not-a-directory');
    writeFileSync(path, 'fixture');
    const result = createStore({ dataDir: path });
    expect(result.mode).toBe('ephemeral');
    expect(result.degradedReason).toBeTruthy();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
