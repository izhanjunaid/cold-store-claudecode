import { describe, it, expect } from 'vitest';
import {
  isCapitalAccount,
  isDrawingsAccount,
  hasPartnerCapitalAccounts,
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
  it('is not a question for a sole proprietor — the plug IS their capital', () => {
    // docs/17 Finding 17: plugging into the owner's capital is deliberate, and
    // for one owner it leaves nothing to clear. Warning here would be noise
    // about the only equity account they have.
    expect(unattributedPlug([PLUG, RETAINED, CURRENT_YEAR], 500000)).toBeNull();
    expect(hasPartnerCapitalAccounts([PLUG, RETAINED, CURRENT_YEAR])).toBe(false);
  });

  it('becomes one as soon as an owner has an account of their own', () => {
    const chart = [PLUG, RETAINED, CURRENT_YEAR, acct('3110', 'CREDIT'), acct('3210', 'DEBIT')];
    expect(hasPartnerCapitalAccounts(chart)).toBe(true);
    expect(unattributedPlug(chart, 370000)).toBe(370000);
  });

  it('reports zero rather than null once equity is attributed in full', () => {
    // "attributed in full" is a real answer and worth being able to say; null
    // means the question does not apply, which is a different thing.
    const chart = [PLUG, acct('3110', 'CREDIT')];
    expect(unattributedPlug(chart, 0)).toBe(0);
  });

  it('is not fooled by a drawings account alone', () => {
    // A facility part-way through setting partners up may have created drawings
    // before capital. Drawings are not capital, so the question does not arise.
    expect(hasPartnerCapitalAccounts([PLUG, acct('3210', 'DEBIT')])).toBe(false);
  });

  it('rounds to paisa, so the screen and the balance sheet cannot drift apart', () => {
    expect(unattributedPlug([PLUG, acct('3110', 'CREDIT')], 1000.005)).toBe(1000.01);
  });
});
