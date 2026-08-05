import type { PrismaClient, Prisma } from '@coldchain/db';
import { Errors } from '../../common/errors';
import { JournalEntryService } from '../accounting/journal-entry.service';
import { FixedAssetRepository } from './fixed-asset.repository';
import { generateFixedAssetNumber } from './fixed-asset-number';
import { ASSET_CATEGORY_ACCOUNT_DEFAULTS } from './templates/types';
import { DEFAULT_BANK_ACCOUNT_CODE } from '../accounting/templates/types';
import { buildJE12AssetPurchase } from './templates/je-12-asset-purchase';
import { buildJE13Depreciation } from './templates/je-13-depreciation';
import { buildJE14AssetDisposal } from './templates/je-14-asset-disposal';
import { computeMonthlyDepreciation } from './depreciation-calc';

type CreateInput = {
  asset_name: string;
  asset_category: 'COLD_PLANT' | 'BUILDING' | 'VEHICLE' | 'COMPUTER' | 'OTHER';
  purchase_date: string;
  purchase_cost_pkr: number;
  residual_value_pkr?: number;
  useful_life_years?: number;
  depreciation_method: 'SLM' | 'WDV';
  wdv_rate_percent?: number;
  paid_from_account_code?: string;
  asset_account_code?: string;
  accum_depr_account_code?: string;
  depr_expense_account_code?: string;
  book_type?: 'PACCI' | 'KATCHI';
  notes?: string;
};

type CommissionInput = {
  depreciation_start_date: string;
};

type DisposeInput = {
  disposal_date: string;
  disposal_proceeds_pkr: number;
  proceeds_account_code?: string;
};

type RunDepreciationInput = {
  period_year: number;
  period_month: number;
};

export class FixedAssetService {
  private repo: FixedAssetRepository;

  constructor(
    private prisma: PrismaClient,
    private journalEntry: JournalEntryService,
  ) {
    this.repo = new FixedAssetRepository(prisma);
  }

  async create(facilityId: string, userId: string, body: CreateInput) {
    const defaults = ASSET_CATEGORY_ACCOUNT_DEFAULTS[body.asset_category];
    const assetCode = body.asset_account_code ?? defaults.asset;
    const accumCode = body.accum_depr_account_code ?? defaults.accumDepr;
    const deprExpCode = body.depr_expense_account_code ?? defaults.deprExpense;
    const paidFrom = body.paid_from_account_code ?? DEFAULT_BANK_ACCOUNT_CODE;
    const bookType = body.book_type ?? 'PACCI';
    const purchaseDate = new Date(body.purchase_date);

    if (body.depreciation_method === 'SLM' && (!body.useful_life_years || body.useful_life_years <= 0)) {
      throw Errors.VALIDATION_ERROR('useful_life_years required for SLM', 'useful_life_years');
    }
    if (body.depreciation_method === 'WDV' && (!body.wdv_rate_percent || body.wdv_rate_percent <= 0)) {
      throw Errors.VALIDATION_ERROR('wdv_rate_percent required for WDV', 'wdv_rate_percent');
    }
    if (body.purchase_cost_pkr <= 0) {
      throw Errors.VALIDATION_ERROR('purchase_cost_pkr must be > 0', 'purchase_cost_pkr');
    }

    return this.prisma.$transaction(async (tx) => {
      const assetNumber = await generateFixedAssetNumber(tx, facilityId, purchaseDate);

      const asset = await tx.fixedAsset.create({
        data: {
          facilityId,
          assetNumber,
          assetName: body.asset_name,
          assetCategory: body.asset_category,
          assetAccountCode: assetCode,
          accumDeprAccountCode: accumCode,
          deprExpenseAccountCode: deprExpCode,
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

      // Post JE-12 (purchase)
      const draft = buildJE12AssetPurchase({
        assetId: asset.id,
        assetNumber: asset.assetNumber,
        assetName: asset.assetName,
        assetAccountCode: assetCode,
        paidFromAccountCode: paidFrom,
        costPkr: Number(asset.purchaseCostPkr),
        purchaseDate,
        bookType,
      });
      const posted = await this.journalEntry.postInTransaction(tx, facilityId, userId, draft, {
        postingStatus: 'POSTED',
      });
      await tx.fixedAsset.update({
        where: { id: asset.id },
        data: { purchaseJournalEntryId: posted.id },
      });

      const reloaded = await this.repo.findById(facilityId, asset.id, tx);
      return formatAsset(reloaded);
    });
  }

  async getById(facilityId: string, id: string) {
    const asset = await this.repo.findById(facilityId, id);
    if (!asset) throw Errors.FIXED_ASSET_NOT_FOUND();
    return formatAsset(asset);
  }

  async list(facilityId: string, query: { status?: string; category?: string; page: number; pageSize: number }) {
    const [data, total] = await this.repo.list(facilityId, query);
    return {
      data: data.map((a) => formatAssetSummary(a)),
      meta: { total, page: query.page, per_page: query.pageSize },
    };
  }

  async commission(facilityId: string, id: string, body: CommissionInput) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.fixedAsset.findFirst({ where: { facilityId, id } });
      if (!asset) throw Errors.FIXED_ASSET_NOT_FOUND();
      if (asset.status !== 'PURCHASED') {
        throw Errors.FIXED_ASSET_INVALID_STATUS(
          `Cannot commission asset in status ${asset.status}; must be PURCHASED`,
        );
      }

      const startDate = new Date(body.depreciation_start_date);
      await tx.fixedAsset.update({
        where: { id },
        data: {
          status: 'IN_SERVICE',
          depreciationStartDate: startDate,
        },
      });
      const reloaded = await this.repo.findById(facilityId, id, tx);
      return formatAsset(reloaded);
    });
  }

