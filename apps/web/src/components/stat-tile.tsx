import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Tone colours the value only. State-driven by the caller: a zero overdue
 * balance is 'default', not 'negative' — alarm colour means something is
 * actually wrong right now.
 */
export type StatTone = 'default' | 'positive' | 'negative' | 'warning';

const TONE_CLASS: Record<StatTone, string> = {
  default: 'text-foreground',
  positive: 'text-green-600',
  negative: 'text-destructive',
  warning: 'text-amber-600',
};

export interface StatTileProps {
  label: string;
  value: string;
  /** One short line under the value, e.g. "bags accepted today". */
  caption?: string;
  tone?: StatTone;
  /** 'compact' for rows of 4+ tiles where money values would overflow. */
  size?: 'default' | 'compact';
  className?: string;
}

export function StatTile({
  label,
  value,
  caption,
  tone = 'default',
  size = 'default',
  className,
}: StatTileProps) {
  return (
    <Card className={className}>
      <CardContent className="p-3">
        <div className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div
          className={cn(
            'mt-1 font-bold tabular-nums',
            size === 'compact' ? 'text-lg' : 'text-2xl',
            TONE_CLASS[tone],
          )}
        >
          {value}
        </div>
        {caption && <div className="mt-1 text-2xs text-muted-foreground">{caption}</div>}
      </CardContent>
    </Card>
  );
}
