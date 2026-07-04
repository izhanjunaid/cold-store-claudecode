import Link from 'next/link';
import { StatusBadge } from '@/components/ui/status-badge';
import { UrduText } from '@/components/ui/urdu-text';
import type { DataTableColumn } from '@/components/data-table';

import { formatMoney } from '@/lib/format';
export interface PartyRow {
  id: string;
  name: string;
  name_urdu: string | null;
  party_type: string;
  phone_primary: string;
  credit_limit_pkr: number | null;
  is_active: boolean;
}

const PARTY_TYPE_TONE: Record<string, 'success' | 'info' | 'warning' | 'neutral'> = {
  FARMER: 'success',
  TRADER: 'info',
  ARHTI: 'warning',
  BUYER: 'neutral',
};

export const partyColumns: DataTableColumn<PartyRow>[] = [
  {
    id: 'name',
    header: 'Name',
    sortId: 'name',
    enableHiding: false,
    cell: (p) => (
      <div>
        <Link
          href={`/parties/${p.id}`}
          className="font-medium text-foreground hover:text-primary-700 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {p.name}
        </Link>
        {p.name_urdu && <UrduText className="block text-xs text-muted-foreground">{p.name_urdu}</UrduText>}
      </div>
    ),
    csv: (p) => p.name,
  },
  {
    id: 'party_type',
    header: 'Type',
    cell: (p) => <StatusBadge status={p.party_type} tone={PARTY_TYPE_TONE[p.party_type] ?? 'neutral'} />,
    csv: (p) => p.party_type,
  },
  {
    id: 'phone',
    header: 'Phone',
    cell: (p) => p.phone_primary,
    csv: (p) => p.phone_primary,
  },
  {
    id: 'credit',
    header: 'Credit Limit',
    numeric: true,
    cell: (p) => (p.credit_limit_pkr ? `${formatMoney(p.credit_limit_pkr)}` : '—'),
    csv: (p) => p.credit_limit_pkr ?? '',
  },
  {
    id: 'status',
    header: 'Status',
    cell: (p) => <StatusBadge status={p.is_active ? 'ACTIVE' : 'INACTIVE'} />,
    csv: (p) => (p.is_active ? 'Active' : 'Inactive'),
  },
];
