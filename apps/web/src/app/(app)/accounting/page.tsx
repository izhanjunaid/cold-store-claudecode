'use client';

import Link from 'next/link';

const cards = [
  {
    title: 'Chart of Accounts',
    href: '/accounting/chart-of-accounts',
    description: 'View and manage the 73-account chart of accounts.',
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
