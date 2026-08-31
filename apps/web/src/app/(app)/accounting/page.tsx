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
import { PageHeader } from '@/components/layout/page-header';

interface AcctLink {
  title: string;
  href: string;
  description: string;
  icon: LucideIcon;
}
interface AcctGroup {
  label: string;
  links: AcctLink[];
}

const groups: AcctGroup[] = [
  {
    label: 'Ledger',
    links: [
      { title: 'Chart of Accounts', href: '/accounting/chart-of-accounts', icon: Layers, description: 'The account structure and current balances.' },
      { title: 'Journal Entries', href: '/accounting/journal-entries', icon: BookOpenText, description: 'Auto-posted and manual ledger entries.' },
      { title: 'General Ledger', href: '/accounting/general-ledger', icon: ClipboardList, description: 'Every line that hit a single account.' },
      { title: 'Period Locks', href: '/accounting/period-locks', icon: LockKeyhole, description: 'Close finished months so nothing can be posted into them.' },
      { title: 'Opening Balances', href: '/accounting/opening-balances', icon: FilePlus2, description: 'Bring balances forward at go-live.' },
      { title: 'Revenue Accrual', href: '/accounting/revenue-accrual', icon: FilePlus2, description: 'Recognise storage earned but not yet billed.' },
      { title: 'Cash Transfer', href: '/accounting/cash-transfers', icon: Wallet, description: 'Move money between cash, bank and wallet.' },
      { title: 'Sales Tax Settlement', href: '/accounting/gst-settlement', icon: Coins, description: 'Clear GST collected against input tax remitted.' },
    ],
  },
  {
    label: 'Statements',
    links: [
      { title: 'Trial Balance', href: '/accounting/reports/trial-balance', icon: Scale, description: 'Verify debits = credits across all accounts.' },
      { title: 'Profit & Loss', href: '/accounting/reports/profit-loss', icon: FileBarChart, description: 'Revenue, cost of service, and net profit.' },
      { title: 'Balance Sheet', href: '/accounting/reports/balance-sheet', icon: FileBarChart, description: 'Assets = Liabilities + Equity, as of any date.' },
      { title: 'Cash Flow', href: '/accounting/reports/cash-flow', icon: FilePlus2, description: 'Where the money came from and went.' },
    ],
  },
  {
    label: 'Assets & Payroll',
    links: [
      { title: 'Fixed Assets', href: '/accounting/fixed-assets', icon: Building2, description: 'Register, commission, and dispose of assets.' },
      { title: 'Depreciation Runs', href: '/accounting/fixed-assets/runs', icon: CalendarClock, description: 'Run monthly depreciation and review past runs.' },
      { title: 'Employees', href: '/accounting/payroll/employees', icon: Users, description: 'Salaried staff and daily-wage workers.' },
      { title: 'Payroll Runs', href: '/accounting/payroll/runs', icon: Wallet, description: 'Create, finalize, pay and remit monthly payroll.' },
      { title: 'Employee Advances', href: '/accounting/payroll/advances', icon: HandCoins, description: 'Cash advances against salary, tracked to recovery.' },
    ],
  },
  {
    label: 'Expenses',
    links: [
      { title: 'Expense Vouchers', href: '/accounting/expenses', icon: ReceiptText, description: 'Record, approve, accrue, and pay operating expenses.' },
    ],
  },
];

export default function AccountingHomePage() {
  return (
    <div>
      <PageHeader title="Accounting" description="General ledger, financial statements, fixed assets, payroll and expenses" />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {groups.map((g) => (
          <div key={g.label}>
            <h2 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</h2>
            <div className="space-y-1">
              {g.links.map((l) => {
                const Icon = l.icon;
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60"
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden />
                    <div>
                      <div className="text-sm font-medium group-hover:text-primary">{l.title}</div>
                      <p className="text-2xs text-muted-foreground">{l.description}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
