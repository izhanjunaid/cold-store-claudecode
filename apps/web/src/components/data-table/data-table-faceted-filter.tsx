'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FacetConfig } from './types';

const ALL_VALUE = '__all__';

interface DataTableFacetedFilterProps {
  facet: FacetConfig;
  value: string;
  onChange: (value: string) => void;
}

/**
 * Single-select faceted filter rendered as a compact dropdown. The empty
 * string maps to "All" (no filter applied).
 */
export function DataTableFacetedFilter({ facet, value, onChange }: DataTableFacetedFilterProps) {
  return (
    <Select
      value={value === '' ? ALL_VALUE : value}
      onValueChange={(v) => onChange(v === ALL_VALUE ? '' : v)}
    >
      <SelectTrigger className="h-8 w-auto min-w-[140px] gap-1">
        <span className="text-muted-foreground">{facet.label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>All</SelectItem>
        {facet.options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
