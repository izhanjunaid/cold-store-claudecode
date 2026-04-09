'use client';

import { PartyForm } from '@/components/party/party-form';

export default function PartyCreatePage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Create New Party</h1>
      <PartyForm mode="create" />
    </div>
  );
}
