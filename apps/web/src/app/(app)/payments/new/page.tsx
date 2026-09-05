'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { PaymentForm } from '../payment-form';

/**
 * Deep-link entry point, kept as a full page on purpose: the command palette
 * (`PALETTE_ACTIONS`) links here and the e2e navigates straight to it. The
 * everyday path is the Record Payment drawer on the payments list.
 *
 * Note it passes `defaultPartyId` but never `lockPartyId` — the e2e arrives with
 * `?party_id=` set and still drives `combobox-party_id`, so the picker has to stay.
 */
export default function NewPaymentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <div className="max-w-5xl">
      <PageHeader title="Record Payment" crumb="New" />
      <PaymentForm
        defaultPartyId={searchParams.get('party_id') ?? ''}
        onCreated={(p) => router.push(`/payments/${p.id}`)}
        onCancel={() => router.back()}
      />
    </div>
  );
}
