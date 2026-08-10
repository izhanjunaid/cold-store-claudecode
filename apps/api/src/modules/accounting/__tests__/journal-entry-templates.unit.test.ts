import { describe, it, expect } from 'vitest';
import { buildJE01InvoiceFinalized } from '../templates/je-01-invoice-finalized';
import { buildJE02PaymentReceived } from '../templates/je-02-payment-received';
import { buildJE03AdvanceReceived } from '../templates/je-03-advance-received';
import { buildJE04AdvanceApplied } from '../templates/je-04-advance-applied';
import { buildJE05CreditNote } from '../templates/je-05-credit-note';
import { buildJE06ChequeDishonoured } from '../templates/je-06-cheque-dishonoured';
import { buildJE08BadDebtWriteOff } from '../templates/je-08-bad-debt-writeoff';
import { buildJE24ChequeCleared } from '../templates/je-24-cheque-cleared';
import { arAccountForParty, assetAccountForPaymentMethod, revenueAccountForCommodity } from '../templates/types';
import { receiptAssetAccountForPaymentMethod } from '@coldchain/shared';

function totals(lines: { debitAmount: number; creditAmount: number }[]) {
  return {
    d: lines.reduce((s, l) => s + Number(l.debitAmount), 0),
    c: lines.reduce((s, l) => s + Number(l.creditAmount), 0),
  };
}

const farmerParty = { id: 'p1', name: 'Test Farmer', partyType: 'FARMER' };
const traderParty = { id: 'p2', name: 'Test Trader', partyType: 'TRADER' };
const lot = { id: 'l1', lotNumber: 'LOT-260101-0001', commodityName: 'POTATO' };

