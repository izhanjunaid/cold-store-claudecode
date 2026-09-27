'use client';

import type { PayrollSettingsType } from '@coldchain/shared';
import { useFacility } from '@/hooks/use-reference-data';

/**
 * The facility's statutory payroll figures (EOBI, standard working days). They were
 * literals in four places; they change by notification, so they come from settings
 * (docs/25 C-19). Undefined while the facility loads.
 */
export function usePayrollSettings(): PayrollSettingsType | undefined {
  const { data } = useFacility();
  return data?.settings?.['payroll'] as PayrollSettingsType | undefined;
}
