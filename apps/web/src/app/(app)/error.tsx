'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
      </div>
      <div>
        <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {error.message || 'An unexpected error occurred while loading this page.'}
        </p>
      </div>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