describe('JE template balance enforcement', () => {
  it('JE-01 balances with storage + service + GST', () => {
    const draft = buildJE01InvoiceFinalized({
      invoiceId: 'inv1',
      invoiceNumber: 'INV-202601-0001',
      invoiceDate: new Date('2026-01-15'),
      totalPkr: 27500,
      gstAmountPkr: 2500,
      bookType: 'PACCI',
      billingParty: farmerParty,
      lot,
      lines: [
        { lineType: 'STORAGE', description: 'Storage', amountPkr: 20000 },
        { lineType: 'SERVICE', description: 'Loading', amountPkr: 5000, serviceChargeRevenueCode: '4110' },
      ],
    });
    const t = totals(draft.lines);
    expect(t.d).toBeCloseTo(27500);
    expect(t.c).toBeCloseTo(27500);
    expect(draft.lines.find((l) => l.accountCode === '1110')?.debitAmount).toBe(27500);
    expect(draft.lines.find((l) => l.accountCode === '4010')?.creditAmount).toBe(20000);
    expect(draft.lines.find((l) => l.accountCode === '4110')?.creditAmount).toBe(5000);
    expect(draft.lines.find((l) => l.accountCode === '2020')?.creditAmount).toBe(2500);
  });

  it('JE-01 routes Apple lots to 4020', () => {
    const draft = buildJE01InvoiceFinalized({
      invoiceId: 'inv2',
      invoiceNumber: 'INV-2',
      invoiceDate: new Date(),
      totalPkr: 1000,
      gstAmountPkr: 0,
      bookType: 'PACCI',
      billingParty: traderParty,
      lot: { id: 'l2', lotNumber: 'LOT-2', commodityName: 'APPLE' },
      lines: [{ lineType: 'STORAGE', description: 'Storage', amountPkr: 1000 }],
    });
    expect(draft.lines.find((l) => l.creditAmount > 0)?.accountCode).toBe('4020');
    expect(draft.lines.find((l) => l.debitAmount > 0)?.accountCode).toBe('1120'); // trader AR
  });

  it('JE-01 with ADVANCE_APPLIED line stays balanced', () => {
    const draft = buildJE01InvoiceFinalized({
      invoiceId: 'inv3',
      invoiceNumber: 'INV-3',
      invoiceDate: new Date(),
      totalPkr: 8000,
      gstAmountPkr: 0,
      bookType: 'PACCI',
      billingParty: farmerParty,
      lot,
      lines: [
        { lineType: 'STORAGE', description: 'Storage', amountPkr: 10000 },
        { lineType: 'ADVANCE_APPLIED', description: 'Advance offset', amountPkr: -2000 },
      ],
    });
    const t = totals(draft.lines);
    expect(t.d).toBeCloseTo(t.c);
  });

  it('JE-01 with discount debits 4910 Discounts Allowed and stays balanced', () => {
    // subTotal 10000, discount 500, no GST → total 9500
    const draft = buildJE01InvoiceFinalized({
      invoiceId: 'inv-disc-1',
      invoiceNumber: 'INV-D1',
      invoiceDate: new Date('2026-06-01'),
      totalPkr: 9500,
      gstAmountPkr: 0,
      discountAmountPkr: 500,
      bookType: 'PACCI',
      billingParty: farmerParty,
      lot,
      lines: [{ lineType: 'STORAGE', description: 'Storage', amountPkr: 10000 }],
    });
    const t = totals(draft.lines);
    expect(t.d).toBeCloseTo(t.c);
    expect(draft.lines.find((l) => l.accountCode === '4910')?.debitAmount).toBe(500);
    expect(draft.lines.find((l) => l.accountCode === '1110')?.debitAmount).toBe(9500);
    // revenue stays gross
    expect(draft.lines.find((l) => l.accountCode === '4010')?.creditAmount).toBe(10000);
  });

  it('JE-01 with discount + advance + GST stays balanced', () => {
    // subTotal 10000, discount 1000, gst 10% on 9000 = 900, advance 2000
    // total = 10000 - 1000 + 900 - 2000 = 7900
    const draft = buildJE01InvoiceFinalized({
      invoiceId: 'inv-disc-2',
      invoiceNumber: 'INV-D2',
      invoiceDate: new Date('2026-06-01'),
      totalPkr: 7900,
      gstAmountPkr: 900,
      discountAmountPkr: 1000,
      bookType: 'PACCI',
      billingParty: farmerParty,
      lot,
      lines: [
        { lineType: 'STORAGE', description: 'Storage', amountPkr: 10000 },
        { lineType: 'ADVANCE_APPLIED', description: 'Advance offset', amountPkr: -2000 },
      ],
    });
    const t = totals(draft.lines);
    expect(t.d).toBeCloseTo(t.c);
    expect(draft.lines.find((l) => l.accountCode === '4910')?.debitAmount).toBe(1000);
    expect(draft.lines.find((l) => l.accountCode === '2010')?.debitAmount).toBe(2000);
    expect(draft.lines.find((l) => l.accountCode === '2020')?.creditAmount).toBe(900);
  });

  it('JE-01 with zero discount emits no 4910 line', () => {
    const draft = buildJE01InvoiceFinalized({
      invoiceId: 'inv-disc-3',
      invoiceNumber: 'INV-D3',
      invoiceDate: new Date('2026-06-01'),
      totalPkr: 1000,
      gstAmountPkr: 0,
      discountAmountPkr: 0,
      bookType: 'PACCI',
      billingParty: farmerParty,
      lot,
      lines: [{ lineType: 'STORAGE', description: 'Storage', amountPkr: 1000 }],
    });
    expect(draft.lines.find((l) => l.accountCode === '4910')).toBeUndefined();
  });

  it('JE-02 balances DR Cash CR AR', () => {
    const draft = buildJE02PaymentReceived({
      paymentId: 'pay1',
      paymentDate: new Date('2026-01-20'),
      amountPkr: 5000,
      paymentMethod: 'CASH',
      referenceNumber: null,
      bookType: 'PACCI',
      party: farmerParty,
    });
    const t = totals(draft.lines);
    expect(t.d).toBe(5000);
    expect(t.c).toBe(5000);
    expect(draft.lines[0]!.accountCode).toBe('1010');
    expect(draft.lines[1]!.accountCode).toBe('1110');
  });

  it('JE-03 advance debits Bank credits Advance Receipts liability', () => {
    const draft = buildJE03AdvanceReceived({
      paymentId: 'pay2',
      paymentDate: new Date('2026-01-20'),
      amountPkr: 10000,
      paymentMethod: 'BANK_TRANSFER',
      referenceNumber: 'TXN-1',
      bookType: 'PACCI',
      party: traderParty,
    });
    expect(draft.lines.find((l) => l.debitAmount > 0)?.accountCode).toBe('1020');
    expect(draft.lines.find((l) => l.creditAmount > 0)?.accountCode).toBe('2010');
  });

  it('JE-04 advance applied: debits Advance Receipts, credits AR', () => {
    const draft = buildJE04AdvanceApplied({
      paymentId: 'pay2',
      invoiceId: 'inv4',
      invoiceNumber: 'INV-4',
      appliedDate: new Date(),
      amountPkr: 4000,
      bookType: 'PACCI',
      party: traderParty,
    });
    expect(draft.lines.find((l) => l.debitAmount > 0)?.accountCode).toBe('2010');
    expect(draft.lines.find((l) => l.creditAmount > 0)?.accountCode).toBe('1120'); // trader AR
  });

  it('JE-05 credit note debits revenue per line, credits AR sum', () => {
    const draft = buildJE05CreditNote({
      creditNoteId: 'cn1',
      creditNoteNumber: 'CN-1',
      creditDate: new Date(),
      bookType: 'PACCI',
      party: farmerParty,
      invoice: { id: 'inv5', invoiceNumber: 'INV-5' },
      lineItems: [
        { revenueAccountCode: '4010', amountPkr: 1000, description: 'Storage adjust' },
        { revenueAccountCode: '4110', amountPkr: 500, description: 'Loading adjust' },
      ],
    });
    const t = totals(draft.lines);
    expect(t.d).toBe(1500);
    expect(t.c).toBe(1500);
    expect(draft.lines.find((l) => l.creditAmount > 0 && l.accountCode === '1110')?.creditAmount).toBe(1500);
  });

  it('JE-06 cheque bounce debits AR, credits Bank — REVERSAL type', () => {
    const draft = buildJE06ChequeDishonoured({
      paymentId: 'pay3',
      dishonourDate: new Date(),
      amountPkr: 12000,
      bookType: 'PACCI',
      party: traderParty,
    });
    expect(draft.entryType).toBe('REVERSAL');
    expect(draft.lines.find((l) => l.debitAmount > 0)?.accountCode).toBe('1120');
    expect(draft.lines.find((l) => l.creditAmount > 0)?.accountCode).toBe('1020');
  });

  // P0-1: an advance cheque that bounces while still sitting in 2010 must reverse
  // against 2010, not AR. JE-03 booked DR bank / CR 2010; only JE-04 (on allocation)
  // moves it to AR. Reversing to AR while 2010 still holds the money leaves the
  // advance liability standing AND invents a receivable — a 2x misstatement.
  it('JE-06 wholly-unallocated advance bounce debits 2010, never AR', () => {
    const draft = buildJE06ChequeDishonoured({
      paymentId: 'pay-adv-1',
      dishonourDate: new Date(),
      amountPkr: 12000,
      bookType: 'PACCI',
      party: traderParty,
      advanceRemainderPkr: 12000,
    });
    const t = totals(draft.lines);
    expect(t.d).toBe(12000);
    expect(t.c).toBe(12000);
    expect(draft.lines.find((l) => l.accountCode === '2010')?.debitAmount).toBe(12000);
    expect(draft.lines.find((l) => l.accountCode === '1120')).toBeUndefined();
    expect(draft.lines.find((l) => l.creditAmount > 0)?.accountCode).toBe('1020');
  });

  it('JE-06 partly-allocated advance bounce splits the debit across 2010 and AR', () => {
    const draft = buildJE06ChequeDishonoured({
      paymentId: 'pay-adv-2',
      dishonourDate: new Date(),
      amountPkr: 12000,
      bookType: 'PACCI',
      party: traderParty,
      advanceRemainderPkr: 5000, // 7000 already applied to invoices via JE-04
    });
    const t = totals(draft.lines);
    expect(t.d).toBe(12000);
    expect(t.c).toBe(12000);
    expect(draft.lines.find((l) => l.accountCode === '2010')?.debitAmount).toBe(5000);
    expect(draft.lines.find((l) => l.accountCode === '1120')?.debitAmount).toBe(7000);
    expect(draft.lines.find((l) => l.creditAmount > 0)?.creditAmount).toBe(12000);
  });

  it('JE-06 without an advance remainder is unchanged — AR only', () => {
    const draft = buildJE06ChequeDishonoured({
      paymentId: 'pay-adv-3',
      dishonourDate: new Date(),
      amountPkr: 9000,
      bookType: 'PACCI',
      party: traderParty,
      advanceRemainderPkr: 0,
    });
    expect(draft.lines).toHaveLength(2);
    expect(draft.lines.find((l) => l.accountCode === '2010')).toBeUndefined();
    expect(draft.lines.find((l) => l.accountCode === '1120')?.debitAmount).toBe(9000);
  });

  it('JE-08 bad debt: debits 6080, credits AR', () => {
    const draft = buildJE08BadDebtWriteOff({
      invoiceId: 'inv6',
      invoiceNumber: 'INV-6',
      writeOffDate: new Date(),
      amountPkr: 8000,
      reason: 'Party defaulted',
      bookType: 'PACCI',
      party: farmerParty,
    });
    const t = totals(draft.lines);
    expect(t.d).toBe(8000);
    expect(t.c).toBe(8000);
    expect(draft.lines.find((l) => l.debitAmount > 0)?.accountCode).toBe('6080');
    expect(draft.lines.find((l) => l.creditAmount > 0)?.accountCode).toBe('1110');
  });

  // Phase 25 — cheque clearing (docs/09 §2, ERP benchmark). A received cheque
  // parks in 1025 until the bank actually processes it; JE-24 moves it to 1020.
  it('JE-24 cheque cleared: debits 1020 Bank, credits 1025 Cheques in Hand', () => {
    const draft = buildJE24ChequeCleared({
      paymentId: 'pay1',
      clearedDate: new Date('2026-04-10'),
      amountPkr: 5000,
      bookType: 'PACCI',
      party: farmerParty,
      referenceNumber: 'CHQ-12345',
    });
    const t = totals(draft.lines);
    expect(t.d).toBe(5000);
    expect(t.c).toBe(5000);
    expect(draft.lines.find((l) => l.debitAmount > 0)?.accountCode).toBe('1020');
    expect(draft.lines.find((l) => l.creditAmount > 0)?.accountCode).toBe('1025');
    expect(draft.entryType).toBe('CHEQUE_CLEARED');
    expect(draft.sourceTable).toBe('payments');
    expect(draft.sourceId).toBe('pay1');
  });

  // JE-07 (overpayment) and JE-10 (ownership-transfer AR shift) were removed in
  // phase/19: both had zero production callers. Overpayment is prevented by
  // allocation guards (PAYMENT_OVER_ALLOCATED); FULL-transfer accrued billing
  // splits a standalone draft invoice through JE-01 instead. JE-11 / JE-11R
  // (month-end revenue accrual) were removed earlier — revenue is invoice-basis
  // by decision (docs/09 §JE-11, docs/16 Gap 4).
});

