'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

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
      <div className="p-6">
        <p className="text-red-600 mb-4">Failed to load acknowledgment: {error}</p>
        <button onClick={() => router.push(`/lots/${lotId}`)} className="text-primary-600 hover:underline text-sm">
          Back to Lot
        </button>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push(`/lots/${lotId}`)} className="text-gray-400 hover:text-gray-600">&#8592;</button>
          <h1 className="text-xl font-bold text-gray-900">Transfer Acknowledgment</h1>
        </div>
        {blobUrl && (
          <a
            href={blobUrl}
            download={`transfer-${transferId.slice(0, 8)}.pdf`}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700"
          >
            Download PDF
          </a>
        )}
      </div>
      {blobUrl ? (
        <iframe src={blobUrl} className="flex-1 w-full border rounded-lg bg-white" title="Transfer Acknowledgment PDF" />
      ) : (
        <div className="text-gray-500 text-sm">Loading PDF...</div>
      )}
    </div>
  );
}
