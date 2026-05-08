'use client';

import Link from 'next/link';

const cards = [
  {
    title: 'Chart of Accounts',
    href: '/accounting/chart-of-accounts',
    description: 'View and manage the 81-account chart of accounts.',
  },
  {
    title: 'Journal Entries',
    href: '/accounting/journal-entries',
    description: 'Browse all journal entries — auto-posted and manual.',
  },
  {
    title: 'General Ledger',
    href: '/accounting/general-ledger',
    description: 'Drill into a single account to see every line that hit it.',
  },
  {
    title: 'Trial Balance',
    href: '/accounting/reports/trial-balance',
    description: 'Verify debits = credits across all accounts.',
  },
  {
    title: 'Profit & Loss',
    href: '/accounting/reports/profit-loss',
    description: 'Revenue, cost of service, and net profit for any period.',
  },
  {
    title: 'Balance Sheet',
    href: '/accounting/reports/balance-sheet',
    description: 'Assets = Liabilities + Equity, as of any date.',
  },
  {
    title: 'Fixed Assets',
    href: '/accounting/fixed-assets',
    description: 'Register, commission, and dispose of cold-plant, building, vehicle and computer assets.',
  },
  {
    title: 'Depreciation Runs',
    href: '/accounting/fixed-assets/runs',
    description: 'Run monthly depreciation (JE-13) and review past runs.',
  },
  {
    title: 'Employees',
    href: '/accounting/payroll/employees',
    description: 'Manage salaried staff and daily-wage workers, with EOBI registration.',
  },
  {
    title: 'Payroll Runs',
    href: '/accounting/payroll/runs',
    description: 'Create monthly payroll runs, finalize JE-15/15B, pay JE-16, remit JE-16B.',
  },
  {
    title: 'Expense Vouchers',
    href: '/accounting/expenses',
    description: 'Record, approve, accrue, and pay operating expenses (JE-17A/B/C).',
  },
];

export default function AccountingHomePage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Accounting</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="block bg-white p-5 rounded-lg shadow hover:shadow-md transition-shadow border border-gray-200"
          >
            <h2 className="text-lg font-semibold text-gray-900 mb-1">{c.title}</h2>
            <p className="text-sm text-gray-600">{c.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
