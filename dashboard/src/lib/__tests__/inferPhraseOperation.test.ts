import { describe, it, expect } from 'vitest';
import { inferPhraseOperation } from '../inferPhraseOperation';

describe('inferPhraseOperation', () => {
  it('detects Turkish remove suffix', () => {
    expect(inferPhraseOperation('ayrani cikar')).toBe('remove');
    expect(inferPhraseOperation('Pizza cikar')).toBe('remove');
    expect(inferPhraseOperation('tavuk döner iptal')).toBe('remove');
    expect(inferPhraseOperation('ayran iptal')).toBe('remove');
  });

  it('detects German conjugated remove', () => {
    expect(inferPhraseOperation('entferne ayran')).toBe('remove');
    expect(inferPhraseOperation('entfernen ayran')).toBe('remove');
  });

  it('defaults to add for normal orders', () => {
    expect(inferPhraseOperation('ein ayran')).toBe('add');
    expect(inferPhraseOperation('2 döner')).toBe('add');
  });
});
