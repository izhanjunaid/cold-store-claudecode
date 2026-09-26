import type { JournalEntryDraft, JournalEntryLineDraft } from '../../accounting/templates/types';

// Category → account mapping lives in @coldchain/shared ASSET_CATEGORY_ACCOUNTS; the
// gain, loss and impairment accounts in SYSTEM_ACCOUNTS (docs/25 C-34).
export type { JournalEntryDraft, JournalEntryLineDraft };
