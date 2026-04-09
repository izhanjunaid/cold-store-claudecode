'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { PartyForm } from '@/components/party/party-form';

interface PartyData {
  id: string;
  name: string;
  name_urdu: string | null;
  party_type: string;
  phone_primary: string;
  phone_secondary: string | null;
  address: string | null;
  cnic: string | null;
  parent_arhti_id: string | null;
  credit_limit_pkr: number | null;
  credit_terms_days: number;
  notes: string | null;
}

export default function PartyEditPage() {
  const params = useParams();
  const [party, setParty] = useState<PartyData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient<PartyData>(`/v1/parties/${params['id']}`)
      .then(setParty)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [params['id']]);

  if (loading) return <div className="text-gray-500">Loading...</div>;
  if (!party) return <div className="text-red-500">Party not found</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Edit Party: {party.name}</h1>
      <PartyForm
        mode="edit"
        partyId={party.id}
        initialData={{
          name: party.name,
          name_urdu: party.name_urdu || '',
          party_type: party.party_type,
          phone_primary: party.phone_primary,
          phone_secondary: party.phone_secondary || '',
          address: party.address || '',
          cnic: party.cnic || '',
          parent_arhti_id: party.parent_arhti_id || '',
          credit_limit_pkr: party.credit_limit_pkr?.toString() || '',
          credit_terms_days: party.credit_terms_days.toString(),
          notes: party.notes || '',
        }}
      />
    </div>
  );
}
