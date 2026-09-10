import { describe, it, expect } from 'vitest';
import {
  isCapitalAccount,
  isDrawingsAccount,
  unattributedPlug,
  EQUITY_PLUG_ACCOUNT,
  type EquityAccountShape,
} from '../equity-accounts';

/**
 * These rules decide what every equity figure on every statement means, and they
 * are pure — so they are tested here rather than through a facility. The
 * single-owner branch in particular cannot be tested against the shared test
 * facility at all: whether partner accounts exist there depends on what other
 * suites (and the developer) have created.
 */

const acct = (
  accountCode: string,
  normalBalance: 'DEBIT' | 'CREDIT',
  accountClass = 'EQUITY',
  accountType = 'DETAIL',
): EquityAccountShape => ({ accountCode, accountClass, accountType, normalBalance });

const PLUG = acct(EQUITY_PLUG_ACCOUNT, 'CREDIT');
const RETAINED = acct('3020', 'CREDIT');
const CURRENT_YEAR = acct('3030', 'CREDIT');

describe('what makes an equity account a partner’s', () => {
  it('reads the role off the normal balance, not the code', () => {
    // Nothing records that an account belongs to a partner; per-partner accounts
    // are created by the owner and never seeded, so no list of codes can know
    // them. DEBIT-normal equity is drawings; CREDIT-normal is capital.
    expect(isDrawingsAccount(acct('3210', 'DEBIT'))).toBe(true);
    expect(isCapitalAccount(acct('3110', 'CREDIT'))).toBe(true);
    expect(isCapitalAccount(acct('3210', 'DEBIT'))).toBe(false);
    expect(isDrawingsAccount(acct('3110', 'CREDIT'))).toBe(false);
  });

  it('excludes the accounts the statements compute for themselves', () => {
    // 3020 and 3030 are derived by virtual closing and never posted. Treating
    // either as a capital account would double-count the year's result.
    expect(isCapitalAccount(RETAINED)).toBe(false);
    expect(isCapitalAccount(CURRENT_YEAR)).toBe(false);
  });

  it('ignores headers and other classes', () => {
    expect(isCapitalAccount(acct('3100', 'CREDIT', 'EQUITY', 'HEADER'))).toBe(false);
    expect(isCapitalAccount(acct('1020', 'CREDIT', 'ASSET'))).toBe(false);
    expect(isDrawingsAccount(acct('6010', 'DEBIT', 'EXPENSE'))).toBe(false);
  });
});

describe('unattributed opening equity', () => {
  // 3010 used to be a sole proprietor’s real capital account AND the plug, so
  // whether a balance there mattered depended on the rest of the chart. It is
  // now only the plug: every owner has a named account under 3100, so anything
  // left here is unattributed by definition and no chart lookup is involved.
  it('is whatever is sitting in the plug, rounded to paisa', () => {
    expect(unattributedPlug(370000)).toBe(370000);
    expect(unattributedPlug(1000.005)).toBe(1000.01);
  });

  it('is zero — not a warning — once equity is attributed in full', () => {
    expect(unattributedPlug(0)).toBe(0);
  });

  it('keeps a debit residual signed, so an over-attributed entry is visible too', () => {
    expect(unattributedPlug(-5000)).toBe(-5000);
  });

  // The plug is not one of the owners, so it must never be counted as a partner
  // capital account by anything walking the chart.
  it('is still an equity account the statements render when non-zero', () => {
    expect(isCapitalAccount(PLUG)).toBe(true);
  });
});
