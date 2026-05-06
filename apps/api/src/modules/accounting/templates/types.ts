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

export const PAYMENT_METHOD_ASSET_ACCOUNT: Record<string, string> = {
  CASH: '1010',
  CHEQUE: '1020',
  BANK_TRANSFER: '1020',
  MOBILE_WALLET: '1030',
};

export const COMMODITY_REVENUE_ACCOUNT: Record<string, string> = {
  POTATO: '4010',
  APPLE: '4020',
  ONION: '4030',
  KINNOW: '4040',
};

export const ACCOUNT_GST_PAYABLE = '2020';
export const ACCOUNT_ADVANCE_RECEIPTS = '2010';
export const ACCOUNT_BAD_DEBT = '6080';

export function arAccountForParty(partyType: string): string {
  return PARTY_AR_ACCOUNT[partyType] ?? '1150';
}

export function assetAccountForPaymentMethod(method: string): string {
  return PAYMENT_METHOD_ASSET_ACCOUNT[method] ?? '1010';
}

export function revenueAccountForCommodity(commodityName: string | null | undefined): string {
  if (!commodityName) return '4050';
  return COMMODITY_REVENUE_ACCOUNT[commodityName.toUpperCase()] ?? '4050';
}