  async dispose(facilityId: string, userId: string, id: string, body: DisposeInput) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.fixedAsset.findFirst({ where: { facilityId, id } });
      if (!asset) throw Errors.FIXED_ASSET_NOT_FOUND();
      if (asset.status === 'DISPOSED' || asset.status === 'WRITTEN_OFF') {
        throw Errors.FIXED_ASSET_INVALID_STATUS(`Asset already ${asset.status}`);
      }

      const proceedsAccount = body.proceeds_account_code ?? DEFAULT_BANK_ACCOUNT_CODE;
      const disposalDate = new Date(body.disposal_date);
      const cost = Number(asset.purchaseCostPkr);
      const accum = Number(asset.accumulatedDepreciationPkr);
      const proceeds = body.disposal_proceeds_pkr;

      const draft = buildJE14AssetDisposal({
        assetId: asset.id,
        assetNumber: asset.assetNumber,
        assetName: asset.assetName,
        assetAccountCode: asset.assetAccountCode,
        accumDeprAccountCode: asset.accumDeprAccountCode,
        proceedsAccountCode: proceedsAccount,
        disposalDate,
        costPkr: cost,
        accumDeprPkr: accum,
        proceedsPkr: proceeds,
        bookType: asset.bookType,
      });
      const posted = await this.journalEntry.postInTransaction(tx, facilityId, userId, draft, {
        postingStatus: 'POSTED',
      });

      await tx.fixedAsset.update({
        where: { id },
        data: {
          status: 'DISPOSED',
          disposalDate,
          disposalProceedsPkr: proceeds,
          disposalJournalEntryId: posted.id,
        },
      });

