// ============================================================================
// Permission registry — the owner-configurable capability matrix (Phase 15).
//
// Each key is a named capability enforced at a route boundary via the API's
// requirePermission(key) guard. `defaultMinRole` reproduces the pre-Phase-15
// requireMinRole threshold for the routes the key covers, so with no owner
// overrides the effective permissions are byte-for-byte identical to the old
// role hierarchy. Owners edit a delta (grant/revoke) per role on top of these
// defaults; OWNER implicitly holds every key. `alwaysOwner` keys are locked to
// OWNER (never grantable) to prevent privilege-escalation / self-lockout.
//
// NOT in this matrix (deliberately fixed business rules, documented in
// docs/07): KATCHI book access (MANAGER read / OWNER write — an audit control),
// backdating and third-party release (MANAGER+, seniority-based). Reference-data
// GET routes stay authenticate-only so every role keeps read access it has today.
// ============================================================================

export type Role = 'OWNER' | 'MANAGER' | 'ACCOUNTANT' | 'OPERATOR' | 'SECURITY' | 'VIEWER';

export const ROLES: Role[] = ['OWNER', 'MANAGER', 'ACCOUNTANT', 'OPERATOR', 'SECURITY', 'VIEWER'];
export const EDITABLE_ROLES: Role[] = ['MANAGER', 'ACCOUNTANT', 'OPERATOR', 'SECURITY', 'VIEWER'];

// Hierarchy shared with the API auth plugin and web rbac helper.
export const ROLE_RANK: Record<Role, number> = {
  OWNER: 6,
  MANAGER: 5,
  ACCOUNTANT: 4,
  OPERATOR: 3,
  SECURITY: 2,
  VIEWER: 1,
};

export interface PermissionDef {
  key: string;
  group: string;
  label: string;
  description: string;
  defaultMinRole: Role;
  alwaysOwner?: boolean;
}

