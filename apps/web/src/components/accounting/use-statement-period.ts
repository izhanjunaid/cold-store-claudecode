'use client';

import { useMemo, useState } from 'react';
import { useFacility } from '@/hooks/use-reference-data';
import {
  presetRange,
  priorRange,
  DEFAULT_FY_START_MONTH,
  type PresetKey,
  type PeriodRange,
} from '@/lib/fiscal-period';

/**
 * Shared period/state controller for the financial statements:
 * preset → concrete range, custom overrides, prior-year range, book-type, compare.
 */
export function useStatementPeriod(defaultPreset: PresetKey = 'this_fy') {
  const { data: facility } = useFacility();
  const fyStart = (facility?.settings?.['fiscal_year_start_month'] as number | undefined) ?? DEFAULT_FY_START_MONTH;

  const [preset, setPreset] = useState<PresetKey>(defaultPreset);
  const [custom, setCustomState] = useState<{ date_from: string; date_to: string } | null>(null);
  const [bookType, setBookType] = useState('');
  const [compare, setCompare] = useState(false);

  const range: PeriodRange = useMemo(() => {
    if (preset === 'custom' && custom) {
      return { date_from: custom.date_from, date_to: custom.date_to, as_of: custom.date_to, label: 'Custom' };
    }
    return presetRange(preset, fyStart);
  }, [preset, custom, fyStart]);

  const prior = useMemo(() => priorRange(range, 'year'), [range]);

  function setCustom(partial: { date_from?: string; date_to?: string }) {
    setCustomState((prev) => {
      const base = prev ?? { date_from: range.date_from, date_to: range.date_to };
      return { ...base, ...partial };
    });
  }

  function changePreset(p: PresetKey) {
    setPreset(p);
    if (p === 'custom' && !custom) {
      setCustomState({ date_from: range.date_from, date_to: range.date_to });
    }
  }

  return { preset, setPreset: changePreset, range, prior, setCustom, bookType, setBookType, compare, setCompare };
}
