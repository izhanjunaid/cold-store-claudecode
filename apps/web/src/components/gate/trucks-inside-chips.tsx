'use client';

import { useQuery } from '@tanstack/react-query';
import { normalizePlate } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
import { Button } from '@/components/ui/button';

/**
 * The plates of the trucks the gate has logged in and not yet released (docs/28 D2, D5). One tap
 * fills a plate field with a plate the gate will match exactly. It shares the dispatch desk's own
 * cache entry (`['dispatch', 'trucks']`) and is read only by users who may see the desk's trucks
 * (`outbound.record`); for anyone else it stays empty and the forms behave as they always did.
 * `loaded` tells a form the list is real, so it never warns about a plate on a list it has not read.
 */
export function useTrucksInside(enabled = true): { plates: string[]; loaded: boolean } {
  const canSee = useCan('outbound.record');
  const { data, isSuccess } = useQuery({
    queryKey: ['dispatch', 'trucks'],
    queryFn: () => apiClient<{ vehicle_number: string }[]>('/v1/dispatch/trucks'),
    enabled: enabled && canSee,
    refetchInterval: 15_000,
  });
  return { plates: [...new Set((data ?? []).map((t) => t.vehicle_number))], loaded: isSuccess };
}

export function TrucksInsideChips({
  plates,
  value,
  onPick,
}: {
  plates: string[];
  /** What is typed in the plate field, so the matching truck shows as picked. */
  value: string;
  onPick: (plate: string) => void;
}) {
  if (plates.length === 0) return null;
  const typed = normalizePlate(value);
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Trucks inside">
      <span className="text-xs text-muted-foreground">Inside:</span>
      {plates.map((plate) => (
        <Button
          key={plate}
          type="button"
          size="sm"
          variant={typed !== '' && normalizePlate(plate) === typed ? 'default' : 'outline'}
          className="h-6 px-2 font-mono text-xs"
          onClick={() => onPick(plate)}
        >
          {plate}
        </Button>
      ))}
    </div>
  );
}
