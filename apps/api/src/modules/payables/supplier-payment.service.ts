import type { PrismaClient, Prisma } from '@coldchain/db';
import {
  MONEY_EPSILON,
  assetAccountForPaymentMethod,
  round2,
  sumMoney,
  toIsoDate,
  type AllocationInputType,
  type AllocateSupplierPaymentRequestType,
  type CreateSupplierPaymentRequestType,
  type SupplierPaymentActionType,
  type SupplierPaymentListQueryType,
  type VoidDocumentRequestType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { lockRow } from '../../common/row-lock';
import { documentNumberPrefix, nextDocumentNumber } from '../../common/document-number';
import { assertKatchiWriteAllowed } from '../accounting/book-gate';
import { assertCashAccount } from '../accounting/cash-account';
import { postedEntryNumber, type JournalEntryService } from '../accounting/journal-entry.service';
import { PayablesErrors } from './errors';
import { SUPPLIER_WITHHOLDING_ACCOUNT, payableSupplier } from './supplier';
import { buildJE33SupplierPayment } from './templates/je-33-supplier-payment';

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;
type Book = 'PACCI' | 'KATCHI';

/** What a payment is made of, whether recorded on its own or as a bill's "pay now". */
export type SupplierPaymentInput = Omit<CreateSupplierPaymentRequestType, 'book_type'> & { book_type: Book };

const include = {
  supplier: { select: { name: true } },
  account: { select: { accountName: true } },
  journalEntry: { select: { entryNumber: true } },
  allocations: { include: { bill: { select: { billNumber: true } } }, orderBy: { id: 'asc' } },
} satisfies Prisma.SupplierPaymentInclude;

type Row = Prisma.SupplierPaymentGetPayload<{ include: typeof include }>;

const liveTotal = (allocations: Array<{ allocatedAmountPkr: unknown; voidedAt: Date | null }>) =>
  sumMoney(allocations.filter((a) => !a.voidedAt).map((a) => Number(a.allocatedAmountPkr)));

export class SupplierPaymentService {
  constructor(
    private prisma: PrismaClient,
    private journal: JournalEntryService,
  ) {}

  async create(facilityId: string, userId: string, role: string, body: CreateSupplierPaymentRequestType) {
    return this.prisma.$transaction((tx) => this.createInTransaction(tx, facilityId, userId, role, body));
  }

  /**
   * Record and post a payment (JE-33), then apply it to bills. The supplier's account
   * is debited gross; the cash equivalent is credited net and the tax withheld is owed
   * to the FBR at the rate the payment states.
   */
  async createInTransaction(tx: Tx, facilityId: string, userId: string, role: string, body: SupplierPaymentInput) {
    assertKatchiWriteAllowed(role, body.book_type);
    const supplier = await payableSupplier(tx, facilityId, body.supplier_party_id);
    const assetAccountCode = body.asset_account_code ?? assetAccountForPaymentMethod(body.payment_method);
    await assertCashAccount(tx, facilityId, assetAccountCode);

    const gross = round2(body.gross_amount_pkr);
    const section = body.withholding_section ?? null;
    const withholding = section ? round2((gross * body.withholding_rate_pct!) / 100) : 0;
    const net = round2(gross - withholding);
    const paymentDate = new Date(`${body.payment_date}T00:00:00.000Z`);

    const paymentNumber = await nextDocumentNumber(
      tx,
      facilityId,
      'supplier_payments',
      documentNumberPrefix('SPY', paymentDate, 'monthly'),
      4,
    );
    const payment = await tx.supplierPayment.create({
      data: {
        facilityId,
        paymentNumber,
        supplierPartyId: supplier.id,
        paymentDate,
        paymentMethod: body.payment_method,
        assetAccountCode,
        grossAmountPkr: gross,
        withholdingSection: section,
        withholdingRatePct: section ? body.withholding_rate_pct : null,
        withholdingPkr: withholding,
        netPaidPkr: net,
        certificateNumber: body.certificate_number ?? null,
        referenceNumber: body.reference_number ?? null,
        notes: body.notes ?? null,
        bookType: body.book_type,
        createdBy: userId,
      },
    });

    const posted = await this.journal.postInTransaction(
      tx,
      facilityId,
      userId,
      buildJE33SupplierPayment({
        paymentId: payment.id,
        paymentNumber,
        paymentDate,
        supplier,
        assetAccountCode,
        grossPkr: gross,
        netPkr: net,
        withholding: section ? { accountCode: SUPPLIER_WITHHOLDING_ACCOUNT[section], amountPkr: withholding, section } : null,
        bookType: body.book_type,
      }),
    );
    await tx.supplierPayment.update({ where: { id: payment.id }, data: { journalEntryId: posted.id } });

    await applyAllocations(tx, facilityId, payment.id, body.allocations ?? []);
    return this.detail(tx, facilityId, payment.id);
  }

  /** Apply an unapplied remainder to bills (no entry: the ledger already holds the payment). */
  async allocate(facilityId: string, role: string, id: string, body: AllocateSupplierPaymentRequestType) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await this.lock(tx, facilityId, id);
      assertKatchiWriteAllowed(role, payment.bookType);
      if (payment.voidedAt) throw PayablesErrors.SUPPLIER_PAYMENT_VOIDED();
      await applyAllocations(tx, facilityId, id, body.allocations);
      return this.detail(tx, facilityId, id);
    });
  }

  /**
   * Void a payment made in error: reverse its entry and release every bill it paid.
   * The row lock comes first and the book check runs on the locked row (C-42).
   */
  async void(facilityId: string, userId: string, role: string, id: string, body: VoidDocumentRequestType) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await this.lock(tx, facilityId, id);
      assertKatchiWriteAllowed(role, payment.bookType);
      if (payment.voidedAt) throw PayablesErrors.SUPPLIER_PAYMENT_VOIDED();
      if (!payment.journalEntryId) throw new Error(`Supplier payment ${id} has no journal entry`);

      await this.journal.reverseInTransaction(tx, facilityId, userId, payment.journalEntryId, {
        reason: `supplier payment ${payment.paymentNumber} voided — ${body.reason}`,
        date: body.void_date ? new Date(`${body.void_date}T00:00:00.000Z`) : undefined,
      });
      const now = new Date();
      await tx.supplierPaymentAllocation.updateMany({
        where: { supplierPaymentId: id, voidedAt: null },
        data: { voidedAt: now, voidedBy: userId },
      });
      await tx.supplierPayment.update({
        where: { id },
        data: { voidedAt: now, voidedBy: userId, voidReason: body.reason },
      });
      return this.detail(tx, facilityId, id);
    });
  }

  async getById(facilityId: string, id: string) {
    return this.detail(this.prisma, facilityId, id);
  }

  async list(facilityId: string, book: Book, query: SupplierPaymentListQueryType) {
    const where: Prisma.SupplierPaymentWhereInput = {
      facilityId,
      bookType: book,
      ...(query.supplier_party_id ? { supplierPartyId: query.supplier_party_id } : {}),
      ...(query.date_from || query.date_to
        ? {
            paymentDate: {
              ...(query.date_from ? { gte: new Date(query.date_from) } : {}),
              ...(query.date_to ? { lte: new Date(query.date_to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.supplierPayment.findMany({
        where,
        include,
        orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      }),
      this.prisma.supplierPayment.count({ where }),
    ]);
    return { data: rows.map(format), meta: { total, page: query.page, per_page: query.page_size } };
  }

  private async lock(tx: Tx, facilityId: string, id: string) {
    if (!(await lockRow(tx, 'supplier_payments', id, facilityId))) throw PayablesErrors.SUPPLIER_PAYMENT_NOT_FOUND();
    return tx.supplierPayment.findFirstOrThrow({ where: { id, facilityId } });
  }

  private async detail(db: Db, facilityId: string, id: string) {
    const row = await db.supplierPayment.findFirst({ where: { id, facilityId }, include });
    if (!row) throw PayablesErrors.SUPPLIER_PAYMENT_NOT_FOUND();
    return format(row);
  }
}

/**
 * Apply a payment to bills. The payment row is already locked (or new); every bill is
 * locked in id order before its open amount is read, so two payments racing for the
 * same bill cannot both see it unpaid. A bill must be posted, the payment's supplier's
 * and in the payment's book (R-04's payables twin).
 */
async function applyAllocations(
  tx: Tx,
  facilityId: string,
  paymentId: string,
  allocations: AllocationInputType[],
) {
  if (allocations.length === 0) return;
  const payment = await tx.supplierPayment.findFirstOrThrow({
    where: { id: paymentId, facilityId },
    include: { allocations: true },
  });

  const byBill = new Map<string, number>();
  for (const a of allocations) byBill.set(a.bill_id, round2((byBill.get(a.bill_id) ?? 0) + a.amount_pkr));

  const requested = sumMoney([...byBill.values()]);
  if (liveTotal(payment.allocations) + requested > Number(payment.grossAmountPkr) + MONEY_EPSILON) {
    throw Errors.PAYMENT_OVER_ALLOCATED();
  }

  for (const billId of [...byBill.keys()].sort()) {
    if (!(await lockRow(tx, 'bills', billId, facilityId))) throw PayablesErrors.BILL_NOT_FOUND();
    const bill = await tx.bill.findFirstOrThrow({ where: { id: billId, facilityId }, include: { allocations: true } });
    const label = bill.billNumber ?? 'draft';
    if (bill.status !== 'POSTED') throw PayablesErrors.BILL_NOT_PAYABLE(`Bill ${label} is not posted`);
    if (bill.supplierPartyId !== payment.supplierPartyId) {
      throw PayablesErrors.BILL_NOT_PAYABLE(`Bill ${label} belongs to another supplier`);
    }
    if (bill.bookType !== payment.bookType) {
      throw PayablesErrors.BILL_NOT_PAYABLE(`Bill ${label} is in the other book`);
    }
    const open = round2(Number(bill.totalPkr) - liveTotal(bill.allocations));
    const amount = byBill.get(billId)!;
    if (amount > open + MONEY_EPSILON) throw PayablesErrors.BILL_OVER_ALLOCATED(label, open);
    await tx.supplierPaymentAllocation.create({
      data: { supplierPaymentId: paymentId, billId, allocatedAmountPkr: amount },
    });
  }
}

function allowedActions(p: Row, unapplied: number): SupplierPaymentActionType[] {
  if (p.voidedAt) return [];
  return unapplied > MONEY_EPSILON ? ['allocate', 'void'] : ['void'];
}

function format(p: Row) {
  const allocated = liveTotal(p.allocations);
  const unapplied = p.voidedAt ? 0 : round2(Number(p.grossAmountPkr) - allocated);
  return {
    id: p.id,
    payment_number: p.paymentNumber,
    supplier_party_id: p.supplierPartyId,
    supplier_name: p.supplier.name,
    payment_date: toIsoDate(p.paymentDate),
    payment_method: p.paymentMethod,
    asset_account_code: p.assetAccountCode,
    asset_account_name: p.account.accountName,
    gross_amount_pkr: Number(p.grossAmountPkr),
    withholding_section: p.withholdingSection,
    withholding_rate_pct: p.withholdingRatePct === null ? null : Number(p.withholdingRatePct),
    withholding_pkr: Number(p.withholdingPkr),
    net_paid_pkr: Number(p.netPaidPkr),
    certificate_number: p.certificateNumber,
    reference_number: p.referenceNumber,
    book_type: p.bookType,
    journal_entry_id: p.journalEntryId,
    entry_number: p.journalEntry ? postedEntryNumber(p.journalEntry) : null,
    allocated_pkr: allocated,
    unapplied_pkr: unapplied,
    allocations: p.allocations
      .filter((a) => !a.voidedAt)
      .map((a) => ({ bill_id: a.billId, bill_number: a.bill.billNumber, amount_pkr: Number(a.allocatedAmountPkr) })),
    voided_at: p.voidedAt?.toISOString() ?? null,
    void_reason: p.voidReason,
    notes: p.notes,
    allowed_actions: allowedActions(p, unapplied),
    created_at: p.createdAt.toISOString(),
  };
}
