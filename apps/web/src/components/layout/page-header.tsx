'use client';

import { useCrumb } from '@/components/layout/page-meta';

interface PageHeaderProps {
  /** Rendered as the page's h1. Keep existing screen titles verbatim — E2E asserts on them. */
  title: string;
  description?: string;
  /** Primary actions, rendered top-right. */
  actions?: React.ReactNode;
  /** Breadcrumb label override for this page (defaults to title). */
  crumb?: string;
}

export function PageHeader({ title, description, actions, crumb }: PageHeaderProps) {
  useCrumb(crumb ?? title);

  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