export const PERMISSION_REGISTRY: PermissionDef[] = [
  // Parties
  { key: 'parties.manage', group: 'Parties', label: 'Create & edit parties', description: 'Add or update farmers, traders, arhtis and buyers.', defaultMinRole: 'OPERATOR' },
  { key: 'parties.delete', group: 'Parties', label: 'Deactivate parties', description: 'Soft-delete a party record.', defaultMinRole: 'MANAGER' },

  // Commodities
  { key: 'commodities.manage', group: 'Commodities', label: 'Manage commodities & varieties', description: 'Add or edit commodities and their varieties.', defaultMinRole: 'MANAGER' },

  // Rooms & racks
  { key: 'chambers.manage', group: 'Rooms & Racks', label: 'Manage rooms & racks', description: 'Create or edit rooms (chambers) and their racks.', defaultMinRole: 'MANAGER' },
  { key: 'chambers.log_temperature', group: 'Rooms & Racks', label: 'Log temperature', description: 'Record room temperature readings.', defaultMinRole: 'OPERATOR' },

  // Lots
  { key: 'lots.manage', group: 'Inbound & Lots', label: 'Create, edit & place lots', description: 'Intake lots, edit them, set rack placements, move lots, print storage receipts.', defaultMinRole: 'OPERATOR' },
  { key: 'lots.transfer_ownership', group: 'Inbound & Lots', label: 'Transfer lot ownership', description: 'Record mid-storage ownership transfers and print acknowledgments.', defaultMinRole: 'MANAGER' },

  // Outbound
  { key: 'outbound.record', group: 'Outbound & Dispatch', label: 'Record withdrawals', description: 'Create outbound events, record weigh-out, print dispatch notes.', defaultMinRole: 'OPERATOR' },
  { key: 'outbound.finalize', group: 'Outbound & Dispatch', label: 'Finalize outbound', description: 'Finalize an outbound event (generates the invoice).', defaultMinRole: 'MANAGER' },

  // Gate pass
  { key: 'gate_passes.log', group: 'Gate Pass', label: 'Log & view gate passes', description: 'Record vehicle inward/outward movements and view the gate log.', defaultMinRole: 'SECURITY' },
  { key: 'gate_passes.link_lot', group: 'Gate Pass', label: 'Link gate pass to lot', description: 'Attach a lot to a gate pass entry.', defaultMinRole: 'OPERATOR' },

  // Billing
  { key: 'rate_plans.manage', group: 'Billing', label: 'Manage rate plans', description: 'Create, edit or deactivate storage rate plans.', defaultMinRole: 'MANAGER' },
  { key: 'service_charges.manage', group: 'Billing', label: 'Manage service charges', description: 'Create, edit or deactivate service charges.', defaultMinRole: 'MANAGER' },
  { key: 'billing.view', group: 'Billing', label: 'View invoices & payments', description: 'View invoice lists, payments, credit notes and party ledgers.', defaultMinRole: 'ACCOUNTANT' },
  { key: 'invoices.manage', group: 'Billing', label: 'Edit & finalize invoices', description: 'Edit draft invoices, add/remove lines, apply discounts, finalize, issue credit notes.', defaultMinRole: 'MANAGER' },
  { key: 'invoices.write_off', group: 'Billing', label: 'Write off invoices (bad debt)', description: 'Write off an unpaid invoice as bad debt.', defaultMinRole: 'OWNER' },
  { key: 'invoices.void', group: 'Billing', label: 'Void invoices', description: 'Void a finalized, unpaid invoice (reverses its journal entry).', defaultMinRole: 'OWNER' },
  { key: 'payments.record', group: 'Billing', label: 'Record payments', description: 'Record, allocate and dishonour payments.', defaultMinRole: 'ACCOUNTANT' },

  // Accounting
  { key: 'accounting.view', group: 'Accounting', label: 'View accounting', description: 'View chart of accounts, journals, general ledger, statements and fixed-asset registers.', defaultMinRole: 'ACCOUNTANT' },
  { key: 'accounting.manage_accounts', group: 'Accounting', label: 'Manage chart of accounts', description: 'Add or edit accounts in the chart of accounts.', defaultMinRole: 'OWNER' },
  { key: 'accounting.post_journal', group: 'Accounting', label: 'Post journal entries', description: 'Create, post and reverse journal entries; enter opening balances.', defaultMinRole: 'MANAGER' },
  { key: 'accounting.period_lock', group: 'Accounting', label: 'Lock accounting periods', description: 'Close (lock) an accounting period.', defaultMinRole: 'MANAGER' },
  { key: 'accounting.period_unlock', group: 'Accounting', label: 'Unlock accounting periods', description: 'Re-open a locked accounting period.', defaultMinRole: 'OWNER' },

  // Fixed assets
  { key: 'fixed_assets.manage', group: 'Fixed Assets', label: 'Manage fixed assets', description: 'Create, commission and dispose assets; run depreciation.', defaultMinRole: 'OWNER' },
  { key: 'fixed_assets.reverse', group: 'Fixed Assets', label: 'Reverse asset disposal', description: 'Undo a disposal posted in error (reverses its journal entry).', defaultMinRole: 'OWNER' },

  // Payroll & HR
  { key: 'payroll.view', group: 'Payroll & HR', label: 'View payroll & employees', description: 'View employees, payroll runs and salary slips.', defaultMinRole: 'ACCOUNTANT' },
  { key: 'employees.manage', group: 'Payroll & HR', label: 'Manage employees', description: 'Create or edit employee records.', defaultMinRole: 'MANAGER' },
  { key: 'employees.terminate', group: 'Payroll & HR', label: 'Terminate employees', description: 'Mark an employee as terminated.', defaultMinRole: 'OWNER' },
  { key: 'payroll.draft', group: 'Payroll & HR', label: 'Draft payroll', description: 'Create payroll run drafts and edit their lines.', defaultMinRole: 'ACCOUNTANT' },
  { key: 'payroll.finalize', group: 'Payroll & HR', label: 'Finalize & pay payroll', description: 'Finalize and pay payroll runs.', defaultMinRole: 'MANAGER' },
  { key: 'payroll.remit', group: 'Payroll & HR', label: 'Remit deductions', description: 'Remit payroll deductions to authorities.', defaultMinRole: 'OWNER' },
  { key: 'payroll.reverse', group: 'Payroll & HR', label: 'Reverse a payroll run', description: 'Reverse a finalized or paid run posted in error (reverses its journal entries).', defaultMinRole: 'OWNER' },

  // Expenses
  { key: 'expenses.record', group: 'Expenses', label: 'Record expenses', description: 'View and record expense vouchers, petty-cash, accrue and pay.', defaultMinRole: 'ACCOUNTANT' },
  { key: 'expenses.approve', group: 'Expenses', label: 'Approve expenses', description: 'Approve or cancel expense vouchers.', defaultMinRole: 'MANAGER' },

  // Loans (Peshgi)
  { key: 'loans.view', group: 'Loans (Peshgi)', label: 'View loans', description: 'View loans and print acknowledgments.', defaultMinRole: 'ACCOUNTANT' },
  { key: 'loans.issue', group: 'Loans (Peshgi)', label: 'Issue & write off loans', description: 'Issue new loans and write off outstanding loans.', defaultMinRole: 'OWNER' },
  { key: 'loans.record_repayment', group: 'Loans (Peshgi)', label: 'Record loan repayments', description: 'Record repayments against a loan.', defaultMinRole: 'MANAGER' },

  // Reports
  { key: 'reports.operational', group: 'Reports', label: 'Operational dashboard', description: 'View the operational dashboard.', defaultMinRole: 'OPERATOR' },
  { key: 'reports.inventory', group: 'Reports', label: 'Inventory reports', description: 'Lot aging, commodity inventory, weight variance, ownership transfers.', defaultMinRole: 'MANAGER' },
  { key: 'reports.financial', group: 'Reports', label: 'Financial reports', description: 'Receivables aging and party statements.', defaultMinRole: 'ACCOUNTANT' },
  { key: 'reports.seasonal', group: 'Reports', label: 'Seasonal summary', description: 'View the seasonal summary report.', defaultMinRole: 'OWNER' },

  // Administration
  { key: 'users.manage', group: 'Administration', label: 'Manage users', description: 'Create, edit and reset users; manage their sessions.', defaultMinRole: 'OWNER', alwaysOwner: true },
  { key: 'settings.manage', group: 'Administration', label: 'Manage settings', description: 'Edit facility settings, email and notifications.', defaultMinRole: 'OWNER', alwaysOwner: true },
  { key: 'permissions.manage', group: 'Administration', label: 'Manage permissions', description: 'Edit the role permission matrix.', defaultMinRole: 'OWNER', alwaysOwner: true },
  { key: 'audit.view', group: 'Administration', label: 'View activity log', description: 'View the facility activity (audit) log.', defaultMinRole: 'OWNER' },
];

