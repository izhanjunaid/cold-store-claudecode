'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

const ROLE_RANK: Record<string, number> = {
  SECURITY: 0, OPERATOR: 1, ACCOUNTANT: 2, MANAGER: 3, OWNER: 4,
};

interface LineItem {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_type: 'SALARIED' | 'DAILY_WAGE';
  days_worked: number | null;
  gross_pay_pkr: number;
  eobi_employee_pkr: number;
  eobi_employer_pkr: number;
  income_tax_pkr: number;
  other_deductions_pkr: number;
  net_pay_pkr: number;
}

interface PayrollRun {
  id: string;
  run_number: string;
  payroll_type: 'MONTHLY_SALARY' | 'DAILY_WAGES';
  period_year: number;
  period_month: number;
  period_from: string;
  period_to: string;
  total_gross_pkr: number;
  total_employer_eobi_pkr: number;
  total_deductions_pkr: number;
  total_net_payable_pkr: number;
  status: 'DRAFT' | 'FINALIZED' | 'PAID';
  payroll_journal_entry_id: string | null;
  payment_journal_entry_id: string | null;
  remittance_journal_entry_id: string | null;
  finalized_at: string | null;
  paid_at: string | null;
  notes: string | null;
  line_items: LineItem[];
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-yellow-100 text-yellow-800',
  FINALIZED: 'bg-blue-100 text-blue-800',
  PAID: 'bg-green-100 text-green-800',
};

