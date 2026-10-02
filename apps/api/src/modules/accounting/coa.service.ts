import type { Prisma, PrismaClient } from '@coldchain/db';
import { Errors } from '../../common/errors';
import {
  CLASS_CODE_PREFIX,
  CLASS_SECTIONS,
  moneyEquals,
  normalBalanceForClass,
  type AccountClassName,
  type ChartOfAccountsListQueryType,
  type CreateAccountRequestType,
  type UpdateAccountRequestType,
} from '@coldchain/shared';

type Tx = Prisma.TransactionClient;
type Row = Prisma.ChartOfAccountsGetPayload<{}>;

/**
 * The chart's own rules, enforced here for every caller — the Chart of Accounts
 * screen and the partner service, which creates accounts inside its own
 * transaction without passing through the request schema. Class digits and
 * sections come from `@coldchain/shared` chart.ts, which the web reads too.
 */
function validateNewAccount(body: CreateAccountRequestType): void {
  const cls = body.account_class as AccountClassName;
  // Every class's codes start with its digit. The unassigned 0/7/8/9 ranges were
  // a route into the statements' "unclassified" bucket (docs/25 L-31).
  if (!body.account_code.startsWith(CLASS_CODE_PREFIX[cls])) {
    throw Errors.VALIDATION_ERROR(
      `${body.account_class} account codes start with ${CLASS_CODE_PREFIX[cls]}; ${body.account_code} does not`,
      'account_code',
    );
  }
  // A detail rolls up through its parent header; without one it could never
  // reach the statements (F-6a). Equity is presented by owner and by role
  // rather than by header, so an equity detail may sit at the root.
  if (body.account_type === 'DETAIL' && body.account_class !== 'EQUITY' && !body.parent_account_code) {
    throw Errors.INVALID_PARENT_ACCOUNT('Detail accounts must sit under a header account (equity excepted)');
  }
  // Headers stay root-level: the statements classify a detail by its parent's
  // section one level deep, so a header under a header would orphan its children.
  if (body.account_type === 'HEADER' && body.parent_account_code) {
    throw Errors.INVALID_PARENT_ACCOUNT('Header accounts cannot have a parent — headers are always root-level');
  }
  // A non-equity header with no section would send every child to
  // "unclassified" (docs/25 L-38).
  if (body.account_type === 'HEADER' && body.account_class !== 'EQUITY' && !body.statement_section) {
    throw Errors.VALIDATION_ERROR(
      'A header account must declare the statement section its children roll up into',
      'statement_section',
    );
  }
  validateStatementSection(body.account_type, cls, body.statement_section);
  validateFlags({ accountType: body.account_type, accountClass: cls }, body);
}

function validateStatementSection(accountType: string, accountClass: AccountClassName, section: string | null | undefined): void {
  if (section === undefined || section === null) return;
  if (accountType !== 'HEADER') {
    throw Errors.VALIDATION_ERROR('statement_section can only be set on a HEADER account', 'statement_section');
  }
  if (!CLASS_SECTIONS[accountClass].includes(section)) {
    const equityNote = accountClass === 'EQUITY' ? ' — equity is presented by owner and role, not by header' : '';
    throw Errors.VALIDATION_ERROR(
      `${section} is not a valid statement section for ${accountClass}${equityNote}`,
      'statement_section',
    );
  }
}

type Flags = { is_cash_equivalent?: boolean; allow_manual_posting?: boolean; requires_party?: boolean };

/** Cash is an asset you can pay from; a party is required only on balance-sheet details. */
function validateFlags(a: { accountType: string; accountClass: string }, flags: Flags): void {
  const set = [flags.is_cash_equivalent, flags.allow_manual_posting === false, flags.requires_party].some(Boolean);
  if (set && a.accountType !== 'DETAIL') {
    throw Errors.VALIDATION_ERROR('Only a detail account carries posting flags', 'account_type');
  }
  if (flags.is_cash_equivalent && a.accountClass !== 'ASSET') {
    throw Errors.VALIDATION_ERROR('Only an asset account can be cash or a bank account', 'is_cash_equivalent');
  }
  if (flags.requires_party && a.accountClass !== 'ASSET' && a.accountClass !== 'LIABILITY') {
    throw Errors.VALIDATION_ERROR(
      'Only a receivable or payable (asset or liability) account can require a party on every line',
      'requires_party',
    );
  }
  if (flags.is_cash_equivalent && flags.requires_party) {
    throw Errors.VALIDATION_ERROR('A cash account is not a party control account', 'requires_party');
  }
}

type Reference = { label: string; count: (tx: Tx, facilityId: string, code: string) => Promise<number> };

