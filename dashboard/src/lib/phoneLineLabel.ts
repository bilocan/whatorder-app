import type { PhoneLine } from '../contexts/AdminPhoneLineContext';

/** Last 6 digits of the Meta phone_number_id — disambiguates lines with the same displayNumber. */
export function phoneLineMetaSuffix(id: string): string {
  const tail = id.replace(/\D/g, '').slice(-6);
  return tail ? `…${tail}` : id;
}

export function hasPhoneLineDisplayNumber(line: PhoneLine): boolean {
  return Boolean(line.displayNumber?.trim());
}

export function formatPhoneLineLabel(line: PhoneLine): string {
  return line.displayNumber?.trim() || '';
}

export function comparePhoneLines(a: PhoneLine, b: PhoneLine): number {
  const aHas = hasPhoneLineDisplayNumber(a);
  const bHas = hasPhoneLineDisplayNumber(b);
  if (aHas && !bHas) return -1;
  if (!aHas && bHas) return 1;
  if (aHas && bHas) {
    const byNumber = formatPhoneLineLabel(a).localeCompare(formatPhoneLineLabel(b));
    if (byNumber !== 0) return byNumber;
  }
  return a.id.localeCompare(b.id);
}

export function normalizeDisplayNumber(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}
