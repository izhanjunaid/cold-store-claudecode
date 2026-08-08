'use client';

import { Fragment, useEffect, useState } from 'react';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/layout/page-header';
import { StatementFrame, StatementSkeleton } from '@/components/accounting/statement-frame';
import { StatementToolbar } from '@/components/accounting/statement-toolbar';
import { StatementTable, SectionHeading, StatementRow, SpacerRow } from '@/components/accounting/statement';
import { RatiosStrip } from '@/components/accounting/ratios-strip';
import { useStatementPeriod } from '@/components/accounting/use-statement-period';
import { describePeriod } from '@/lib/fiscal-period';
import { fmtRatio, fmtAcct } from '@/lib/accounting-format';
import { buildCsv, downloadCsv } from '@/components/data-table/export-csv';
import { cn } from '@/lib/utils';

interface Line {
  account_code: string;
  account_name: string;
  amount_pkr: number;
}
interface Group {
  code: string;
  name: string;
  lines: Line[];
  subtotal_pkr: number;
}
interface BS {
  as_of_date: string;
  current_asset_groups: Group[];
  total_current_assets_pkr: number;
  non_current_asset_groups: Group[];
  total_non_current_assets_pkr: number;
  total_assets_pkr: number;
  current_liability_groups: Group[];
  total_current_liabilities_pkr: number;
  non_current_liability_groups: Group[];
  total_non_current_liabilities_pkr: number;
  total_liabilities_pkr: number;
  equity_lines: Line[];
  retained_earnings_pkr: number;
  prior_years_pl_pkr: number;
  current_year_pl_pkr: number;
  fiscal_year_start: string;
  total_equity_pkr: number;
  total_liabilities_and_equity_pkr: number;
  is_balanced: boolean;
  unclassified_asset_lines: Line[];
  unclassified_liability_lines: Line[];
  has_unclassified: boolean;
}

function groupMap(bs: BS | null): Map<string, number> {
  const m = new Map<string, number>();
  if (!bs) return m;
  for (const g of [...bs.current_asset_groups, ...bs.non_current_asset_groups, ...bs.current_liability_groups, ...bs.non_current_liability_groups]) {
    m.set(g.code, g.subtotal_pkr);
  }
  return m;
}
function lineMap(bs: BS | null): Map<string, number> {
  const m = new Map<string, number>();
  if (!bs) return m;
  const groups = [...bs.current_asset_groups, ...bs.non_current_asset_groups, ...bs.current_liability_groups, ...bs.non_current_liability_groups];
  for (const l of groups.flatMap((g) => g.lines)) m.set(l.account_code, l.amount_pkr);
  for (const l of bs.equity_lines) m.set(l.account_code, l.amount_pkr);
  for (const l of [...bs.unclassified_asset_lines, ...bs.unclassified_liability_lines]) m.set(l.account_code, l.amount_pkr);
  return m;
}

