import { describe, it, expect } from 'vitest';
import { buildJE12AssetPurchase } from '../templates/je-12-asset-purchase';
import { buildJE13Depreciation } from '../templates/je-13-depreciation';
import { buildJE14AssetDisposal } from '../templates/je-14-asset-disposal';
import { ASSET_CATEGORY_ACCOUNT_DEFAULTS } from '../templates/types';

function totals(lines: { debitAmount: number; creditAmount: number }[]) {
  return {
    d: lines.reduce((s, l) => s + Number(l.debitAmount), 0),
    c: lines.reduce((s, l) => s + Number(l.creditAmount), 0),
  };
}

describe('Fixed Asset JE templates', () => {
  it('JE-12 balances: DR asset = CR bank', () => {
    const draft = buildJE12AssetPurchase({
      assetId: 'a1',
      assetNumber: 'FA-2026-0001',
      assetName: 'Bitzer Compressor',
      assetAccountCode: '1310',
      paidFromAccountCode: '1020',
      costPkr: 4500000,
      purchaseDate: new Date('2026-04-15'),
      bookType: 'PACCI',
    });
    const t = totals(draft.lines);
    expect(t.d).toBe(4500000);
    expect(t.c).toBe(4500000);
    expect(draft.entryType).toBe('ASSET_PURCHASE');
    expect(draft.lines.find((l) => l.accountCode === '1310')?.debitAmount).toBe(4500000);
    expect(draft.lines.find((l) => l.accountCode === '1020')?.creditAmount).toBe(4500000);
  });

  it('JE-13 routes COLD_PLANT depreciation to 5040 (direct cost)', () => {
    const draft = buildJE13Depreciation({
      assetId: 'a1',
      assetNumber: 'FA-2026-0001',
      assetName: 'Bitzer Compressor',
      deprExpenseAccountCode: ASSET_CATEGORY_ACCOUNT_DEFAULTS.COLD_PLANT.deprExpense,
      accumDeprAccountCode: ASSET_CATEGORY_ACCOUNT_DEFAULTS.COLD_PLANT.accumDepr,
      periodYear: 2026,
      periodMonth: 4,
      amountPkr: 75000,
      bookType: 'PACCI',
    });
    const t = totals(draft.lines);
    expect(t.d).toBe(75000);
    expect(t.c).toBe(75000);
    expect(draft.lines.find((l) => l.accountCode === '5040')?.debitAmount).toBe(75000);
    expect(draft.lines.find((l) => l.accountCode === '1311')?.creditAmount).toBe(75000);
    expect(draft.entryType).toBe('DEPRECIATION');
  });

  it('JE-13 routes BUILDING depreciation to 6120 (indirect)', () => {
    const draft = buildJE13Depreciation({
      assetId: 'a2',
      assetNumber: 'FA-2026-0002',
      assetName: 'Cold Store Building',
      deprExpenseAccountCode: ASSET_CATEGORY_ACCOUNT_DEFAULTS.BUILDING.deprExpense,
      accumDeprAccountCode: ASSET_CATEGORY_ACCOUNT_DEFAULTS.BUILDING.accumDepr,
      periodYear: 2026,
      periodMonth: 4,
      amountPkr: 20833,
      bookType: 'PACCI',
    });
    expect(draft.lines.find((l) => l.accountCode === '6120')?.debitAmount).toBe(20833);
    expect(draft.lines.find((l) => l.accountCode === '1321')?.creditAmount).toBe(20833);
  });

  it('JE-14 Case A: sold at book value (no gain/loss)', () => {
    const draft = buildJE14AssetDisposal({
      assetId: 'a1',
      assetNumber: 'FA-2026-0001',
      assetName: 'Old Forklift',
      assetAccountCode: '1330',
      accumDeprAccountCode: '1331',
      proceedsAccountCode: '1020',
      disposalDate: new Date('2026-12-15'),
      costPkr: 1000000,
      accumDeprPkr: 400000,
      proceedsPkr: 600000, // == NBV
      bookType: 'PACCI',
    });
    const t = totals(draft.lines);
    expect(t.d).toBeCloseTo(t.c);
    // No 4230 / 6110 lines
    expect(draft.lines.find((l) => l.accountCode === '4230')).toBeUndefined();
    expect(draft.lines.find((l) => l.accountCode === '6110')).toBeUndefined();
    expect(draft.lines.find((l) => l.accountCode === '1330')?.creditAmount).toBe(1000000);
  });

  it('JE-14 Case B: sold above book value (GAIN)', () => {
    const draft = buildJE14AssetDisposal({
      assetId: 'a1',
      assetNumber: 'FA-2026-0001',
      assetName: 'Forklift',
      assetAccountCode: '1330',
      accumDeprAccountCode: '1331',
      proceedsAccountCode: '1020',
      disposalDate: new Date('2026-12-15'),
      costPkr: 1000000,
      accumDeprPkr: 400000,
      proceedsPkr: 700000, // 100k gain over NBV 600k
      bookType: 'PACCI',
    });
    const t = totals(draft.lines);
    expect(t.d).toBeCloseTo(t.c);
    expect(draft.lines.find((l) => l.accountCode === '4230')?.creditAmount).toBe(100000);
    expect(draft.lines.find((l) => l.accountCode === '6110')).toBeUndefined();
  });

  it('JE-14 Case C: sold below book value (LOSS)', () => {
    const draft = buildJE14AssetDisposal({
      assetId: 'a1',
      assetNumber: 'FA-2026-0001',
      assetName: 'Forklift',
      assetAccountCode: '1330',
      accumDeprAccountCode: '1331',
      proceedsAccountCode: '1020',
      disposalDate: new Date('2026-12-15'),
      costPkr: 1000000,
      accumDeprPkr: 400000,
      proceedsPkr: 500000, // 100k loss vs NBV 600k
      bookType: 'PACCI',
    });
    const t = totals(draft.lines);
    expect(t.d).toBeCloseTo(t.c);
    expect(draft.lines.find((l) => l.accountCode === '6110')?.debitAmount).toBe(100000);
    expect(draft.lines.find((l) => l.accountCode === '4230')).toBeUndefined();
  });

  it('JE-14 Case C: scrapped (zero proceeds) writes off remaining NBV as loss', () => {
    const draft = buildJE14AssetDisposal({
      assetId: 'a1',
      assetNumber: 'FA-2026-0001',
      assetName: 'Broken Forklift',
      assetAccountCode: '1330',
      accumDeprAccountCode: '1331',
      proceedsAccountCode: '1020',
      disposalDate: new Date('2026-12-15'),
      costPkr: 1000000,
      accumDeprPkr: 400000,
      proceedsPkr: 0, // total NBV becomes loss
      bookType: 'PACCI',
    });
    const t = totals(draft.lines);
    expect(t.d).toBeCloseTo(t.c);
    expect(draft.lines.find((l) => l.accountCode === '1020')).toBeUndefined();
    expect(draft.lines.find((l) => l.accountCode === '6110')?.debitAmount).toBe(600000);
    expect(draft.lines.find((l) => l.accountCode === '1330')?.creditAmount).toBe(1000000);
  });
});
