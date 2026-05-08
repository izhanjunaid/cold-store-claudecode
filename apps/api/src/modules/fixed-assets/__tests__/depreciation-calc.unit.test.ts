import { describe, it, expect } from 'vitest';
import {
  computeMonthlyDepreciation,
  isPeriodActive,
} from '../depreciation-calc';

describe('depreciation-calc', () => {
  describe('isPeriodActive', () => {
    it('returns true if period is after start month', () => {
      const start = new Date('2026-03-10');
      expect(isPeriodActive(start, 2026, 4)).toBe(true);
      expect(isPeriodActive(start, 2027, 1)).toBe(true);
    });

    it('returns false if period is before start month', () => {
      const start = new Date('2026-03-10');
      expect(isPeriodActive(start, 2026, 2)).toBe(false);
      expect(isPeriodActive(start, 2025, 12)).toBe(false);
    });

    it('counts start month if start day <= 15', () => {
      const start = new Date('2026-03-15');
      expect(isPeriodActive(start, 2026, 3)).toBe(true);
    });

    it('skips start month if start day > 15', () => {
      const start = new Date('2026-03-16');
      expect(isPeriodActive(start, 2026, 3)).toBe(false);
      expect(isPeriodActive(start, 2026, 4)).toBe(true);
    });
  });

  describe('SLM monthly depreciation', () => {
    it('computes Rs. 20,833/month for Rs. 8M building, Rs. 500k residual, 30 years', () => {
      const row = computeMonthlyDepreciation({
        method: 'SLM',
        costPkr: 8000000,
        residualValuePkr: 500000,
        usefulLifeYears: 30,
        wdvRatePercent: null,
        depreciationStartDate: new Date('2026-01-01'),
        periodYear: 2026,
        periodMonth: 1,
        openingNbvPkr: 8000000,
      });
      // (8M - 500k) / 30 / 12 = 20,833.33
      expect(row.depreciationAmountPkr).toBeCloseTo(20833.33, 1);
      expect(row.closingNbvPkr).toBeCloseTo(7979166.67, 1);
    });

    it('throws if usefulLifeYears missing for SLM', () => {
      expect(() =>
        computeMonthlyDepreciation({
          method: 'SLM',
          costPkr: 1000,
          residualValuePkr: 0,
          usefulLifeYears: null,
          wdvRatePercent: null,
          depreciationStartDate: new Date('2026-01-01'),
          periodYear: 2026,
          periodMonth: 1,
          openingNbvPkr: 1000,
        }),
      ).toThrow(/usefulLifeYears required/);
    });
  });

  describe('WDV monthly depreciation', () => {
    it('computes Rs. 75,000/month for Rs. 4.5M compressor, 20% rate, year 1', () => {
      const row = computeMonthlyDepreciation({
        method: 'WDV',
        costPkr: 4500000,
        residualValuePkr: 0,
        usefulLifeYears: null,
        wdvRatePercent: 20,
        depreciationStartDate: new Date('2026-01-01'),
        periodYear: 2026,
        periodMonth: 1,
        openingNbvPkr: 4500000,
      });
      // 4.5M * 20% / 12 = 75,000
      expect(row.depreciationAmountPkr).toBe(75000);
      expect(row.closingNbvPkr).toBe(4425000);
    });

    it('reduces NBV in subsequent year (year 2 lower than year 1)', () => {
      const year2 = computeMonthlyDepreciation({
        method: 'WDV',
        costPkr: 4500000,
        residualValuePkr: 0,
        usefulLifeYears: null,
        wdvRatePercent: 20,
        depreciationStartDate: new Date('2026-01-01'),
        periodYear: 2027,
        periodMonth: 1,
        openingNbvPkr: 3600000, // 4.5M - 900k year-1 depr
      });
      // 3.6M * 20% / 12 = 60,000
      expect(year2.depreciationAmountPkr).toBe(60000);
    });

    it('throws if wdvRatePercent missing for WDV', () => {
      expect(() =>
        computeMonthlyDepreciation({
          method: 'WDV',
          costPkr: 1000,
          residualValuePkr: 0,
          usefulLifeYears: null,
          wdvRatePercent: null,
          depreciationStartDate: new Date('2026-01-01'),
          periodYear: 2026,
          periodMonth: 1,
          openingNbvPkr: 1000,
        }),
      ).toThrow(/wdvRatePercent required/);
    });
  });

  describe('floor and edge cases', () => {
    it('returns zero depreciation when period is before start', () => {
      const row = computeMonthlyDepreciation({
        method: 'SLM',
        costPkr: 8000000,
        residualValuePkr: 0,
        usefulLifeYears: 10,
        wdvRatePercent: null,
        depreciationStartDate: new Date('2026-06-01'),
        periodYear: 2026,
        periodMonth: 3,
        openingNbvPkr: 8000000,
      });
      expect(row.depreciationAmountPkr).toBe(0);
      expect(row.closingNbvPkr).toBe(8000000);
    });

    it('caps depreciation so closing NBV cannot fall below residual value', () => {
      const row = computeMonthlyDepreciation({
        method: 'SLM',
        costPkr: 1000,
        residualValuePkr: 100,
        usefulLifeYears: 1, // would be (1000-100)/12 = 75/month
        wdvRatePercent: null,
        depreciationStartDate: new Date('2026-01-01'),
        periodYear: 2026,
        periodMonth: 1,
        openingNbvPkr: 150, // already near floor
      });
      // remaining depreciable = 150 - 100 = 50; even though formula = 75/month
      expect(row.depreciationAmountPkr).toBe(50);
      expect(row.closingNbvPkr).toBe(100);
    });
  });
});
