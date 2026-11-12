'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';

import { fetchPdfBlobUrl } from '@/lib/open-pdf';

export default function AcknowledgmentPage() {
  const params = useParams();
  const router = useRouter();
  const lotId = params['id'] as string;
  const transferId = params['transferId'] as string;

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The paper this effect loaded, kept here (not in state) so the cleanup frees the right one.
    let url: string | null = null;
    let left = false;
    const load = async () => {
      try {
        url = await fetchPdfBlobUrl(`/v1/lots/${lotId}/transfer/${transferId}/acknowledgment`, 'transfer acknowledgment');
        if (left) URL.revokeObjectURL(url); // the page was left while it loaded
        else setBlobUrl(url);
      } catch (e) {
        if (!left) setError(e instanceof Error ? e.message : 'Failed to load PDF');
      }
    };
    load();
    return () => {
      left = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [lotId, transferId]);

  if (error) {
    return (
      <div>
        <p className="mb-4 text-destructive">{error}</p>
        <Button variant="outline" onClick={() => router.push(`/lots/${lotId}`)}>
          Back to Lot
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <PageHeader
        title="Transfer Acknowledgment"
        crumb="Acknowledgment"
        actions={
          blobUrl ? (
            <Button asChild>
              <a href={blobUrl} download={`transfer-${transferId.slice(0, 8)}.pdf`}>
                <Download className="h-4 w-4" aria-hidden />
                Download PDF
              </a>
            </Button>
          ) : undefined
        }
      />
      {blobUrl ? (
        <iframe src={blobUrl} className="w-full flex-1 rounded-lg border bg-card" title="Transfer Acknowledgment PDF" />
      ) : (
        <p className="text-sm text-muted-foreground">Loading PDF…</p>
      )}
    </div>
  );
}
