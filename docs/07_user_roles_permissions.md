# ColdChain — User Roles & Permissions

**Version**: 1.0  
**Date**: March 2026

---

## 1. Role Definitions

| Role | Description | Typical User |
|---|---|---|
| **OWNER** | Full system access; business owner; can manage all settings, users, and data | Cold store proprietor |
| **MANAGER** | Operational authority; can authorize overrides, approve transfers, finalize bills | Senior facility manager |
| **OPERATOR** | Day-to-day data entry; inbound/outbound processing; cannot approve overrides | Gate/floor operator |
| **SECURITY GUARD** | Strictly physical gate control; records vehicle arrival/departure | Main Gate Security |
| **ACCOUNTANT** | Financial views and payment recording; no operational mutations | In-house accounts person |
| **VIEWER** | Read-only access to reference data and records it is granted | External or internal auditor |

> **Implementation note.** The six roles above are fixed. The design-era "AUDITOR" role ships as **VIEWER** (`UserRole` enum: `OWNER, MANAGER, ACCOUNTANT, OPERATOR, SECURITY, VIEWER`).

---

## 1a. Permission Model (Phase 15 — owner-configurable)

As of Phase 15, authorization is a **capability matrix the owner can edit**, not a
hardcoded role hierarchy. The source of truth is the permission registry in
`packages/shared/src/permissions.ts` (42 keys). Each key has a `defaultMinRole`
that **exactly reproduces the pre-Phase-15 `requireMinRole` threshold**, so with
no customization the effective permissions are identical to the historical
behaviour documented in the matrix below. The API enforces every key at the
route boundary via `app.requirePermission(key)`; `login` / `/me` return the
caller's effective key list, and the web app gates nav/actions with `can(user, key)`.

- **Owner customization**: `Settings → Permissions` (`GET/PUT /v1/permissions`,
  `POST /v1/permissions/reset`) stores a per-role `{grant, revoke}` delta over the
  defaults. OWNER always holds every key. Three keys are **alwaysOwner** (never
  delegable): `users.manage`, `settings.manage`, `permissions.manage`.
- **Fixed rules outside the matrix** (deliberate audit controls, still seniority-based
  via `roleAtLeast`): KATCHI book access (MANAGER read / OWNER write), backdating and
  third-party release (MANAGER+), and gate-pass credit authorization (MANAGER+).
  Reference-data GET routes remain authenticate-only so every role keeps the read
  access it has today.

**Registry keys by group** (default minimum role in parentheses; the owner may grant/revoke per role):

- **Parties**: `parties.manage`(OPERATOR), `parties.delete`(MANAGER)
- **Commodities**: `commodities.manage`(MANAGER)
- **Rooms & Racks**: `chambers.manage`(MANAGER), `chambers.log_temperature`(OPERATOR)
- **Inbound & Lots**: `lots.manage`(OPERATOR), `lots.transfer_ownership`(MANAGER)
- **Outbound**: `outbound.record`(OPERATOR), `outbound.finalize`(MANAGER)
- **Gate Pass**: `gate_passes.log`(SECURITY), `gate_passes.link_lot`(OPERATOR)
- **Billing**: `rate_plans.manage`(MANAGER), `service_charges.manage`(MANAGER), `billing.view`(ACCOUNTANT), `invoices.manage`(MANAGER), `invoices.write_off`(OWNER), `payments.record`(ACCOUNTANT)
- **Accounting**: `accounting.view`(ACCOUNTANT), `accounting.manage_accounts`(OWNER), `accounting.post_journal`(MANAGER), `accounting.period_lock`(MANAGER), `accounting.period_unlock`(OWNER)
- **Fixed Assets**: `fixed_assets.manage`(OWNER)
- **Payroll & HR**: `payroll.view`(ACCOUNTANT), `employees.manage`(MANAGER), `employees.terminate`(OWNER), `payroll.draft`(ACCOUNTANT), `payroll.finalize`(MANAGER), `payroll.remit`(OWNER)
- **Expenses**: `expenses.record`(ACCOUNTANT), `expenses.approve`(MANAGER)
- **Loans (Peshgi)**: `loans.view`(ACCOUNTANT), `loans.issue`(OWNER), `loans.record_repayment`(MANAGER)
- **Reports**: `reports.operational`(OPERATOR), `reports.inventory`(MANAGER), `reports.financial`(ACCOUNTANT), `reports.seasonal`(OWNER)
- **Administration**: `users.manage`(OWNER·alwaysOwner), `settings.manage`(OWNER·alwaysOwner), `permissions.manage`(OWNER·alwaysOwner), `audit.view`(OWNER)

