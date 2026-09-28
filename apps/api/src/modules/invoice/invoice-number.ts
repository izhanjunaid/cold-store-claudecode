import type { Prisma } from '@coldchain/db';
import { documentNumberPrefix, formatDocumentNumber, nextDocumentNumber } from '../../common/document-number';

// INV-YYYYMM-NNNN, per facility per month, from the invoice's own UTC date — the
// calendar its accounting period is derived from.
export const invoiceNumberPrefix = (date: Date): string => documentNumberPrefix('INV', date, 'monthly');

export const formatInvoiceNumber = (date: Date, next: number): string =>
  formatDocumentNumber(invoiceNumberPrefix(date), next, 4);

export const generateInvoiceNumber = (tx: Prisma.TransactionClient, facilityId: string, date: Date) =>
  nextDocumentNumber(tx, facilityId, 'invoices', invoiceNumberPrefix(date), 4);
