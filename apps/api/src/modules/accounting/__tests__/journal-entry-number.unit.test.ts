import { describe, it, expect } from 'vitest';
import {
  formatJournalEntryNumber,
  journalEntryNumberPrefix,
  formatCreditNoteNumber,
} from '../journal-entry-number';

// Period derivation (period.ts) uses UTC getters; document numbering must use
// the same clock or an entry posted near a month boundary is numbered in a
// different month than its accounting period (phase/19 audit item 11).
describe('journal entry numbering uses UTC months', () => {
  it('numbers a late-evening UTC date in the UTC month, not the local month', () => {
    const d = new Date('2026-06-30T20:00:00Z'); // already 1 July in UTC+5 local time
    expect(formatJournalEntryNumber(d, 1)).toBe('JE-202606-0001');
    expect(journalEntryNumberPrefix(d)).toBe('JE-202606-');
    expect(formatCreditNoteNumber(d, 3)).toBe('CN-202606-0003');
  });

  it('formats a mid-month date identically in any timezone', () => {
    const d = new Date('2026-07-15T10:00:00Z');
    expect(formatJournalEntryNumber(d, 42)).toBe('JE-202607-0042');
    expect(journalEntryNumberPrefix(d)).toBe('JE-202607-');
    expect(formatCreditNoteNumber(d, 1)).toBe('CN-202607-0001');
  });
});
