import { randomUUID } from 'crypto';
import type { PrismaClient, Prisma } from '@coldchain/db';
import {
  MONEY_EPSILON,
  SYSTEM_ACCOUNTS,
  addDays,
  fromIsoDate,
  suggestNextCode,
  toIsoDate,
  type AttributeOpeningEquityRequestType,
  type CodedAccount,
  type CreatePartnerRequestType,
  type UpdatePartnerRequestType,
  type SetProfitSharesRequestType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { advisoryXactLock } from '../../common/advisory-lock';
import { CoaService } from '../accounting/coa.service';
import { JournalEntryService } from '../accounting/journal-entry.service';
import { PeriodLockService } from '../accounting/period-lock.service';
import { accountBalances, signedBalance } from '../accounting/ledger';

const PARTNER_CAPITAL_HEADER = SYSTEM_ACCOUNTS.PARTNERS_CAPITAL;
const PARTNER_DRAWINGS_HEADER = SYSTEM_ACCOUNTS.PARTNERS_DRAWINGS;
const PLUG = SYSTEM_ACCOUNTS.OPENING_BALANCE_EQUITY;
const REGISTRY_EQUITY = new Set<string>([PLUG, SYSTEM_ACCOUNTS.RETAINED_EARNINGS, SYSTEM_ACCOUNTS.CURRENT_YEAR_RESULT]);

type Tx = Prisma.TransactionClient;

type Side = {
  header: string;
  normal: 'DEBIT' | 'CREDIT';
  suffix: string;
  field: 'capital_account_code' | 'drawings_account_code';
};

const CAPITAL: Side = {
  header: PARTNER_CAPITAL_HEADER,
  normal: 'CREDIT',
  suffix: 'Capital',
  field: 'capital_account_code',
};
const DRAWINGS: Side = {
  header: PARTNER_DRAWINGS_HEADER,
  normal: 'DEBIT',
  suffix: 'Drawings',
  field: 'drawings_account_code',
};

export class PartnerService {
  private coa: CoaService;
  private periodLock: PeriodLockService;
  private journalEntry: JournalEntryService;

  constructor(private prisma: PrismaClient) {
    this.coa = new CoaService(prisma);
    this.periodLock = new PeriodLockService(prisma);
    this.journalEntry = new JournalEntryService(prisma, this.periodLock);
  }

  async list(facilityId: string) {
    const [partners, accounts] = await Promise.all([
      this.prisma.partner.findMany({ where: { facilityId }, orderBy: { admittedOn: 'asc' } }),
      this.prisma.chartOfAccounts.findMany({
        where: { facilityId, accountClass: 'EQUITY' },
        select: { accountCode: true, accountName: true },
      }),
    ]);
    // Both accounts are foreign keys on the partner row: they always exist.
    const nameOf = new Map(accounts.map((a) => [a.accountCode, a.accountName]));
    return partners.map((p) => ({
      id: p.id,
      name: p.name,
      cnic: p.cnic,
      capital_account_code: p.capitalAccountCode,
      capital_account_name: nameOf.get(p.capitalAccountCode)!,
      drawings_account_code: p.drawingsAccountCode,
      drawings_account_name: nameOf.get(p.drawingsAccountCode)!,
      admitted_on: toIsoDate(p.admittedOn),
      retired_on: p.retiredOn ? toIsoDate(p.retiredOn) : null,
    }));
  }

  /**
   * Add an owner, and with them the two accounts that are theirs.
   *
   * **One transaction, deliberately.** Half a partner — an owner with a drawings
   * account and no capital account — is the exact state that went unnoticed in a
   * live chart, because nothing knew a partner needed both. Two accounts and a
   * partner row created separately can leave that state behind; created together
   * they cannot.
   */
  async create(facilityId: string, body: CreatePartnerRequestType) {
    return this.prisma.$transaction(async (tx) => {
      const chart = await tx.chartOfAccounts.findMany({
        where: { facilityId },
        select: {
          accountCode: true,
          accountName: true,
          accountClass: true,
          accountType: true,
          parentAccountCode: true,
          normalBalance: true,
        },
      });

      const capital = await this.resolveSide(tx, facilityId, chart, body, CAPITAL);
      const drawings = await this.resolveSide(tx, facilityId, chart, body, DRAWINGS);

      if (capital === drawings) {
        throw Errors.VALIDATION_ERROR(
          'Capital and drawings must be two different accounts',
          'drawings_account_code',
        );
      }

      const created = await tx.partner.create({
        data: {
          facilityId,
          name: body.name.trim(),
          capitalAccountCode: capital,
          drawingsAccountCode: drawings,
          admittedOn: fromIsoDate(body.admitted_on),
          cnic: body.cnic ?? null,
        },
      });
      return { id: created.id };
    });
  }

  /**
   * The code for one side of a partner: an existing account they already use, or
   * a new one under the seeded header.
   *
   * Adoption is not a convenience. A facility that already has per-owner accounts
   * cannot delete and recreate them once anything has posted —
   * `guard_chart_of_accounts` locks the structure and the journal-entry-line FK
   * is `ON UPDATE RESTRICT` — so without this, modelling the partner would be
   * impossible on exactly the facilities that need it most.
   */
  private async resolveSide(
    tx: Tx,
    facilityId: string,
    chart: {
      accountCode: string;
      accountClass: string;
      accountType: string;
      parentAccountCode: string | null;
      normalBalance: string;
    }[],
    body: CreatePartnerRequestType,
    side: Side,
  ): Promise<string> {
    const given = body[side.field]?.trim();

    if (given) {
      const account = chart.find((a) => a.accountCode === given);
      if (!account) throw Errors.VALIDATION_ERROR(`Account ${given} does not exist`, side.field);
      // The plug, retained earnings and the current-year result have roles of
      // their own; adopting one as an owner's account is how the plug used to
      // end up doing two jobs (docs/25 L-32).
      if (REGISTRY_EQUITY.has(given)) {
        throw Errors.VALIDATION_ERROR(`Account ${given} is not an owner's account and cannot be adopted`, side.field);
      }
      if (account.accountClass !== 'EQUITY' || account.accountType !== 'DETAIL') {
        throw Errors.VALIDATION_ERROR(
          `Account ${given} must be an equity detail account`,
          side.field,
        );
      }
      // The normal balance IS the side. An account on the wrong one is not a
      // naming slip: every statement reads the role off it, and
      // guard_chart_of_accounts locks it permanently once anything posts.
      if (account.normalBalance !== side.normal) {
        throw Errors.VALIDATION_ERROR(
          `Account ${given} carries a ${account.normalBalance} balance; a ${side.suffix.toLowerCase()} account must be ${side.normal}-normal`,
          side.field,
        );
      }
      const claimed = await tx.partner.findFirst({
        where:
          side.field === 'capital_account_code'
            ? { facilityId, capitalAccountCode: given }
            : { facilityId, drawingsAccountCode: given },
        select: { name: true },
      });
      if (claimed) {
        throw Errors.VALIDATION_ERROR(
          `Account ${given} already belongs to ${claimed.name}`,
          side.field,
        );
      }
      return given;
    }

    const header = chart.find((a) => a.accountCode === side.header && a.accountType === 'HEADER');
    if (!header) {
      throw Errors.VALIDATION_ERROR(
        `This facility has no ${side.header} header account, so a code cannot be placed. Add it under Chart of Accounts, or name an existing account.`,
        side.field,
      );
    }

    const coded: CodedAccount[] = chart.map((a) => ({
      account_code: a.accountCode,
      account_class: a.accountClass,
      account_type: a.accountType as 'HEADER' | 'DETAIL',
      parent_account_code: a.parentAccountCode,
    }));
    const code = suggestNextCode(coded, side.header);
    if (!code) {
      throw Errors.VALIDATION_ERROR(
        `No free code left under ${side.header}. Name an existing account instead.`,
        side.field,
      );
    }

    // Through the chart-of-accounts service, in this transaction, so every rule
    // that guards a hand-created account guards this one too — and so a failure
    // on the second account rolls the first one back with it.
    await this.coa.createInTransaction(tx, facilityId, {
      account_code: code,
      account_name: `${body.name.trim()} — ${side.suffix}`,
      account_class: 'EQUITY',
      account_type: 'DETAIL',
      parent_account_code: side.header,
      normal_balance: side.normal,
      // Drawings deliberately invert the class's CREDIT: contra-equity, which is
      // what makes the balance sheet present them as a deduction.
      is_contra: side.normal === 'DEBIT',
    });
    return code;
  }

  /**
   * Rename, record a CNIC, retire or un-retire. A retirement changes who shares
   * the result from the day after it, so it may not reach into a closed period —
   * neither the new date nor the one it replaces (docs/25 L-25).
   */
  async update(facilityId: string, id: string, body: UpdatePartnerRequestType) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.partner.findFirst({ where: { id, facilityId } });
      if (!existing) throw Errors.PARTNER_NOT_FOUND();

      if (body.retired_on !== undefined) {
        if (body.retired_on && body.retired_on < toIsoDate(existing.admittedOn)) {
          throw Errors.VALIDATION_ERROR('An owner cannot retire before the date they were admitted', 'retired_on');
        }
        const previous = existing.retiredOn ? toIsoDate(existing.retiredOn) : null;
        if (body.retired_on !== previous) {
          for (const lastDay of [previous, body.retired_on]) {
            if (lastDay) await this.periodLock.assertOpen(tx, facilityId, fromIsoDate(addDays(lastDay, 1)));
          }
        }
      }

      await tx.partner.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.cnic !== undefined ? { cnic: body.cnic } : {}),
          ...(body.retired_on !== undefined ? { retiredOn: body.retired_on ? fromIsoDate(body.retired_on) : null } : {}),
        },
      });
      return { id };
    });
  }

  /**
   * Replace the profit-sharing ratio effective from a date.
   *
   * The whole window is replaced rather than patched: a ratio is a set that has
   * to be read together, and leaving one partner's old row behind beside two new
   * ones would produce a split nobody chose. A ratio governs every later day
   * until the next one, so it may not start inside a closed period — the period
   * lock's watermark covers every period at or before a locked one.
   */
  async setShares(facilityId: string, body: SetProfitSharesRequestType) {
    const ids = body.shares.map((s) => s.partner_id);
    if (new Set(ids).size !== ids.length) {
      throw Errors.VALIDATION_ERROR('A partner appears twice in the same ratio', 'shares');
    }

    const known = await this.prisma.partner.findMany({
      where: { facilityId, id: { in: ids } },
      select: { id: true },
    });
    if (known.length !== ids.length) throw Errors.PARTNER_NOT_FOUND();

    const effectiveFrom = fromIsoDate(body.effective_from);
    await this.prisma.$transaction(async (tx) => {
      await this.periodLock.assertOpen(tx, facilityId, effectiveFrom);
      await tx.partnerProfitShare.deleteMany({ where: { facilityId, effectiveFrom } });
      await tx.partnerProfitShare.createMany({
        data: body.shares.map((s) => ({
          facilityId,
          partnerId: s.partner_id,
          effectiveFrom,
          weight: s.weight,
        })),
      });
    });
    return { effective_from: body.effective_from, count: body.shares.length };
  }

  /**
   * Attribute opening equity to an owner: move it out of the plug (3010), which
   * belongs to nobody, into their capital account (docs/25 L-32). It replaces the
   * hand-written reclass the balance-sheet banner used to ask for.
   *
   * A journal entry the system builds at the owner's request, so it is sourced as
   * a manual entry — its own source document, reversible from the journal like
   * any other — and typed OWNER_EQUITY. The statements present it as a movement
   * between two columns of equity, not as capital anybody introduced. It may not
   * take more out of the plug than is there: concurrent attributions are
   * serialised so two cannot each see the same balance.
   */
  async attributeOpeningEquity(facilityId: string, userId: string, partnerId: string, body: AttributeOpeningEquityRequestType) {
    return this.prisma.$transaction(async (tx) => {
      await advisoryXactLock(tx, `${facilityId}:opening-equity-attribution`);
      const partner = await tx.partner.findFirst({ where: { id: partnerId, facilityId } });
      if (!partner) throw Errors.PARTNER_NOT_FOUND();

      const date = fromIsoDate(body.date);
      const unattributed = signedBalance(
        (await accountBalances(tx, { facilityId, book: 'PACCI', to: date, accounts: [PLUG] })).get(PLUG),
        'CREDIT',
      );
      if (body.amount_pkr - unattributed > MONEY_EPSILON) {
        throw Errors.VALIDATION_ERROR(
          `Only Rs ${unattributed.toLocaleString('en-PK')} of opening equity is unattributed on ${body.date}`,
          'amount_pkr',
        );
      }

      const id = randomUUID();
      const what = `Opening equity attributed to ${partner.name}`;
      const posted = await this.journalEntry.postInTransaction(tx, facilityId, userId, {
        id,
        entryType: 'OWNER_EQUITY',
        bookType: 'PACCI',
        sourceTable: 'manual',
        sourceId: id,
        entryDate: date,
        description: body.note?.trim() ? `${what} — ${body.note.trim()}` : what,
        lines: [
          { accountCode: PLUG, debitAmount: body.amount_pkr, creditAmount: 0, description: what },
          { accountCode: partner.capitalAccountCode, debitAmount: 0, creditAmount: body.amount_pkr, description: what },
        ],
      });
      return posted.id;
    });
  }

  /** Every ratio window on record, oldest first — the 4.13 disclosure reads this. */
  async listShares(facilityId: string) {
    const [rows, partners] = await Promise.all([
      this.prisma.partnerProfitShare.findMany({
        where: { facilityId },
        orderBy: [{ effectiveFrom: 'asc' }],
      }),
      this.prisma.partner.findMany({ where: { facilityId }, select: { id: true, name: true } }),
    ]);
    const nameOf = new Map(partners.map((p) => [p.id, p.name]));

    const byDate = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.effectiveFrom.toISOString().slice(0, 10);
      byDate.set(key, [...(byDate.get(key) ?? []), r]);
    }

    return [...byDate.entries()].map(([effective_from, window]) => {
      const total = window.reduce((t, r) => t + Number(r.weight), 0);
      return {
        effective_from,
        shares: window.map((r) => ({
          partner_id: r.partnerId,
          partner_name: nameOf.get(r.partnerId) ?? 'Unknown',
          weight: Number(r.weight),
          share_pct: total > 0 ? Math.round((Number(r.weight) / total) * 10000) / 100 : 0,
        })),
      };
    });
  }
}
