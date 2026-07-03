import Link from 'next/link';
import { Snowflake } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Root-level 404 — catches URLs that match no route group at all
 * (the (app) group has its own not-found for in-shell misses).
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-4 text-center">
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Snowflake className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold text-foreground">ColdChain</h1>
      </div>
      <div>
        <h2 className="text-lg font-semibold text-foreground">Page not found</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has moved.
        </p>
      </div>
      <Button asChild>
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
