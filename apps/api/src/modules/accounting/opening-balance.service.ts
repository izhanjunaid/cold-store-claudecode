import type { Prisma, PrismaClient } from '@coldchain/db';
import { SYSTEM_ACCOUNTS, round2, toIsoDate, type EnterOpeningBalancesRequestType } from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { advisoryXactLock } from '../../common/advisory-lock';
import { type JournalEntryLineDraft } from './templates/types';
import type { JournalEntryService } from './journal-entry.service';
import { accountBalances, classify, signedBalance, standingEntriesWhere } from './ledger';

/**
 * Guided opening balances (audit Gap 1): one balanced PACCI entry holding the
 * position the facility started from — per-party receivables and payables, cash,
 * bank and wallet, and any other balance-sheet line — with the difference plugged
 * to 3010 Opening Balance Equity, which belongs to no owner until it is
 * attributed. One-shot: a facility carries exactly one standing opening entry;
 * redoing it means reversing the first.
 */

type Tx = Prisma.TransactionClient;
type ChartRow = Prisma.ChartOfAccountsGetPayload<{}>;

const PLUG = SYSTEM_ACCOUNTS.OPENING_BALANCE_EQUITY;

/** The three seeded cash accounts each have a field of their own on the request. */
const DEDICATED_FIELDS = {
  cash_pkr: { code: SYSTEM_ACCOUNTS.CASH_ON_HAND, description: 'Opening cash on hand' },
  bank_pkr: { code: SYSTEM_ACCOUNTS.BANK_MAIN, description: 'Opening bank balance' },
  wallet_pkr: { code: SYSTEM_ACCOUNTS.MOBILE_WALLET, description: 'Opening mobile wallet balance' },
} as const;
const DEDICATED_CODES = new Set<string>(Object.values(DEDICATED_FIELDS).map((f) => f.code));

const BALANCE_SHEET_CLASSES = new Set(['ASSET', 'LIABILITY', 'EQUITY']);

/**
 * Why an account may not carry an "other" opening line, or null if it may. Read
 * from the chart row's own flags — never a list of codes — so an account the
 * owner creates behaves exactly like a seeded one (docs/25 L-26).
 */
function otherLineRefusal(a: ChartRow): string | null {
  if (a.accountType !== 'DETAIL') return 'is a header account and cannot hold a balance';
  if (!a.isActive) return 'is inactive';
  if (!BALANCE_SHEET_CLASSES.has(a.accountClass)) {
    return `is a ${a.accountClass} account — opening balances are balance-sheet positions; their net effect is the equity the plug books`;
  }
  if (DEDICATED_CODES.has(a.accountCode)) return 'has its own field (cash, bank, wallet)';
  if (a.requiresParty) return 'needs a party on every line — enter it under receivables or payables, or through its own module';
  if (a.accountCode === PLUG) return 'is the opening-balance plug, booked automatically';
  // Retained earnings is the one account the statements compute that a person
  // may post to — here, and only here (docs/25 §2 matrix).
  if (!a.allowManualPosting && a.accountCode !== SYSTEM_ACCOUNTS.RETAINED_EARNINGS) {
    return 'is moved only by its own documents (cheques, accruals, advances, payroll)';
  }
  return null;
}

export class OpeningBalanceService {
  constructor(
    private prisma: PrismaClient,
    private journalEntry: JournalEntryService,
  ) {}

  async getStatus(facilityId: string) {
    const [existing, firstPosting, plugSums, chart] = await Promise.all([
      this.prisma.journalEntry.findFirst({
        where: { ...standingEntriesWhere(facilityId), sourceTable: 'opening_balances' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, entryNumber: true, entryDate: true },
      }),
      // Drives the same warn-before-the-form-is-filled treatment the period lock
      // already gets: the entry is immutable once posted, so telling someone
      // their date is impossible AFTER they have keyed every balance is too late.
      this.firstTradingEntry(this.prisma, facilityId),
      accountBalances(this.prisma, { facilityId, book: 'PACCI', accounts: [PLUG] }),
      this.prisma.chartOfAccounts.findMany({ where: { facilityId }, orderBy: { accountCode: 'asc' } }),
    ]);

    return {
      entered: existing !== null,
      journal_entry_id: existing?.id ?? null,
      entry_number: existing?.entryNumber ?? null,
      as_of_date: existing ? toIsoDate(existing.entryDate) : null,
      earliest_posting_date: firstPosting ? toIsoDate(firstPosting.entryDate) : null,
      earliest_posting_entry_number: firstPosting?.entryNumber ?? null,
      // Anything sitting in the plug is unattributed by definition. Zero is the
      // healthy answer.
      unattributed_plug_pkr: signedBalance(plugSums.get(PLUG), 'CREDIT'),
      other_line_accounts: (() => {
        const byCode = new Map(chart.map((a) => [a.accountCode, a]));
        return chart
          .filter((a) => otherLineRefusal(a) === null)
          .map((a) => ({
            account_code: a.accountCode,
            account_name: a.accountName,
            account_class: a.accountClass,
            normal_balance: a.normalBalance,
            statement_section: classify(a, byCode).section,
          }));
      })(),
    };
  }

  /** Trading activity, not an earlier opening balance or its reversal — those are what re-entry replaces. */
  private firstTradingEntry(db: PrismaClient | Tx, facilityId: string) {
    return db.journalEntry.findFirst({
      where: { facilityId, postingStatus: 'POSTED', bookType: 'PACCI', sourceTable: { not: 'opening_balances' } },
      orderBy: { entryDate: 'asc' },
      select: { entryNumber: true, entryDate: true },
    });
  }