/**
 * Configuration that stores an account code WITHOUT a foreign key, so nothing in
 * the database stops a delete. Everything else that stores a code (rate plans,
 * service charges, payments, fixed assets, vouchers, loans, advances, the new
 * documents) is a foreign key since 0030 and the database refuses the delete
 * itself — see remove(). Partners have SQL-only foreign keys that no Prisma
 * relation describes, so they are named here too, for a clear message.
 */
const DELETE_REFERENCES: Reference[] = [
  {
    label: 'peshgi repayment',
    count: (tx, f, c) => tx.partyLoanRepayment.count({ where: { loan: { facilityId: f }, assetAccountCode: c } }),
  },
  {
    label: 'credit-note line',
    count: (tx, f, c) => tx.creditNoteLineItem.count({ where: { creditNote: { facilityId: f }, revenueAccountCode: c } }),
  },
  {
    label: 'owner',
    count: (tx, f, c) =>
      tx.partner.count({ where: { facilityId: f, OR: [{ capitalAccountCode: c }, { drawingsAccountCode: c }] } }),
  },
];

/**
 * Configuration that will post to an account in future. Foreign keys ignore
 * is_active, so deactivating one of these would pass every constraint and fail
 * at the next invoice, depreciation run, payroll or owner movement (docs/25 L-34).
 */
const DEACTIVATION_REFERENCES: Reference[] = [
  {
    label: 'active rate plan',
    count: (tx, f, c) => tx.ratePlan.count({ where: { facilityId: f, isActive: true, revenueAccountCode: c } }),
  },
  {
    label: 'active service charge',
    count: (tx, f, c) => tx.serviceCharge.count({ where: { facilityId: f, isActive: true, revenueAccountCode: c } }),
  },
  {
    label: 'fixed asset in use',
    count: (tx, f, c) =>
      tx.fixedAsset.count({
        where: {
          facilityId: f,
          voidedAt: null,
          status: { in: ['PLANNED', 'PURCHASED', 'IN_SERVICE'] },
          OR: [{ assetAccountCode: c }, { accumDeprAccountCode: c }, { deprExpenseAccountCode: c }],
        },
      }),
  },
  {
    label: 'active employee',
    count: (tx, f, c) => tx.employee.count({ where: { facilityId: f, isActive: true, costAccountCode: c } }),
  },
  {
    label: 'active party',
    count: (tx, f, c) => tx.party.count({ where: { facilityId: f, isActive: true, controlAccountCode: c } }),
  },
  {
    label: 'current owner',
    count: (tx, f, c) =>
      tx.partner.count({
        where: { facilityId: f, retiredOn: null, OR: [{ capitalAccountCode: c }, { drawingsAccountCode: c }] },
      }),
  },
];

async function firstReference(tx: Tx, refs: Reference[], facilityId: string, code: string) {
  for (const ref of refs) {
    const used = await ref.count(tx, facilityId, code);
    if (used > 0) return `${used} ${ref.label}(s)`;
  }
  return null;
}

function format(a: Row) {
  return {
    id: a.id,
    facility_id: a.facilityId,
    account_code: a.accountCode,
    account_name: a.accountName,
    account_class: a.accountClass,
    account_type: a.accountType,
    parent_account_code: a.parentAccountCode,
    normal_balance: a.normalBalance,
    statement_section: a.statementSection,
    is_system_account: a.isSystemAccount,
    is_active: a.isActive,
    is_cash_equivalent: a.isCashEquivalent,
    allow_manual_posting: a.allowManualPosting,
    requires_party: a.requiresParty,
    created_at: a.createdAt.toISOString(),
  };
}

export class CoaService {
  constructor(private prisma: PrismaClient) {}

  async list(facilityId: string, query: ChartOfAccountsListQueryType) {
    const where: Prisma.ChartOfAccountsWhereInput = { facilityId };
    if (query.account_class) where.accountClass = query.account_class;
    if (query.is_active !== undefined) where.isActive = query.is_active;

    const data = await this.prisma.chartOfAccounts.findMany({ where, orderBy: { accountCode: 'asc' } });
    return data.map(format);
  }

  async getByCode(facilityId: string, code: string) {
    const a = await this.prisma.chartOfAccounts.findUnique({
      where: { facilityId_accountCode: { facilityId, accountCode: code } },
    });
    if (!a) throw Errors.ACCOUNT_NOT_FOUND();
    return format(a);
  }

  async create(facilityId: string, body: CreateAccountRequestType) {
    // Transaction so the audit trigger sees the acting user (F-2b).
    return this.prisma.$transaction((tx) => this.createInTransaction(tx as Tx, facilityId, body));
  }