### Account security & administration (Phase 15)

- **Self-service password reset** via emailed OTP (`/v1/auth/forgot-password`,
  `/reset-password`); owner admin-reset remains the offline fallback.
- **Optional email 2FA at login** (per user); offline boxes fall back to
  password-only login with a warning rather than locking out.
- **Session management**: each user reviews and revokes their own devices
  (`/v1/auth/sessions`); admins (`users.manage`) can force sign-out
  (`/v1/users/:id/sessions`).
- **Activity log viewer** (`audit.view`, `GET /v1/audit-logs`) over the DB audit
  trail, with password/secret fields masked server-side.
- **Email notifications**: opt-in daily digest to the admin email
  (`settings.manage`), configured under `Settings → Notifications`.

The table below is the historical feature-level view; it now represents the
**default grants** that ship out of the box and that the owner may customize.

---

## 2. Permissions Matrix

| Feature | OWNER | MANAGER | OPERATOR | SECURITY | ACCOUNTANT | VIEWER |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Party Management** ||||||
| Create / edit party | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Deactivate party | ✅ | ✅ | ❌ | ❌ | ❌ |
| Merge duplicate parties | ✅ | ❌ | ❌ | ❌ | ❌ |
| View party ledger | ✅ | ✅ | ✅ | ✅ | ✅ |
| Set credit limit | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Inbound & Lot Management** |||||
| Create inbound lot | ✅ | ✅ | ✅ | ❌ | ❌ |
| Backdate lot entry | ✅ | ✅ | ❌ | ❌ | ❌ |
| Override weight dispute flag | ✅ | ✅ | ❌ | ❌ | ❌ |
| Reprint storage receipt | ✅ | ✅ | ✅ | ❌ | ❌ |
| View lot details | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Ownership Transfer** |||||
| Initiate full ownership transfer | ✅ | ✅ | ❌ | ❌ | ❌ |
| Initiate partial ownership transfer | ✅ | ✅ | ❌ | ❌ | ❌ |
| View ownership history | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Outbound & Dispatch** |||||
| Initiate withdrawal | ✅ | ✅ | ✅ | ❌ | ❌ |
| Finalize invoice | ✅ | ✅ | ❌ | ❌ | ❌ |
| Override invoice total | ✅ | ✅ | ❌ | ❌ | ❌ |
| Generate dispatch note | ✅ | ✅ | ✅ | ❌ | ❌ |
| Backdate outbound | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Billing Engine** |||||
| Create / edit rate plans | ✅ | ✅ | ❌ | ❌ | ❌ |
| Create / edit service charges | ✅ | ✅ | ❌ | ❌ | ❌ |
| Issue credit note | ✅ | ✅ | ❌ | ✅ | ❌ |
| View all invoices | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Quality & Spoilage** |||||
| Log quality inspection | ✅ | ✅ | ✅ | ❌ | ❌ |
| Create spoilage record | ✅ | ✅ | ✅ | ❌ | ❌ |
| Confirm spoilage (adjust quantity) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Dispute spoilage record | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Financial Ledger & Payments** |||||
| Record payment | ✅ | ✅ | ❌ | ✅ | ❌ |
| Record advance payment | ✅ | ✅ | ❌ | ✅ | ❌ |
| Mark cheque as dishonoured | ✅ | ✅ | ❌ | ✅ | ❌ |
| Allocate payment to invoices | ✅ | ✅ | ❌ | ✅ | ❌ |
| View party ledger / AR aging | ✅ | ✅ | ❌ | ✅ | ✅ |
| Export party statement | ✅ | ✅ | ❌ | ✅ | ✅ |
| **Accounting — Chart of Accounts** |||||
| View Chart of Accounts | ✅ | ✅ | ❌ | ✅ | ✅ |
| Add new account | ✅ | ❌ | ❌ | ❌ | ❌ |
| Rename / deactivate account | ✅ | ❌ | ❌ | ❌ | ❌ |
| Delete system-protected account | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Accounting — Journal Entries & GL** |||||
| View journal entries (auto-generated) | ✅ | ✅ | ❌ | ✅ | ✅ |
| View GL account ledger | ✅ | ✅ | ❌ | ✅ | ✅ |
| Create manual journal entry (draft) | ✅ | ❌ | ❌ | ✅ | ❌ |
| Post manual journal entry | ✅ | ❌ | ❌ | ❌ | ❌ |
| Reverse a posted journal entry | ✅ | ❌ | ❌ | ❌ | ❌ |
| Write off bad debt | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Accounting — Statements & Periods** |||||
| View Trial Balance | ✅ | ✅ | ❌ | ✅ | ✅ |
| View P&L Statement | ✅ | ❌ | ❌ | ✅ | ✅ |
| View Balance Sheet | ✅ | ❌ | ❌ | ✅ | ✅ |
| View Revenue by Commodity | ✅ | ✅ | ❌ | ✅ | ✅ |
| View GST Output Summary | ✅ | ❌ | ❌ | ✅ | ✅ |
| Lock accounting period | ✅ | ❌ | ❌ | ❌ | ❌ |
| Unlock locked period (override) | ✅ | ❌ | ❌ | ❌ | ❌ |
| View AR Reconciliation report | ✅ | ✅ | ❌ | ✅ | ✅ |
| **Cost Accounting — Fixed Assets & HR** |||||
| Create/Edit fixed assets | ✅ | ❌ | ❌ | ✅ | ❌ |
| Run depreciation batch | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Dispose of fixed asset | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage employee roster | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Draft payroll runs | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Finalize payroll runs | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Record expense voucher (draft) | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Approve expense voucher | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Pay expense voucher | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Mandi Context (Phase 5)** ||||||
| Log Inward/Outward Gate Pass | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Issue Peshgi (Advance Loan) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Record Peshgi Recovery | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Soft Edit/Delete "KATCHI" Record | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Toggle Katchi/Pacci Filters | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| **Chamber Management** ||||||
| Create / edit chambers | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| View chamber occupancy | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Log temperature | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Decommission chamber | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Reporting** ||||||
| View operational dashboard | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| View financial dashboard | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| Run / export any report | ✅ | ✅ | Limited | ❌ | ✅ | ✅ |
| **System Administration** ||||||
| Create / edit users | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Assign roles | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Configure system settings | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View audit log | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |

