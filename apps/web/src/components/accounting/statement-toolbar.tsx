'use client';

import { Printer, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { PRESETS, type PresetKey, type PeriodRange } from '@/lib/fiscal-period';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';

const SELECT_CLASS =
  'flex h-9 w-auto rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

interface StatementToolbarProps {
  mode: 'range' | 'asof';
  preset: PresetKey;
  onPresetChange: (p: PresetKey) => void;
  range: PeriodRange;
  onCustomChange: (partial: { date_from?: string; date_to?: string }) => void;
  bookType: string;
  onBookTypeChange: (b: string) => void;
  compare: boolean;
  onCompareChange: (c: boolean) => void;
  showCompare?: boolean;
  onPrint: () => void;
  onExportCsv: () => void;
}

export function StatementToolbar({
  mode,
  preset,
  onPresetChange,
  range,
  onCustomChange,
  bookType,
  onBookTypeChange,
  compare,
  onCompareChange,
  showCompare = true,
  onPrint,
  onExportCsv,
}: StatementToolbarProps) {
  const isCustom = preset === 'custom';
  // Reports default to the official PACCI book; the KATCHI book is
  // MANAGER+ only (mirrors the backend gate in book-gate.ts).
  const { user } = useAuthStore();
  const canSeeKatchi = hasMinRole(user?.role, 'MANAGER');
  return (
    <div className="print-hide mb-4 flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Period</Label>
        <select value={preset} onChange={(e) => onPresetChange(e.target.value as PresetKey)} className={SELECT_CLASS}>
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {isCustom && mode === 'range' && (
        <>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={range.date_from} onChange={(e) => onCustomChange({ date_from: e.target.value })} className="h-9 w-auto tabular-nums" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={range.date_to} onChange={(e) => onCustomChange({ date_to: e.target.value })} className="h-9 w-auto tabular-nums" />
          </div>
        </>
      )}
      {isCustom && mode === 'asof' && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">As of</Label>
          <Input type="date" value={range.date_to} onChange={(e) => onCustomChange({ date_to: e.target.value })} className="h-9 w-auto tabular-nums" />
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Book</Label>
        <select value={bookType} onChange={(e) => onBookTypeChange(e.target.value)} className={SELECT_CLASS}>
          <option value="">PACCI (Official)</option>
          {canSeeKatchi && <option value="KATCHI">KATCHI (Internal)</option>}
        </select>
      </div>

      {showCompare && (
        <label className="flex h-9 items-center gap-2 text-sm">
          <Checkbox checked={compare} onCheckedChange={(c) => onCompareChange(!!c)} />
          Compare prior year
        </label>
      )}

      <div className="ml-auto flex items-end gap-2">
        <Button variant="outline" size="sm" onClick={onExportCsv}>
          <Download className="h-4 w-4" aria-hidden />
          CSV
        </Button>
        <Button variant="outline" size="sm" onClick={onPrint}>
          <Printer className="h-4 w-4" aria-hidden />
          Print
        </Button>
      </div>
    </div>
  );
}
