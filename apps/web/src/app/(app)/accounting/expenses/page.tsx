'use client';

import Link from 'next/link';
import { FileText, HandCoins, Landmark, Plus, Timer } from 'lucide-react';
import { useCan } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/page-header';

const LINKS = [
  { href: '/accounting/payables/bills', icon: FileText, title: 'Bills', text: 'What suppliers billed — each a cost at its own date.' },
  { href: '/accounting/payables/payments', icon: HandCoins, title: 'Supplier payments', text: 'Paying suppliers, with the tax withheld.' },
  { href: '/accounting/payables/aging', icon: Timer, title: 'Payables aging', text: 'What is owed to whom, and how overdue.' },
  { href: '/accounting/payables/tax-remittances', icon: Landmark, title: 'Tax & EOBI remittances', text: 'Paying over what was collected for the state.' },
];

/** Costs are recorded as supplier bills and paid through supplier payments (docs/25 Q3). */
export default function ExpensesPage() {
  const canRecord = useCan('expenses.record');

  if (!canRecord) {
    return (
      <div>
        <PageHeader title="Expenses & Payables" />
        <p className="text-muted-foreground">You don&apos;t have permission to view expenses.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Expenses & Payables"
        description="Costs are recorded as supplier bills and paid through supplier payments"
        actions={
          <Button asChild>
            <Link href="/accounting/payables/bills/new">
              <Plus className="h-4 w-4" aria-hidden />
              New bill
            </Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href}>
            <Card className="h-full p-3 transition-colors hover:bg-muted/50">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <l.icon className="h-4 w-4" aria-hidden />
                {l.title}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{l.text}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