export const ALL_PERMISSION_KEYS: string[] = PERMISSION_REGISTRY.map((p) => p.key);

const REGISTRY_BY_KEY = new Map(PERMISSION_REGISTRY.map((p) => [p.key, p]));

export function isPermissionKey(key: string): boolean {
  return REGISTRY_BY_KEY.has(key);
}

export function isAlwaysOwnerKey(key: string): boolean {
  return REGISTRY_BY_KEY.get(key)?.alwaysOwner === true;
}

// A per-role override on top of the registry defaults.
export interface RoleDelta {
  grant: string[];
  revoke: string[];
}
export type PermissionOverrides = Partial<Record<Role, RoleDelta>>;

/** Default permission keys for a role (no overrides). OWNER holds everything. */
export function defaultPermissionsForRole(role: Role): string[] {
  if (role === 'OWNER') return [...ALL_PERMISSION_KEYS];
  const rank = ROLE_RANK[role] ?? 0;
  return PERMISSION_REGISTRY.filter((p) => rank >= ROLE_RANK[p.defaultMinRole]).map((p) => p.key);
}

/**
 * Effective permission keys for a role given the facility's overrides.
 * OWNER always has all keys. alwaysOwner keys can never be granted to a
 * non-owner. Grants add, revokes remove, on top of the role defaults.
 */
export function computeEffectivePermissions(role: Role, overrides?: PermissionOverrides): string[] {
  if (role === 'OWNER') return [...ALL_PERMISSION_KEYS];
  const set = new Set(defaultPermissionsForRole(role));
  const delta = overrides?.[role];
  if (delta) {
    for (const key of delta.grant) {
      if (REGISTRY_BY_KEY.has(key) && !isAlwaysOwnerKey(key)) set.add(key);
    }
    for (const key of delta.revoke) {
      set.delete(key);
    }
  }
  // Never leak alwaysOwner keys to a non-owner regardless of stored data.
  for (const p of PERMISSION_REGISTRY) {
    if (p.alwaysOwner) set.delete(p.key);
  }
  return [...set];
}
