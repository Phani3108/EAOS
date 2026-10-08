import { describe, expect, it } from 'vitest';
import { attachmentDisposition, extractArtifact, sanitizeArtifactFilename } from './artifact-ingestion.js';

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
  });
});

describe('artifact filenames', () => {
  it.each([
    ['report (1).csv', 'text/csv'],
    ['Q3 plan (final).md', 'text/markdown'],
    ["John's notes, v2.txt", 'text/plain'],
    ['résumé.txt', 'text/plain'],
    ['議事録 2026.md', 'text/markdown'],
    ['_draft.json', 'application/json'],
  ])('accepts the ordinary name %s unchanged', (name, mimeType) => {
    expect(extractArtifact(name, mimeType, Buffer.from('{"fixture":true}')).filename).toBe(name);
  });
  it('never stores a path, whatever separators or traversal the name carries', () => {
    for (const name of ['../file.txt', '../../etc/file.txt', '..\\..\\file.txt', '/abs/file.txt', 'dir/sub/file.txt']) {
      expect(sanitizeArtifactFilename(name)).toBe('file.txt');
    }
    expect(sanitizeArtifactFilename('notes..final.txt')).toBe('notes.final.txt');
    expect(sanitizeArtifactFilename('.hidden.txt')).toBe('hidden.txt');
    expect(sanitizeArtifactFilename('report.txt. ')).toBe('report.txt');
  });
  it('neutralises characters that can hide or spoof part of a name', () => {
    // U+202E (right-to-left override) would display 'invoice‮txt.exe' as 'invoiceexe.txt'.
    expect(sanitizeArtifactFilename('invoice‮txt.md')).toBe('invoice_txt.md');
    expect(sanitizeArtifactFilename('a​b\u0000c\nd.txt')).toBe('a_b_c_d.txt');
    expect(sanitizeArtifactFilename('a<b>c:d"e|f?g*h.txt')).toBe('a_b_c_d_e_f_g_h.txt');
    expect(sanitizeArtifactFilename('no break　space.txt')).toBe('no break space.txt');
    expect(sanitizeArtifactFilename('é.txt')).toBe('é.txt');
  });
  it('rejects names that sanitise to nothing, and still checks the format', () => {
    for (const name of ['', '..', '/', ' . ', 'dir/']) expect(() => sanitizeArtifactFilename(name)).toThrow('Invalid artifact filename');
    expect(() => extractArtifact('file.pdf.exe', 'text/plain', Buffer.from('fixture'))).toThrow('Unsupported');
  });
  it('bounds the length while keeping the extension', () => {
    const name = sanitizeArtifactFilename(`${'x'.repeat(300)}.csv`);
    expect(Array.from(name)).toHaveLength(160);
    expect(name.endsWith('.csv')).toBe(true);
    expect(Array.from(sanitizeArtifactFilename(`${'😀'.repeat(200)}.md`))).toHaveLength(160);
  });
  it('is idempotent, so a stored name re-validates unchanged', () => {
    for (const name of ['../a b (1).csv', 'invoice‮txt.md', ' ..x..y.. .txt', `${'é'.repeat(170)}.json`, 'é​́.txt', 'brief.txt']) {
      const once = sanitizeArtifactFilename(name);
      expect(sanitizeArtifactFilename(once)).toBe(once);
    }
  });
  it('encodes every non attr-char in the download header', () => {
    expect(attachmentDisposition("John's report (1)*.txt")).toBe("attachment; filename*=UTF-8''John%27s%20report%20%281%29%2A.txt");
    expect(attachmentDisposition('résumé.txt')).toBe("attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.txt");
  });
});
