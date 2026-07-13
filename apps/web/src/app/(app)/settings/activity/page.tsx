'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AuditLogRowType } from '@coldchain/shared';
import { apiClientList } from '@/lib/api-client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { AuditDiff } from '@/components/settings/audit-diff';

const SELECT_CLASS =
  'flex h-9 w-auto rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

const PER_PAGE = 50;

const ACTION_STYLES: Record<AuditLogRowType['action'], string> = {
  INSERT: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  UPDATE: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  DELETE: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
};

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

interface Filters {
  table_name: string;
  action: '' | AuditLogRowType['action'];
  date_from: string;
  date_to: string;
}

export default function ActivityLogPage() {
  const [rows, setRows] = useState<AuditLogRowType[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ table_name: '', action: '', date_from: '', date_to: '' });

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setPage(1);
    setFilters((f) => ({ ...f, [key]: value }));
  };

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
    if (filters.table_name.trim()) params.set('table_name', filters.table_name.trim());
    if (filters.action) params.set('action', filters.action);
    if (filters.date_from) params.set('date_from', filters.date_from);
    if (filters.date_to) params.set('date_to', filters.date_to);
    try {
      const res = await apiClientList<AuditLogRowType>(`/v1/audit-logs?${params.toString()}`);
      setRows(res.data);
      setTotal(res.meta.total);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Activity Log"
        description="Every create, update and delete recorded across the facility. Passwords and secrets are always masked."
        crumb="Activity Log"
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Table</Label>
          <Input
            value={filters.table_name}
            onChange={(e) => setFilter('table_name', e.target.value)}
            placeholder="e.g. invoices"
            className="h-9 w-44"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Action</Label>
          <select
            value={filters.action}
            onChange={(e) => setFilter('action', e.target.value as Filters['action'])}
            className={SELECT_CLASS}
          >
            <option value="">All</option>
            <option value="INSERT">Created</option>
            <option value="UPDATE">Updated</option>
            <option value="DELETE">Deleted</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input type="date" value={filters.date_from} onChange={(e) => setFilter('date_from', e.target.value)} className="h-9 w-auto tabular-nums" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input type="date" value={filters.date_to} onChange={(e) => setFilter('date_to', e.target.value)} className="h-9 w-auto tabular-nums" />
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Table</TableHead>
              <TableHead>Record</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const open = expanded === r.id;
              return (
                <Fragment key={r.id}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() => setExpanded(open ? null : r.id)}
                  >
                    <TableCell>
                      {open ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{fmtWhen(r.changed_at)}</TableCell>
                    <TableCell>{r.changed_by_name ?? <span className="text-muted-foreground">System</span>}</TableCell>
                    <TableCell>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_STYLES[r.action]}`}>
                        {r.action}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.table_name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{r.record_id.slice(0, 8)}…</TableCell>
                  </TableRow>
                  {open && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={6} className="p-0">
                        {r.reason && (
                          <p className="px-4 pt-2 text-xs text-muted-foreground">Reason: {r.reason}</p>
                        )}
                        <AuditDiff action={r.action} oldValues={r.old_values} newValues={r.new_values} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No activity matches these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {loading && <p className="border-t px-4 py-3 text-sm text-muted-foreground">Loading…</p>}
      </Card>

      <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
        <span>{total.toLocaleString()} entries</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="tabular-nums">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
