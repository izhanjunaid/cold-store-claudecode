import { describe, it, expect } from 'vitest';
import { formatInvoiceNumber, invoiceNumberPrefix } from './invoice-number';

// Period derivation (period.ts) uses UTC getters; document numbering must use the
// same clock or an invoice finalized near a month boundary is numbered into a
// different month than its accounting period. phase/19 fixed this for journal
// entries (audit item 11); invoice and expense numbering were missed.
describe('invoice numbering uses UTC months', () => {
  it('numbers a late-evening UTC date in the UTC month, not the local month', () => {
    const d = new Date('2026-06-30T20:00:00Z'); // already 1 July in UTC+5 local time
    expect(formatInvoiceNumber(d, 1)).toBe('INV-202606-0001');
    expect(invoiceNumberPrefix(d)).toBe('INV-202606-');
  });

  it('formats a mid-month date identically in any timezone', () => {
    const d = new Date('2026-07-15T10:00:00Z');
    expect(formatInvoiceNumber(d, 42)).toBe('INV-202607-0042');
    expect(invoiceNumberPrefix(d)).toBe('INV-202607-');
  });

  it('pads the sequence to four digits', () => {
    const d = new Date('2026-07-15T10:00:00Z');
    expect(formatInvoiceNumber(d, 7)).toBe('INV-202607-0007');
    expect(formatInvoiceNumber(d, 1234)).toBe('INV-202607-1234');
  });
});
