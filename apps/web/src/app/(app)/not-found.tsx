import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <FileQuestion className="h-6 w-6 text-muted-foreground" aria-hidden />
      </div>
      <div>
        <h1 className="text-lg font-semibold text-foreground">Page not found</h1>
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
