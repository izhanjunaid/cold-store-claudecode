'use client';

import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/layout/page-header';
import { ExpenseVoucherForm } from '../expense-voucher-form';

export default function NewExpenseVoucherPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canCreate = can(user, 'expenses.record');

  if (!canCreate) {
    return (
      <div>
        <PageHeader title="New Expense Voucher" />
        <p className="text-muted-foreground">Requires ACCOUNTANT role or higher.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="New Expense Voucher" crumb="New" />
      <ExpenseVoucherForm
        onCreated={(v) => router.push(`/accounting/expenses/${v.id}`)}
        onCancel={() => router.back()}
      />
    </div>
  );
}
