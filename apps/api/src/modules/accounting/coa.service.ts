import type { PrismaClient, Prisma } from '@coldchain/db';
import { Errors } from '../../common/errors';
import type {
  ChartOfAccountsListQueryType,
  CreateAccountRequestType,
  UpdateAccountRequestType,
} from '@coldchain/shared';

// The seed numbers every class by its leading digit (1 asset … 6 expense).
// We reject only a code whose leading digit is *another* class's assigned
// range — e.g. an EXPENSE numbered 1999 collides with assets. Unassigned
// leading digits (0/7/8/9) stay legal so owners can still open custom heads
// outside the seeded ranges; those surface via the statements' unclassified
// bucket (F-6b), which is a shipped capability, not a bug (phase/19 audit).
const CLASS_CODE_PREFIX: Record<string, string> = {
  ASSET: '1',
  LIABILITY: '2',
  EQUITY: '3',
  REVENUE: '4',
  COST_OF_SERVICE: '5',
  EXPENSE: '6',
};
const ASSIGNED_CLASS_PREFIXES = new Set(Object.values(CLASS_CODE_PREFIX));

// Which statement_section values a HEADER of a given class may take
// (phase/24). EQUITY has no entry on purpose: equity aggregates by class, not
// by header — 3010/3020/3030 sit at the root and the balance sheet places
// equity lines directly off accountClass (financial-statements.service.ts).
const CLASS_SECTIONS: Record<string, Set<string>> = {
  ASSET: new Set(['CURRENT_ASSET', 'NON_CURRENT_ASSET']),
  LIABILITY: new Set(['CURRENT_LIABILITY', 'NON_CURRENT_LIABILITY']),
  REVENUE: new Set(['REVENUE', 'CONTRA_REVENUE', 'OTHER_INCOME']),
  COST_OF_SERVICE: new Set(['COST_OF_SERVICE']),
  EXPENSE: new Set(['OPERATING_EXPENSE', 'OTHER_EXPENSE']),
};

function validateStatementSection(
  accountType: string,
  accountClass: string,
  section: string | null | undefined,
): void {
  if (section === undefined || section === null) return;
  if (accountType !== 'HEADER') {
    throw Errors.VALIDATION_ERROR('statement_section can only be set on a HEADER account', 'statement_section');
  }
  const allowed = CLASS_SECTIONS[accountClass];
  if (!allowed || !allowed.has(section)) {
    const equityNote = accountClass === 'EQUITY' ? ' — equity aggregates by class, not by header' : '';
    throw Errors.VALIDATION_ERROR(
      `${section} is not a valid statement section for ${accountClass}${equityNote}`,
      'statement_section',
    );
  }
}

function format(a: Prisma.ChartOfAccountsGetPayload<{}>) {
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
    created_at: a.createdAt.toISOString(),
  };
}

export class CoaService {
  constructor(private prisma: PrismaClient) {}

