import type { EntryType, BookType } from '@coldchain/db';

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

export const PARTY_AR_ACCOUNT: Record<string, string> = {
  FARMER: '1110',
  TRADER: '1120',
  ARHTI: '1130',
  BUYER: '1150',
  OTHER: '1150',
};

// Payment-method routing lives in @coldchain/shared because the web client needs the
// same mapping (it used to re-derive it inline, which mis-routed MOBILE_WALLET).
// Re-exported here so the templates keep importing account routing from one place.
export {
  PAYMENT_METHOD_ASSET_ACCOUNT,
  DEFAULT_BANK_ACCOUNT_CODE,
  assetAccountForPaymentMethod,
  receiptAssetAccountForPaymentMethod,
} from '@coldchain/shared';

export const COMMODITY_REVENUE_ACCOUNT: Record<string, string> = {
  POTATO: '4010',
  APPLE: '4020',
  ONION: '4030',
  KINNOW: '4040',
};

export const ACCOUNT_GST_PAYABLE = '2020';
export const ACCOUNT_ADVANCE_RECEIPTS = '2010';
export const ACCOUNT_BAD_DEBT = '6080';
export const ACCOUNT_DISCOUNTS_ALLOWED = '4910';

// Party types are a closed enum: an unmapped value is a programming error, and a
// silent fallback would misclassify the posting (audit finding F-10). Fail loudly
// instead. (The payment-method equivalent now lives in @coldchain/shared and is
// re-exported above; it applies the same rule.)
export function arAccountForParty(partyType: string): string {
  const account = PARTY_AR_ACCOUNT[partyType];
  if (!account) throw new Error(`No AR account mapping for party type '${partyType}'`);
  return account;
}

// Commodities are an open, facility-configurable set — an unmapped commodity
// deliberately books to 4050 "Storage Revenue — Other" rather than blocking
// intake of a new commodity. (Rate plans/service charges can override via
// their stored revenue_account_code.)
export function revenueAccountForCommodity(commodityName: string | null | undefined): string {
  if (!commodityName) return '4050';
  return COMMODITY_REVENUE_ACCOUNT[commodityName.toUpperCase()] ?? '4050';
}
