'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PanelLeftClose, PanelLeftOpen, Snowflake } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { navGroupsForRole } from '@/components/layout/nav-config';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuthStore();
  const { sidebarCollapsed, toggleSidebar } = useUiStore();

  const groups = navGroupsForRole(user?.role);

  return (
    <aside
      className={cn(
        'sticky top-0 flex h-screen flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200',
        sidebarCollapsed ? 'w-14' : 'w-60',
      )}
    >
      <div
        className={cn(
          'flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border',
          sidebarCollapsed ? 'justify-center px-0' : 'px-4',
        )}
      >
        <Snowflake className="h-6 w-6 shrink-0 text-primary-300" aria-hidden />
        {!sidebarCollapsed && (
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold leading-tight text-white">ColdChain</h1>
            <p className="truncate text-[11px] leading-tight text-sidebar-muted">
              Cold Storage Management
            </p>
          </div>
        )}
      </div>

      <nav className="sidebar-scroll flex-1 overflow-y-auto py-2" aria-label="Main navigation">
        {groups.map((group) => (
          <div key={group.label} className="mb-1 px-2">
            {!sidebarCollapsed && (
              <div className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted">
                {group.label}
              </div>
            )}
            {sidebarCollapsed && <div className="mx-2 my-2 border-t border-sidebar-border" />}
            <ul>
              {group.items.map((item) => {
                const isActive =
                  pathname === item.href || pathname.startsWith(item.href + '/');
                const Icon = item.icon;
                const link = (
                  <Link
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors',
                      sidebarCollapsed && 'justify-center px-0 py-2',
                      isActive
                        ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
                return (
                  <li key={item.href}>
                    {sidebarCollapsed ? (
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>{link}</TooltipTrigger>
                        <TooltipContent side="right">{item.label}</TooltipContent>
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-sidebar-border p-2">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
            sidebarCollapsed && 'justify-center px-0 py-2',
          )}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" aria-hidden />
          ) : (
            <>
              <PanelLeftClose className="h-4 w-4" aria-hidden />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
