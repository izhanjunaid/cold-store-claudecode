import { describe, it, expect } from 'vitest';
import { BLIND_KEYS, isBlindRole, redactBagCounts } from './blind-count';

describe('redactBagCounts', () => {
  it('nulls every stock quantity, nested in objects and arrays, and keeps the key', () => {
    const out = redactBagCounts({
      success: true,
      data: [
        {
          id: 'lot-1',
          lot_number: 'LOT-1',
          quantity_bags: 500,
          current_balance_bags: 320,
          placements: [{ rack_id: 'r1', rack_name: 'R-1', bags: 200 }],
          unplaced_bags: 120,
        },
      ],
      meta: { total: 1 },
    });
    expect(out.data[0]).toEqual({
      id: 'lot-1',
      lot_number: 'LOT-1',
      quantity_bags: null,
      current_balance_bags: null,
      placements: [{ rack_id: 'r1', rack_name: 'R-1', bags: null }],
      unplaced_bags: null,
    });
    expect(out.meta).toEqual({ total: 1 });
  });

  it("keeps the guard's own count, and everything that is not a stock quantity", () => {
    const row = { declared_quantity: 98, quantity_mismatch_flag: true, vehicle_number: 'LHR-1', max_capacity_bags: 900 };
    expect(redactBagCounts(row)).toEqual(row);
  });

  it('takes the counts out of a location string but leaves the rack names', () => {
    expect(redactBagCounts({ related_location: 'Room A → R-1 ×20, R-2 ×1030' })).toEqual({
      related_location: 'Room A → R-1, R-2',
    });
    expect(redactBagCounts({ related_location: 'Room A' })).toEqual({ related_location: 'Room A' });
  });

  it('does not change what it was given, and passes dates and decimals through', () => {
    const date = new Date('2026-10-01T00:00:00Z');
    class Decimalish {} // stands in for Prisma.Decimal: a class instance, not a plain object
    const dec = new Decimalish();
    const input = { quantity_bags: 5, when: date, amount: dec, nested: { bags: 3 } };
    const out = redactBagCounts(input);
    expect(input).toEqual({ quantity_bags: 5, when: date, amount: dec, nested: { bags: 3 } });
    expect(out.when).toBe(date);
    expect(out.amount).toBe(dec);
    expect(out.nested).toEqual({ bags: null });
  });

  it('leaves primitives, null and empty values alone', () => {
    expect(redactBagCounts(null)).toBeNull();
    expect(redactBagCounts('text')).toBe('text');
    expect(redactBagCounts(7)).toBe(7);
    expect(redactBagCounts([])).toEqual([]);
  });

  it('is the SECURITY role only', () => {
    expect(isBlindRole('SECURITY')).toBe(true);
    for (const r of ['OWNER', 'MANAGER', 'ACCOUNTANT', 'OPERATOR', 'VIEWER', undefined, null]) {
      expect(isBlindRole(r)).toBe(false);
    }
  });

  it('covers the count fields the responses actually carry', () => {
    for (const key of ['quantity_bags', 'current_balance_bags', 'quantity_withdrawn_bags', 'authorized_quantity']) {
      expect(BLIND_KEYS.has(key)).toBe(true);
    }
  });

  it('also covers the weights and the money owed that stand in for a count', () => {
    const out = redactBagCounts({
      accepted_weight_kg: 2000,
      declared_weight_kg: 2010,
      outbound_weight_kg: 1950,
      prorated_inbound_weight_kg: 1980,
      weight_variance_pct: 1.5,
      weight_dispute_note: 'Declared 2,010 kg, kanta 2,000 kg',
      release: { state: 'PAYMENT_PENDING', outstanding_pkr: 12_000, cheque_pending: false },
      credit_authorized_amount_pkr: 9_000,
      total_pkr: 500, // not a guard-facing field; left alone
    });
    expect(out).toEqual({
      accepted_weight_kg: null,
      declared_weight_kg: null,
      outbound_weight_kg: null,
      prorated_inbound_weight_kg: null,
      weight_variance_pct: null,
      weight_dispute_note: null,
      release: { state: 'PAYMENT_PENDING', outstanding_pkr: null, cheque_pending: false },
      credit_authorized_amount_pkr: null,
      total_pkr: 500,
    });
  });
});
