'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/layout/page-header';
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
  const partyId = params['id'] as string;
  const [party, setParty] = useState<PartyData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient<PartyData>(`/v1/parties/${partyId}`)
      .then(setParty)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [partyId]);

  if (loading) return <p className="text-muted-foreground">Loading…</p>;
  if (!party) return <p className="text-destructive">Party not found</p>;

  return (
    <div>
      <PageHeader title={`Edit Party: ${party.name}`} crumb="Edit" />
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
