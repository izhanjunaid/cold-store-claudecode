'use client';

import { Fragment, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/layout/page-header';
import { StatementFrame, StatementSkeleton } from '@/components/accounting/statement-frame';
import { StatementToolbar } from '@/components/accounting/statement-toolbar';
import { StatementTable, SectionHeading, StatementRow, SpacerRow } from '@/components/accounting/statement';
import { RatiosStrip } from '@/components/accounting/ratios-strip';
import { useStatementPeriod } from '@/components/accounting/use-statement-period';
import { describePeriod } from '@/lib/fiscal-period';
import { fmtPct, fmtAcct } from '@/lib/accounting-format';
import { buildCsv, downloadCsv } from '@/components/data-table/export-csv';

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
interface PL {
  date_from: string;
  date_to: string;
  revenue_groups: Group[];
  total_operating_revenue_pkr: number;
  contra_revenue_lines: Line[];
  total_contra_revenue_pkr: number;
  net_revenue_pkr: number;
  cost_of_service_lines: Line[];
  total_cost_of_service_pkr: number;
  gross_profit_pkr: number;
  gross_profit_pct: number;
  operating_expense_lines: Line[];
  total_operating_expense_pkr: number;
  operating_profit_pkr: number;
  operating_profit_pct: number;
  other_income_lines: Line[];
  total_other_income_pkr: number;
  depreciation_amortisation_pkr: number;
  ebitda_pkr: number;
  ebitda_pct: number;
  net_profit_pkr: number;
  net_profit_pct: number;
}

function lineMap(pl: PL | null): Map<string, number> {
  const m = new Map<string, number>();
  if (!pl) return m;
  for (const l of [
    ...pl.revenue_groups.flatMap((g) => g.lines),
    ...pl.contra_revenue_lines,
    ...pl.cost_of_service_lines,
    ...pl.operating_expense_lines,
    ...pl.other_income_lines,
  ]) {
    m.set(l.account_code, l.amount_pkr);
  }
  return m;
}

export default function ProfitLossPage() {
  const { preset, setPreset, range, prior, setCustom, bookType, setBookType, compare, setCompare } = useStatementPeriod('this_fy');
  const [data, setData] = useState<PL | null>(null);
  const [priorData, setPriorData] = useState<PL | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams({ date_from: range.date_from, date_to: range.date_to });
    if (bookType) p.set('book_type', bookType);
    apiClient<PL>(`/v1/accounting/profit-loss?${p}`).then(setData).finally(() => setLoading(false));
  }, [range.date_from, range.date_to, bookType]);

  useEffect(() => {
    if (!compare) {
      setPriorData(null);
      return;
    }
    const p = new URLSearchParams({ date_from: prior.date_from, date_to: prior.date_to });
    if (bookType) p.set('book_type', bookType);
    apiClient<PL>(`/v1/accounting/profit-loss?${p}`).then(setPriorData).catch(() => setPriorData(null));
  }, [compare, prior.date_from, prior.date_to, bookType]);

  const cmp = compare ? priorData : null;
  const priorLines = lineMap(cmp);
  const glHref = (code: string) =>
    `/accounting/general-ledger?account_code=${code}&date_from=${range.date_from}&date_to=${range.date_to}${bookType ? `&book_type=${bookType}` : ''}`;
  const pl = (code: string) => (cmp ? priorLines.get(code) ?? 0 : undefined);

  function exportCsv() {
    if (!data) return;
    type Row = { section: string; code: string; account: string; amount: number };
    const rows: Row[] = [];
    for (const g of data.revenue_groups) for (const l of g.lines) rows.push({ section: g.name, code: l.account_code, account: l.account_name, amount: l.amount_pkr });
    for (const l of data.contra_revenue_lines) rows.push({ section: 'Contra Revenue', code: l.account_code, account: l.account_name, amount: -l.amount_pkr });
    for (const l of data.cost_of_service_lines) rows.push({ section: 'Cost of Service', code: l.account_code, account: l.account_name, amount: l.amount_pkr });
    for (const l of data.operating_expense_lines) rows.push({ section: 'Operating Expenses', code: l.account_code, account: l.account_name, amount: l.amount_pkr });
    for (const l of data.other_income_lines) rows.push({ section: 'Other Income', code: l.account_code, account: l.account_name, amount: l.amount_pkr });
    const csv = buildCsv(rows, [
      { header: 'Section', value: (r) => r.section },
      { header: 'Code', value: (r) => r.code },
      { header: 'Account', value: (r) => r.account },
      { header: 'Amount (PKR)', value: (r) => r.amount },
    ]);
    downloadCsv(`profit-loss-${range.date_from}_${range.date_to}`, csv);
  }

  return (
    <div className="max-w-4xl">
      <PageHeader title="Profit &amp; Loss" description="Income statement — revenue, cost of service and profit" />

      <StatementToolbar
        mode="range"
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
          <StatementFrame title="Statement of Profit or Loss" periodLabel={describePeriod(range, 'period')} bookType={bookType}>
            <StatementTable compare={compare} currentLabel={range.label} priorLabel={prior.label}>
              <SectionHeading>Revenue</SectionHeading>
              {data.revenue_groups.map((g) => (
                <Fragment key={g.code}>
                  {g.lines.map((l) => (
                    <StatementRow key={l.account_code} depth={1} code={l.account_code} label={l.account_name} amount={l.amount_pkr} prior={pl(l.account_code)} href={glHref(l.account_code)} />
                  ))}
                  <StatementRow depth={1} emphasis="subtotal" label={`Total ${g.name}`} amount={g.subtotal_pkr} prior={cmp?.revenue_groups.find((x) => x.code === g.code)?.subtotal_pkr ?? (cmp ? 0 : undefined)} />
                </Fragment>
              ))}
              {data.contra_revenue_lines.map((l) => (
                <StatementRow key={l.account_code} depth={1} code={l.account_code} label={`Less: ${l.account_name}`} amount={-l.amount_pkr} prior={cmp ? -(priorLines.get(l.account_code) ?? 0) : undefined} href={glHref(l.account_code)} />
              ))}
              <StatementRow emphasis="subtotal" label="Net Revenue" amount={data.net_revenue_pkr} prior={cmp?.net_revenue_pkr} />

              <SpacerRow />
              <SectionHeading>Cost of Service</SectionHeading>
              {data.cost_of_service_lines.map((l) => (
                <StatementRow key={l.account_code} depth={1} code={l.account_code} label={l.account_name} amount={-l.amount_pkr} prior={cmp ? -(priorLines.get(l.account_code) ?? 0) : undefined} href={glHref(l.account_code)} />
              ))}
              <StatementRow emphasis="total" label="Gross Profit" amount={data.gross_profit_pkr} prior={cmp?.gross_profit_pkr} />

              <SpacerRow />
              <SectionHeading>Operating Expenses</SectionHeading>
              {data.operating_expense_lines.map((l) => (
                <StatementRow key={l.account_code} depth={1} code={l.account_code} label={l.account_name} amount={-l.amount_pkr} prior={cmp ? -(priorLines.get(l.account_code) ?? 0) : undefined} href={glHref(l.account_code)} />
              ))}
              <StatementRow emphasis="total" label="Operating Profit (EBIT)" amount={data.operating_profit_pkr} prior={cmp?.operating_profit_pkr} />

              {data.other_income_lines.length > 0 && (
                <>
                  <SpacerRow />
                  <SectionHeading>Other Income</SectionHeading>
                  {data.other_income_lines.map((l) => (
                    <StatementRow key={l.account_code} depth={1} code={l.account_code} label={l.account_name} amount={l.amount_pkr} prior={pl(l.account_code)} href={glHref(l.account_code)} />
                  ))}
                </>
              )}

              <StatementRow emphasis="grand" label={data.net_profit_pkr >= 0 ? 'Net Profit' : 'Net Loss'} amount={data.net_profit_pkr} prior={cmp?.net_profit_pkr} />
            </StatementTable>
          </StatementFrame>

          <RatiosStrip
            items={[
              { label: 'Gross Margin', value: fmtPct(data.gross_profit_pct) },
              { label: 'Operating Margin', value: fmtPct(data.operating_profit_pct) },
              { label: 'Net Margin', value: fmtPct(data.net_profit_pct) },
              { label: 'EBITDA', value: `Rs ${fmtAcct(data.ebitda_pkr)}`, hint: `${fmtPct(data.ebitda_pct)} margin` },
            ]}
          />
        </div>
      )}
    </div>
  );
}
