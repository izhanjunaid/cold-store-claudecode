import { describe, it, expect } from 'vitest';
import { renderLoanAcknowledgmentHtml } from '../pdf.service';
import type { LoanAcknowledgmentData } from '../pdf.service';

const SAMPLE: LoanAcknowledgmentData = {
  facilityName: 'Lahore Cold Store',
  facilityCity: 'Lahore',
  loanNumber: 'L-260510-001',
  partyName: 'Ghulam Hussain',
  partyNameUrdu: 'غلام حسین',
  issueDate: '2026-05-10',
  principalPkr: 150000,
  sourceAssetAccountCode: '1010',
  journalEntryId: 'je-uuid-1',
  notes: 'Advance for upcoming potato season',
};

describe('loan-acknowledgment template', () => {
  it('renders without throwing', () => {
    const html = renderLoanAcknowledgmentHtml(SAMPLE);
    expect(html).toBeTruthy();
    expect(typeof html).toBe('string');
  });

  it('includes loan number', () => {
    const html = renderLoanAcknowledgmentHtml(SAMPLE);
    expect(html).toContain('L-260510-001');
  });

  it('includes bilingual party name', () => {
    const html = renderLoanAcknowledgmentHtml(SAMPLE);
    expect(html).toContain('Ghulam Hussain');
    expect(html).toContain('غلام حسین');
  });

  // P1-8: this used to assert the raw, ungrouped '150000' the template
  // printed. The money helper now groups and 2-decimals it.
  it('shows principal amount prominently, grouped with two decimals', () => {
    const html = renderLoanAcknowledgmentHtml(SAMPLE);
    expect(html).toContain('150,000.00');
    expect(html).not.toContain('PKR 150000');
  });

  it('groups by lakh/crore when the facility reads en-IN', () => {
    const html = renderLoanAcknowledgmentHtml(SAMPLE, 'en-IN');
    expect(html).toContain('1,50,000.00');
  });

  it('shows notes when provided', () => {
    const html = renderLoanAcknowledgmentHtml(SAMPLE);
    expect(html).toContain('Advance for upcoming potato season');
  });

  it('hides notes when null', () => {
    const html = renderLoanAcknowledgmentHtml({ ...SAMPLE, notes: null });
    expect(html).not.toContain('Advance for upcoming potato season');
  });

  it('includes Urdu acknowledgment text', () => {
    const html = renderLoanAcknowledgmentHtml(SAMPLE);
    expect(html).toContain('پیشگی');
  });
});
