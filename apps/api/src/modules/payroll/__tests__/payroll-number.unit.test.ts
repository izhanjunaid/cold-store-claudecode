import { describe, it, expect } from 'vitest';
import { formatPayrollRunNumber, payrollRunNumberPrefix } from '../payroll-number';

describe('payroll-number formatting', () => {
  it('formats PAY-YYYYMM-NNN with 3-digit zero-padded sequence', () => {
    expect(formatPayrollRunNumber(2026, 4, 1)).toBe('PAY-202604-001');
    expect(formatPayrollRunNumber(2026, 12, 99)).toBe('PAY-202612-099');
  });

  it('zero-pads month to two digits', () => {
    expect(formatPayrollRunNumber(2026, 1, 5)).toBe('PAY-202601-005');
    expect(payrollRunNumberPrefix(2026, 1)).toBe('PAY-202601-');
  });
});
