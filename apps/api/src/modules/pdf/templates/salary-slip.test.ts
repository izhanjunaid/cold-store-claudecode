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

  it('shows net pay and gross pay', () => {
    const html = renderSalarySlipHtml(SAMPLE);
    expect(html).toContain('45000');
    expect(html).toContain('43625');
  });

  it('hides zero income tax row', () => {
    const html = renderSalarySlipHtml({ ...SAMPLE, incomeTax: 0 });
    expect(html).not.toContain('Income Tax');
  });

  it('shows income tax row when non-zero', () => {
    const html = renderSalarySlipHtml({ ...SAMPLE, incomeTax: 500 });
    expect(html).toContain('Income Tax');
    expect(html).toContain('500');
  });

  it('includes Urdu header', () => {
    const html = renderSalarySlipHtml(SAMPLE);
    expect(html).toContain('تنخواہ');
  });
});
