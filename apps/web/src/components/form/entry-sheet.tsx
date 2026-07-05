'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Entry Sheet — the dense, keyboard-first shell for data-entry forms.
 *
 * One flat surface per form (no card-per-section): sections are hairline
 * micro-headers, controls are compact (see `.entry-sheet` in globals.css),
 * and Enter advances to the next field like classic ERP entry screens.
 */

const FOCUSABLE_SELECTOR = [
  'input:not([type="hidden"]):not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'button[role="combobox"]:not(:disabled)',
].join(', ');

/** Enter should advance (not submit / not open) only on plain inputs and selects. */
export function isEnterAdvanceTarget(target: { tagName: string; getAttribute(n: string): string | null }): boolean {
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'BUTTON') return false; // newline / activate
  if (target.getAttribute('role') === 'combobox') return false; // Enter opens it
  return tag === 'INPUT' || tag === 'SELECT';
}

/** The element Enter should move focus to, or null when `current` is last (→ submit). */
export function nextFocusable(elements: HTMLElement[], current: HTMLElement): HTMLElement | null {
  const idx = elements.indexOf(current);
  if (idx === -1) return null;
  return elements[idx + 1] ?? null;
}

function handleEntryKeys(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'Enter') return;
  const target = e.target as HTMLElement;
  const form = target.closest('form');
  if (!form) return;

  // Ctrl/Cmd+Enter submits from anywhere, including textareas.
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    form.requestSubmit();
    return;
  }

  if (!isEnterAdvanceTarget(target)) return;

  const focusables = Array.from(form.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    // offsetParent is null for display:none subtrees (conditional fields).
    (el) => el.offsetParent !== null || el === target,
  );
  e.preventDefault();
  const next = nextFocusable(focusables, target);
  if (next) next.focus();
  else form.requestSubmit();
}

export interface EntrySheetProps {
  children: React.ReactNode;
  className?: string;
  /** Focus the sheet's first control on mount (default true — entry starts typing immediately). */
  autoFocus?: boolean;
}

export function EntrySheet({ children, className, autoFocus = true }: EntrySheetProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    first?.focus();
  }, [autoFocus]);

  return (
    <div
      ref={ref}
      onKeyDown={handleEntryKeys}
      className={cn('entry-sheet space-y-4 rounded-lg border bg-card p-4', className)}
    >
      {children}
    </div>
  );
}

const GROUP_COLS: Record<number, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
  6: 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6',
};

export interface EntryGroupProps {
  title: string;
  children: React.ReactNode;
  /** Grid columns at the widest breakpoint (collapses responsively). */
  columns?: 2 | 3 | 4 | 6;
  className?: string;
}

export function EntryGroup({ title, children, columns = 4, className }: EntryGroupProps) {
  return (
    <section className={className}>
      <div className="mb-2 flex items-center gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        <div className="h-px flex-1 bg-border" aria-hidden />
      </div>
      <div className={cn('grid grid-cols-1 gap-x-6 gap-y-2.5', GROUP_COLS[columns])}>{children}</div>
    </section>
  );
}

const CHIP_TONE = {
  default: 'border-border text-muted-foreground',
  warning: 'border-amber-300 bg-amber-50 text-amber-800',
  destructive: 'border-destructive/40 bg-destructive/10 text-destructive',
} as const;

export interface EntryChipProps {
  label: string;
  value: string;
  tone?: keyof typeof CHIP_TONE;
}

/** Live computed value shown next to the submit button (replaces the summary rail). */
export function EntryChip({ label, value, tone = 'default' }: EntryChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs',
        CHIP_TONE[tone],
      )}
    >
      <span>{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </span>
  );
}