describe('Account-mapping helpers', () => {
  it('maps party types to AR accounts and fails loudly on unknown types (F-10)', () => {
    expect(arAccountForParty('FARMER')).toBe('1110');
    expect(arAccountForParty('TRADER')).toBe('1120');
    expect(arAccountForParty('ARHTI')).toBe('1130');
    expect(arAccountForParty('BUYER')).toBe('1150');
    expect(arAccountForParty('OTHER')).toBe('1150');
    // Party types are a closed enum — an unmapped value is a programming
    // error and must not silently misclassify AR into Buyers'.
    expect(() => arAccountForParty('UNKNOWN')).toThrow(/no ar account mapping/i);
  });

  it('maps payment methods to asset accounts and fails loudly on unknown methods (F-10)', () => {
    expect(assetAccountForPaymentMethod('CASH')).toBe('1010');
    expect(assetAccountForPaymentMethod('CHEQUE')).toBe('1020');
    expect(assetAccountForPaymentMethod('BANK_TRANSFER')).toBe('1020');
    expect(assetAccountForPaymentMethod('MOBILE_WALLET')).toBe('1030');
    expect(() => assetAccountForPaymentMethod('CRYPTO')).toThrow(/no asset account mapping/i);
  });

  // Phase 25 (ERP benchmark, docs/09 §2): a cheque *received* is not yet bank
  // funds — it parks in 1025 until POST /v1/payments/:id/clear moves it to
  // 1020. This resolver is receipt-only and deliberately separate from
  // assetAccountForPaymentMethod, which still returns 1020 for CHEQUE because
  // peshgi issuance, employee-advance issuance and expense payments (all
  // disbursements — money the facility writes a cheque FOR, not receives)
  // depend on that unchanged mapping.
  it('routes a received CHEQUE to 1025 (clearing) but leaves every other method unchanged (phase/25)', () => {
    expect(receiptAssetAccountForPaymentMethod('CHEQUE')).toBe('1025');
    expect(receiptAssetAccountForPaymentMethod('CASH')).toBe('1010');
    expect(receiptAssetAccountForPaymentMethod('BANK_TRANSFER')).toBe('1020');
    expect(receiptAssetAccountForPaymentMethod('MOBILE_WALLET')).toBe('1030');
    expect(() => receiptAssetAccountForPaymentMethod('CRYPTO')).toThrow(/no asset account mapping/i);
    // The disbursement-side mapping must stay untouched by this change.
    expect(assetAccountForPaymentMethod('CHEQUE')).toBe('1020');
  });

  it('maps commodities to revenue accounts and falls back to 4050', () => {
    expect(revenueAccountForCommodity('POTATO')).toBe('4010');
    expect(revenueAccountForCommodity('APPLE')).toBe('4020');
    expect(revenueAccountForCommodity('ONION')).toBe('4030');
    expect(revenueAccountForCommodity('KINNOW')).toBe('4040');
    expect(revenueAccountForCommodity(null)).toBe('4050');
    expect(revenueAccountForCommodity('GUAVA')).toBe('4050');
  });
});