export default function PayrollRunDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params['id'] as string;
  const { user } = useAuthStore();
  const isManager = (ROLE_RANK[user?.role ?? ''] ?? -1) >= 3;
  const isOwner = (ROLE_RANK[user?.role ?? ''] ?? -1) >= 4;
  const isAccountant = (ROLE_RANK[user?.role ?? ''] ?? -1) >= 2;

  const [run, setRun] = useState<PayrollRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showPay, setShowPay] = useState(false);
  const [showRemit, setShowRemit] = useState(false);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [remitDate, setRemitDate] = useState(new Date().toISOString().slice(0, 10));

  const fetchRun = useCallback(async () => {
    setLoading(true);
    try {
      setRun(await apiClient<PayrollRun>(`/v1/payroll-runs/${id}`));
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchRun(); }, [fetchRun]);

  async function finalize() {
    setActionError(null);
    try {
      await apiClient(`/v1/payroll-runs/${id}/finalize`, { method: 'POST', body: {} });
      fetchRun();
    } catch (e: any) { setActionError(e.message); }
  }

  async function pay() {
    setActionError(null);
    try {
      await apiClient(`/v1/payroll-runs/${id}/pay`, {
        method: 'POST',
        body: { payment_date: paymentDate, from_asset_account_code: '1020' },
      });
      setShowPay(false);
      fetchRun();
    } catch (e: any) { setActionError(e.message); }
  }

  async function remit() {
    setActionError(null);
    if (!run) return;
    try {
      await apiClient(`/v1/payroll-runs/${id}/remit`, {
        method: 'POST',
        body: {
          remittance_date: remitDate,
          from_asset_account_code: '1020',
          remit_employee_eobi_pkr: run.line_items.reduce((s, l) => s + l.eobi_employee_pkr, 0),
          remit_employer_eobi_pkr: run.total_employer_eobi_pkr,
          remit_income_tax_pkr: run.line_items.reduce((s, l) => s + l.income_tax_pkr, 0),
        },
      });
      setShowRemit(false);
      fetchRun();
    } catch (e: any) { setActionError(e.message); }
  }

  async function viewSlip(lineId: string) {
    try {
      const slip = await apiClient<any>(`/v1/payroll-runs/${id}/lines/${lineId}/slip`);
      alert(
        `Salary Slip — ${slip.runNumber}\n` +
        `${slip.employeeName} (${slip.employeeDesignation ?? 'N/A'})\n` +
        `Period: ${slip.payrollPeriod}\n\n` +
        `Gross: Rs. ${slip.grossPay.toLocaleString()}\n` +
        `EOBI (employee): Rs. ${slip.eobiEmployee.toLocaleString()}\n` +
        `Income tax: Rs. ${slip.incomeTax.toLocaleString()}\n` +
        `Other deductions: Rs. ${slip.otherDeductions.toLocaleString()}\n` +
        `─────────────────\n` +
        `Net Pay: Rs. ${slip.netPay.toLocaleString()}`,
      );
    } catch (e: any) { alert(e.message); }
  }

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (!run) return <div className="p-8 text-red-700">Run not found</div>;

  return (
    <div>
      <button onClick={() => router.push('/accounting/payroll/runs')} className="text-sm text-blue-600 hover:underline mb-4">← Back to runs</button>

      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-mono text-sm text-gray-500">{run.run_number}</div>
            <h1 className="text-2xl font-bold text-gray-900">
              Payroll {run.period_year}-{String(run.period_month).padStart(2, '0')} ({run.payroll_type === 'MONTHLY_SALARY' ? 'Salary' : 'Wages'})
            </h1>
            <div className="text-sm text-gray-600 mt-1">{run.period_from} → {run.period_to}</div>
          </div>
          <span className={`px-3 py-1 text-sm font-medium rounded-full ${STATUS_COLORS[run.status]}`}>{run.status}</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div><div className="text-xs text-gray-500 uppercase">Total Gross</div><div className="text-lg font-semibold">Rs. {run.total_gross_pkr.toLocaleString()}</div></div>
          <div><div className="text-xs text-gray-500 uppercase">Deductions</div><div className="text-lg font-semibold text-orange-700">Rs. {run.total_deductions_pkr.toLocaleString()}</div></div>
          <div><div className="text-xs text-gray-500 uppercase">Employer EOBI</div><div className="text-lg font-semibold">Rs. {run.total_employer_eobi_pkr.toLocaleString()}</div></div>
          <div><div className="text-xs text-gray-500 uppercase">Net Payable</div><div className="text-lg font-semibold text-green-700">Rs. {run.total_net_payable_pkr.toLocaleString()}</div></div>
        </div>

        <div className="mt-4 text-sm text-gray-600 space-y-1">
          {run.payroll_journal_entry_id && <div>Payroll JE: <button onClick={() => router.push(`/accounting/journal-entries/${run.payroll_journal_entry_id}`)} className="text-blue-600 hover:underline font-mono">{run.payroll_journal_entry_id.slice(0, 8)}…</button></div>}
          {run.payment_journal_entry_id && <div>Payment JE-16: <button onClick={() => router.push(`/accounting/journal-entries/${run.payment_journal_entry_id}`)} className="text-blue-600 hover:underline font-mono">{run.payment_journal_entry_id.slice(0, 8)}…</button></div>}
          {run.remittance_journal_entry_id && <div>Remittance JE-16B: <button onClick={() => router.push(`/accounting/journal-entries/${run.remittance_journal_entry_id}`)} className="text-blue-600 hover:underline font-mono">{run.remittance_journal_entry_id.slice(0, 8)}…</button></div>}
        </div>

        {actionError && <div className="text-red-700 bg-red-50 px-3 py-2 rounded text-sm mt-4">{actionError}</div>}

        <div className="mt-4 flex gap-2">
          {isManager && run.status === 'DRAFT' && (
            <button onClick={finalize} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">Finalize (post JE-15{run.payroll_type === 'DAILY_WAGES' ? 'B' : ''})</button>
          )}
          {isManager && run.status === 'FINALIZED' && (
            <button onClick={() => setShowPay(true)} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">Pay (post JE-16)</button>
          )}
          {isOwner && run.status !== 'DRAFT' && !run.remittance_journal_entry_id && (
            <button onClick={() => setShowRemit(true)} className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700">Remit EOBI/Tax (JE-16B)</button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-3 border-b">
          <h2 className="font-semibold">Line Items ({run.line_items.length} employees)</h2>
        </div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Employee</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Days</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Gross</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">EOBI (E)</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Tax</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Other</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Net Pay</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {run.line_items.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-3 text-sm font-medium">{l.employee_name}</td>
                <td className="px-4 py-3 text-sm text-right">{l.days_worked ?? '—'}</td>
                <td className="px-4 py-3 text-sm text-right">{l.gross_pay_pkr.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-right text-orange-700">{l.eobi_employee_pkr.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-right">{l.income_tax_pkr.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-right">{l.other_deductions_pkr.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-right font-medium text-green-700">{l.net_pay_pkr.toLocaleString()}</td>
                <td className="px-4 py-3 text-right">
                  {isAccountant && (
                    <button onClick={() => viewSlip(l.id)} className="text-blue-600 hover:underline text-sm">Slip</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showPay && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Pay Salaries</h3>
            <p className="text-sm text-gray-600 mb-3">Posts JE-16: DR 2030 Rs. {run.total_net_payable_pkr.toLocaleString()} / CR 1020.</p>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date</label>
            <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="w-full border rounded-lg px-3 py-2 mb-4" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowPay(false)} className="border border-gray-300 px-4 py-2 rounded-lg">Cancel</button>
              <button onClick={pay} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">Pay</button>
            </div>
          </div>
        </div>
      )}

      {showRemit && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Remit EOBI / Tax</h3>
            <p className="text-sm text-gray-600 mb-3">Posts JE-16B clearing 2060/2061/2070 against 1020.</p>
            <label className="block text-sm font-medium text-gray-700 mb-1">Remittance Date</label>
            <input type="date" value={remitDate} onChange={(e) => setRemitDate(e.target.value)} className="w-full border rounded-lg px-3 py-2 mb-4" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowRemit(false)} className="border border-gray-300 px-4 py-2 rounded-lg">Cancel</button>
              <button onClick={remit} className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700">Remit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
