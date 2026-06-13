import { Skeleton } from '@/components/ui/skeleton';
import { TableCell, TableRow } from '@/components/ui/table';

interface DataTableSkeletonProps {
  columns: number;
  rows?: number;
}

export function DataTableSkeleton({ columns, rows = 8 }: DataTableSkeletonProps) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r} className="hover:bg-transparent">
          {Array.from({ length: columns }).map((__, c) => (
            <TableCell key={c} className="py-2">
              <Skeleton className="h-4 w-full max-w-[160px]" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
