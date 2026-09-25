import type { Prisma } from '@coldchain/db';
import { documentNumberPrefix, formatDocumentNumber, nextDocumentNumber } from '../../common/document-number';

// UTC throughout so a document's number always agrees with the accounting period
// derived from its date (see common/document-number.ts).

export const journalEntryNumberPrefix = (date: Date): string => documentNumberPrefix('JE', date, 'monthly');

export const formatJournalEntryNumber = (date: Date, next: number): string =>
  formatDocumentNumber(journalEntryNumberPrefix(date), next, 4);

export const generateJournalEntryNumber = (tx: Prisma.TransactionClient, facilityId: string, date: Date) =>
  nextDocumentNumber(tx, facilityId, 'journal_entries', journalEntryNumberPrefix(date), 4);

export const formatCreditNoteNumber = (date: Date, next: number): string =>
  formatDocumentNumber(documentNumberPrefix('CN', date, 'monthly'), next, 4);

export const generateCreditNoteNumber = (tx: Prisma.TransactionClient, facilityId: string, date: Date) =>
  nextDocumentNumber(tx, facilityId, 'credit_notes', documentNumberPrefix('CN', date, 'monthly'), 4);
