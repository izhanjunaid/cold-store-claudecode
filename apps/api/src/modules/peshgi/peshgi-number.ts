import type { Prisma } from '@coldchain/db';
import { documentNumberPrefix, formatDocumentNumber, nextDocumentNumber } from '../../common/document-number';

// L-YYMMDD-NNN (docs/08 §30), per facility per day, from the loan's own UTC date.
export const peshgiNumberPrefix = (date: Date): string => documentNumberPrefix('L', date, 'daily');

export const formatPeshgiNumber = (date: Date, next: number): string =>
  formatDocumentNumber(peshgiNumberPrefix(date), next, 3);

export const generatePeshgiNumber = (tx: Prisma.TransactionClient, facilityId: string, date: Date) =>
  nextDocumentNumber(tx, facilityId, 'party_loans', peshgiNumberPrefix(date), 3);