  /**
   * The same creation, inside a transaction the caller already owns — adding a
   * partner creates two accounts and a partner row, and half a partner is exactly
   * the state that went unnoticed in a live chart. Every rule above applies here
   * too: this is the path that skips the request schema.
   */
  async createInTransaction(tx: Tx, facilityId: string, body: CreateAccountRequestType) {
    validateNewAccount(body);
    const exists = await tx.chartOfAccounts.findUnique({
      where: { facilityId_accountCode: { facilityId, accountCode: body.account_code } },
    });
    if (exists) throw Errors.VALIDATION_ERROR('Account code already exists', 'account_code');

    // An equity detail sits under an equity header once the facility has one —
    // an owner's account adrift of the 3100/3200 blocks is what the Owners page
    // exists to prevent. With no equity header at all, a root account stays
    // legal rather than leaving no way to create one (docs/25 L-34: this was a
    // rule only the browser enforced).
    if (body.account_type === 'DETAIL' && body.account_class === 'EQUITY' && !body.parent_account_code) {
      const equityHeaders = await tx.chartOfAccounts.count({
        where: { facilityId, accountClass: 'EQUITY', accountType: 'HEADER', isActive: true },
      });
      if (equityHeaders > 0) {
        throw Errors.INVALID_PARENT_ACCOUNT('An equity account must sit under one of the equity headers');
      }
    }

    if (body.parent_account_code) {
      const parent = await tx.chartOfAccounts.findUnique({
        where: { facilityId_accountCode: { facilityId, accountCode: body.parent_account_code } },
      });
      if (!parent) throw Errors.INVALID_PARENT_ACCOUNT('Parent account does not exist');
      if (parent.accountType !== 'HEADER') throw Errors.INVALID_PARENT_ACCOUNT('Parent must be a HEADER account');
      if (parent.accountClass !== body.account_class) {
        throw Errors.INVALID_PARENT_ACCOUNT('Parent must belong to the same account class');
      }
    }

    const created = await tx.chartOfAccounts.create({
      data: {
        facilityId,
        accountCode: body.account_code,
        accountName: body.account_name,
        accountClass: body.account_class,
        accountType: body.account_type,
        parentAccountCode: body.parent_account_code ?? null,
        // Derived from the class unless the caller explicitly declared a contra
        // account (CreateAccountRequest.superRefine enforces that).
        normalBalance: body.normal_balance ?? normalBalanceForClass(body.account_class),
        statementSection: body.statement_section ?? null,
        isSystemAccount: false,
        isCashEquivalent: body.is_cash_equivalent ?? false,
        allowManualPosting: body.allow_manual_posting ?? true,
        requiresParty: body.requires_party ?? false,
      },
    });
    return format(created);
  }