*OPERATOR report access is limited to: Lot Listing, Chamber Occupancy, Today's Inbound/Outbound.*
*SECURITY GUARD access is strictly limited to the Gate Pass interface.*

---

## 3. Override Capabilities

| Override Action | Required Role | Audit Requirement |
|---|---|---|
| Backdate lot entry | MANAGER or above | Mandatory reason field |
| Override weight dispute | MANAGER or above | Resolution note required |
| Override invoice total | MANAGER or above | Adjustment reason required |
| Adjust lot quantity (spoilage) | MANAGER or above | Spoilage report linked |
| Backdate outbound | MANAGER or above | Mandatory reason field |
| Soft Edit/Delete Katchi Record | OWNER only | Shadow audit record; silent in frontend |
| Merge parties | OWNER only | Confirmation dialog + log |
| Change rate plan mid-storage | MANAGER or above | Old/new rate + effective date logged |
| Post manual journal entry | OWNER only | Balanced lines required; purpose note |
| Reverse posted journal entry | OWNER only | Reversal reason mandatory; original entry referenced |
| Unlock locked accounting period | OWNER only | Reason logged; correction posted in current period |
| Write off bad debt | OWNER only | Invoice reference + write-off justification |

---

## 4. Role Assignment Rules

- Every user has exactly one role per facility
- In multi-facility scenarios (Phase 3), a user can have different roles in different facilities
- Role assignment is performed exclusively by OWNER
- A facility must always have at least one active OWNER — cannot demote the last OWNER
- Deactivated users lose all system access immediately; their historical records are preserved

---

## 5. Session Policies

| Policy | Value |
|---|---|
| Session duration | 8 hours |
| Idle timeout | 30 minutes |
| Concurrent sessions | 3 max per user |
| Password minimum | 8 characters, at least 1 number |
| MFA | Optional in MVP; mandatory for OWNER in Phase 2 |
| Failed login lockout | 5 attempts → 15 min lockout |
