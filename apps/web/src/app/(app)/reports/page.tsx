'use client';

import Link from 'next/link';
import {
  ArrowRightLeft,
  Boxes,
  CalendarRange,
  FileSpreadsheet,
  Receipt,
  Scale,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole, type Role } from '@/lib/rbac';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/page-header';

interface ReportCard {
  title: string;
  href: string;
  description: string;
  minRole: Role;
  icon: LucideIcon;
}

const cards: ReportCard[] = [
  { title: 'Lot Aging', href: '/reports/lot-aging', icon: Boxes, minRole: 'MANAGER', description: 'Active lots in storage sorted by age, with commodity-specific alert thresholds.' },
  { title: 'Receivables Aging', href: '/reports/receivables-aging', icon: Receipt, minRole: 'ACCOUNTANT', description: 'Outstanding invoices bucketed 0–30 / 31–60 / 61–90 / 90+ days.' },
  { title: 'Party Statement', href: '/reports/party-statement', icon: FileSpreadsheet, minRole: 'ACCOUNTANT', description: 'Generate a statement of account for any party, downloadable as PDF.' },
  { title: 'Commodity Inventory', href: '/reports/commodity-inventory', icon: Warehouse, minRole: 'MANAGER', description: 'Bags by commodity, expandable per-room breakdown.' },
  { title: 'Weight Variance', href: '/reports/weight-variance', icon: Scale, minRole: 'MANAGER', description: 'Inbound vs. outbound weight per lot, flagged at ±2% variance.' },
  { title: 'Seasonal Summary', href: '/reports/seasonal-summary', icon: CalendarRange, minRole: 'OWNER', description: 'Total inbound, outbound, and revenue across a date range, per commodity.' },
  { title: 'Ownership Transfer Log', href: '/reports/ownership-transfers', icon: ArrowRightLeft, minRole: 'MANAGER', description: 'Timeline of all FULL and PARTIAL ownership transfers across the facility.' },
];

export default function ReportsHubPage() {
  const user = useAuthStore((s) => s.user);
  const visible = cards.filter((c) => hasMinRole(user?.role, c.minRole));

  return (
    <div>
      <PageHeader title="Reports" description="Operational, inventory and financial analytics" />
      {visible.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Your role does not have access to any reports.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((c) => {
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
      )}
    </div>
  );
}
