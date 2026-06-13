'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { PageMetaProvider } from '@/components/layout/page-meta';
import { CommandPaletteProvider } from '@/components/layout/command-palette';
import { ConfirmDialogProvider } from '@/components/form/confirm-dialog';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <NuqsAdapter>
        <TooltipProvider delayDuration={200}>
          <PageMetaProvider>
            <ConfirmDialogProvider>
              <CommandPaletteProvider>
                {children}
                <Toaster richColors position="top-right" />
              </CommandPaletteProvider>
            </ConfirmDialogProvider>
          </PageMetaProvider>
        </TooltipProvider>
      </NuqsAdapter>
    </QueryClientProvider>
  );
}
