import { redirect } from 'next/navigation';

/** Expense vouchers are retired (docs/25 C-03): a new cost is a supplier bill. */
export default function NewExpensePage() {
  redirect('/accounting/payables/bills/new');
}
