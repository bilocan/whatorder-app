import { describe, it, expect } from 'vitest';
import {
  comparePhoneLines,
  formatAttachLineOption,
  formatPhoneLineLabel,
  normalizeDisplayNumber,
  phoneLineMetaSuffix,
} from '../phoneLineLabel';

describe('phoneLineLabel', () => {
  it('uses displayNumber as the label', () => {
    expect(formatPhoneLineLabel({ id: '1227165440469679', displayNumber: '+905323458516' }))
      .toBe('+905323458516');
  });

  it('returns empty string when displayNumber is missing', () => {
    expect(formatPhoneLineLabel({ id: '1227165440469679' })).toBe('');
  });

  it('shows the last six digits of the Meta id as suffix', () => {
    expect(phoneLineMetaSuffix('1227165440469679')).toBe('…469679');
  });

  it('pairs display number with Meta-id tail for attach options', () => {
    expect(formatAttachLineOption(
      { id: '1147794621759163', displayNumber: '+1 (555) 196-1529' },
      'Phone number not set',
    )).toBe('+1 (555) 196-1529 (…759163)');
    expect(formatAttachLineOption(
      { id: '1147794621759163' },
      'Phone number not set',
    )).toBe('Phone number not set (…759163)');
  });

  it('sorts labeled lines before unlabeled', () => {
    const sorted = [
      { id: 'b', displayNumber: '+43 222' },
      { id: 'a' },
      { id: 'c', displayNumber: '+43 111' },
    ].sort(comparePhoneLines);
    expect(sorted.map((l) => l.id)).toEqual(['c', 'b', 'a']);
  });

  it('normalizes bare digits to E.164', () => {
    expect(normalizeDisplayNumber('905323458516')).toBe('+905323458516');
    expect(normalizeDisplayNumber('+905323458516')).toBe('+905323458516');
  });
});
