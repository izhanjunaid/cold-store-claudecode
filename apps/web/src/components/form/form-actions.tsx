import { cn } from '@/lib/utils';

/**
 * Sticky footer for create/edit forms: the submit button stays visible
 * however tall the form is — fast data entry never scrolls to find Save.
 * `meta` renders right-aligned live values (EntryChip) beside the actions.
 */
export function FormActions({
  children,
  meta,
  className,
}: {
  children: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 -mb-4 flex flex-wrap items-center gap-3 border-t bg-background/95 py-3 backdrop-blur',
        className,
      )}
    >
      {children}
      {meta && <div className="ml-auto flex flex-wrap items-center gap-2">{meta}</div>}
    </div>
  );
}
