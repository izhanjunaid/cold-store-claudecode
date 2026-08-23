'use client';

import { Fragment, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/layout/page-header';
import { OpeningBalanceNotice } from '@/components/opening-balance-notice';
import { StatementFrame, StatementSkeleton } from '@/components/accounting/statement-frame';
import { StatementToolbar } from '@/components/accounting/statement-toolbar';
import { StatementTable, SectionHeading, StatementRow, SpacerRow } from '@/components/accounting/statement';
import { RatiosStrip } from '@/components/accounting/ratios-strip';
import { useStatementPeriod } from '@/components/accounting/use-statement-period';
import { useFacility } from '@/hooks/use-reference-data';
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
  gross_profit_pct: number | null;
  operating_expense_lines: Line[];
  total_operating_expense_pkr: number;
  operating_profit_pkr: number;
  operating_profit_pct: number | null;
  other_income_lines: Line[];
  total_other_income_pkr: number;
  other_expense_lines: Line[];
  total_other_expense_pkr: number;
  depreciation_amortisation_pkr: number;
  ebitda_pkr: number;
  ebitda_pct: number | null;
  net_profit_pkr: number;
  net_profit_pct: number | null;
  opening_equity_pkr: number;
  drawings_pkr: number;
  closing_equity_pkr: number;
  is_fiscal_year_to_date: boolean;
  unclassified_lines: Line[];
  total_unclassified_pkr: number;
  has_unclassified: boolean;
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
    ...pl.other_expense_lines,
    ...pl.unclassified_lines,
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
  const facility = useFacility();

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
  // The basis note must describe the policy actually in force. Saying "no
  // month-end accrual is made" on a facility that runs JE-25 is a false
  // statement on the face of the statement, which is the one place it matters.
  const accrual = facility.data?.settings?.revenue_accrual?.enabled ?? false;
  const basisNote = accrual
    ? 'Storage revenue is recognized as it is earned: at each period end an accrual (JE-25) brings unbilled storage into revenue, and it is reversed when the invoice is raised, so a month shows the storage it actually provided.'
    : 'Storage revenue is recognized when invoiced (typically at withdrawal); no month-end accrual is made. During the storage season a month can show low revenue against full running costs — the revenue arrives in the months lots are dispatched.';
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
    for (const l of data.other_expense_lines) rows.push({ section: 'Other Expense', code: l.account_code, account: l.account_name, amount: -l.amount_pkr });
    for (const l of data.unclassified_lines) rows.push({ section: 'Unclassified', code: l.account_code, account: l.account_name, amount: l.amount_pkr });
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

      <OpeningBalanceNotice context="statement" />

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
          <StatementFrame
            title="Statement of Profit or Loss"
            periodLabel={describePeriod(range, 'period')}
            bookType={bookType}
            note={basisNote}
          >
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

              {data.other_expense_lines.length > 0 && (
                <>
                  <SpacerRow />
                  <SectionHeading>Other Expense</SectionHeading>
                  {data.other_expense_lines.map((l) => (
                    <StatementRow key={l.account_code} depth={1} code={l.account_code} label={l.account_name} amount={-l.amount_pkr} prior={cmp ? -(priorLines.get(l.account_code) ?? 0) : undefined} href={glHref(l.account_code)} />
                  ))}
                </>
              )}

              {data.has_unclassified && (
                <>
                  <SpacerRow />
                  <SectionHeading>Unclassified — not under a standard header</SectionHeading>
                  {data.unclassified_lines.map((l) => (
                    <StatementRow key={l.account_code} depth={1} code={l.account_code} label={l.account_name} amount={l.amount_pkr} prior={pl(l.account_code)} href={glHref(l.account_code)} />
                  ))}
                  <StatementRow depth={1} emphasis="subtotal" label="Total Unclassified" amount={data.total_unclassified_pkr} prior={cmp?.total_unclassified_pkr} />
                </>
              )}

              <StatementRow emphasis="grand" label={data.net_profit_pkr >= 0 ? 'Net Profit' : 'Net Loss'} amount={data.net_profit_pkr} prior={cmp?.net_profit_pkr} />

              {data.is_fiscal_year_to_date && (
                <>
                  <SpacerRow />
                  <SectionHeading>Owner&apos;s Equity — fiscal year to date</SectionHeading>
                  <StatementRow depth={1} label="Owner's equity, opening" amount={data.opening_equity_pkr} prior={cmp?.opening_equity_pkr} />
                  <StatementRow depth={1} label={data.net_profit_pkr >= 0 ? 'Add: profit for the period' : 'Less: loss for the period'} amount={data.net_profit_pkr} prior={cmp?.net_profit_pkr} />
                  <StatementRow depth={1} code="3015" label="Less: owner's drawings" amount={-data.drawings_pkr} prior={cmp ? -cmp.drawings_pkr : undefined} href={glHref('3015')} />
                  <StatementRow emphasis="total" label="Owner's equity, closing" amount={data.closing_equity_pkr} prior={cmp?.closing_equity_pkr} />
                </>
              )}
            </StatementTable>

            {data.is_fiscal_year_to_date && (
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                Closing equity ties to Total Equity on the balance sheet at the period end. These rows
                are fiscal-year-to-date: equity carries the year&apos;s profit, not this range&apos;s, so
                they appear only for a range starting on the fiscal-year start.
              </p>
            )}

            {data.has_unclassified && (
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                Unclassified amounts are included in net profit, shown as their contribution to it.
                Move these accounts under a standard header (Chart of Accounts) to place them in a
                named section.
              </p>
            )}
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
