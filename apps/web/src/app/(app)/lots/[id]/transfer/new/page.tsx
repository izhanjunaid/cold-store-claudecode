'use client';

import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { TransferForm } from '../../transfer-form';

/**
 * Deep-link entry point, kept as a full page on purpose — the ownership-history table and the
 * lot-detail header both link here when the drawer isn't already open, and it needs its own URL.
 * The everyday path is the Transfer drawer on lot detail (docs/24_ui_density_spec.md §5).
 */
export default function TransferNewPage() {
  const params = useParams();
  const router = useRouter();
  const lotId = params['id'] as string;

  return (
    <div className="max-w-4xl">
      <PageHeader title="Transfer Ownership" crumb="Transfer" />
      <TransferForm
        lotId={lotId}
        onSuccess={(transferId) => router.push(`/lots/${lotId}?transfer=${transferId}`)}
        onCancel={() => router.push(`/lots/${lotId}`)}
      />
    </div>
  );
}
