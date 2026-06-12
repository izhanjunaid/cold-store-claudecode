'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { SurchargeSuggestionsResponseType, SurchargeSuggestionType } from '@coldchain/shared';
import { useAuthStore } from '@/stores/auth.store';
import { apiClient } from '@/lib/api-client';

const ROLE_RANK: Record<string, number> = {
  OWNER: 6,
  MANAGER: 5,
  ACCOUNTANT: 4,
  OPERATOR: 3,
  SECURITY: 2,
  VIEWER: 1,
};

function fmtPkr(n: number): string {
  return n.toLocaleString('en-PK', { maximumFractionDigits: 0 });
}

export default function SurchargesPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const queryClient = useQueryClient();
  const canView = (ROLE_RANK[user?.role ?? ''] ?? 0) >= ROLE_RANK['ACCOUNTANT']!;
  const isOwner = user?.role === 'OWNER';
  const [applyError, setApplyError] = useState('');

  const { data, isLoading } = useQuery<SurchargeSuggestionsResponseType>({
    queryKey: ['surcharge-suggestions', user?.facility_id],
    queryFn: () => apiClient<SurchargeSuggestionsResponseType>('/v1/surcharges/suggestions'),
    enabled: canView && !!user,
  });

  const applyMutation = useMutation({
    mutationFn: (invoiceId: string) =>
      apiClient(`/v1/invoices/${invoiceId}/surcharges`, { method: 'POST', body: {} }),
    onSuccess: () => {
      setApplyError('');
      queryClient.invalidateQueries({ queryKey: ['surcharge-suggestions'] });
    },
    onError: (e: unknown) => {
      setApplyError(e instanceof Error ? e.message : 'Failed to apply surcharge');
    },
  });

  function handleApply(s: SurchargeSuggestionType) {
    if (
      !confirm(
        `Apply a surcharge of Rs ${fmtPkr(s.suggested_amount_pkr)} ` +
          `(${s.chargeable_months} month(s) × ${s.rate_pct_per_month}% on Rs ${fmtPkr(s.base_outstanding_pkr)}) ` +
          `to ${s.invoice_number ?? 'this invoice'} for ${s.billing_party_name}?`,
      )
    )
      return;
    applyMutation.mutate(s.invoice_id);
  }

  if (!canView) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Access denied</h1>
        <p className="text-gray-600">Surcharges require ACCOUNTANT role or higher.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Late Payment Surcharges</h1>
        {data?.enabled && (
          <span className="text-sm text-gray-600">
            Rule: {data.pct_per_month}% / month after {data.grace_days} days grace
          </span>
        )}
      </div>

      <p className="text-sm text-gray-600">
        Suggestions are computed from the facility rule — nothing is charged automatically.
        Applying posts the surcharge to the invoice and the GL (account 4210). The base shown is
        the unpaid principal; payments settle principal first, so surcharges do not compound.
      </p>

      {applyError && (
        <div className="text-red-700 bg-red-50 px-3 py-2 rounded text-sm">{applyError}</div>
      )}

      {data && !data.enabled ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-600">
          <p className="mb-2 font-medium">The late payment surcharge rule is disabled.</p>
          {isOwner ? (
            <button
              onClick={() => router.push('/settings')}
              className="text-primary-600 hover:underline text-sm"
            >
              Enable it in System Settings →
            </button>
          ) : (
            <p className="text-sm">Ask the owner to enable it in System Settings.</p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="text-left py-3 px-4">Invoice</th>
                <th className="text-left">Party</th>
                <th className="text-right">Invoice Date</th>
                <th className="text-right">Days Overdue</th>
                <th className="text-right">Months</th>
                <th className="text-right">Outstanding</th>
                <th className="text-right">Suggested</th>
                <th className="text-right px-4" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : data?.suggestions.length ? (
                data.suggestions.map((s) => (
                  <tr key={s.invoice_id} className="border-t hover:bg-gray-50">
                    <td
                      className="py-2 px-4 font-mono text-primary-600 cursor-pointer hover:underline"
                      onClick={() => router.push(`/invoices/${s.invoice_id}`)}
                    >
                      {s.invoice_number ?? s.invoice_id.slice(0, 8)}
                    </td>
                    <td className="font-medium">{s.billing_party_name}</td>
                    <td className="text-right text-gray-500">{s.invoice_date}</td>
                    <td className="text-right text-red-700">{s.days_overdue}d</td>
                    <td className="text-right">{s.chargeable_months}</td>
                    <td className="text-right font-mono">{fmtPkr(s.base_outstanding_pkr)}</td>
                    <td className="text-right font-mono font-bold">
                      {fmtPkr(s.suggested_amount_pkr)}
                    </td>
                    <td className="text-right px-4">
                      <button
                        onClick={() => handleApply(s)}
                        disabled={applyMutation.isPending}
                        className="px-3 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700 disabled:opacity-50"
                      >
                        Apply
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-gray-500">
                    No overdue invoices eligible for a surcharge.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
