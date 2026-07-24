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
        },
      });
      return format(updated);
    });
  }
}
