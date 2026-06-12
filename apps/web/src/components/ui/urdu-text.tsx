import { cn } from '@/lib/utils';

interface UrduTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
}

/**
 * Renders Urdu data values (party name_urdu, marka) in Noto Nastaliq Urdu
 * with RTL direction. Nastaliq script needs extra line height to avoid
 * clipping its vertical strokes.
 */
export function UrduText({ children, className, ...props }: UrduTextProps) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <span dir="rtl" lang="ur" className={cn('font-urdu leading-loose', className)} {...props}>
      {children}
    </span>
  );
}
