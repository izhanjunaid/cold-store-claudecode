import type { Prisma, PrismaClient } from '@coldchain/db';
import { SYSTEM_ACCOUNTS } from '@coldchain/shared';
import { Errors } from '../../common/errors';

/** Every account that is a payable control account. The payables tie-out sums exactly these. */
export const AP_CONTROL_ACCOUNTS: readonly string[] = [SYSTEM_ACCOUNTS.TRADE_PAYABLES];

/** Where tax withheld from a supplier is owed, by section of the Income Tax Ordinance. */
export const SUPPLIER_WITHHOLDING_ACCOUNT: Record<'S153' | 'S155', string> = {
  S153: SYSTEM_ACCOUNTS.WHT_SUPPLIERS,
  S155: SYSTEM_ACCOUNTS.WHT_RENT,
};

export type PayableSupplier = { id: string; name: string; controlAccountCode: string };

/**
 * The party as a supplier. Its payable account is the one stamped on the party row at
 * creation — never looked up from its type (docs/25 R-01). A customer, whose account is
 * a receivable, is never billed by or paid as a supplier.
 */
export async function payableSupplier(
  db: PrismaClient | Prisma.TransactionClient,
  facilityId: string,
  partyId: string,
  field = 'supplier_party_id',
): Promise<PayableSupplier> {
  const p = await db.party.findFirst({
    where: { id: partyId, facilityId },
    select: { id: true, name: true, controlAccountCode: true },
  });
  if (!p) throw Errors.PARTY_NOT_FOUND();
  if (!AP_CONTROL_ACCOUNTS.includes(p.controlAccountCode)) {
    throw Errors.VALIDATION_ERROR(`${p.name} is not a supplier — its account is not a payable`, field);
  }
  return { id: p.id, name: p.name, controlAccountCode: p.controlAccountCode };
}
