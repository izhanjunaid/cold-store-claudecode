import { describe, it, expect } from 'vitest';
import { renderSalarySlipHtml } from '../pdf.service';
import type { SalarySlipData } from '../pdf.service';

const SAMPLE: SalarySlipData = {
  facilityName: 'Test Cold Store',
  runNumber: 'PAY-202604-001',
  payrollPeriod: 'April 2026',
  employeeName: 'Asif Khan',
  employeeNameUrdu: 'آصف خان',
  employeeCnic: '35202-1234567-1',
  employeeDesignation: 'Chamber Operator',
  daysWorked: 26,
  grossPay: 45000,
  eobiEmployee: 375,
  incomeTax: 0,
  otherDeductions: 1000,
  advanceRecovery: 0,
  netPay: 43625,
};

describe('salary-slip template', () => {
  it('renders without throwing', () => {
    const html = renderSalarySlipHtml(SAMPLE);
    expect(html).toBeTruthy();
    expect(typeof html).toBe('string');
  });

  it('includes bilingual employee name', () => {
    const html = renderSalarySlipHtml(SAMPLE);
    expect(html).toContain('Asif Khan');
    expect(html).toContain('آصف خان');
  });

  // P1-8: before the `money` helper the slip printed a raw `45000`, and an
  // invoice printed `1234567.5`. Amounts on a document somebody is handed must
  // be grouped and carry both decimal places.
  it('groups and 2-decimals the money fields', () => {
    const html = renderSalarySlipHtml(SAMPLE);
    expect(html).toContain('45,000.00');
    expect(html).toContain('43,625.00');
    expect(html).not.toContain('>45000<');
  });

  it('groups by lakh/crore when the facility reads en-IN', () => {
    const html = renderSalarySlipHtml({ ...SAMPLE, grossPay: 1234567 }, 'en-IN');
    expect(html).toContain('12,34,567.00');
  });

  it('leaves counts alone — days worked is not money', () => {
    const html = renderSalarySlipHtml(SAMPLE);
    expect(html).toContain('26');
    expect(html).not.toContain('26.00');
  });

  it('hides zero income tax row', () => {
    const html = renderSalarySlipHtml({ ...SAMPLE, incomeTax: 0 });
    expect(html).not.toContain('Income Tax');
  });

  it('shows income tax row when non-zero', () => {
    const html = renderSalarySlipHtml({ ...SAMPLE, incomeTax: 500 });
    expect(html).toContain('Income Tax');
    expect(html).toContain('500.00');
  });

  it('hides zero advance recovery row', () => {
    const html = renderSalarySlipHtml({ ...SAMPLE, advanceRecovery: 0 });
    expect(html).not.toContain('Advance Recovery');
  });

  it('shows advance recovery row when non-zero', () => {
    const html = renderSalarySlipHtml({ ...SAMPLE, advanceRecovery: 5000 });
    expect(html).toContain('Advance Recovery');
    expect(html).toContain('5,000.00');
  });

  it('includes Urdu header', () => {
    const html = renderSalarySlipHtml(SAMPLE);
    expect(html).toContain('تنخواہ');
  });
});
