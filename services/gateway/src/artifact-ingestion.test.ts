import { describe, expect, it } from 'vitest';
import { extractArtifact } from './artifact-ingestion.js';

describe('bounded artifact extraction', () => {
  it('extracts source bytes rather than treating an upload ID as content', () => {
    const first = extractArtifact('brief.txt', 'text/plain', Buffer.from('Fixture product brief'));
    const second = extractArtifact('brief.txt', 'text/plain', Buffer.from('Changed product brief'));
    expect(first.text).toBe('Fixture product brief');
    expect(first.digest).not.toBe(second.digest);
  });
  it('rejects unsupported binary formats, invalid UTF-8 and forged JSON', () => {
    expect(() => extractArtifact('file.pdf', 'application/pdf', Buffer.from('%PDF-1.7'))).toThrow('Unsupported');
    expect(() => extractArtifact('file.txt', 'text/plain', Buffer.from([255,254,0]))).toThrow();
    expect(() => extractArtifact('file.json', 'application/json', Buffer.from('{invalid'))).toThrow();
    expect(() => extractArtifact('../file.txt', 'text/plain', Buffer.from('fixture'))).toThrow();
  });
});
