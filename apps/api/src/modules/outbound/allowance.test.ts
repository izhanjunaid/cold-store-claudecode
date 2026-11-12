import { describe, it, expect } from 'vitest';
import { allowedOnEvery, liveAllows, soloAskRefusal } from './allowance';

// 2026-11-12 14:00 in Lahore is 09:00 UTC; 2026-11-13 01:30 in Lahore is 20:30 UTC on the 12th.
const noon = new Date('2026-11-12T09:00:00Z');

describe('liveAllows (docs/28 O10: an allowance lasts the business day it was given)', () => {
  it('is what a manager allowed today', () => {
    const live = liveAllows({ managerAllows: ['CREDIT', 'LEAVE_CHARGE_OFF'], managerAllowedAt: noon }, '2026-11-12');
    expect([...live].sort()).toEqual(['CREDIT', 'LEAVE_CHARGE_OFF']);
  });

  it('is nothing from an earlier day', () => {
    expect(liveAllows({ managerAllows: ['CREDIT'], managerAllowedAt: noon }, '2026-11-13').size).toBe(0);
  });

  it('counts the day in Lahore, not UTC: 01:30 on the 13th there is still the 13th, not the 12th', () => {
    const lateEvening = new Date('2026-11-12T20:30:00Z'); // 01:30 on 13 Nov in Lahore
    expect(liveAllows({ managerAllows: ['CREDIT'], managerAllowedAt: lateEvening }, '2026-11-13').has('CREDIT')).toBe(true);
    expect(liveAllows({ managerAllows: ['CREDIT'], managerAllowedAt: lateEvening }, '2026-11-12').size).toBe(0);
  });

  it('is nothing when nothing was allowed, or when it was taken back', () => {
    expect(liveAllows({ managerAllows: [], managerAllowedAt: null }, '2026-11-12').size).toBe(0);
    expect(liveAllows({ managerAllows: ['CREDIT'], managerAllowedAt: null }, '2026-11-12').size).toBe(0);
  });

  it('ignores a code this version does not know', () => {
    expect([...liveAllows({ managerAllows: ['CREDIT', 'SOMETHING_NEW'], managerAllowedAt: noon }, '2026-11-12')]).toEqual(['CREDIT']);
  });
});

describe('allowedOnEvery: a group has what each of its lines has', () => {
  it('is the intersection, and nothing for an empty group', () => {
    const a = new Set(['CREDIT', 'CHEQUE_OR_TRANSFER'] as const);
    const b = new Set(['CREDIT'] as const);
    expect([...allowedOnEvery([a, b])]).toEqual(['CREDIT']);
    expect([...allowedOnEvery([a])].sort()).toEqual(['CHEQUE_OR_TRANSFER', 'CREDIT']);
    expect(allowedOnEvery([a, new Set()]).size).toBe(0);
    expect(allowedOnEvery([]).size).toBe(0);
  });
});

describe('soloAskRefusal: what a request asks beyond cash in full, and what lifts it', () => {
  const none = new Set<never>();
  const live = (...codes: ('CHEQUE_OR_TRANSFER' | 'CREDIT' | 'LEAVE_CHARGE_OFF')[]) => new Set(codes);

  it('cash in full with every charge kept is never refused', () => {
    expect(soloAskRefusal({ skips: false, mode: 'CASH' }, false, none)).toBeNull();
  });

  it('a skipped charge needs LEAVE_CHARGE_OFF', () => {
    expect(soloAskRefusal({ skips: true, mode: 'CASH' }, false, none)).toBe('SKIP_CHARGE');
    expect(soloAskRefusal({ skips: true, mode: 'CASH' }, false, live('CREDIT', 'CHEQUE_OR_TRANSFER'))).toBe('SKIP_CHARGE');
    expect(soloAskRefusal({ skips: true, mode: 'CASH' }, false, live('LEAVE_CHARGE_OFF'))).toBeNull();
  });

  it('credit needs a standing approval or CREDIT', () => {
    expect(soloAskRefusal({ skips: false, mode: 'CREDIT' }, false, none)).toBe('NO_STANDING_CREDIT');
    expect(soloAskRefusal({ skips: false, mode: 'CREDIT' }, true, none)).toBeNull();
    expect(soloAskRefusal({ skips: false, mode: 'CREDIT' }, false, live('CREDIT'))).toBeNull();
    expect(soloAskRefusal({ skips: false, mode: 'CREDIT' }, false, live('CHEQUE_OR_TRANSFER'))).toBe('NO_STANDING_CREDIT');
  });

  it('cheque, bank transfer and mobile wallet need CHEQUE_OR_TRANSFER', () => {
    for (const mode of ['CHEQUE', 'BANK_TRANSFER', 'MOBILE_WALLET'] as const) {
      expect(soloAskRefusal({ skips: false, mode }, true, none)).toBe('PAYMENT_MODE');
      expect(soloAskRefusal({ skips: false, mode }, false, live('CREDIT'))).toBe('PAYMENT_MODE');
      expect(soloAskRefusal({ skips: false, mode }, false, live('CHEQUE_OR_TRANSFER'))).toBeNull();
    }
  });

  it('names the skipped charge first, as the checkout always did', () => {
    expect(soloAskRefusal({ skips: true, mode: 'CHEQUE' }, false, none)).toBe('SKIP_CHARGE');
  });
});
