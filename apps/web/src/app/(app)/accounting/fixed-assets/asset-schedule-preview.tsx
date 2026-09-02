'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface ScheduleRow {
  period_year: number;
  period_month: number;
  opening_nbv_pkr: number;
  depreciation_amount_pkr: number;
  closing_nbv_pkr: number;
}
interface AssetDetail {
  schedules: ScheduleRow[];
}

const PREVIEW_ROWS = 6;

/**
 * Read-only depreciation-history preview mounted in DataTable.renderExpanded
 * on the fixed-assets register — avoids a full navigation just to see the
 * schedule. Fetches the existing detail endpoint (which already includes
 * `schedules`); commission/dispose/impair stay exclusively on the detail page.
 */
export function AssetSchedulePreview({ assetId }: { assetId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['fixed-assets', assetId],
    queryFn: () => apiClient<AssetDetail>(`/v1/fixed-assets/${assetId}`),
    staleTime: 60_000,
  });

  if (isLoading) return <p className="py-2 text-sm text-muted-foreground">Loading schedule…</p>;
  const schedules = data?.schedules ?? [];
  const shown = schedules.slice(-PREVIEW_ROWS);

  return (
    <div className="space-y-2">
      {schedules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No depreciation runs yet for this asset.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="h-8 hover:bg-transparent">
              <TableHead className="h-8">Period</TableHead>
              <TableHead className="h-8 text-right">Opening NBV</TableHead>
              <TableHead className="h-8 text-right">Depreciation</TableHead>
              <TableHead className="h-8 text-right">Closing NBV</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((s) => (
              <TableRow key={`${s.period_year}-${s.period_month}`} className="h-7 hover:bg-transparent">
                <TableCell className="py-1 font-mono">{s.period_year}-{String(s.period_month).padStart(2, '0')}</TableCell>
                <TableCell className="py-1 text-right tabular-nums">{s.opening_nbv_pkr.toLocaleString()}</TableCell>
                <TableCell className="py-1 text-right tabular-nums text-amber-700">{s.depreciation_amount_pkr.toLocaleString()}</TableCell>
                <TableCell className="py-1 text-right font-medium tabular-nums">{s.closing_nbv_pkr.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {schedules.length > PREVIEW_ROWS && (
        <p className="text-xs text-muted-foreground">Showing the last {PREVIEW_ROWS} of {schedules.length} periods.</p>
      )}
      <Link href={`/accounting/fixed-assets/${assetId}`} className="text-xs text-primary hover:underline">
        View asset →
      </Link>
    </div>
  );
}
