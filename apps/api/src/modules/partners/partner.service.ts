import type { PrismaClient, Prisma } from '@coldchain/db';
import {
  suggestNextCode,
  type CodedAccount,
  type CreatePartnerRequestType,
  type UpdatePartnerRequestType,
  type SetProfitSharesRequestType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { CoaService } from '../accounting/coa.service';
import { PARTNER_CAPITAL_HEADER, PARTNER_DRAWINGS_HEADER } from '../accounting/equity-accounts';

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

  constructor(private prisma: PrismaClient) {
    this.coa = new CoaService(prisma);
  }

  async list(facilityId: string) {
    const [partners, accounts] = await Promise.all([
      this.prisma.partner.findMany({ where: { facilityId }, orderBy: { admittedOn: 'asc' } }),
      this.prisma.chartOfAccounts.findMany({
        where: { facilityId, accountClass: 'EQUITY' },
        select: { accountCode: true, accountName: true },
      }),
    ]);
    const nameOf = new Map(accounts.map((a) => [a.accountCode, a.accountName]));
    return partners.map((p) => ({
      id: p.id,
      name: p.name,
      capital_account_code: p.capitalAccountCode,
      capital_account_name: nameOf.get(p.capitalAccountCode) ?? p.capitalAccountCode,
      drawings_account_code: p.drawingsAccountCode,
      drawings_account_name: nameOf.get(p.drawingsAccountCode) ?? p.drawingsAccountCode,
      admitted_on: p.admittedOn.toISOString().slice(0, 10),
      retired_on: p.retiredOn?.toISOString().slice(0, 10) ?? null,
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
          admittedOn: new Date(body.admitted_on),
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

  async update(facilityId: string, id: string, body: UpdatePartnerRequestType) {
    const existing = await this.prisma.partner.findFirst({ where: { id, facilityId } });
    if (!existing) throw Errors.PARTNER_NOT_FOUND();

    if (body.retired_on) {
      const retired = new Date(body.retired_on);
      if (retired < existing.admittedOn) {
        throw Errors.VALIDATION_ERROR(
          'An owner cannot retire before the date they were admitted',
          'retired_on',
        );
      }
    }

    await this.prisma.partner.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.retired_on !== undefined
          ? { retiredOn: body.retired_on ? new Date(body.retired_on) : null }
          : {}),
      },
    });
    return { id };
  }

  /**
   * Replace the profit-sharing ratio effective from a date.
   *
   * The whole window is replaced rather than patched: a ratio is a set that has
   * to be read together, and leaving one partner's old row behind beside two new
   * ones would produce a split nobody chose.
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

    const effectiveFrom = new Date(body.effective_from);
    await this.prisma.$transaction(async (tx) => {
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
