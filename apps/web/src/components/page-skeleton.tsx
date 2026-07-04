import { Skeleton } from '@/components/ui/skeleton';

/**
 * Full-page loading placeholder: header line + content blocks.
 * Use for detail/form pages while their primary query resolves —
 * never a bare "Loading…" paragraph.
 */
export function PageSkeleton({ blocks = 2 }: { blocks?: number }) {
  return (
    <div aria-busy="true">
      <Skeleton className="h-7 w-64 max-w-full" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-6 space-y-4">
        {Array.from({ length: blocks }, (_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
