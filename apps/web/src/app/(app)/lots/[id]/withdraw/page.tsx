'use client';

import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { WithdrawForm } from '@/components/outbound/withdraw-form';

/**
 * Deep-link entry point, kept as a full page on purpose (the e2e navigates straight
 * to it, as does the command palette). The everyday path is the New Withdrawal
 * drawer opened from a lot row — same form, see `WithdrawSheet`.
 */
export default function WithdrawPage() {
  const params = useParams();
  const router = useRouter();
  const lotId = params['id'] as string;

  return (
    <div className="max-w-4xl">
      <PageHeader title="New Withdrawal" crumb="Withdraw" />
      <WithdrawForm
        lotId={lotId}
        onCreated={(id) => router.push(`/outbound-events/${id}`)}
        onCancel={() => router.push(`/lots/${lotId}`)}
      />
    </div>
  );
}
