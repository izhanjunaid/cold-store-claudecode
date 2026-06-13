'use client';

import { PageHeader } from '@/components/layout/page-header';
import { PartyForm } from '@/components/party/party-form';

export default function PartyCreatePage() {
  return (
    <div>
      <PageHeader title="Create New Party" description="Add a farmer, trader, arhti or buyer" />
      <PartyForm mode="create" />
    </div>
  );
}
