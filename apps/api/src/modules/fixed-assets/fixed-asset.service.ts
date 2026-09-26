import type { PrismaClient, Prisma } from '@coldchain/db';
import {
  ASSET_CATEGORY_ACCOUNTS,
  DEFAULT_BANK_ACCOUNT_CODE,
  MONEY_EPSILON,
  monthEnd,
  periodOf,
  round2,
  sumMoney,
  toIsoDate,
  type ConvertToOpeningAssetRequestType,
  type CreateFixedAssetRequestType,
  type FixedAssetActionType,
  type OpeningAssetType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { lockRow } from '../../common/row-lock';
import { documentNumberPrefix, nextDocumentNumber } from '../../common/document-number';
import { assertKatchiWriteAllowed } from '../accounting/book-gate';
import { standingEntriesWhere } from '../accounting/ledger';
import { JournalEntryService } from '../accounting/journal-entry.service';
import { FixedAssetRepository } from './fixed-asset.repository';
import { buildJE12AssetPurchase } from './templates/je-12-asset-purchase';
import { buildJE13Depreciation } from './templates/je-13-depreciation';
import { buildJE14AssetDisposal } from './templates/je-14-asset-disposal';
import { buildJE28AssetImpairment } from './templates/je-28-asset-impairment';
import { computeMonthlyDepreciation } from './depreciation-calc';

type Tx = Prisma.TransactionClient;
type Asset = Prisma.FixedAssetGetPayload<object>;

type DisposeInput = { disposal_date: string; disposal_proceeds_pkr: number; proceeds_account_code?: string };
type CorrectionInput = { reason: string; reversal_date?: string };

/** A period as one integer, so months compare and step as numbers. */
const periodIndex = (p: { year: number; month: number }) => p.year * 12 + (p.month - 1);
const periodAt = (index: number) => ({ year: Math.floor(index / 12), month: (index % 12) + 1 });

/** The last month whose final day falls on or before `date` — what a charge dated `date` has fully used. */
function lastFullMonthBy(date: Date): number {
  const p = periodOf(date);
  return toIsoDate(monthEnd(p.year, p.month)) === toIsoDate(date) ? periodIndex(p) : periodIndex(p) - 1;
}

/** Impairments are IMPAIRMENT entries; before docs/25 they were posted as ADJUSTMENT. */
const IMPAIRMENT_ENTRY_TYPES: Prisma.JournalEntryWhereInput['entryType'] = { in: ['IMPAIRMENT', 'ADJUSTMENT'] };

export class FixedAssetService {
  private repo: FixedAssetRepository;

  constructor(
    private prisma: PrismaClient,
    private journalEntry: JournalEntryService,
  ) {
    this.repo = new FixedAssetRepository(prisma);
  }

  async create(facilityId: string, userId: string, role: string, body: CreateFixedAssetRequestType) {
    const bookType = body.book_type ?? 'PACCI';
    assertKatchiWriteAllowed(role, bookType);
    const defaults = ASSET_CATEGORY_ACCOUNTS[body.asset_category]!;
    const assetCode = body.asset_account_code ?? defaults.asset;
    const paidFrom = body.paid_from_account_code ?? DEFAULT_BANK_ACCOUNT_CODE;
    const purchaseDate = new Date(body.purchase_date);

    return this.prisma.$transaction(async (tx) => {
      const assetNumber = await nextDocumentNumber(
        tx,
        facilityId,
        'fixed_assets',
        documentNumberPrefix('FA', purchaseDate, 'yearly'),
        4,
      );

      const asset = await tx.fixedAsset.create({
        data: {
          facilityId,
          assetNumber,
          assetName: body.asset_name,
          assetCategory: body.asset_category,
          assetAccountCode: assetCode,
          accumDeprAccountCode: body.accum_depr_account_code ?? defaults.accumulatedDepreciation,
          deprExpenseAccountCode: body.depr_expense_account_code ?? defaults.depreciationExpense,
          purchaseDate,
          purchaseCostPkr: body.purchase_cost_pkr,
          residualValuePkr: body.residual_value_pkr ?? 0,
          usefulLifeYears: body.useful_life_years ?? null,
          depreciationMethod: body.depreciation_method,
          wdvRatePercent: body.wdv_rate_percent ?? null,
          status: 'PURCHASED',
          accumulatedDepreciationPkr: 0,
          bookType,
          notes: body.notes ?? null,
          createdBy: userId,
        },
      });

      const posted = await this.journalEntry.postInTransaction(
        tx,
        facilityId,
        userId,
        buildJE12AssetPurchase({
          assetId: asset.id,
          assetNumber: asset.assetNumber,
          assetName: asset.assetName,
          assetAccountCode: assetCode,
          paidFromAccountCode: paidFrom,
          costPkr: Number(asset.purchaseCostPkr),
          purchaseDate,
          bookType,
        }),
        { postingStatus: 'POSTED' },
      );
      await tx.fixedAsset.update({ where: { id: asset.id }, data: { purchaseJournalEntryId: posted.id } });

      return this.detail(tx, facilityId, asset.id);
    });
  }

  async getById(facilityId: string, id: string) {
    return this.detail(this.prisma, facilityId, id);
  }

  /**
   * Bring the assets the business owned at go-live onto the register (docs/25 C-30).
   * Their cost and depreciation to date are already in the opening-balance entry, so
   * no journal entry is posted — posting a purchase too used to count every one of
   * them twice. The register may not claim more than that entry carries.
   */
  async importOpening(facilityId: string, userId: string, role: string, assets: OpeningAssetType[]) {
    // Opening balances are official-book only.
    assertKatchiWriteAllowed(role, 'PACCI');
    return this.prisma.$transaction(async (tx) => {
      const opening = await standingOpeningEntry(tx, facilityId);
      const ids: string[] = [];
      for (const a of assets) {
        const purchaseDate = new Date(a.purchase_date);
        if (purchaseDate > opening.entryDate) {
          throw Errors.VALIDATION_ERROR(
            `${a.asset_name} was bought after the opening date (${toIsoDate(opening.entryDate)}); record it as a purchase instead`,
            'purchase_date',
          );
        }
        if (a.depreciation_start_date && new Date(a.depreciation_start_date) < purchaseDate) {
          throw Errors.VALIDATION_ERROR(`${a.asset_name} cannot go into service before it was bought`, 'depreciation_start_date');
        }
        const defaults = ASSET_CATEGORY_ACCOUNTS[a.asset_category]!;
        const created = await tx.fixedAsset.create({
          data: {
            facilityId,
            assetNumber: await nextDocumentNumber(tx, facilityId, 'fixed_assets', documentNumberPrefix('FA', purchaseDate, 'yearly'), 4),
            assetName: a.asset_name,
            assetCategory: a.asset_category,
            assetAccountCode: a.asset_account_code ?? defaults.asset,
            accumDeprAccountCode: a.accum_depr_account_code ?? defaults.accumulatedDepreciation,
            deprExpenseAccountCode: a.depr_expense_account_code ?? defaults.depreciationExpense,
            purchaseDate,
            purchaseCostPkr: a.purchase_cost_pkr,
            residualValuePkr: a.residual_value_pkr ?? 0,
            usefulLifeYears: a.useful_life_years ?? null,
            depreciationMethod: a.depreciation_method,
            wdvRatePercent: a.wdv_rate_percent ?? null,
            depreciationStartDate: a.depreciation_start_date ? new Date(a.depreciation_start_date) : null,
            status: a.depreciation_start_date ? 'IN_SERVICE' : 'PURCHASED',
            accumulatedDepreciationPkr: a.accumulated_depreciation_pkr,
            isOpeningBalance: true,
            bookType: 'PACCI',
            notes: a.notes ?? null,
            createdBy: userId,
          },
        });
        ids.push(created.id);
      }
      await assertRegisterWithinOpening(tx, facilityId);
      return Promise.all(ids.map((id) => this.detail(tx, facilityId, id)));
    });
  }

  /**
   * For a box that already double-booked (pre-update check C08): an asset entered
   * through the register whose cost the opening-balance entry also carries. Reverse
   * its purchase entry and keep the row as an opening asset, adding the depreciation
   * the opening entry carries for it.
   */
  async convertToOpening(facilityId: string, userId: string, role: string, id: string, body: ConvertToOpeningAssetRequestType) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await this.lockAsset(tx, facilityId, id, role);
      if (asset.isOpeningBalance) throw Errors.FIXED_ASSET_INVALID_STATUS('This asset is already on the opening register');
      if (asset.status === 'DISPOSED') throw Errors.FIXED_ASSET_INVALID_STATUS('Reverse the disposal first');
      const opening = await standingOpeningEntry(tx, facilityId);
      if (!(await carriedByOpening(tx, facilityId, asset))) {
        throw Errors.FIXED_ASSET_INVALID_STATUS(
          'The opening-balance entry does not carry this asset (bought on or before its date, on the same account); it was not booked twice',
        );
      }
      const early = await tx.depreciationSchedule.findMany({ where: { fixedAssetId: id, status: 'POSTED' } });
      if (early.some((s) => periodIndex({ year: s.periodYear, month: s.periodMonth }) <= lastFullMonthBy(opening.entryDate))) {
        throw Errors.FIXED_ASSET_INVALID_STATUS(
          'Depreciation was posted for months the opening entry already covers; reverse those months first',
        );
      }

      await this.journalEntry.reverseInTransaction(tx, facilityId, userId, asset.purchaseJournalEntryId!, {
        reason: `${asset.assetNumber} is carried by the opening balances — ${body.reason}`,
        date: body.reversal_date ? new Date(body.reversal_date) : undefined,
      });
      await tx.fixedAsset.update({
        where: { id },
        data: {
          isOpeningBalance: true,
          accumulatedDepreciationPkr: { increment: body.opening_accumulated_depreciation_pkr },
        },
      });
      await assertRegisterWithinOpening(tx, facilityId);
      return this.detail(tx, facilityId, id);
    });
  }

  /** The opening register against the opening-balance entry, account by account. */
  async openingTieOut(facilityId: string) {
    return openingTieOut(this.prisma, facilityId);
  }

  async list(facilityId: string, query: { status?: string; category?: string; page: number; pageSize: number }) {
    const [data, total] = await this.repo.list(facilityId, query);
    return {
      data: data.map((a) => formatAssetSummary(a)),
      meta: { total, page: query.page, per_page: query.pageSize },
    };
  }

  async commission(facilityId: string, role: string, id: string, body: { depreciation_start_date: string }) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await this.lockAsset(tx, facilityId, id, role);
      if (asset.status !== 'PURCHASED') {
        throw Errors.FIXED_ASSET_INVALID_STATUS(`Cannot commission asset in status ${asset.status}; must be PURCHASED`);
      }
      const startDate = new Date(body.depreciation_start_date);
      if (toIsoDate(startDate) < toIsoDate(asset.purchaseDate)) {
        throw Errors.VALIDATION_ERROR(
          `Depreciation cannot start before the asset was bought (${toIsoDate(asset.purchaseDate)})`,
          'depreciation_start_date',
        );
      }
      await tx.fixedAsset.update({ where: { id }, data: { status: 'IN_SERVICE', depreciationStartDate: startDate } });
      return this.detail(tx, facilityId, id);
    });
  }

  /**
   * Dispose of an asset. It is first depreciated for every month it was used up to
   * the disposal date, so the gain or loss is measured against its real carrying
   * amount; a disposal dated before depreciation already posted is refused (C-31).
   * A written-off asset can still leave the register (C-32).
   */
  async dispose(facilityId: string, userId: string, role: string, id: string, body: DisposeInput) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockAsset(tx, facilityId, id, role);
      if (locked.status === 'DISPOSED') throw Errors.FIXED_ASSET_INVALID_STATUS('Asset already DISPOSED');

      const disposalDate = new Date(body.disposal_date);
      await this.depreciateThrough(tx, facilityId, userId, locked, disposalDate, 'disposal_date');

      const asset = await tx.fixedAsset.findFirstOrThrow({ where: { id, facilityId } });
      const proceeds = body.disposal_proceeds_pkr;
      const posted = await this.journalEntry.postInTransaction(
        tx,
        facilityId,
        userId,
        buildJE14AssetDisposal({
          assetId: asset.id,
          assetNumber: asset.assetNumber,
          assetName: asset.assetName,
          assetAccountCode: asset.assetAccountCode,
          accumDeprAccountCode: asset.accumDeprAccountCode,
          proceedsAccountCode: body.proceeds_account_code ?? DEFAULT_BANK_ACCOUNT_CODE,
          disposalDate,
          costPkr: Number(asset.purchaseCostPkr),
          accumDeprPkr: Number(asset.accumulatedDepreciationPkr),
          accumImpairmentPkr: Number(asset.accumulatedImpairmentPkr),
          proceedsPkr: proceeds,
          bookType: asset.bookType,
        }),
        { postingStatus: 'POSTED' },
      );

      await tx.fixedAsset.update({
        where: { id },
        data: { status: 'DISPOSED', disposalDate, disposalProceedsPkr: proceeds, disposalJournalEntryId: posted.id },
      });
      return this.detail(tx, facilityId, id);
    });
  }

  /**
   * Write an asset down to its recoverable amount (IFRS for SMEs Section 27). It is
   * depreciated up to the impairment date first, so the write-down is measured on the
   * carrying amount of that day and later months spread what is left (27.10). The
   * loss credits 1370, not accumulated depreciation — see JE-28. A write-down to zero
   * sets the asset WRITTEN_OFF.
   */
  async impair(
    facilityId: string,
    userId: string,
    role: string,
    id: string,
    body: { impairment_date: string; amount_pkr: number; reason: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockAsset(tx, facilityId, id, role);
      if (locked.status === 'DISPOSED' || locked.status === 'WRITTEN_OFF') {
        throw Errors.FIXED_ASSET_INVALID_STATUS(
          `Asset is already ${locked.status} and has no carrying amount left to impair`,
        );
      }
      const impairmentDate = new Date(body.impairment_date);
      await this.depreciateThrough(tx, facilityId, userId, locked, impairmentDate, 'impairment_date');

      const asset = await tx.fixedAsset.findFirstOrThrow({ where: { id, facilityId } });
      const carrying = carryingAmount(asset);
      const amount = round2(body.amount_pkr);
      if (amount <= 0) {
        throw Errors.VALIDATION_ERROR('The impairment must be more than zero.', 'amount_pkr');
      }
      if (amount > carrying + MONEY_EPSILON) {
        // Past the carrying amount the asset would sit at a negative value.
        throw Errors.VALIDATION_ERROR(
          `The impairment cannot exceed the carrying amount of Rs. ${carrying.toLocaleString()}.`,
          'amount_pkr',
        );
      }

      const posted = await this.journalEntry.postInTransaction(
        tx,
        facilityId,
        userId,
        buildJE28AssetImpairment({
          assetId: asset.id,
          assetNumber: asset.assetNumber,
          assetName: asset.assetName,
          impairmentDate,
          amountPkr: amount,
          reason: body.reason,
          bookType: asset.bookType,
        }),
        { postingStatus: 'POSTED' },
      );

      await tx.fixedAsset.update({
        where: { id },
        data: {
          accumulatedImpairmentPkr: { increment: amount },
          ...(round2(carrying - amount) <= MONEY_EPSILON ? { status: 'WRITTEN_OFF' as const } : {}),
        },
      });
      return { ...(await this.detail(tx, facilityId, id)), impairment_journal_entry_id: posted.id };
    });
  }

  /**
   * Undo a disposal posted in error: reverse JE-14 and put the asset back. Depreciation
   * posted up to the disposal date stands — it was real use. The status returns to what
   * the asset's own figures say it was.
   */
  async reverseDisposal(facilityId: string, userId: string, role: string, id: string, body: CorrectionInput) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await this.lockAsset(tx, facilityId, id, role);
      if (asset.status !== 'DISPOSED' || !asset.disposalJournalEntryId) {
        throw Errors.ASSET_NOT_REVERSIBLE(
          `Only a DISPOSED asset can have its disposal reversed (this one is ${asset.status})`,
        );
      }

      await this.journalEntry.reverseInTransaction(tx, facilityId, userId, asset.disposalJournalEntryId, {
        reason: `disposal of ${asset.assetNumber} reversed — ${body.reason}`,
        date: body.reversal_date ? new Date(body.reversal_date) : undefined,
      });

      await tx.fixedAsset.update({
        where: { id },
        data: {
          status: statusWhenStanding(asset),
          disposalDate: null,
          disposalProceedsPkr: null,
          disposalJournalEntryId: null,
        },
      });
      return this.detail(tx, facilityId, id);
    });
  }

  /**
   * Void an asset entered in error (docs/25 C-33): reverse its purchase entry and take
   * it off the register. Only while nothing else has posted to it — depreciation and
   * impairment are reversed first, a disposal is reversed first.
   */
  async void(facilityId: string, userId: string, role: string, id: string, body: { reason: string; void_date?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await this.lockAsset(tx, facilityId, id, role);
      if (asset.status === 'DISPOSED') throw Errors.ASSET_NOT_REVERSIBLE('Reverse the disposal before voiding the asset');
      if (Number(asset.accumulatedImpairmentPkr) > MONEY_EPSILON) {
        throw Errors.ASSET_NOT_REVERSIBLE('Reverse the impairment before voiding the asset');
      }
      if (await tx.depreciationSchedule.count({ where: { fixedAssetId: id, status: 'POSTED' } })) {
        throw Errors.ASSET_NOT_REVERSIBLE('Depreciation has been posted on this asset; reverse it before voiding');
      }

      if (asset.purchaseJournalEntryId) {
        const purchase = await tx.journalEntry.findFirstOrThrow({
          where: { id: asset.purchaseJournalEntryId, facilityId },
          select: { reversedById: true },
        });
        // Already reversed when the asset was moved onto the opening register.
        if (!purchase.reversedById) {
          await this.journalEntry.reverseInTransaction(tx, facilityId, userId, asset.purchaseJournalEntryId, {
            reason: `asset ${asset.assetNumber} voided — ${body.reason}`,
            date: body.void_date ? new Date(body.void_date) : undefined,
          });
        }
      }

      await tx.fixedAsset.update({
        where: { id },
        data: { voidedAt: new Date(), voidedBy: userId, voidReason: body.reason },
      });
      return this.detail(tx, facilityId, id);
    });
  }

  /** Reverse the most recent depreciation month (C-33); the next run posts it again. */
  async reverseLatestDepreciation(facilityId: string, userId: string, role: string, id: string, body: CorrectionInput) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await this.lockAsset(tx, facilityId, id, role);
      if (asset.status === 'DISPOSED') throw Errors.ASSET_NOT_REVERSIBLE('Reverse the disposal first');

      const latest = await tx.depreciationSchedule.findFirst({
        where: { fixedAssetId: id, status: 'POSTED' },
        orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
      });
      if (!latest?.journalEntryId) throw Errors.ASSET_NOT_REVERSIBLE('No depreciation has been posted on this asset');

      const monthClose = monthEnd(latest.periodYear, latest.periodMonth);
      // Later depreciation was measured on the carrying amount an impairment left.
      const laterImpairment = await tx.journalEntry.findFirst({
        where: {
          ...standingEntriesWhere(facilityId),
          sourceTable: 'fixed_assets',
          sourceId: id,
          entryType: IMPAIRMENT_ENTRY_TYPES,
          entryDate: { gt: monthClose },
        },
      });
      if (laterImpairment) throw Errors.ASSET_NOT_REVERSIBLE('An impairment was recorded after this month; reverse it first');

      await this.journalEntry.reverseInTransaction(tx, facilityId, userId, latest.journalEntryId, {
        reason: `depreciation ${latest.periodYear}-${String(latest.periodMonth).padStart(2, '0')} of ${asset.assetNumber} reversed — ${body.reason}`,
        date: body.reversal_date ? new Date(body.reversal_date) : monthClose,
      });
      await tx.depreciationSchedule.delete({ where: { id: latest.id } });
      await tx.fixedAsset.update({
        where: { id },
        data: { accumulatedDepreciationPkr: { decrement: Number(latest.depreciationAmountPkr) } },
      });
      return this.detail(tx, facilityId, id);
    });
  }

  /** Reverse the most recent impairment (C-32, C-33); a written-off asset returns to the register. */
  async reverseLatestImpairment(facilityId: string, userId: string, role: string, id: string, body: CorrectionInput) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await this.lockAsset(tx, facilityId, id, role);
      if (asset.status === 'DISPOSED') throw Errors.ASSET_NOT_REVERSIBLE('Reverse the disposal first');

      const latest = await tx.journalEntry.findFirst({
        where: {
          ...standingEntriesWhere(facilityId),
          sourceTable: 'fixed_assets',
          sourceId: id,
          entryType: IMPAIRMENT_ENTRY_TYPES,
        },
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
        include: { lines: true },
      });
      if (!latest) throw Errors.ASSET_NOT_REVERSIBLE('No impairment has been recorded on this asset');

      const since = await tx.depreciationSchedule.findMany({ where: { fixedAssetId: id, status: 'POSTED' } });
      if (since.some((s) => monthEnd(s.periodYear, s.periodMonth) > latest.entryDate)) {
        throw Errors.ASSET_NOT_REVERSIBLE(
          'Depreciation has been posted since this impairment, on the written-down amount; reverse it first',
        );
      }

      await this.journalEntry.reverseInTransaction(tx, facilityId, userId, latest.id, {
        reason: `impairment of ${asset.assetNumber} reversed — ${body.reason}`,
        date: body.reversal_date ? new Date(body.reversal_date) : latest.entryDate,
      });
      const amount = sumMoney(latest.lines.map((l) => Number(l.debitAmount)));
      await tx.fixedAsset.update({
        where: { id },
        data: {
          accumulatedImpairmentPkr: { decrement: amount },
          status: asset.status === 'WRITTEN_OFF' ? (asset.depreciationStartDate ? 'IN_SERVICE' : 'PURCHASED') : asset.status,
        },
      });
      return this.detail(tx, facilityId, id);
    });
  }

  /**
   * Post depreciation up to the given month for every asset in service, asset by
   * asset: each posts every month it has not posted yet (docs/25 C-29). There is no
   * period-wide "already run" rule any more — an asset commissioned into a month that
   * was already run is simply caught up, and re-running posts nothing new.
   */
  async runMonthlyDepreciation(
    facilityId: string,
    userId: string,
    role: string,
    body: { period_year: number; period_month: number; book_type?: 'PACCI' | 'KATCHI' },
  ) {
    const book = body.book_type ?? 'PACCI';
    assertKatchiWriteAllowed(role, book);
    const through = periodIndex({ year: body.period_year, month: body.period_month });

    return this.prisma.$transaction(
      async (tx) => {
        const assets = await tx.fixedAsset.findMany({
          where: { facilityId, status: 'IN_SERVICE', voidedAt: null, bookType: book },
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        const entries: Awaited<ReturnType<FixedAssetService['catchUp']>> = [];
        for (const { id } of assets) {
          await lockRow(tx, 'fixed_assets', id, facilityId);
          entries.push(...(await this.catchUp(tx, facilityId, userId, id, through)));
        }
        if (entries.length === 0) throw Errors.DEPRECIATION_NOTHING_TO_RUN();

        return {
          period_year: body.period_year,
          period_month: body.period_month,
          run_count: entries.length,
          total_depreciation_pkr: sumMoney(entries.map((e) => e.depreciation_amount_pkr)),
          entries,
        };
      },
      // ponytail: one transaction for the whole register; batch per asset if a box ever outgrows 30 s.
      { timeout: 30_000, maxWait: 10_000 },
    );
  }

  async listRuns(facilityId: string) {
    const rows = await this.prisma.depreciationSchedule.groupBy({
      by: ['periodYear', 'periodMonth'],
      where: { fixedAsset: { facilityId }, status: 'POSTED' },
      _count: { _all: true },
      _sum: { depreciationAmountPkr: true },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
    });
    return rows.map((r) => ({
      period_year: r.periodYear,
      period_month: r.periodMonth,
      asset_count: r._count._all,
      total_depreciation_pkr: Number(r._sum.depreciationAmountPkr ?? 0),
    }));
  }

  // ---------------------------------------------------------------------------

  /** Lock the asset row, then check the book and that it has not been voided. */
  private async lockAsset(tx: Tx, facilityId: string, id: string, role: string): Promise<Asset> {
    if (!(await lockRow(tx, 'fixed_assets', id, facilityId))) throw Errors.FIXED_ASSET_NOT_FOUND();
    const asset = await tx.fixedAsset.findFirstOrThrow({ where: { id, facilityId } });
    assertKatchiWriteAllowed(role, asset.bookType);
    if (asset.voidedAt) throw Errors.FIXED_ASSET_INVALID_STATUS('This asset has been voided');
    return asset;
  }

  /**
   * Catch an asset's depreciation up to the last month that ended by `date`, refusing
   * a `date` earlier than depreciation already posted (the asset's state on that day
   * is no longer knowable).
   */
  private async depreciateThrough(tx: Tx, facilityId: string, userId: string, asset: Asset, date: Date, field: string) {
    const through = lastFullMonthBy(date);
    const last = await lastPostedMonth(tx, asset.id);
    if (last !== null && last > through) {
      const p = periodAt(last);
      throw Errors.VALIDATION_ERROR(
        `Depreciation is already posted through ${p.year}-${String(p.month).padStart(2, '0')}; the date cannot be earlier`,
        field,
      );
    }
    await this.catchUp(tx, facilityId, userId, asset.id, through);
  }

  /** Post every month of `assetId`'s depreciation not yet posted, up to `through`. The caller holds the row lock. */
  private async catchUp(tx: Tx, facilityId: string, userId: string, assetId: string, through: number) {
    const asset = await tx.fixedAsset.findFirstOrThrow({ where: { id: assetId, facilityId } });
    if (asset.status !== 'IN_SERVICE' || asset.voidedAt || !asset.depreciationStartDate) return [];

    const last = await lastPostedMonth(tx, asset.id);
    let month = last !== null ? last + 1 : periodIndex(periodOf(asset.depreciationStartDate));
    if (asset.isOpeningBalance) month = Math.max(month, await firstMonthAfterOpening(tx, facilityId));

    const cost = Number(asset.purchaseCostPkr);
    const residual = Number(asset.residualValuePkr);
    const impairment = Number(asset.accumulatedImpairmentPkr);
    let accumulated = Number(asset.accumulatedDepreciationPkr);
    const posted: Array<{
      asset_id: string;
      asset_number: string;
      period_year: number;
      period_month: number;
      depreciation_amount_pkr: number;
      journal_entry_id: string;
    }> = [];

    for (; month <= through; month++) {
      if (round2(cost - accumulated - impairment - residual) <= MONEY_EPSILON) break; // fully depreciated
      const { year, month: m } = periodAt(month);
      const row = computeMonthlyDepreciation({
        method: asset.depreciationMethod,
        costPkr: cost,
        residualValuePkr: residual,
        usefulLifeYears: asset.usefulLifeYears ? Number(asset.usefulLifeYears) : null,
        wdvRatePercent: asset.wdvRatePercent ? Number(asset.wdvRatePercent) : null,
        depreciationStartDate: asset.depreciationStartDate,
        periodYear: year,
        periodMonth: m,
        openingNbvPkr: cost - accumulated - impairment,
        accumulatedImpairmentPkr: impairment,
      });
      if (row.depreciationAmountPkr <= 0) continue; // e.g. a start after the 15th

      const entry = await this.journalEntry.postInTransaction(
        tx,
        facilityId,
        userId,
        buildJE13Depreciation({
          assetId: asset.id,
          assetNumber: asset.assetNumber,
          assetName: asset.assetName,
          deprExpenseAccountCode: asset.deprExpenseAccountCode,
          accumDeprAccountCode: asset.accumDeprAccountCode,
          periodYear: year,
          periodMonth: m,
          amountPkr: row.depreciationAmountPkr,
          bookType: asset.bookType,
        }),
        { postingStatus: 'POSTED' },
      );
      const schedule = {
        openingNbvPkr: row.openingNbvPkr,
        depreciationAmountPkr: row.depreciationAmountPkr,
        closingNbvPkr: row.closingNbvPkr,
        status: 'POSTED' as const,
        journalEntryId: entry.id,
        postedAt: new Date(),
      };
      await tx.depreciationSchedule.upsert({
        where: { fixedAssetId_periodYear_periodMonth: { fixedAssetId: asset.id, periodYear: year, periodMonth: m } },
        create: { fixedAssetId: asset.id, periodYear: year, periodMonth: m, ...schedule },
        update: schedule,
      });
      accumulated = round2(accumulated + row.depreciationAmountPkr);
      posted.push({
        asset_id: asset.id,
        asset_number: asset.assetNumber,
        period_year: year,
        period_month: m,
        depreciation_amount_pkr: row.depreciationAmountPkr,
        journal_entry_id: entry.id,
      });
    }

    if (posted.length > 0) {
      await tx.fixedAsset.update({ where: { id: asset.id }, data: { accumulatedDepreciationPkr: accumulated } });
    }
    return posted;
  }

  private async detail(db: PrismaClient | Tx, facilityId: string, id: string) {
    const asset = await this.repo.findById(facilityId, id, db);
    if (!asset) throw Errors.FIXED_ASSET_NOT_FOUND();
    const convertible = !asset.isOpeningBalance && !asset.voidedAt && (await carriedByOpening(db, facilityId, asset));
    return formatAsset(asset, convertible);
  }
}

type Db = PrismaClient | Tx;

async function standingOpeningEntry(db: Db, facilityId: string) {
  const opening = await db.journalEntry.findFirst({
    where: { ...standingEntriesWhere(facilityId), sourceTable: 'opening_balances' },
    include: { lines: true },
  });
  if (!opening) {
    throw Errors.VALIDATION_ERROR(
      'Enter the opening balances first: an asset owned at go-live is carried by the opening-balance entry',
    );
  }
  return opening;
}

/**
 * Is `asset`'s cost also in the opening-balance entry? The C08 test: bought on or
 * before the opening date, its purchase entry still standing, and the opening entry
 * debiting its asset account.
 */
async function carriedByOpening(db: Db, facilityId: string, asset: Asset): Promise<boolean> {
  if (!asset.purchaseJournalEntryId) return false;
  const purchase = await db.journalEntry.findFirst({
    where: { id: asset.purchaseJournalEntryId, reversedById: null },
    select: { id: true },
  });
  if (!purchase) return false;
  const opening = await db.journalEntry.findFirst({
    where: {
      ...standingEntriesWhere(facilityId),
      sourceTable: 'opening_balances',
      entryDate: { gte: asset.purchaseDate },
      lines: { some: { accountCode: asset.assetAccountCode, debitAmount: { gt: 0 } } },
    },
    select: { id: true },
  });
  return opening !== null;
}

/**
 * Per fixed-asset account: what the opening-balance entry carries against what the
 * opening register says — cost on asset accounts, depreciation to go-live on
 * accumulated-depreciation accounts (the register's own later months excluded).
 */
async function openingTieOut(db: Db, facilityId: string) {
  const opening = await db.journalEntry.findFirst({
    where: { ...standingEntriesWhere(facilityId), sourceTable: 'opening_balances' },
    include: { lines: true },
  });
  const assets = await db.fixedAsset.findMany({
    where: { facilityId, isOpeningBalance: true, voidedAt: null },
    include: { schedules: { where: { status: 'POSTED' }, select: { depreciationAmountPkr: true } } },
  });

  const costAccounts = new Set<string>(Object.values(ASSET_CATEGORY_ACCOUNTS).map((c) => c.asset));
  const accumAccounts = new Set<string>(Object.values(ASSET_CATEGORY_ACCOUNTS).map((c) => c.accumulatedDepreciation));
  const register = new Map<string, number>();
  const add = (code: string, amount: number) => register.set(code, round2((register.get(code) ?? 0) + amount));
  for (const a of assets) {
    costAccounts.add(a.assetAccountCode);
    accumAccounts.add(a.accumDeprAccountCode);
    add(a.assetAccountCode, Number(a.purchaseCostPkr));
    add(
      a.accumDeprAccountCode,
      Number(a.accumulatedDepreciationPkr) - sumMoney(a.schedules.map((s) => Number(s.depreciationAmountPkr))),
    );
  }

  const ledger = (code: string, kind: 'COST' | 'ACCUMULATED_DEPRECIATION') => {
    const lines = (opening?.lines ?? []).filter((l) => l.accountCode === code);
    const net = sumMoney(lines.map((l) => Number(l.debitAmount) - Number(l.creditAmount)));
    return kind === 'COST' ? net : round2(-net);
  };
  const codes = [...costAccounts, ...accumAccounts];
  const names = new Map(
    (await db.chartOfAccounts.findMany({ where: { facilityId, accountCode: { in: codes } }, select: { accountCode: true, accountName: true } }))
      .map((c) => [c.accountCode, c.accountName]),
  );

  const accounts = [
    ...[...costAccounts].map((code) => ({ code, kind: 'COST' as const })),
    ...[...accumAccounts].map((code) => ({ code, kind: 'ACCUMULATED_DEPRECIATION' as const })),
  ]
    .map(({ code, kind }) => {
      const ledgerPkr = ledger(code, kind);
      const registerPkr = register.get(code) ?? 0;
      return {
        account_code: code,
        account_name: names.get(code) ?? code,
        kind,
        ledger_pkr: ledgerPkr,
        register_pkr: registerPkr,
        difference_pkr: round2(ledgerPkr - registerPkr),
      };
    })
    .filter((r) => Math.abs(r.ledger_pkr) >= MONEY_EPSILON || Math.abs(r.register_pkr) >= MONEY_EPSILON)
    .sort((a, b) => a.account_code.localeCompare(b.account_code));

  return {
    opening_date: opening ? toIsoDate(opening.entryDate) : null,
    accounts,
    is_reconciled: accounts.every((r) => Math.abs(r.difference_pkr) < MONEY_EPSILON),
  };
}

/** The opening register may not claim more on any account than the opening entry carries — that is the double count. */
async function assertRegisterWithinOpening(tx: Tx, facilityId: string) {
  const over = (await openingTieOut(tx, facilityId)).accounts.find((r) => r.register_pkr > r.ledger_pkr + MONEY_EPSILON);
  if (over) {
    throw Errors.VALIDATION_ERROR(
      `The opening register would carry Rs. ${over.register_pkr.toLocaleString()} on ${over.account_code} ${over.account_name}, ` +
        `but the opening-balance entry carries Rs. ${over.ledger_pkr.toLocaleString()}. Correct the asset or the opening balances.`,
    );
  }
}

async function lastPostedMonth(tx: Tx, assetId: string): Promise<number | null> {
  const last = await tx.depreciationSchedule.findFirst({
    where: { fixedAssetId: assetId, status: 'POSTED' },
    orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
  });
  return last ? periodIndex({ year: last.periodYear, month: last.periodMonth }) : null;
}

/**
 * The first month an asset brought on at go-live depreciates: the opening-balance
 * entry already carries its accumulated depreciation up to that date, so the register
 * charges only months that end after it.
 */
async function firstMonthAfterOpening(tx: Tx, facilityId: string): Promise<number> {
  const opening = await tx.journalEntry.findFirst({
    where: { ...standingEntriesWhere(facilityId), sourceTable: 'opening_balances' },
    select: { entryDate: true },
  });
  if (!opening) {
    throw Errors.VALIDATION_ERROR(
      'This asset was brought on with the opening balances, but no opening-balance entry stands; enter it first',
    );
  }
  return lastFullMonthBy(opening.entryDate) + 1;
}

function carryingAmount(a: Asset): number {
  return round2(Number(a.purchaseCostPkr) - Number(a.accumulatedDepreciationPkr) - Number(a.accumulatedImpairmentPkr));
}

/** The status an asset's own figures give it while it stands on the register. */
function statusWhenStanding(a: Asset): 'PURCHASED' | 'IN_SERVICE' | 'WRITTEN_OFF' {
  if (Number(a.accumulatedImpairmentPkr) > MONEY_EPSILON && carryingAmount(a) <= MONEY_EPSILON) return 'WRITTEN_OFF';
  return a.depreciationStartDate ? 'IN_SERVICE' : 'PURCHASED';
}

function allowedActions(a: any, convertible: boolean): FixedAssetActionType[] {
  if (a.voidedAt) return [];
  if (convertible && a.status !== 'DISPOSED') return [...standingActions(a), 'convert_to_opening'];
  return standingActions(a);
}

function standingActions(a: any): FixedAssetActionType[] {
  const impaired = Number(a.accumulatedImpairmentPkr) > MONEY_EPSILON;
  const depreciated = (a.schedules ?? []).some((s: any) => s.status === 'POSTED');
  const untouched = !impaired && !depreciated;
  switch (a.status) {
    case 'PURCHASED':
      return ['commission', 'impair', 'dispose', ...(impaired ? (['reverse_impairment'] as const) : []), ...(untouched ? (['void'] as const) : [])];
    case 'IN_SERVICE':
      return [
        'impair',
        'dispose',
        ...(depreciated ? (['reverse_depreciation'] as const) : []),
        ...(impaired ? (['reverse_impairment'] as const) : []),
        ...(untouched ? (['void'] as const) : []),
      ];
    case 'WRITTEN_OFF':
      return ['dispose', 'reverse_impairment'];
    case 'DISPOSED':
      return ['reverse_disposal'];
    default:
      return [];
  }
}

function formatAssetSummary(a: any) {
  return {
    id: a.id,
    asset_number: a.assetNumber,
    asset_name: a.assetName,
    asset_category: a.assetCategory,
    purchase_date: a.purchaseDate.toISOString().slice(0, 10),
    purchase_cost_pkr: Number(a.purchaseCostPkr),
    accumulated_depreciation_pkr: Number(a.accumulatedDepreciationPkr),
    accumulated_impairment_pkr: Number(a.accumulatedImpairmentPkr),
    net_book_value_pkr: carryingAmount(a),
    depreciation_method: a.depreciationMethod,
    status: a.status,
    is_opening_balance: a.isOpeningBalance,
    voided_at: a.voidedAt?.toISOString() ?? null,
    book_type: a.bookType,
    created_at: a.createdAt.toISOString(),
    created_by_name: a.createdByUser?.name,
  };
}

function formatAsset(a: any, convertible = false) {
  return {
    ...formatAssetSummary(a),
    asset_account_code: a.assetAccountCode,
    accum_depr_account_code: a.accumDeprAccountCode,
    depr_expense_account_code: a.deprExpenseAccountCode,
    residual_value_pkr: Number(a.residualValuePkr),
    useful_life_years: a.usefulLifeYears ? Number(a.usefulLifeYears) : null,
    wdv_rate_percent: a.wdvRatePercent ? Number(a.wdvRatePercent) : null,
    depreciation_start_date: a.depreciationStartDate ? a.depreciationStartDate.toISOString().slice(0, 10) : null,
    disposal_date: a.disposalDate ? a.disposalDate.toISOString().slice(0, 10) : null,
    // A scrapped asset's proceeds are 0, not unknown (C-38).
    disposal_proceeds_pkr: a.disposalProceedsPkr === null ? null : Number(a.disposalProceedsPkr),
    purchase_journal_entry_id: a.purchaseJournalEntryId,
    disposal_journal_entry_id: a.disposalJournalEntryId,
    void_reason: a.voidReason ?? null,
    allowed_actions: allowedActions(a, convertible),
    notes: a.notes,
    schedules: (a.schedules ?? []).map((s: any) => ({
      period_year: s.periodYear,
      period_month: s.periodMonth,
      opening_nbv_pkr: Number(s.openingNbvPkr),
      depreciation_amount_pkr: Number(s.depreciationAmountPkr),
      closing_nbv_pkr: Number(s.closingNbvPkr),
      status: s.status,
      journal_entry_id: s.journalEntryId,
      posted_at: s.postedAt?.toISOString() ?? null,
    })),
  };
}
