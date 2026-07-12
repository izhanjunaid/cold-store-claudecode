# Phase 15 — Auth, Permissions & Notifications

Owner-facing security & administration upgrade: self-service password reset via email OTP,
email 2FA, an Odoo/ERPNext-style **owner-configurable permission matrix**, session management,
an activity-log viewer over the existing `audit_log`, and daily-digest email notifications.
Branch: `phase/15-auth-permissions` (off `phase/14-rooms-racks`).

## Approved design decisions

- **Email**: Gmail SMTP via app password (generic SMTP fields, `smtp.gmail.com:587` defaults),
  owner-configured in Settings → Email with a "Send test email" button. SMTP password stored
  **encrypted** (aes-256-gcm; `APP_ENCRYPTION_KEY` or sha256 of `JWT_SECRET`) because the
  `audit_facilities` trigger snapshots settings JSON into `audit_log`. Every send is on-demand,
  time-boxed and non-fatal — the box may legitimately be offline; features degrade gracefully.
- **OTP password reset**: 6-digit code to the **user's own email** (10-min expiry, single-use,
  5 verify attempts, tight per-route rate limits, neutral "if account exists" responses).
  On success: rotate password, clear lockout, revoke all refresh tokens. The OWNER admin-reset
  (`POST /v1/users/:id/reset-password`) remains as the offline fallback.
- **2FA**: per-user `two_factor_enabled` (aimed at OWNER). Login → password OK → pending JWT +
  emailed code → `verify-2fa` → tokens. If SMTP is unconfigured/unreachable, login **falls back
  with a `two_factor_bypassed` warning** rather than locking the owner out of an offline box.
- **Permissions**: capability matrix of **45 registry keys grouped by module × 5 editable roles**
  (fixed 6 roles; OWNER implicitly has all and is not editable; `alwaysOwner` keys —
  `users.manage`, `settings.manage`, `permissions.manage`, `accounting.katchi_write` — are
  locked rows, preventing lockout/privilege-escalation by construction). Defaults exactly
  reproduce the pre-Phase-15 `requireMinRole` thresholds, so behavior is unchanged until the
  owner edits the matrix. Storage: **delta model** `{role: {grant[], revoke[]}}` under
  `Facility.settings.permissions` (hidden key outside the Zod settings schema; upgrade-safe —
  new keys ship with defaults; audited for free by the facilities audit trigger).
  Enforcement: `requirePermission(key)` plugin (per-facility 60s cache + invalidation on PUT)
  replaces all `requireMinRole` sites; service-level special cases fold in
  (`accounting.katchi_read`/`katchi_write` via book-gate, `ops.backdate` for backdating floors).
  `login`/`me` return the effective `permissions: string[]` — the web app gates nav/pages/buttons
  from this single source (`can()`), retiring the hand-synced `ROLE_RANK` mirror in `rbac.ts`.
  Reference-data GETs stay authenticate-only (mapping them would strip VIEWER/SECURITY of
  access they have today; optional hardening later).
- **Sessions**: `RefreshToken` gains `user_agent`/`ip`/`last_used_at`; access token gains a
  `sid` claim. Self-service list/revoke (`/v1/auth/sessions*`) + owner view/revoke-all per user.
- **Activity log**: `GET /v1/audit-logs` (permission `audit.view`) with table/action/user/date
  filters + pagination; user names batch-resolved; `password_hash` and SMTP password **masked**;
  Settings → Activity Log UI with old→new field diffs. New composite index
  `(facility_id, changed_at)`.
- **Notifications**: minimal framework — daily digest (overdue invoices + storage/expiry alerts)
  to the admin email at a configured hour; plain `setInterval` 5-min tick, once-per-day dedupe
  persisted in hidden `settings.notifications_state`; disabled under test env; "Send now" button.

## Migrations

| # | Contents |
|---|----------|
| 0006 | `otp_codes` table (purpose enum `PASSWORD_RESET`/`LOGIN_2FA`, sha256 code hash, expiry, attempts, RLS) |
| 0007 | `users.two_factor_enabled` |
| 0008 | `refresh_tokens.user_agent/ip/last_used_at` |
| 0009 | `audit_log` composite index `(facility_id, changed_at)` |

## Buckets

15.1 email infra → 15.2 OTP reset → 15.3 2FA → 15.4 permissions backend (registry + guard +
119-site swap) → 15.5 permissions frontend (matrix UI + `hasMinRole`→`can()` sweep) →
15.6 sessions → 15.7 activity log → 15.8 notifications → 15.9 docs/PROGRESS/TESTING + full suite.

## Guardrails

- Parity unit test: `computeEffectivePermissions(role, {})` ⇔ old `ROLE_RANK` threshold for every
  key × role; route→key→old-min-role mapping test; CI grep gates (`requireMinRole(` gone from
  `apps/api/src/modules`, `hasMinRole` gone from `apps/web/src/app`).
- `mergeSettings` must keep preserving hidden keys (`permissions`, `notifications_state`) —
  regression test.
- OTP/session queries run through the GUC-stamped `$transaction` pattern (RLS on those tables).
- 2FA off for all seeded users → existing integration/e2e suites see the old login shape.

## Status

- [ ] 15.1 Email infrastructure
- [ ] 15.2 OTP password reset
- [ ] 15.3 Email 2FA
- [ ] 15.4 Permission matrix — backend
- [ ] 15.5 Permission matrix — frontend
- [ ] 15.6 Sessions
- [ ] 15.7 Activity log viewer
- [ ] 15.8 Email notifications
- [ ] 15.9 Docs & bookkeeping
