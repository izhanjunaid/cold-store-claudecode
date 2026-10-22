import { z } from 'zod';

/**
 * A vehicle plate as typed: trimmed and upper-cased, the form both the gate and a
 * withdrawal store. Spacing and dashes are kept as written so the plate reads the
 * way it is painted; comparisons go through `normalizePlate`.
 */
export const VehicleNumber = z
  .string()
  .trim()
  .min(2)
  .max(30)
  .transform((v) => v.toUpperCase());

/**
 * The comparable form of a plate: letters and digits only, upper-cased, so
 * "lhr 5234", "LHR-5234" and "LHR5234" are the same truck. SQL mirror:
 * `regexp_replace(upper(x), '[^A-Z0-9]', '', 'g')`.
 */
export function normalizePlate(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
