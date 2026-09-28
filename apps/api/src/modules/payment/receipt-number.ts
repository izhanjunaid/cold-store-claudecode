import type { Prisma } from '@coldchain/db';
import { documentNumberPrefix, formatDocumentNumber, nextDocumentNumber } from '../../common/document-number';

// RCP-YYYYMM-NNNN, per facility per month, from the receipt's own UTC date.
export const receiptNumberPrefix = (date: Date): string => documentNumberPrefix('RCP', date, 'monthly');

export const formatReceiptNumber = (date: Date, next: number): string =>
  formatDocumentNumber(receiptNumberPrefix(date), next, 4);

export const generateReceiptNumber = (tx: Prisma.TransactionClient, facilityId: string, date: Date) =>
  nextDocumentNumber(tx, facilityId, 'payments', receiptNumberPrefix(date), 4);
