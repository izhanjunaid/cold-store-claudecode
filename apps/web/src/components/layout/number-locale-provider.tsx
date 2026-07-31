'use client';

import { useFacility } from '@/hooks/use-reference-data';
import { setNumberLocale } from '@/lib/format';

/**
 * Pushes the facility's `number_format` setting into the formatter modules.
 *
 * `formatMoney` / `fmtAcct` and friends are pure functions called from hundreds
 * of sites, so the locale is module state in `lib/format.ts` rather than a prop
 * threaded through every screen. This component is its only writer.
 *
 * The assignment happens **during render, not in an effect**, and this component
 * wraps `children` rather than returning null. Both matter: module state is not
 * reactive, so an effect would set the locale only *after* the tree had already
 * rendered every number at the default, and a null-returning sibling would never
 * re-render its siblings when the facility query resolved. Wrapping means the
 * resolve re-renders the subtree, and the assignment lands before children read
 * it. The write is idempotent and derived purely from query state, so StrictMode
 * double-rendering is harmless.
 */
export function NumberLocaleProvider({ children }: { children: React.ReactNode }) {
  const { data } = useFacility();
  setNumberLocale(data?.settings?.number_format ?? 'en-PK');
  return <>{children}</>;
}
