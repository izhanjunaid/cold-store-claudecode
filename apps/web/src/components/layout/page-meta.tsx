'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

interface PageMetaContextValue {
  /** Label overrides keyed by full pathname, e.g. { '/lots/abc-uuid': 'LOT-2026-0042' } */
  crumbs: Record<string, string>;
  setCrumb: (pathname: string, label: string) => void;
}

const PageMetaContext = createContext<PageMetaContextValue>({
  crumbs: {},
  setCrumb: () => {},
});

export function PageMetaProvider({ children }: { children: React.ReactNode }) {
  const [crumbs, setCrumbs] = useState<Record<string, string>>({});

  const setCrumb = useCallback((pathname: string, label: string) => {
    setCrumbs((prev) => (prev[pathname] === label ? prev : { ...prev, [pathname]: label }));
  }, []);

  return (
    <PageMetaContext.Provider value={{ crumbs, setCrumb }}>{children}</PageMetaContext.Provider>
  );
}

export function usePageMeta() {
  return useContext(PageMetaContext);
}

/**
 * Registers a human-readable breadcrumb label for the current pathname
 * (e.g. a lot number instead of its UUID segment).
 */
export function useCrumb(label: string | undefined | null) {
  const pathname = usePathname();
  const { setCrumb } = usePageMeta();
  useEffect(() => {
    if (label) setCrumb(pathname, label);
  }, [label, pathname, setCrumb]);
}
