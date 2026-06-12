'use client';

import { Fragment, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { navLabelForPath } from '@/components/layout/nav-config';
import { usePageMeta } from '@/components/layout/page-meta';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function humanize(segment: string): string {
  if (UUID_RE.test(segment)) return 'Detail';
  return segment
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

interface Crumb {
  href: string;
  label: string;
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const { crumbs: overrides } = usePageMeta();

  const crumbs = useMemo<Crumb[]>(() => {
    const segments = pathname.split('/').filter(Boolean);
    const result: Crumb[] = [];
    let path = '';
    for (const segment of segments) {
      path += `/${segment}`;
      const label = overrides[path] ?? navLabelForPath(path) ?? humanize(segment);
      result.push({ href: path, label });
    }
    return result;
  }, [pathname, overrides]);

  // Top-level screens don't need a breadcrumb trail.
  if (crumbs.length <= 1) return null;

  return (
    <Breadcrumb className="mb-3">
      <BreadcrumbList>
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <Fragment key={crumb.href}>
              {i > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