      const reloaded = await this.repo.findById(facilityId, id, tx);
      return formatAsset(reloaded);
    });
  }

  /**
   * Undo a disposal posted in error (audit P1-3).
   *
   * Mirrors the invoice VOID pattern: post a reversing entry for JE-14, cross-link both
   * ways, and restore the asset — rather than mutating the posted entry, which the DB
   * guard triggers forbid. `JournalEntryService.reverse` cannot be used: it rejects any
   * entry whose sourceTable is not 'manual'/'opening_balances', and JE-14 stamps
   * 'fixed_assets'.
   *
   * The prior status is derived rather than stored: `commission()` is the only writer of
   * depreciationStartDate, so its presence means the asset had reached IN_SERVICE.
   * Accumulated depreciation needs no repair — JE-14 credited the contra account on
   * disposal and this reversal debits it straight back; no schedule rows were deleted.
   */
  async reverseDisposal(facilityId: string, userId: string, id: string, body: any) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT id FROM fixed_assets WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
        id,
        facilityId,
      );

      const asset = await tx.fixedAsset.findFirst({ where: { facilityId, id } });
      if (!asset) throw Errors.FIXED_ASSET_NOT_FOUND();
      if (asset.status !== 'DISPOSED') {
        throw Errors.ASSET_NOT_REVERSIBLE(
          `Only a DISPOSED asset can have its disposal reversed (this one is ${asset.status})`,
        );
      }
      if (!asset.disposalJournalEntryId) {
        throw Errors.ASSET_NOT_REVERSIBLE('Disposal has no journal entry to reverse');
      }

      const original = await tx.journalEntry.findFirstOrThrow({
        where: { id: asset.disposalJournalEntryId, facilityId },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });
      if (original.postingStatus === 'REVERSED') {
        throw Errors.ASSET_NOT_REVERSIBLE('Disposal entry has already been reversed');
      }

      const reversalDate = body?.reversal_date ? new Date(body.reversal_date) : new Date();

      const reversal = await this.journalEntry.postInTransaction(
        tx,
        facilityId,
        userId,
        {
          entryType: 'REVERSAL',
          bookType: original.bookType as 'PACCI' | 'KATCHI',
          sourceTable: 'fixed_assets',
          sourceId: id,
          entryDate: reversalDate,
          description: `Reversal of disposal ${original.entryNumber} (${asset.assetNumber}) — ${body.reason}`,
          lines: original.lines.map((l) => ({
            accountCode: l.accountCode,
            debitAmount: Number(l.creditAmount),
            creditAmount: Number(l.debitAmount),
            partyId: l.partyId,
            lotId: l.lotId,
            description: l.description ?? undefined,
          })),
        },
        { postingStatus: 'POSTED' },
      );
      await this.journalEntry.markReversed(tx, original.id, reversal.id);

      const tag = `[DISPOSAL REVERSED ${reversalDate.toISOString().slice(0, 10)}]: ${body.reason}`;
      await tx.fixedAsset.update({
        where: { id },
        data: {
          status: asset.depreciationStartDate ? 'IN_SERVICE' : 'PURCHASED',
          disposalDate: null,
          disposalProceedsPkr: null,
          disposalJournalEntryId: null,
          notes: asset.notes ? `${asset.notes}\n${tag}` : tag,
        },
      });

      const reloaded = await this.repo.findById(facilityId, id, tx);
      return formatAsset(reloaded);
    });
  }

  /**
   * Run monthly depreciation batch for the given period across all IN_SERVICE assets.
   * Idempotent: schedule rows are unique on (asset, year, month) and only created if missing.
   * Once a schedule row is POSTED, re-running for the same period throws DEPRECIATION_ALREADY_POSTED.
   */
  async runMonthlyDepreciation(facilityId: string, userId: string, body: RunDepreciationInput) {
    const { period_year: year, period_month: month } = body;

    return this.prisma.$transaction(
      async (tx) => {
      const assets = await tx.fixedAsset.findMany({
        where: { facilityId, status: 'IN_SERVICE' },
        orderBy: { assetNumber: 'asc' },
      });

      if (assets.length === 0) throw Errors.DEPRECIATION_NOTHING_TO_RUN();

      // Reject if any asset already has a POSTED row for this period
      const existing = await tx.depreciationSchedule.findMany({
        where: {
          fixedAssetId: { in: assets.map((a) => a.id) },
          periodYear: year,
          periodMonth: month,
        },
      });
      if (existing.some((e) => e.status === 'POSTED')) {
        throw Errors.DEPRECIATION_ALREADY_POSTED();
      }

      // Reject running out of order: any asset that would have produced a
      // nonzero depreciation row last period must have a POSTED row for it
      // first. Scoped to per-asset eligibility (not "facility's last posted
      // period + 1") so a calendar gap with zero IN_SERVICE assets — which
      // can never be posted at all, see DEPRECIATION_NOTHING_TO_RUN above —
      // doesn't permanently block the next real run.
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      const eligibleLastPeriod = assets.filter((a) => {
        if (!a.depreciationStartDate) return false;
        const opening = Number(a.purchaseCostPkr) - Number(a.accumulatedDepreciationPkr);
        const row = computeMonthlyDepreciation({
          method: a.depreciationMethod,
          costPkr: Number(a.purchaseCostPkr),
          residualValuePkr: Number(a.residualValuePkr),
          usefulLifeYears: a.usefulLifeYears ? Number(a.usefulLifeYears) : null,
          wdvRatePercent: a.wdvRatePercent ? Number(a.wdvRatePercent) : null,
          depreciationStartDate: a.depreciationStartDate,
          periodYear: prevYear,
          periodMonth: prevMonth,
          openingNbvPkr: opening,
        });
        return row.depreciationAmountPkr > 0;
      });
      if (eligibleLastPeriod.length > 0) {
        const prevPosted = await tx.depreciationSchedule.findMany({
          where: {
            fixedAssetId: { in: eligibleLastPeriod.map((a) => a.id) },
            periodYear: prevYear,
            periodMonth: prevMonth,
            status: 'POSTED',
          },
          select: { fixedAssetId: true },
        });
        const postedIds = new Set(prevPosted.map((p) => p.fixedAssetId));
        if (eligibleLastPeriod.some((a) => !postedIds.has(a.id))) {
          throw Errors.DEPRECIATION_PRIOR_PERIOD_NOT_POSTED();
        }
      }

      const results: Array<{
        asset_id: string;
        asset_number: string;
        depreciation_amount_pkr: number;
        journal_entry_id: string;
      }> = [];

      for (const asset of assets) {
        if (!asset.depreciationStartDate) continue;
        const opening = Number(asset.purchaseCostPkr) - Number(asset.accumulatedDepreciationPkr);
        const row = computeMonthlyDepreciation({
          method: asset.depreciationMethod,
          costPkr: Number(asset.purchaseCostPkr),
          residualValuePkr: Number(asset.residualValuePkr),
          usefulLifeYears: asset.usefulLifeYears ? Number(asset.usefulLifeYears) : null,
          wdvRatePercent: asset.wdvRatePercent ? Number(asset.wdvRatePercent) : null,
          depreciationStartDate: asset.depreciationStartDate,
          periodYear: year,
          periodMonth: month,
          openingNbvPkr: opening,
        });

        if (row.depreciationAmountPkr <= 0) continue;

        const draft = buildJE13Depreciation({
          assetId: asset.id,
          assetNumber: asset.assetNumber,
          assetName: asset.assetName,
          deprExpenseAccountCode: asset.deprExpenseAccountCode,
          accumDeprAccountCode: asset.accumDeprAccountCode,
          periodYear: year,
          periodMonth: month,
          amountPkr: row.depreciationAmountPkr,
          bookType: asset.bookType,
        });
        const posted = await this.journalEntry.postInTransaction(tx, facilityId, userId, draft, {
          postingStatus: 'POSTED',
        });

        await tx.depreciationSchedule.upsert({
          where: {
            fixedAssetId_periodYear_periodMonth: {
              fixedAssetId: asset.id,
              periodYear: year,
              periodMonth: month,
            },
          },
          create: {
            fixedAssetId: asset.id,
            periodYear: year,
            periodMonth: month,
            openingNbvPkr: row.openingNbvPkr,
            depreciationAmountPkr: row.depreciationAmountPkr,
            closingNbvPkr: row.closingNbvPkr,
            status: 'POSTED',
            journalEntryId: posted.id,
            postedAt: new Date(),
          },
          update: {
            openingNbvPkr: row.openingNbvPkr,
            depreciationAmountPkr: row.depreciationAmountPkr,
            closingNbvPkr: row.closingNbvPkr,
            status: 'POSTED',
            journalEntryId: posted.id,
            postedAt: new Date(),
          },
        });

        await tx.fixedAsset.update({
          where: { id: asset.id },
          data: {
            accumulatedDepreciationPkr: {
              increment: row.depreciationAmountPkr,
            },
          },
        });

        results.push({
          asset_id: asset.id,
          asset_number: asset.assetNumber,
          depreciation_amount_pkr: row.depreciationAmountPkr,
          journal_entry_id: posted.id,
        });
      }

      if (results.length === 0) throw Errors.DEPRECIATION_NOTHING_TO_RUN();

      return {
        period_year: year,
        period_month: month,
        run_count: results.length,
        total_depreciation_pkr: round2(
          results.reduce((s, r) => s + r.depreciation_amount_pkr, 0),
        ),
        entries: results,
      };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  }

  async listRuns(facilityId: string) {
    const rows = await this.prisma.depreciationSchedule.groupBy({
      by: ['periodYear', 'periodMonth'],
      where: {
        fixedAsset: { facilityId },
        status: 'POSTED',
      },
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
    net_book_value_pkr: round2(Number(a.purchaseCostPkr) - Number(a.accumulatedDepreciationPkr)),
    depreciation_method: a.depreciationMethod,
    status: a.status,
    book_type: a.bookType,
    created_at: a.createdAt.toISOString(),
    created_by_name: a.createdByUser?.name,
  };
}

function formatAsset(a: any) {
  return {
    ...formatAssetSummary(a),
    asset_account_code: a.assetAccountCode,
    accum_depr_account_code: a.accumDeprAccountCode,
    depr_expense_account_code: a.deprExpenseAccountCode,
    residual_value_pkr: Number(a.residualValuePkr),
    useful_life_years: a.usefulLifeYears ? Number(a.usefulLifeYears) : null,
    wdv_rate_percent: a.wdvRatePercent ? Number(a.wdvRatePercent) : null,
    depreciation_start_date: a.depreciationStartDate
      ? a.depreciationStartDate.toISOString().slice(0, 10)
      : null,
    disposal_date: a.disposalDate ? a.disposalDate.toISOString().slice(0, 10) : null,
    disposal_proceeds_pkr: a.disposalProceedsPkr ? Number(a.disposalProceedsPkr) : null,
    purchase_journal_entry_id: a.purchaseJournalEntryId,
    disposal_journal_entry_id: a.disposalJournalEntryId,
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
