import type { PrismaClient, Prisma } from '@coldchain/db';
import { Errors } from '../../common/errors';
import type {
  ChartOfAccountsListQueryType,
  CreateAccountRequestType,
  UpdateAccountRequestType,
} from '@coldchain/shared';

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
    const exists = await this.prisma.chartOfAccounts.findUnique({
      where: { facilityId_accountCode: { facilityId, accountCode: body.account_code } },
    });
    if (exists) {
      throw Errors.VALIDATION_ERROR('Account code already exists', 'account_code');
    }
    const created = await this.prisma.chartOfAccounts.create({
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
  }

  async update(facilityId: string, code: string, body: UpdateAccountRequestType) {
    const a = await this.prisma.chartOfAccounts.findUnique({
      where: { facilityId_accountCode: { facilityId, accountCode: code } },
    });
    if (!a) throw Errors.ACCOUNT_NOT_FOUND();
    if (a.isSystemAccount && body.is_active === false) {
      throw Errors.SYSTEM_ACCOUNT_PROTECTED();
    }
    const updated = await this.prisma.chartOfAccounts.update({
      where: { id: a.id },
      data: {
        ...(body.account_name !== undefined ? { accountName: body.account_name } : {}),
        ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
      },
    });
    return format(updated);
  }
}
