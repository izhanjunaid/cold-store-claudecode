'use client';

import { createContext, useContext } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { fmtAcct, variance } from '@/lib/accounting-format';

const StatementCtx = createContext<{ compare: boolean }>({ compare: false });

interface StatementTableProps {
  compare?: boolean;
  currentLabel?: string;
  priorLabel?: string;
  children: React.ReactNode;
}

/** A financial-statement table: Description · Amount [· Prior · Variance]. */
export function StatementTable({ compare = false, currentLabel = 'Amount', priorLabel = 'Prior', children }: StatementTableProps) {
  return (
    <StatementCtx.Provider value={{ compare }}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="py-1 text-left font-medium" />
            <th className="w-40 py-1 text-right font-medium">{currentLabel}</th>
            {compare && <th className="w-40 py-1 text-right font-medium">{priorLabel}</th>}
            {compare && <th className="w-40 py-1 text-right font-medium">Variance</th>}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </StatementCtx.Provider>
  );
}

/** A section heading row (e.g. "Current Assets"). */
export function SectionHeading({ children }: { children: React.ReactNode }) {
  const { compare } = useContext(StatementCtx);
  return (
    <tr>
      <td colSpan={compare ? 4 : 2} className="pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}

export type RowEmphasis = 'line' | 'subtotal' | 'total' | 'grand';

interface StatementRowProps {
  label: string;
  code?: string;
  amount: number;
  prior?: number;
  depth?: number;
  emphasis?: RowEmphasis;
  /** Drill-down target (e.g. GL for this account). */
  href?: string;
}

export function StatementRow({ label, code, amount, prior, depth = 0, emphasis = 'line', href }: StatementRowProps) {
  const { compare } = useContext(StatementCtx);
  const v = prior !== undefined ? variance(amount, prior) : null;

  const rowCls = cn(
    emphasis === 'subtotal' && 'border-t',
    emphasis === 'total' && 'border-t-2 border-foreground/60',
    emphasis === 'grand' && 'border-t-4 border-double border-foreground/70',
  );
  const labelCls = cn(
    emphasis === 'total' || emphasis === 'grand' ? 'font-bold' : emphasis === 'subtotal' ? 'font-semibold' : undefined,
  );
  const amountCls = cn(
    'py-1 text-right tabular-nums',
    emphasis === 'subtotal' && 'font-semibold',
    (emphasis === 'total' || emphasis === 'grand') && 'font-bold',
  );

  return (
    <tr className={rowCls}>
      <td className={cn('py-1', labelCls)} style={{ paddingLeft: depth * 16 }}>
        {code && <span className="mr-2 font-mono text-xs text-muted-foreground">{code}</span>}
        {href ? (
          <Link href={href} className="hover:text-primary hover:underline">
            {label}
          </Link>
        ) : (
          label
        )}
      </td>
      <td className={amountCls}>{fmtAcct(amount)}</td>
      {compare && <td className="py-1 text-right tabular-nums text-muted-foreground">{fmtAcct(prior ?? 0)}</td>}
      {compare && (
        <td className="py-1 text-right text-xs tabular-nums text-muted-foreground">
          {v ? `${fmtAcct(v.abs)}${v.pct !== null ? ` (${v.pct.toFixed(1)}%)` : ''}` : '–'}
        </td>
      )}
    </tr>
  );
}

/** A blank spacer row for vertical rhythm between sections. */
export function SpacerRow() {
  const { compare } = useContext(StatementCtx);
  return (
    <tr aria-hidden>
      <td colSpan={compare ? 4 : 2} className="py-1.5" />
    </tr>
  );
}
