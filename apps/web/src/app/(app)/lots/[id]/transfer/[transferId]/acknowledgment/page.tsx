'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';

export default function AcknowledgmentPage() {
  const params = useParams();
  const router = useRouter();
  const lotId = params['id'] as string;
  const transferId = params['transferId'] as string;

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const token = localStorage.getItem('access_token');
        const facilityId = localStorage.getItem('facility_id');
        const res = await fetch(
          `${API_URL}/v1/lots/${lotId}/transfer/${transferId}/acknowledgment`,
          {
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(facilityId ? { 'X-Facility-ID': facilityId } : {}),
            },
          },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        setBlobUrl(URL.createObjectURL(blob));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load PDF');
      }
    };
    load();
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotId, transferId]);

  if (error) {
    return (
      <div>
        <p className="mb-4 text-destructive">Failed to load acknowledgment: {error}</p>
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
