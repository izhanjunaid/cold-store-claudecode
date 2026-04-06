# ColdChain — Non-Functional Requirements

**Version**: 1.0  
**Date**: March 2026

---

## 1. Performance

| Requirement | Target | Notes |
|---|---|---|
| Page load time (initial) | < 3 seconds | On 4G connection (25 Mbps) |
| API response time (p95) | < 500ms | Operational endpoints |
| API response time — Report endpoints | < 5 seconds | Complex aggregations |
| Concurrent users (MVP) | 15 simultaneous | Single facility |
| Concurrent users (Phase 2) | 50 simultaneous | With read replicas |
| Inbound lot creation throughput | 30 lots/hour | Peak season scenario |
| Invoice generation | < 5 seconds (including PDF) | End-to-end |
| Search response time | < 1 second | Party/lot autocomplete |

**Peak Season Load**  
Feb–May is peak intake season. The system must handle a sustained 5–8x normal load during this period without degradation. Minimum capacity: 100 lot creation events per day.

---

## 2. Availability & Reliability

| Requirement | Target |
|---|---|
| System uptime (SLA) | 99.5% monthly (< 4 hours downtime/month) |
| Planned maintenance window | Sundays 02:00–04:00 PKT |
| Recovery Time Objective (RTO) | < 2 hours |
| Recovery Point Objective (RPO) | < 15 minutes (transaction log shipping) |
| Database backup frequency | Daily full + continuous WAL archiving |
| Backup retention | 30 days |
| Multi-AZ failover | Phase 2 (single-zone acceptable for MVP) |

---

## 3. Data Integrity

| Requirement | Mechanism |
|---|---|
| ACID transactions | PostgreSQL with explicit transactions on all multi-table writes |
| Audit log completeness | Trigger-based; all mutations logged to `audit_log` |
| No hard deletes | Soft delete pattern (is_active = false) on all party/lot records |
| Lot balance accuracy | DB-level CHECK constraint (non-negative balance) |
| Invoice immutability | Status machine; finalized invoices cannot be edited |
| Ownership history immutability | DB rule preventing DELETE on `ownership_history` |
| Concurrent write safety | Optimistic locking on lot balance updates (version field) |

---

## 4. Security

| Area | Requirement |
|---|---|
| Authentication | JWT; 8h access token; refresh token rotation |
| Authorization | RBAC; all endpoints enforce role checks server-side |
| Data in transit | HTTPS everywhere; TLS 1.2+ |
| Data at rest | PostgreSQL encryption (pgcrypto for sensitive fields: CNIC) |
| Secrets management | Environment variables only; no secrets in codebase |
| OWASP Top 10 | All vulnerabilities addressed before production release |
| SQL injection | Parameterized queries (ORM enforced); no raw string interpolation |
| File upload security | MIME type validation; max 5 MB per file; virus scan (Phase 2) |
| Rate limiting | 100 req/min per user; 20 POST /lots per minute per facility |
| Session invalidation | On logout, role change, or deactivation |

---

## 5. Usability

| Requirement | Target |
|---|---|
| Inbound lot creation — operator time | < 3 minutes for a trained operator |
| Training time for new operator | < 4 hours to handle inbound + outbound independently |
| Language support | English (primary); Urdu labels on printed receipts and high-frequency screens |
| Device support | Chrome/Firefox on Windows desktop; Chrome on Android tablet |
| Screen resolution | Minimum 1280×720; optimized for 1920×1080 |
| Touch-friendly tablet UI | Key operational screens usable with finger touch on 10" tablet |
| Offline behavior (MVP) | Graceful error message if connectivity lost; no data loss on reconnect |
| Error messages | Plain language; actionable; no technical codes shown to operators |
| Number formatting | Pakistani comma convention (1,00,000 — lakh system) OR international; configurable |

---

## 6. Scalability

| Dimension | MVP Limit | Scale-Up Trigger |
|---|---|---|
| Parties per facility | 10,000 | No practical limit with indexing |
| Active lots per facility | 5,000 concurrent | No practical limit with indexing |
| Invoices per year | 50,000 | Partition table at 500k |
| Total DB size | < 10 GB/year | Upgrade DB tier at 50 GB |
| Facilities (multi-tenant) | 1 (MVP) | Architecture supports 100+ |
| Users per facility | 25 | No practical limit |

---

## 7. Maintainability

| Requirement | Standard |
|---|---|
| Code language | TypeScript (strict mode) throughout backend and frontend |
| Test coverage | Minimum 70% unit test coverage on business logic services |
| API documentation | OpenAPI 3.0 spec auto-generated and kept in sync |
| Migration strategy | All DB changes via versioned migration files (no manual schema edits) |
| Deployment | CI/CD pipeline; zero-downtime deployments via rolling updates |
| Monitoring | Structured logging (JSON); error tracking (Sentry); uptime monitoring |
| Alerting | Alert on: API error rate > 1%, DB connection pool > 80%, response time p95 > 2s |
| Dependency auditing | `npm audit` run on every CI build |

---

## 8. Compliance & Data Governance

| Area | Requirement |
|---|---|
| Data retention | Operational records retained minimum 5 years |
| Right to delete (client data) | Not applicable (Pakistan does not have GDPR equivalent); best practice: anonymize inactive parties after 7 years |
| GST compliance | System supports optional GST fields; does not enforce tax filing |
| Audit readiness | Full audit log available for any date range; exportable |
| CNIC handling | Optional capture; stored but not transmitted to third parties |
| Data sovereignty | Production database hosted in Pakistan or UAE (nearest region); no EU/US data residency requirement currently |
