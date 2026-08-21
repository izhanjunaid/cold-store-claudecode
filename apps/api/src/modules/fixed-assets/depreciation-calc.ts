/**
 * Pure depreciation math. SLM and WDV with pro-rata for mid-year additions.
 *
 * SLM (straight-line):
 *   annual = (cost - residual) / useful_life_years
 *   monthly = annual / 12
 *
 * WDV (written-down value / reducing balance):
 *   annual = current_nbv * rate / 100
 *   monthly = annual / 12
 *
 * Pro-rata: the month of commissioning counts only if the depreciation_start_date
 * falls on or before the 15th of that month.
 */

export type DepreciationMethod = 'SLM' | 'WDV';

export type ScheduleRowInput = {
  method: DepreciationMethod;
  costPkr: number;
  residualValuePkr: number;
  usefulLifeYears: number | null;
  wdvRatePercent: number | null;
  depreciationStartDate: Date;
  periodYear: number;
  periodMonth: number;
  /** Carrying amount at the start of the period — cost less accumulated depreciation AND impairment. */
  openingNbvPkr: number;
  /** Cumulative impairment written down so far. Zero for almost every asset. */
  accumulatedImpairmentPkr?: number;
};

export type ScheduleRow = {
  periodYear: number;
  periodMonth: number;
  openingNbvPkr: number;
  depreciationAmountPkr: number;
  closingNbvPkr: number;
};

/** Whole months from the start date to the given period. Local time, matching isPeriodActive. */
export function monthsElapsed(start: Date, year: number, month: number): number {
  return (year - start.getFullYear()) * 12 + (month - (start.getMonth() + 1));
}

/**
 * Returns true if the given period (year, month) is on or after the depreciation start date,
 * counting the start month only if start date is on or before the 15th.
 */
export function isPeriodActive(start: Date, year: number, month: number): boolean {
  const startYear = start.getFullYear();
  const startMonth = start.getMonth() + 1;
  if (year < startYear) return false;
  if (year > startYear) return true;
  if (month > startMonth) return true;
  if (month < startMonth) return false;
  // Same month — count only if start day <= 15
  return start.getDate() <= 15;
}

/**
 * Compute one month's depreciation amount given current NBV and method parameters.
 * Floors at residual value (depreciation cannot push NBV below residual).
 */
export function computeMonthlyDepreciation(input: ScheduleRowInput): ScheduleRow {
  if (!isPeriodActive(input.depreciationStartDate, input.periodYear, input.periodMonth)) {
    return {
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      openingNbvPkr: round2(input.openingNbvPkr),
      depreciationAmountPkr: 0,
      closingNbvPkr: round2(input.openingNbvPkr),
    };
  }

  const opening = round2(input.openingNbvPkr);
  const residual = round2(input.residualValuePkr);
  const depreciableFloor = residual; // closing NBV may not go below residual
  const remainingDepreciable = round2(opening - residual);
  if (remainingDepreciable <= 0.005) {
    return {
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      openingNbvPkr: opening,
      depreciationAmountPkr: 0,
      closingNbvPkr: opening,
    };
  }

  let monthly: number;
  if (input.method === 'SLM') {
    if (!input.usefulLifeYears || input.usefulLifeYears <= 0) {
      throw new Error('usefulLifeYears required for SLM');
    }
    if (round2(input.accumulatedImpairmentPkr ?? 0) > 0.005) {
      // IFRS for SMEs 27.10: once an impairment is recognised, later periods
      // spread the REVISED carrying amount, less residual, over the REMAINING
      // useful life. Charging the original cost-based amount against a written
      // -down asset would depreciate it past its residual value and, given
      // enough time, past zero.
      //
      // Only impaired assets take this branch. For an unimpaired asset the two
      // formulas are algebraically identical, but not identical to the paisa
      // once rounding compounds — and this runs on a live register, so an
      // untouched asset must keep producing the schedule it already has.
      const totalMonths = Math.round(input.usefulLifeYears * 12);
      const remaining = Math.max(
        totalMonths - monthsElapsed(input.depreciationStartDate, input.periodYear, input.periodMonth),
        1,
      );
      monthly = round2(remainingDepreciable / remaining);
    } else {
      const annual = round2((input.costPkr - residual) / input.usefulLifeYears);
      monthly = round2(annual / 12);
    }
  } else {
    if (!input.wdvRatePercent || input.wdvRatePercent <= 0) {
      throw new Error('wdvRatePercent required for WDV');
    }
    const annual = round2(opening * (input.wdvRatePercent / 100));
    monthly = round2(annual / 12);
  }

  // Cap at remaining depreciable amount
  if (monthly > remainingDepreciable) monthly = remainingDepreciable;
  monthly = round2(monthly);

  const closing = round2(Math.max(opening - monthly, depreciableFloor));

  return {
    periodYear: input.periodYear,
    periodMonth: input.periodMonth,
    openingNbvPkr: opening,
    depreciationAmountPkr: monthly,
    closingNbvPkr: closing,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
