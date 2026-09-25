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
  /** Pre-assigned id — a manual entry has no document behind it, so it is its own source. */
  id?: string;
  entryType: EntryType;
  bookType: BookType;
  sourceTable: string;
  sourceId: string;
  entryDate: Date;
  description: string;
  lines: JournalEntryLineDraft[];
};
