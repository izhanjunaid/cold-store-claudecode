import Link from 'next/link';
import { StatusBadge } from '@/components/ui/status-badge';
import { UrduText } from '@/components/ui/urdu-text';
import type { DataTableColumn } from '@/components/data-table';
import { LotRowActions } from './lot-row-actions';

import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Facility default when a commodity has no `default_storage_days_alert` override — mirrors the
 *  API's own constant (apps/api/src/modules/reporting/reports/lot-aging.ts). */
export const DEFAULT_STORAGE_ALERT_DAYS = 90;

export interface LotRow {
  id: string;
  lot_number: string;
  owner_party_name: string | null;
  commodity_id: string;
  commodity_name: string | null;
  variety_name: string | null;
  marka: string | null;
  chamber_name: string | null;
  quantity_bags: number;
  current_balance_bags: number;
  inbound_date: string;
  days_in_storage: number;
  status: string;
}

interface GetLotColumnsOptions {
  /** commodity_id -> its days-in-storage alert threshold, from useCommodities(). Same coloring
   *  rule as reports/lot-aging so a lot doesn't read "fine" on the list and "flagged" on the report. */
  commodityThresholds: Map<string, number>;
  /** Same gate as LotLocationCard's Move/Edit Placement actions on lot detail. */
  canOperate: boolean;
}

export function getLotColumns({ commodityThresholds, canOperate }: GetLotColumnsOptions): DataTableColumn<LotRow>[] {
  return [
  {
    id: 'lot_number',
    header: 'Lot #',
    sortId: 'lot_number',
    enableHiding: false,
    cell: (lot) => (
      <Link
        href={`/lots/${lot.id}`}
        className="font-mono font-medium text-primary-700 hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {lot.lot_number}
      </Link>
    ),
    csv: (lot) => lot.lot_number,
  },
  {
    id: 'owner',
    header: 'Owner',
    cell: (lot) => lot.owner_party_name ?? '—',
    csv: (lot) => lot.owner_party_name ?? '',
  },
  {
    id: 'commodity',
    header: 'Commodity',
    cell: (lot) => (
      <span>
        {lot.commodity_name}
        {lot.variety_name && <span className="text-muted-foreground"> / {lot.variety_name}</span>}
      </span>
    ),
    csv: (lot) =>
      lot.variety_name ? `${lot.commodity_name} / ${lot.variety_name}` : (lot.commodity_name ?? ''),
  },
  {
    id: 'marka',
    header: 'Marka',
    cell: (lot) =>
      lot.marka ? <UrduText>{lot.marka}</UrduText> : <span className="text-muted-foreground">—</span>,
    csv: (lot) => lot.marka ?? '',
  },
  {
    id: 'chamber',
    header: 'Room',
    cell: (lot) => lot.chamber_name ?? '—',
    csv: (lot) => lot.chamber_name ?? '',
  },
  {
    id: 'bags',
    header: 'Bags',
    numeric: true,
    cell: (lot) => lot.quantity_bags.toLocaleString(),
    csv: (lot) => lot.quantity_bags,
  },
  {
    id: 'balance',
    header: 'Balance',
    numeric: true,
    cell: (lot) => <span className="font-medium">{lot.current_balance_bags.toLocaleString()}</span>,
    csv: (lot) => lot.current_balance_bags,
  },
  {
    id: 'inbound_date',
    header: 'Inbound',
    sortId: 'inbound_date',
    cell: (lot) => formatDate(lot.inbound_date),
    csv: (lot) => lot.inbound_date,
  },
  {
    id: 'days',
    header: 'Days',
    numeric: true,
    sortId: 'days_in_storage',
    cell: (lot) => {
      const threshold = commodityThresholds.get(lot.commodity_id) ?? DEFAULT_STORAGE_ALERT_DAYS;
      return (
        <span className={cn(lot.days_in_storage > threshold && 'font-medium text-destructive')}>
          {lot.days_in_storage}
        </span>
      );
    },
    csv: (lot) => lot.days_in_storage,
  },
  {
    id: 'status',
    header: 'Status',
    cell: (lot) => <StatusBadge status={lot.status} />,
    csv: (lot) => lot.status,
  },
  {
    id: 'actions',
    header: '',
    enableHiding: false,
    cell: (lot) => <LotRowActions lot={lot} canOperate={canOperate} />,
  },
  ];
}
