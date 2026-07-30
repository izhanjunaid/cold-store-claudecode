'use client';

import Link from 'next/link';
import {
  BookOpenText,
  Building2,
  CalendarClock,
  ClipboardList,
  Coins,
  FileBarChart,
  FilePlus2,
  HandCoins,
  Layers,
  LockKeyhole,
  ReceiptText,
  Scale,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/page-header';

interface AcctCard {
  title: string;
  href: string;
  description: string;
  icon: LucideIcon;
}

const cards: AcctCard[] = [
  { title: 'Chart of Accounts', href: '/accounting/chart-of-accounts', icon: Layers, description: 'View the standard chart of accounts.' },
  { title: 'Journal Entries', href: '/accounting/journal-entries', icon: BookOpenText, description: 'Browse all journal entries — auto-posted and manual.' },
  { title: 'General Ledger', href: '/accounting/general-ledger', icon: ClipboardList, description: 'Drill into a single account to see every line that hit it.' },
  { title: 'Period Locks', href: '/accounting/period-locks', icon: LockKeyhole, description: 'Close finished months so nothing can be posted into them.' },
  { title: 'Opening Balances', href: '/accounting/opening-balances', icon: FilePlus2, description: 'Bring balances from your paper registers into the system at go-live.' },
  { title: 'Trial Balance', href: '/accounting/reports/trial-balance', icon: Scale, description: 'Verify debits = credits across all accounts.' },
  { title: 'Profit & Loss', href: '/accounting/reports/profit-loss', icon: FileBarChart, description: 'Revenue, cost of service, and net profit for any period.' },
  { title: 'Balance Sheet', href: '/accounting/reports/balance-sheet', icon: FileBarChart, description: 'Assets = Liabilities + Equity, as of any date.' },
  { title: 'Fixed Assets', href: '/accounting/fixed-assets', icon: Building2, description: 'Register, commission, and dispose of plant, building and vehicle assets.' },
  { title: 'Depreciation Runs', href: '/accounting/fixed-assets/runs', icon: CalendarClock, description: 'Run monthly depreciation (JE-13) and review past runs.' },
  { title: 'Employees', href: '/accounting/payroll/employees', icon: Users, description: 'Manage salaried staff and daily-wage workers, with EOBI registration.' },
  { title: 'Payroll Runs', href: '/accounting/payroll/runs', icon: Wallet, description: 'Create monthly payroll runs, finalize, pay and remit.' },
  { title: 'Employee Advances', href: '/accounting/payroll/advances', icon: HandCoins, description: 'Issue cash advances against salary and track recovery through payroll.' },
  { title: 'Expense Vouchers', href: '/accounting/expenses', icon: ReceiptText, description: 'Record, approve, accrue, and pay operating expenses.' },
];

export default function AccountingHomePage() {
  return (
    <div>
      <PageHeader title="Accounting" description="General ledger, financial statements, fixed assets, payroll and expenses" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Link key={c.href} href={c.href} className="group">
              <Card className="h-full transition-colors group-hover:border-primary/40">
                <CardHeader className="flex-row items-center gap-3 space-y-0">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <CardTitle className="text-base">{c.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{c.description}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