  /**
   * Delete an account outright — legal only for one opened by mistake that
   * nothing has touched. Deactivation is the route for an account with history.
   *
   * The journal-line FK and, since 0030, every configuration column that has one
   * are ON DELETE RESTRICT, so the database refuses a delete that would strand
   * them; that refusal is reported as ACCOUNT_IN_USE rather than a raw failure.
   * The columns with no foreign key are checked by hand (DELETE_REFERENCES).
   */
  async remove(facilityId: string, code: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const a = await tx.chartOfAccounts.findUnique({
          where: { facilityId_accountCode: { facilityId, accountCode: code } },
        });
        if (!a) throw Errors.ACCOUNT_NOT_FOUND();
        if (a.isSystemAccount) throw Errors.SYSTEM_ACCOUNT_PROTECTED();

        const postings = await tx.journalEntryLine.count({ where: { facilityId, accountCode: code } });
        if (postings > 0) {
          throw Errors.ACCOUNT_IN_USE(
            `it has ${postings} journal posting(s). Deactivate it instead — its history stays on every report.`,
          );
        }
        const children = await tx.chartOfAccounts.count({ where: { facilityId, parentAccountCode: code } });
        if (children > 0) {
          throw Errors.ACCOUNT_IN_USE(`${children} account(s) sit under it. Delete or re-parent those first.`);
        }
        const used = await firstReference(tx, DELETE_REFERENCES, facilityId, code);
        if (used) throw Errors.ACCOUNT_IN_USE(`${used} use it.`);

        await tx.chartOfAccounts.delete({ where: { id: a.id } });
        return { deleted: true, account_code: code };
      });
    } catch (e) {
      // P2003: a foreign key refused the delete.
      if (e instanceof Error && 'code' in e && (e as { code: string }).code === 'P2003') {
        throw Errors.ACCOUNT_IN_USE('a document or a configuration still points at it. Deactivate it instead.');
      }
      throw e;
    }
  }

  async update(facilityId: string, code: string, body: UpdateAccountRequestType) {
    // Transaction so the audit trigger sees the acting user (F-2b).
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.chartOfAccounts.findUnique({
        where: { facilityId_accountCode: { facilityId, accountCode: code } },
      });
      if (!a) throw Errors.ACCOUNT_NOT_FOUND();

      const changes = (key: keyof UpdateAccountRequestType, current: unknown) =>
        body[key] !== undefined && body[key] !== current;
      const renames = changes('account_name', a.accountName);
      const moves = changes('statement_section', a.statementSection);
      const flagsChange =
        changes('is_cash_equivalent', a.isCashEquivalent) ||
        changes('allow_manual_posting', a.allowManualPosting) ||
        changes('requires_party', a.requiresParty);

      // System accounts anchor the posting templates and the statements: they
      // cannot be deactivated, renamed, moved between sections or re-flagged.
      if (a.isSystemAccount && (body.is_active === false || renames || moves || flagsChange)) {
        throw Errors.SYSTEM_ACCOUNT_PROTECTED();
      }

      if (moves) {
        validateStatementSection(a.accountType, a.accountClass, body.statement_section);
        if (body.statement_section === null && a.accountType === 'HEADER' && a.accountClass !== 'EQUITY') {
          throw Errors.VALIDATION_ERROR(
            'A header must keep a statement section — without one every account under it would be unclassified',
            'statement_section',
          );
        }
      }

      if (flagsChange) {
        const next = {
          is_cash_equivalent: body.is_cash_equivalent ?? a.isCashEquivalent,
          allow_manual_posting: body.allow_manual_posting ?? a.allowManualPosting,
          requires_party: body.requires_party ?? a.requiresParty,
        };
        validateFlags(a, next);
        // What an account IS — cash, or a party control account — cannot change
        // under postings already made on the other assumption. The chart guard
        // trigger enforces the same freeze; this says so before it fires.
        if (changes('is_cash_equivalent', a.isCashEquivalent) || changes('requires_party', a.requiresParty)) {
          const postings = await tx.journalEntryLine.count({ where: { facilityId, accountCode: code } });
          if (postings > 0) {
            throw Errors.VALIDATION_ERROR(
              `${code} already carries ${postings} posting(s); whether it is cash, or requires a party, is fixed once it is used`,
              'is_cash_equivalent',
            );
          }
        }
      }

      if (body.is_active === false && a.isActive) {
        await this.assertDeactivatable(tx, facilityId, a);
      }

      const updated = await tx.chartOfAccounts.update({
        where: { id: a.id },
        data: {
          ...(body.account_name !== undefined ? { accountName: body.account_name } : {}),
          ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
          ...(body.statement_section !== undefined ? { statementSection: body.statement_section } : {}),
          ...(body.is_cash_equivalent !== undefined ? { isCashEquivalent: body.is_cash_equivalent } : {}),
          ...(body.allow_manual_posting !== undefined ? { allowManualPosting: body.allow_manual_posting } : {}),
          ...(body.requires_party !== undefined ? { requiresParty: body.requires_party } : {}),
        },
      });
      return format(updated);
    });
  }

  /**
   * An account may be retired only when nothing depends on it staying open: no
   * active child (a header's own balance is always 0, so the balance check alone
   * never stopped a header with live children), a zero balance in both books,
   * and no configuration that will post to it.
   */
  private async assertDeactivatable(tx: Tx, facilityId: string, a: Row) {
    if (a.accountType === 'HEADER') {
      const active = await tx.chartOfAccounts.count({ where: { facilityId, parentAccountCode: a.accountCode, isActive: true } });
      if (active > 0) {
        throw Errors.VALIDATION_ERROR(`${active} active account(s) sit under ${a.accountCode}; deactivate those first`, 'is_active');
      }
      return;
    }
    const agg = await tx.journalEntryLine.aggregate({
      where: { facilityId, accountCode: a.accountCode, journalEntry: { postingStatus: 'POSTED' } },
      _sum: { debitAmount: true, creditAmount: true },
    });
    if (!moneyEquals(Number(agg._sum.debitAmount ?? 0), Number(agg._sum.creditAmount ?? 0))) {
      throw Errors.ACCOUNT_HAS_BALANCE();
    }
    const used = await firstReference(tx, DEACTIVATION_REFERENCES, facilityId, a.accountCode);
    if (used) {
      throw Errors.VALIDATION_ERROR(`${used} still post to ${a.accountCode}; change them before deactivating it`, 'is_active');
    }
  }
}