  async enter(facilityId: string, userId: string, body: EnterOpeningBalancesRequestType): Promise<string> {
    for (const line of body.other_lines) {
      if (line.debit_pkr > 0 && line.credit_pkr > 0) {
        throw Errors.VALIDATION_ERROR('A line cannot have both debit and credit amounts', 'other_lines');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // Serialize concurrent entries for this facility before checking. Two
      // concurrent enter() calls would both see no standing entry and both post
      // — immutable by trigger, so every opening balance would be doubled.
      await advisoryXactLock(tx, `${facilityId}:opening-balances`);

      const existing = await tx.journalEntry.findFirst({
        where: { ...standingEntriesWhere(facilityId), sourceTable: 'opening_balances' },
      });
      if (existing) throw Errors.OPENING_BALANCES_ALREADY_ENTERED();

      // Opening balances are the position the facility started from, so no
      // trading may already be posted before them. Strictly before: setting up
      // and trading on the cutover day itself is ordinary. PACCI only — the book
      // this posts to; a rough KATCHI note must not block a real cutover.
      const firstPosting = await this.firstTradingEntry(tx, facilityId);
      if (firstPosting) {
        const firstDate = toIsoDate(firstPosting.entryDate);
        if (firstDate < body.as_of_date) {
          throw Errors.OPENING_BALANCES_AFTER_ACTIVITY(
            `${firstPosting.entryNumber} is already posted on ${firstDate}, before the ${body.as_of_date} you chose`,
          );
        }
      }

      const chart = new Map(
        (await tx.chartOfAccounts.findMany({ where: { facilityId } })).map((a) => [a.accountCode, a]),
      );
      for (const code of new Set(body.other_lines.map((l) => l.account_code))) {
        const account = chart.get(code);
        if (!account) throw Errors.VALIDATION_ERROR(`Account ${code} does not exist`, 'other_lines');
        const refusal = otherLineRefusal(account);
        if (refusal) throw Errors.VALIDATION_ERROR(`Account ${code} ${refusal}`, 'other_lines');
      }

      const lines: JournalEntryLineDraft[] = [];

      // Each party's balance goes to the control account stamped on the party
      // row — never one derived from its type, which can change (docs/25 R-01).
      const partyLines = async (
        entries: { party_id: string; amount_pkr: number }[],
        side: 'receivable' | 'payable',
      ) => {
        const field = side === 'receivable' ? 'party_receivables' : 'party_payables';
        for (const pr of entries) {
          const party = await tx.party.findFirst({ where: { id: pr.party_id, facilityId } });
          if (!party) throw Errors.VALIDATION_ERROR(`Party ${pr.party_id} not found`, field);
          const control = party.controlAccountCode ? chart.get(party.controlAccountCode) : undefined;
          if (!control) {
            throw Errors.VALIDATION_ERROR(`${party.name} has no control account to carry an opening balance`, field);
          }
          const expected = side === 'receivable' ? 'ASSET' : 'LIABILITY';
          if (control.accountClass !== expected || !control.requiresParty) {
            throw Errors.VALIDATION_ERROR(
              `${party.name}'s account ${control.accountCode} is not a ${side} account; enter them under ${side === 'receivable' ? 'payables' : 'receivables'}`,
              field,
            );
          }
          lines.push({
            accountCode: control.accountCode,
            debitAmount: side === 'receivable' ? pr.amount_pkr : 0,
            creditAmount: side === 'payable' ? pr.amount_pkr : 0,
            partyId: party.id,
            description: `Opening ${side} — ${party.name}`,
          });
        }
      };
      await partyLines(body.party_receivables, 'receivable');
      await partyLines(body.party_payables, 'payable');

      for (const [field, { code, description }] of Object.entries(DEDICATED_FIELDS)) {
        const amount = body[field as keyof typeof DEDICATED_FIELDS];
        if (amount > 0) lines.push({ accountCode: code, debitAmount: amount, creditAmount: 0, description });
      }
      for (const ol of body.other_lines) {
        if (ol.debit_pkr === 0 && ol.credit_pkr === 0) continue;
        lines.push({
          accountCode: ol.account_code,
          debitAmount: ol.debit_pkr,
          creditAmount: ol.credit_pkr,
          description: ol.description ?? 'Opening balance',
        });
      }

      if (lines.length === 0) {
        throw Errors.VALIDATION_ERROR('Nothing to post — every opening amount is zero');
      }

      const net = round2(
        lines.reduce((s, l) => s + Number(l.debitAmount ?? 0) - Number(l.creditAmount ?? 0), 0),
      );
      if (net !== 0) {
        lines.push({
          accountCode: PLUG,
          debitAmount: net < 0 ? -net : 0,
          creditAmount: net > 0 ? net : 0,
          description: 'Opening equity not yet attributed to an owner',
        });
      }

      const posted = await this.journalEntry.postInTransaction(tx, facilityId, userId, {
        entryType: 'OPENING_BALANCE',
        bookType: 'PACCI',
        sourceTable: 'opening_balances',
        sourceId: facilityId,
        entryDate: new Date(`${body.as_of_date}T00:00:00.000Z`),
        description: `Opening balances as of ${body.as_of_date}`,
        lines,
      });
      return posted.id;
    });
  }
}
