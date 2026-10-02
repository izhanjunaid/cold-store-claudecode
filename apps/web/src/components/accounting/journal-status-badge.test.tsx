import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { JournalStatusBadge, journalStatusLabel } from './journal-status-badge';

/**
 * One badge for the list, the detail page and the peek (docs/25 L-11). The
 * detail page used to show POSTED for an entry the list showed as REVERSED,
 * because it read the status rather than is_reversed.
 */
describe('JournalStatusBadge', () => {
  it('shows a reversed entry as reversed, though its status is still POSTED', () => {
    render(<JournalStatusBadge entry={{ posting_status: 'POSTED', is_reversed: true }} />);
    expect(screen.getByText('Reversed')).toBeTruthy();
    expect(screen.queryByText('Posted')).toBeNull();
  });

  it('shows a draft as a draft and a standing entry as posted', () => {
    expect(journalStatusLabel({ posting_status: 'AUTO_DRAFT', is_reversed: false })).toBe('Draft');
    expect(journalStatusLabel({ posting_status: 'POSTED', is_reversed: false })).toBe('Posted');
  });
});
