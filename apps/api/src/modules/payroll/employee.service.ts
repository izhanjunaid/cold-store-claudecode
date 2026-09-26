import type { PrismaClient, Prisma } from '@coldchain/db';
import {
  DEFAULT_PAYROLL_COST_ACCOUNT,
  type CreateEmployeeRequestType,
  type UpdateEmployeeRequestType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';

const digits = (cnic: string) => cnic.replace(/\D/g, '');

/**
 * An owner's pay is a drawing, never a salary (ITO 2001 s.21(j); docs/25 C-21), so
 * payroll refuses a CNIC that belongs to a current partner. Compared on digits: a
 * CNIC is typed with and without its dashes.
 */
async function assertNotAPartner(db: PrismaClient, facilityId: string, cnic: string | null | undefined) {
  if (!cnic || !digits(cnic)) return;
  const partners = await db.partner.findMany({
    where: { facilityId, retiredOn: null, cnic: { not: null } },
    select: { name: true, cnic: true },
  });
  const owner = partners.find((p) => digits(p.cnic!) === digits(cnic));
  if (owner) {
    throw Errors.VALIDATION_ERROR(
      `This CNIC belongs to ${owner.name}, an owner of the business. An owner's pay is a drawing, not a salary — record it under Owners.`,
      'cnic',
    );
  }
}

export class EmployeeService {
  constructor(private prisma: PrismaClient) {}

  async create(facilityId: string, userId: string, body: CreateEmployeeRequestType) {
    await assertNotAPartner(this.prisma, facilityId, body.cnic);
    const created = await this.prisma.employee.create({
      data: {
        facilityId,
        name: body.name,
        nameUrdu: body.name_urdu ?? null,
        cnic: body.cnic ?? null,
        employeeType: body.employee_type,
        designation: body.designation ?? null,
        joinDate: new Date(body.join_date),
        basicSalaryPkr: body.basic_salary_pkr ?? null,
        dailyWagePkr: body.daily_wage_pkr ?? null,
        eobiRegistered: body.eobi_registered ?? false,
        costAccountCode: body.cost_account_code ?? DEFAULT_PAYROLL_COST_ACCOUNT[body.employee_type],
        bankAccountNumber: body.bank_account_number ?? null,
        bankName: body.bank_name ?? null,
        notes: body.notes ?? null,
        createdBy: userId,
      },
    });
    return formatEmployee(created);
  }

  async update(facilityId: string, id: string, body: UpdateEmployeeRequestType) {
    const exists = await this.prisma.employee.findFirst({ where: { facilityId, id } });
    if (!exists) throw Errors.EMPLOYEE_NOT_FOUND();
    if (body.cnic !== undefined) await assertNotAPartner(this.prisma, facilityId, body.cnic);
    const updated = await this.prisma.employee.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.name_urdu !== undefined ? { nameUrdu: body.name_urdu } : {}),
        ...(body.cnic !== undefined ? { cnic: body.cnic } : {}),
        ...(body.designation !== undefined ? { designation: body.designation } : {}),
        ...(body.basic_salary_pkr !== undefined ? { basicSalaryPkr: body.basic_salary_pkr } : {}),
        ...(body.daily_wage_pkr !== undefined ? { dailyWagePkr: body.daily_wage_pkr } : {}),
        ...(body.eobi_registered !== undefined ? { eobiRegistered: body.eobi_registered } : {}),
        ...(body.cost_account_code !== undefined ? { costAccountCode: body.cost_account_code } : {}),
        ...(body.bank_account_number !== undefined ? { bankAccountNumber: body.bank_account_number } : {}),
        ...(body.bank_name !== undefined ? { bankName: body.bank_name } : {}),
        ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      },
    });
    return formatEmployee(updated);
  }

  async terminate(facilityId: string, id: string, terminationDate: string) {
    const exists = await this.prisma.employee.findFirst({ where: { facilityId, id } });
    if (!exists) throw Errors.EMPLOYEE_NOT_FOUND();
    const updated = await this.prisma.employee.update({
      where: { id },
      data: { terminationDate: new Date(terminationDate), isActive: false },
    });
    return formatEmployee(updated);
  }

  async getById(facilityId: string, id: string) {
    const e = await this.prisma.employee.findFirst({ where: { facilityId, id } });
    if (!e) throw Errors.EMPLOYEE_NOT_FOUND();
    return formatEmployee(e);
  }

  async list(facilityId: string, query: { employee_type?: string; is_active?: boolean; page: number; pageSize: number }) {
    const where: Prisma.EmployeeWhereInput = { facilityId };
    if (query.employee_type) where.employeeType = query.employee_type as any;
    if (query.is_active !== undefined) where.isActive = query.is_active;
    const [data, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.employee.count({ where }),
    ]);
    return {
      data: data.map(formatEmployee),
      meta: { total, page: query.page, per_page: query.pageSize },
    };
  }
}

export function formatEmployee(e: any) {
  return {
    id: e.id,
    name: e.name,
    name_urdu: e.nameUrdu,
    cnic: e.cnic,
    employee_type: e.employeeType,
    designation: e.designation,
    join_date: e.joinDate.toISOString().slice(0, 10),
    basic_salary_pkr: e.basicSalaryPkr ? Number(e.basicSalaryPkr) : null,
    daily_wage_pkr: e.dailyWagePkr ? Number(e.dailyWagePkr) : null,
    eobi_registered: e.eobiRegistered,
    cost_account_code: e.costAccountCode,
    bank_account_number: e.bankAccountNumber,
    bank_name: e.bankName,
    is_active: e.isActive,
    termination_date: e.terminationDate ? e.terminationDate.toISOString().slice(0, 10) : null,
    notes: e.notes,
    created_at: e.createdAt.toISOString(),
  };
}
