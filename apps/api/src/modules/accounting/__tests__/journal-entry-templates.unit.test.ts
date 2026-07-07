import { describe, it, expect } from 'vitest';
import { buildJE01InvoiceFinalized } from '../templates/je-01-invoice-finalized';
import { buildJE02PaymentReceived } from '../templates/je-02-payment-received';
import { buildJE03AdvanceReceived } from '../templates/je-03-advance-received';
import { buildJE04AdvanceApplied } from '../templates/je-04-advance-applied';
import { buildJE05CreditNote } from '../templates/je-05-credit-note';
import { buildJE06ChequeDishonoured } from '../templates/je-06-cheque-dishonoured';
import { buildJE07Overpayment } from '../templates/je-07-overpayment';
import { buildJE08BadDebtWriteOff } from '../templates/je-08-bad-debt-writeoff';
import { buildJE10OwnershipTransferBilling } from '../templates/je-10-ownership-transfer-billing';
import { buildJE11AccruedRevenue } from '../templates/je-11-accrued-revenue';
import { buildJE11RAccrualReversal } from '../templates/je-11r-accrued-reversal';
import { arAccountForParty, assetAccountForPaymentMethod, revenueAccountForCommodity } from '../templates/types';

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

  it('JE-07 overpayment splits credit between AR and 2010', () => {
    const draft = buildJE07Overpayment({
      paymentId: 'pay4',
      paymentDate: new Date(),
      paymentMethod: 'CASH',
      bookType: 'PACCI',
      party: farmerParty,
      appliedAmountPkr: 5000,
      overpaymentAmountPkr: 1500,
    });
    const t = totals(draft.lines);
    expect(t.d).toBe(6500);
    expect(t.c).toBe(6500);
    expect(draft.lines.find((l) => l.accountCode === '1110')?.creditAmount).toBe(5000);
    expect(draft.lines.find((l) => l.accountCode === '2010')?.creditAmount).toBe(1500);
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

  it('JE-10 billing reassignment: DR new-party AR, CR old-party AR', () => {
    const draft = buildJE10OwnershipTransferBilling({
      ownershipHistoryId: 'oh1',
      effectiveDate: new Date(),
      amountPkr: 3000,
      bookType: 'PACCI',
      fromParty: farmerParty,
      toParty: traderParty,
      lot: { id: 'l3', lotNumber: 'LOT-3' },
    });
    expect(draft.lines.find((l) => l.debitAmount > 0)?.accountCode).toBe('1120'); // trader
    expect(draft.lines.find((l) => l.creditAmount > 0)?.accountCode).toBe('1110'); // farmer
  });

  it('JE-11 accrual: each lot adds DR AR + CR Revenue', () => {
    const draft = buildJE11AccruedRevenue({
      facilityPeriodId: 'period-202601',
      accrualDate: new Date('2026-01-31'),
      bookType: 'PACCI',
      lines: [
        { lot, billingParty: farmerParty, accruedAmountPkr: 1000 },
        { lot: { id: 'l4', lotNumber: 'LOT-4', commodityName: 'APPLE' }, billingParty: traderParty, accruedAmountPkr: 2000 },
      ],
    });
    const t = totals(draft.lines);
    expect(t.d).toBeCloseTo(3000);
    expect(t.c).toBeCloseTo(3000);
    expect(draft.lines.length).toBe(4);
  });

  it('JE-11R reverses the original lines exactly', () => {
    const original = {
      id: 'je-orig',
      entryNumber: 'JE-202601-0099',
      lines: [
        { accountCode: '1110', debitAmount: 1000, creditAmount: 0, partyId: 'p1', lotId: 'l1', description: 'accrual line' },
        { accountCode: '4010', debitAmount: 0, creditAmount: 1000, partyId: 'p1', lotId: 'l1', description: 'rev line' },
      ],
    };
    const reversal = buildJE11RAccrualReversal({
      originalEntry: original,
      reversalDate: new Date(),
      bookType: 'PACCI',
    });
    const t = totals(reversal.lines);
    expect(t.d).toBeCloseTo(t.c);
    expect(reversal.entryType).toBe('REVERSAL');
    expect(reversal.lines[0]!.debitAmount).toBe(0);
    expect(reversal.lines[0]!.creditAmount).toBe(1000);
    expect(reversal.lines[1]!.debitAmount).toBe(1000);
  });
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

  it('maps commodities to revenue accounts and falls back to 4050', () => {
    expect(revenueAccountForCommodity('POTATO')).toBe('4010');
    expect(revenueAccountForCommodity('APPLE')).toBe('4020');
    expect(revenueAccountForCommodity('ONION')).toBe('4030');
    expect(revenueAccountForCommodity('KINNOW')).toBe('4040');
    expect(revenueAccountForCommodity(null)).toBe('4050');
    expect(revenueAccountForCommodity('GUAVA')).toBe('4050');
  });
});
