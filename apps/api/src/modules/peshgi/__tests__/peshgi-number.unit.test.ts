import { describe, it, expect } from 'vitest';
import { formatPeshgiNumber, peshgiNumberPrefix } from '../peshgi-number';

// docs/25 R-34: every accounting document is numbered from its own date in UTC —
// the calendar its accounting period is derived from. The peshgi generator read
// local getters, so on a server east of UTC a loan dated late on the 30th was
// numbered into the 1st of the next month.
describe('peshgi numbering uses the UTC day', () => {
  it('numbers a late-evening UTC date on its UTC day', () => {
    const d = new Date('2026-06-30T20:00:00Z'); // already 1 July in Pakistan
    expect(peshgiNumberPrefix(d)).toBe('L-260630-');
    expect(formatPeshgiNumber(d, 7)).toBe('L-260630-007');
  });
});
