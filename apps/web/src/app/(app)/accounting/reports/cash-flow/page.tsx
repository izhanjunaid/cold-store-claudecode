'use client';

import { Fragment, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/layout/page-header';
import { OpeningBalanceNotice } from '@/components/opening-balance-notice';
import { StatementFrame, StatementSkeleton } from '@/components/accounting/statement-frame';
import { StatementToolbar } from '@/components/accounting/statement-toolbar';
import { StatementTable, SectionHeading, StatementRow, SpacerRow } from '@/components/accounting/statement';
import { useStatementPeriod } from '@/components/accounting/use-statement-period';
import { describePeriod } from '@/lib/fiscal-period';
import { fmtAcct } from '@/lib/accounting-format';
import { buildCsv, downloadCsv } from '@/components/data-table/export-csv';

interface Line {
  account_code: string;
  account_name: string;
  amount_pkr: number;
}

interface CashFlow {
  date_from: string;
  date_to: string;
  operating_lines: Line[];
  total_operating_pkr: number;
  investing_lines: Line[];
  total_investing_pkr: number;
  financing_lines: Line[];
  total_financing_pkr: number;
  net_change_pkr: number;
  opening_cash_pkr: number;
  closing_cash_pkr: number;
  cash_composition: Line[];
  cheques_in_hand_pkr: number;
  is_reconciled: boolean;
}

type SectionKey = 'operating' | 'investing' | 'financing';
const SECTIONS: { key: SectionKey; title: string }[] = [
  { key: 'operating', title: 'Operating activities' },
  { key: 'investing', title: 'Investing activities' },
  { key: 'financing', title: 'Financing activities' },
];

/**
 * Statement of cash flows, direct method, on the statement kit (docs/25 L-37):
 * fiscal-year presets, the book selector, a prior-year comparative, print and
 * CSV — the same toolbar every other statement has.
 */
export default function CashFlowPage() {
  const { preset, setPreset, range, prior, setCustom, bookType, setBookType, compare, setCompare } = useStatementPeriod('this_fy');
  const [data, setData] = useState<CashFlow | null>(null);
  const [priorData, setPriorData] = useState<CashFlow | null>(null);
  const [loading, setLoading] = useState(false);

  const query = (from: string, to: string) => {
    const p = new URLSearchParams({ date_from: from, date_to: to });
    if (bookType) p.set('book_type', bookType);
    return `/v1/accounting/cash-flow?${p}`;
  };

  useEffect(() => {
    setLoading(true);
    apiClient<CashFlow>(query(range.date_from, range.date_to)).then(setData).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.date_from, range.date_to, bookType]);

  useEffect(() => {
    if (!compare) {
      setPriorData(null);
      return;
    }
    apiClient<CashFlow>(query(prior.date_from, prior.date_to)).then(setPriorData).catch(() => setPriorData(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compare, prior.date_from, prior.date_to, bookType]);

  const cmp = compare ? priorData : null;
  const priorLine = (key: SectionKey, code: string) =>
    cmp ? (cmp[`${key}_lines`].find((l) => l.account_code === code)?.amount_pkr ?? 0) : undefined;
  const glHref = (code: string) =>
    `/accounting/general-ledger?account_code=${code}&date_from=${range.date_from}&date_to=${range.date_to}${bookType ? `&book_type=${bookType}` : ''}`;

  function exportCsv() {
    if (!data) return;
    const rows = SECTIONS.flatMap(({ key, title }) =>
      data[`${key}_lines`].map((l) => ({ section: title, code: l.account_code, account: l.account_name, amount: l.amount_pkr })),
    );
    rows.push(
      { section: 'Summary', code: '', account: 'Net change in cash', amount: data.net_change_pkr },
      { section: 'Summary', code: '', account: 'Cash and cash equivalents, opening', amount: data.opening_cash_pkr },
      { section: 'Summary', code: '', account: 'Cash and cash equivalents, closing', amount: data.closing_cash_pkr },
    );
    const csv = buildCsv(rows, [
      { header: 'Section', value: (r) => r.section },
      { header: 'Code', value: (r) => r.code },
      { header: 'Account', value: (r) => r.account },
      { header: 'Amount (PKR)', value: (r) => r.amount },
    ]);
    downloadCsv(`cash-flow-${range.date_from}_${range.date_to}`, csv);
  }

  return (
    <div className="max-w-4xl">
      <PageHeader title="Cash Flow" description="Statement of cash flows — where the money actually came from and went" />

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

      {data && !data.is_reconciled && (
        <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          This statement does not reconcile: opening cash plus the flows below does not equal cash and cash
          equivalents on the balance sheet. Treat the figures as unreliable and raise it.
        </p>
      )}

      {loading && !data ? (
        <StatementSkeleton />
      ) : !data ? null : (
        <div className="print-area space-y-4">
          <StatementFrame
            title="Statement of Cash Flows"
            periodLabel={describePeriod(range, 'period')}
            bookType={bookType}
            note={`Prepared on the direct method. Cheques in hand (Rs ${fmtAcct(data.cheques_in_hand_pkr)}) are not cash: a received cheque can still bounce, so it becomes cash only when it clears. Transfers between your own cash and bank accounts are not shown — they move money between pockets without changing how much there is.`}
          >
            <StatementTable compare={compare} currentLabel={range.label} priorLabel={prior.label}>
              {SECTIONS.map(({ key, title }) => (
                <Fragment key={key}>
                  <SectionHeading>{title}</SectionHeading>
                  {data[`${key}_lines`].map((l) => (
                    <StatementRow
                      key={l.account_code}
                      depth={1}
                      code={l.account_code}
                      label={l.account_name}
                      amount={l.amount_pkr}
                      prior={priorLine(key, l.account_code)}
                      href={glHref(l.account_code)}
                    />
                  ))}
                  <StatementRow
                    emphasis="subtotal"
                    label={`Net cash from ${title.toLowerCase()}`}
                    amount={data[`total_${key}_pkr`]}
                    prior={cmp?.[`total_${key}_pkr`]}
                  />
                </Fragment>
              ))}
              <SpacerRow />
              <StatementRow emphasis="total" label="Net change in cash" amount={data.net_change_pkr} prior={cmp?.net_change_pkr} />
              <StatementRow label="Cash and cash equivalents, opening" amount={data.opening_cash_pkr} prior={cmp?.opening_cash_pkr} />
              <StatementRow emphasis="grand" label="Cash and cash equivalents, closing" amount={data.closing_cash_pkr} prior={cmp?.closing_cash_pkr} />

              <SectionHeading>Composition of cash and cash equivalents</SectionHeading>
              {data.cash_composition.map((l) => (
                <StatementRow key={`comp-${l.account_code}`} depth={1} code={l.account_code} label={l.account_name} amount={l.amount_pkr} />
              ))}
            </StatementTable>
          </StatementFrame>
        </div>
      )}
    </div>
  );
}
