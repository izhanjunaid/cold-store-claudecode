import type { EntryType, BookType } from '@coldchain/db';

// Account codes live in the registry (`SYSTEM_ACCOUNTS` in @coldchain/shared), not here.

export type JournalEntryLineDraft = {
  accountCode: string;
  debitAmount: number;
  creditAmount: number;
  partyId?: string | null;
  lotId?: string | null;
  description?: string | null;
};

export type JournalEntryDraft = {
  entryType: EntryType;
  bookType: BookType;
  sourceTable: string;
  sourceId: string;
  entryDate: Date;
  description: string;
  lines: JournalEntryLineDraft[];
};