  async list(facilityId: string, query: ChartOfAccountsListQueryType) {
    const where: Prisma.ChartOfAccountsWhereInput = { facilityId };
    if (query.account_class) where.accountClass = query.account_class;
    if (query.is_active !== undefined) where.isActive = query.is_active;

    const data = await this.prisma.chartOfAccounts.findMany({
      where,
      orderBy: { accountCode: 'asc' },
    });
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
    return this.prisma.$transaction(async (tx) => {
      const exists = await tx.chartOfAccounts.findUnique({
        where: { facilityId_accountCode: { facilityId, accountCode: body.account_code } },
      });
      if (exists) {
        throw Errors.VALIDATION_ERROR('Account code already exists', 'account_code');
      }
      const expectedPrefix = CLASS_CODE_PREFIX[body.account_class];
      const leadDigit = body.account_code.charAt(0);
      if (
        expectedPrefix &&
        leadDigit !== expectedPrefix &&
        ASSIGNED_CLASS_PREFIXES.has(leadDigit)
      ) {
        throw Errors.VALIDATION_ERROR(
          `Account code ${body.account_code} starts with ${leadDigit}, which is reserved for another account class; ${body.account_class} codes use ${expectedPrefix} (or an unassigned 0/7/8/9 range)`,
          'account_code',
        );
      }
      // Statements roll detail accounts up through their parent; an invalid
      // parent silently drops the account from the P&L / balance sheet (F-6a).
      // Equity is the one class built by class rather than by header (the
      // seed's 3010/3020/3030 sit at the root) — everything else needs one.
      if (body.account_type === 'DETAIL' && body.account_class !== 'EQUITY' && !body.parent_account_code) {
        throw Errors.INVALID_PARENT_ACCOUNT('Detail accounts must sit under a header account (equity excepted)');
      }
      // buildGroups/buildLines match exactly one level (parentAccountCode ===
      // headerCode); a HEADER-under-a-HEADER would orphan its own children
      // into the unclassified bucket even when its grandparent is a seeded
      // section header. Headers stay root-level so the one-level assumption
      // holds everywhere it's relied on, not just at report time (phase/24).
      if (body.account_type === 'HEADER' && body.parent_account_code) {
        throw Errors.INVALID_PARENT_ACCOUNT('Header accounts cannot have a parent — headers are always root-level');
      }
      validateStatementSection(body.account_type, body.account_class, body.statement_section);
      if (body.parent_account_code) {
        const parent = await tx.chartOfAccounts.findUnique({
          where: {
            facilityId_accountCode: { facilityId, accountCode: body.parent_account_code },
          },
        });
        if (!parent) {
          throw Errors.INVALID_PARENT_ACCOUNT('Parent account does not exist');
        }
        if (parent.accountType !== 'HEADER') {
          throw Errors.INVALID_PARENT_ACCOUNT('Parent must be a HEADER account');
        }
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
          normalBalance: body.normal_balance,
          statementSection: body.statement_section ?? null,
          isSystemAccount: false,
        },
      });
      return format(created);
    });
  }

  async update(facilityId: string, code: string, body: UpdateAccountRequestType) {
    // Transaction so the audit trigger sees the acting user (F-2b).
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.chartOfAccounts.findUnique({
        where: { facilityId_accountCode: { facilityId, accountCode: code } },
      });
      if (!a) throw Errors.ACCOUNT_NOT_FOUND();
      // System accounts anchor the posting templates: they cannot be
      // deactivated, and renaming one would desync the UI (which hides the
      // control) from the API (phase/19 audit).
      const isRename = body.account_name !== undefined && body.account_name !== a.accountName;
      if (a.isSystemAccount && (body.is_active === false || isRename)) {
        throw Errors.SYSTEM_ACCOUNT_PROTECTED();
      }
      // Section is presentation, not structure (unlike code/class/type/parent/
      // normal_balance), so it stays outside the system-account protection
      // above — a seeded header's section is meant to be editable.
      validateStatementSection(a.accountType, a.accountClass, body.statement_section);
      // Deactivating an account that still carries a balance would freeze that
      // balance behind an inactive account; require it be zeroed first. Zero
      // net with history is fine (a fully-settled account may be retired).
      if (body.is_active === false && a.isActive) {
        const agg = await tx.journalEntryLine.aggregate({
          where: { facilityId, accountCode: code, journalEntry: { postingStatus: 'POSTED' } },
          _sum: { debitAmount: true, creditAmount: true },
        });
        const debit = Number(agg._sum.debitAmount ?? 0);
        const credit = Number(agg._sum.creditAmount ?? 0);
        if (Math.abs(debit - credit) > 0.005) {
          throw Errors.ACCOUNT_HAS_BALANCE();
        }
      }
      const updated = await tx.chartOfAccounts.update({
        where: { id: a.id },
        data: {
          ...(body.account_name !== undefined ? { accountName: body.account_name } : {}),
          ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
          ...(body.statement_section !== undefined ? { statementSection: body.statement_section } : {}),
        },
      });
      return format(updated);
    });
  }
}