export default function BalanceSheetPage() {
  const { preset, setPreset, range, prior, setCustom, bookType, setBookType, compare, setCompare } = useStatementPeriod('ytd');
  const [data, setData] = useState<BS | null>(null);
  const [priorData, setPriorData] = useState<BS | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams({ as_of_date: range.as_of });
    if (bookType) p.set('book_type', bookType);
    apiClient<BS>(`/v1/accounting/balance-sheet?${p}`).then(setData).finally(() => setLoading(false));
  }, [range.as_of, bookType]);

  useEffect(() => {
    if (!compare) {
      setPriorData(null);
      return;
    }
    const p = new URLSearchParams({ as_of_date: prior.as_of });
    if (bookType) p.set('book_type', bookType);
    apiClient<BS>(`/v1/accounting/balance-sheet?${p}`).then(setPriorData).catch(() => setPriorData(null));
  }, [compare, prior.as_of, bookType]);

  const cmp = compare ? priorData : null;
  const priorLines = lineMap(cmp);
  const priorGroups = groupMap(cmp);
  const glHref = (code: string) => `/accounting/general-ledger?account_code=${code}&date_to=${range.as_of}${bookType ? `&book_type=${bookType}` : ''}`;
  const pl = (code: string) => (cmp ? priorLines.get(code) ?? 0 : undefined);
  const pg = (code: string) => (cmp ? priorGroups.get(code) ?? 0 : undefined);

  function renderGroups(groups: Group[]) {
    return groups.map((g) => (
      <Fragment key={g.code}>
        {g.lines.map((l) => (
          <StatementRow key={l.account_code} depth={1} code={l.account_code} label={l.account_name} amount={l.amount_pkr} prior={pl(l.account_code)} href={glHref(l.account_code)} />
        ))}
        <StatementRow depth={1} emphasis="subtotal" label={`Total ${g.name}`} amount={g.subtotal_pkr} prior={pg(g.code)} />
      </Fragment>
    ));
  }

  function exportCsv() {
    if (!data) return;
    type Row = { section: string; code: string; account: string; amount: number };
    const rows: Row[] = [];
    const push = (section: string, groups: Group[]) => {
      for (const g of groups) for (const l of g.lines) rows.push({ section: `${section} — ${g.name}`, code: l.account_code, account: l.account_name, amount: l.amount_pkr });
    };
    push('Current Assets', data.current_asset_groups);
    push('Non-current Assets', data.non_current_asset_groups);
    push('Current Liabilities', data.current_liability_groups);
    push('Non-current Liabilities', data.non_current_liability_groups);
    for (const l of data.unclassified_asset_lines) rows.push({ section: 'Assets — Unclassified', code: l.account_code, account: l.account_name, amount: l.amount_pkr });
    for (const l of data.unclassified_liability_lines) rows.push({ section: 'Liabilities — Unclassified', code: l.account_code, account: l.account_name, amount: l.amount_pkr });
    for (const l of data.equity_lines) rows.push({ section: 'Equity', code: l.account_code, account: l.account_name, amount: l.amount_pkr });
    rows.push({ section: 'Equity', code: '', account: "Retained Earnings (incl. prior years' results)", amount: data.retained_earnings_pkr });
    rows.push({ section: 'Equity', code: '', account: `Current Year Profit / (Loss) — FY from ${data.fiscal_year_start}`, amount: data.current_year_pl_pkr });
    const csv = buildCsv(rows, [
      { header: 'Section', value: (r) => r.section },
      { header: 'Code', value: (r) => r.code },
      { header: 'Account', value: (r) => r.account },
      { header: 'Amount (PKR)', value: (r) => r.amount },
    ]);
    downloadCsv(`balance-sheet-${range.as_of}`, csv);
  }

  // Liquidity / leverage ratios
  const ca = data?.total_current_assets_pkr ?? 0;
  const cl = data?.total_current_liabilities_pkr ?? 0;
  const ratios = data
    ? [
        { label: 'Current Ratio', value: fmtRatio(ca, cl), hint: 'Current assets ÷ current liabilities' },
        { label: 'Working Capital', value: `Rs ${fmtAcct(ca - cl)}` },
        { label: 'Debt-to-Equity', value: fmtRatio(data.total_liabilities_pkr, data.total_equity_pkr) },
        { label: 'Equity Ratio', value: fmtRatio(data.total_equity_pkr, data.total_assets_pkr) },
      ]
    : [];

  return (
    <div className="max-w-4xl">
      <PageHeader title="Balance Sheet" description="Statement of financial position — Assets = Liabilities + Equity" />

      <StatementToolbar
        mode="asof"
        preset={preset}
        onPresetChange={setPreset}
        range={range}
        onCustomChange={setCustom}
        bookType={bookType}
        onBookTypeChange={setBookType}
        compare={compare}
        onCompareChange={setCompare}
        onPrint={() => window.print()}
        onExportCsv={exportCsv}
      />

      {loading && !data ? (
        <StatementSkeleton />
      ) : !data ? null : (
        <div className="print-area space-y-4">
          <StatementFrame title="Statement of Financial Position" periodLabel={describePeriod(range, 'as_of')} bookType={bookType}>
            <StatementTable compare={compare} currentLabel={range.label} priorLabel={prior.label}>
              <SectionHeading>Assets</SectionHeading>
              <tr><td colSpan={compare ? 4 : 2} className="pt-1 pb-0.5 pl-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Current Assets</td></tr>
              {renderGroups(data.current_asset_groups)}
              <StatementRow emphasis="subtotal" label="Total Current Assets" amount={data.total_current_assets_pkr} prior={cmp?.total_current_assets_pkr} />
              {data.non_current_asset_groups.length > 0 && (
                <>
                  <tr><td colSpan={compare ? 4 : 2} className="pt-2 pb-0.5 pl-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Non-current Assets</td></tr>
                  {renderGroups(data.non_current_asset_groups)}
                  <StatementRow emphasis="subtotal" label="Total Non-current Assets" amount={data.total_non_current_assets_pkr} prior={cmp?.total_non_current_assets_pkr} />
                </>
              )}
              {data.unclassified_asset_lines.length > 0 && (
                <>
                  <tr><td colSpan={compare ? 4 : 2} className="pt-2 pb-0.5 pl-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Unclassified Assets — not under a standard header</td></tr>
                  {data.unclassified_asset_lines.map((l) => (
                    <StatementRow key={l.account_code} depth={1} code={l.account_code} label={l.account_name} amount={l.amount_pkr} prior={pl(l.account_code)} href={glHref(l.account_code)} />
                  ))}
                </>
              )}
              <StatementRow emphasis="grand" label="Total Assets" amount={data.total_assets_pkr} prior={cmp?.total_assets_pkr} />

              <SpacerRow />
              <SectionHeading>Liabilities &amp; Equity</SectionHeading>
              <tr><td colSpan={compare ? 4 : 2} className="pt-1 pb-0.5 pl-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Current Liabilities</td></tr>
              {renderGroups(data.current_liability_groups)}
              <StatementRow emphasis="subtotal" label="Total Current Liabilities" amount={data.total_current_liabilities_pkr} prior={cmp?.total_current_liabilities_pkr} />
              {data.non_current_liability_groups.length > 0 && (
                <>
                  <tr><td colSpan={compare ? 4 : 2} className="pt-2 pb-0.5 pl-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Non-current Liabilities</td></tr>
                  {renderGroups(data.non_current_liability_groups)}
                  <StatementRow emphasis="subtotal" label="Total Non-current Liabilities" amount={data.total_non_current_liabilities_pkr} prior={cmp?.total_non_current_liabilities_pkr} />
                </>
              )}
              {data.unclassified_liability_lines.length > 0 && (
                <>
                  <tr><td colSpan={compare ? 4 : 2} className="pt-2 pb-0.5 pl-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Unclassified Liabilities — not under a standard header</td></tr>
                  {data.unclassified_liability_lines.map((l) => (
                    <StatementRow key={l.account_code} depth={1} code={l.account_code} label={l.account_name} amount={l.amount_pkr} prior={pl(l.account_code)} href={glHref(l.account_code)} />
                  ))}
                </>
              )}
              <StatementRow emphasis="total" label="Total Liabilities" amount={data.total_liabilities_pkr} prior={cmp?.total_liabilities_pkr} />

              <tr><td colSpan={compare ? 4 : 2} className="pt-2 pb-0.5 pl-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Equity</td></tr>
              {data.equity_lines.map((l) => (
                <StatementRow key={l.account_code} depth={1} code={l.account_code} label={l.account_name} amount={l.amount_pkr} prior={pl(l.account_code)} href={glHref(l.account_code)} />
              ))}
              <StatementRow depth={1} label="Retained Earnings (incl. prior years' results)" amount={data.retained_earnings_pkr} prior={cmp?.retained_earnings_pkr} />
              <StatementRow depth={1} label={`Current Year Profit / (Loss) — FY from ${data.fiscal_year_start}`} amount={data.current_year_pl_pkr} prior={cmp?.current_year_pl_pkr} />
              <StatementRow emphasis="total" label="Total Equity" amount={data.total_equity_pkr} prior={cmp?.total_equity_pkr} />

              <StatementRow emphasis="grand" label="Total Liabilities &amp; Equity" amount={data.total_liabilities_and_equity_pkr} prior={cmp?.total_liabilities_and_equity_pkr} />
            </StatementTable>

            {data.has_unclassified && (
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                Unclassified amounts are included in Total Assets / Total Liabilities above, but
                <strong> not</strong> in Total Current Assets, Total Non-current Assets, Total
                Current Liabilities, or Total Non-current Liabilities — placing an account under
                current vs. non-current is an accounting judgement this report does not guess at.
                A current ratio or working-capital figure read off those subtotals will
                understate them until the account is placed. Move these accounts under a standard
                header (Chart of Accounts) to place them in a named section.
              </p>
            )}

            <div className={cn('mt-4 flex items-center justify-center gap-1.5 text-sm font-medium', data.is_balanced ? 'text-green-600' : 'text-destructive')}>
              {data.is_balanced ? <CheckCircle2 className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
              {data.is_balanced ? 'Balanced — Assets = Liabilities + Equity' : 'UNBALANCED — investigate'}
            </div>
          </StatementFrame>

          <RatiosStrip items={ratios} />
        </div>
      )}
    </div>
  );
}
