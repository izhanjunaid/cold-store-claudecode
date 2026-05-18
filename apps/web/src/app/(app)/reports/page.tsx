'use client';

import Link from 'next/link';
import { useAuthStore } from '@/stores/auth.store';

const ROLE_RANK: Record<string, number> = {
  OWNER: 6,
  MANAGER: 5,
  ACCOUNTANT: 4,
  OPERATOR: 3,
  SECURITY: 2,
  VIEWER: 1,
};

const cards = [
  {
    title: 'Lot Aging',
    href: '/reports/lot-aging',
    description: 'Active lots in storage sorted by age, with commodity-specific alert thresholds.',
    minRole: 'MANAGER',
  },
  {
    title: 'Receivables Aging',
    href: '/reports/receivables-aging',
    description: 'Outstanding invoices bucketed 0–30 / 31–60 / 61–90 / 90+ days.',
    minRole: 'ACCOUNTANT',
  },
  {
    title: 'Party Statement',
    href: '/reports/party-statement',
    description: 'Generate a statement of account for any party, downloadable as PDF.',
    minRole: 'ACCOUNTANT',
  },
  {
    title: 'Commodity Inventory',
    href: '/reports/commodity-inventory',
    description: 'Bags by commodity, broken down by chamber. (Detail view coming in Phase 11.)',
    minRole: 'MANAGER',
  },
  {
    title: 'Weight Variance',
    href: '/reports/weight-variance',
    description: 'Inbound vs. outbound weight per lot. (Detail view coming in Phase 11.)',
    minRole: 'MANAGER',
  },
  {
    title: 'Seasonal Summary',
    href: '/reports/seasonal-summary',
    description: 'Total inbound, outbound, and revenue across a date range. (Detail view coming in Phase 11.)',
    minRole: 'OWNER',
  },
  {
    title: 'Ownership Transfer Log',
    href: '/reports/ownership-transfers',
    description: 'All ownership transfers across the facility. (Detail view coming in Phase 11.)',
    minRole: 'MANAGER',
  },
];

export default function ReportsHubPage() {
  const user = useAuthStore((s) => s.user);
  const userRank = ROLE_RANK[user?.role ?? ''] ?? 0;
  const visible = cards.filter((c) => userRank >= (ROLE_RANK[c.minRole] ?? 0));

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Reports</h1>
      {visible.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          Your role does not have access to any reports.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((c) => (
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
      )}
    </div>
  );
}
