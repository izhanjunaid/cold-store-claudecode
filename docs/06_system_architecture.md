# ColdChain — System Architecture Document

**Version**: 1.0  
**Date**: March 2026  
**Audience**: Technical architects, senior developers, DevOps

---

## 1. Architectural Principles

| Principle | Rationale |
|---|---|
| **Simplicity first** | Small team ops; complex architectures create maintenance burden |
| **Web-first** | Tablet + desktop access via browser; no native app build cost in MVP |
| **Cloud-hosted, Pakistan-region** | Low latency, local data residency preference; Azure/GCP available in Karachi |
| **Multi-tenant ready** | `facility_id` namespacing from day 1 for future multi-location rollout |
| **Audit-first** | Every mutation carries actor, timestamp, reason; no hard deletes |
| **Offline-resilient (Phase 2)** | MVP assumes connectivity; Phase 2 introduces service workers for offline entry |

---

## 2. Logical Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                        PRESENTATION LAYER                          │
│  ┌───────────────────┐   ┌───────────────────────────────────┐    │
│  │   Web App (SPA)   │   │  Printed Docs (PDF Service)       │    │
│  │   React / Next.js │   │  Receipt, Invoice, Dispatch Note  │    │
│  └─────────┬─────────┘   └──────────────────┬────────────────┘    │
└────────────┼────────────────────────────────┼────────────────────-┘
             │ HTTPS/REST or GraphQL          │
┌────────────▼────────────────────────────────▼────────────────────-┐
│                        APPLICATION LAYER                           │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  ┌──────────┐  │
│  │ Party API   │  │  Lot API    │  │ Billing    │  │ Report   │  │
│  │             │  │ (Inbound/   │  │ Engine API │  │ Service  │  │
│  │             │  │  Outbound/  │  │            │  │          │  │
│  │             │  │  Transfer)  │  │            │  │          │  │
│  └──────┬──────┘  └──────┬──────┘  └─────┬──────┘  └────┬─────┘  │
│         │                │               │               │        │
│  ┌──────▼────────────────▼───────────────▼───────────────▼──────┐ │
│  │              Core Domain Services (Business Logic)           │ │
│  │  LotService | BillingEngine | OwnershipTransferService       │ │
│  │  PartyService | QualityService | ReportingService            │ │
│  └─────────────────────────────────┬─────────────────────────--─┘ │
└───────────────────────────────────-┼───────────────────────────--─┘
                                     │
┌────────────────────────────────────▼─────────────────────────────-┐
│                          DATA LAYER                                │
│  ┌──────────────────┐   ┌──────────────┐   ┌──────────────────┐  │
│  │  PostgreSQL DB   │   │  Redis Cache │   │  File Storage    │  │
│  │  (Primary store) │   │  (Sessions,  │   │  (Photos, PDFs)  │  │
│  │                  │   │   Rate data) │   │  S3-compatible   │  │
│  └──────────────────┘   └──────────────┘   └──────────────────┘  │
└──────────────────────────────────────────────────────────────────-┘
                                     │
┌────────────────────────────────────▼─────────────────────────────-┐
│                       INTEGRATION LAYER                            │
│   ┌─────────────┐   ┌──────────────┐   ┌────────────────────┐    │
│   │ SMS Gateway │   │ PDF Renderer │   │ Weighbridge        │    │
│   │ (Twilio /   │   │ (Puppeteer / │   │ (Serial/USB        │    │
│   │  JazzCash)  │   │  React-PDF)  │   │  Phase 2)          │    │
│   └─────────────┘   └──────────────┘   └────────────────────┘    │
└──────────────────────────────────────────────────────────────────-┘
```

---

## 3. Component Architecture

### 3.1 Frontend (Web Application)
- **Framework**: Next.js 14 (App Router) — SSR for fast initial load; React for dynamic UI
- **UI Library**: shadcn/ui + Tailwind CSS
- **State Management**: Zustand (global state); React Query (server state + caching)
- **PDF Generation**: react-pdf for client-side previews; server-side Puppeteer for final print-ready PDFs
- **Urdu Support**: Arabic/Urdu font (Noto Nastaliq Urdu) for bilingual printed receipts
- **Auth**: Supabase Auth or NextAuth.js with role-based session management

### 3.2 Backend API
- **Runtime**: Node.js 20 LTS
- **Framework**: Fastify (high throughput, low latency; typed with TypeScript)
- **Architecture pattern**: Layered — Controllers → Services → Repositories → Database
- **Validation**: Zod schemas on all request/response boundaries
- **Background jobs**: BullMQ (Redis-backed) for async tasks: PDF generation, SMS dispatch, month-end billing runs

### 3.3 Database
- **Primary DB**: PostgreSQL 15
  - JSONB columns for flexible attribute storage (quality notes, metadata)
  - Row-level security (RLS) for multi-tenant data isolation
  - Triggers for audit log population (immutable `audit_log` table)
  - **Dual Ledger Pattern**: Core records carry a `book_type` (`KATCHI` vs `PACCI`) enum. The application logic handles PACCI as strictly immutable, and KATCHI as mutable by the `OWNER`.
  - Partitioning-ready: `lots` and `invoices` tables designed for time-based partitioning
- **Migrations**: Flyway or Prisma Migrate (versioned, repeatable)
- **Backup**: Daily automated snapshots; transaction log shipping for point-in-time recovery

### 3.4 Caching & Session
- **Redis**: Session storage, rate plan cache, chamber occupancy cache (invalidated on lot events), background job queues

### 3.5 File Storage
- **Provider**: AWS S3 or S3-compatible (Cloudflare R2 recommended for cost)
- Stores: inbound/quality photos, generated PDF receipts, invoices, party documents
- Access: pre-signed URLs with expiry for secure browser access

### 3.6 PDF Service
- **Puppeteer** (headless Chrome) renders HTML templates to PDF for:
  - Storage Receipt (Parchi)
  - Invoice
  - Dispatch Note / Gate Pass
  - Party Statement
  - Ownership Transfer Acknowledgment
- Templates: Handlebars or JSX templates with bilingual (English + Urdu) sections
- PDF stored in S3; shareable link returned to frontend

### 3.7 SMS / Notification Service
- MVP: Manual notification prompts (operator chooses to send)
- Integration: Twilio or local provider (JAZZ/Telenor SMS gateway)
- Events triggering SMS: inbound receipt, outbound invoice, ownership transfer

---

## 4. Technology Stack Summary

| Layer | Technology | Rationale |
|---|---|---|
| Frontend | Next.js 14 + shadcn/ui | SSR performance; rapid UI development |
| Backend | Node.js + Fastify + TypeScript | Fast, typed, well-supported in Pakistan dev market |
| Database | PostgreSQL 15 | ACID compliance; JSON support; open source |
| Cache | Redis | Session + job queue + occupancy cache |
| File Storage | Cloudflare R2 / AWS S3 | Cheap, reliable, CDN-ready |
| PDF | Puppeteer + HTML templates | Pixel-perfect bilingual documents |
| Auth | Supabase Auth or NextAuth | Role-based sessions with MFA support |
| Deployment | Railway / Render / Supabase (hosted) | Low ops overhead for MVP |
| SMS | Twilio or local gateway | Pakistan number support |
| Monitoring | Sentry (errors) + Datadog (infra) | Production visibility |

---

## 5. Deployment Topology

```
                    ┌──────────────────────────────────────┐
                    │          CDN (Cloudflare)             │
                    │     Static assets, Edge caching       │
                    └──────────────────┬───────────────────┘
                                       │
                    ┌──────────────────▼───────────────────┐
                    │    Next.js App (Vercel / Railway)     │
                    │    - Server-side rendering            │
                    │    - API routes (lightweight BFF)     │
                    └────────────┬──────────────┬──────────┘
                                 │              │
             ┌───────────────────▼──┐  ┌────────▼──────────────┐
             │   Backend API        │  │   Background Workers  │
             │   (Railway/Render)   │  │   (BullMQ workers)    │
             │   Node.js + Fastify  │  │   PDF, SMS, jobs      │
             └──────────┬───────────┘  └────────┬──────────────┘
                        │                       │
             ┌──────────▼───────────────────────▼──────────────┐
             │              PostgreSQL (Supabase / Neon)        │
             └─────────────────────────────────────────────────┘
                        │
             ┌──────────▼──────────┐   ┌──────────────────────┐
             │   Redis (Upstash)   │   │   S3/R2 Object Store  │
             └─────────────────────┘   └──────────────────────┘
```

---

## 6. Security Architecture

| Concern | Mechanism |
|---|---|
| Authentication | JWT-based sessions; refresh tokens; session expiry 8h |
| Authorization | Role-based access control (RBAC) with fine-grained permissions |
| Data isolation | `facility_id` scoped on all queries; RLS in PostgreSQL |
| API protection | Rate limiting (Fastify/rate-limit); CORS whitelist |
| File security | Pre-signed S3 URLs (expire 1h); no public file exposure |
| Input validation | Zod schema validation on all API endpoints |
| Audit trail | All mutations written to immutable `audit_log` table |
| Password | bcrypt hashing; min 8 chars; no plaintext storage |
| Transport | HTTPS enforced; HSTS header |
| Secrets | Environment variables via secrets manager (not in code) |

---

## 7. Scalability

### MVP Sizing
- Concurrent users: 5–15 (single facility)
- DB size estimate: < 5 GB/year
- Peak load: inbound season (Feb–May) — 50–100 lots/day

### Scaling Path
- **Vertical first**: single Postgres instance handles 100k lots easily
- **Read replicas**: added when reporting queries impact operational speed
- **Horizontal API**: stateless Node.js workers allow horizontal scaling behind load balancer
- **Multi-facility**: `facility_id` namespacing already in schema; tenant-isolated views via DB views/RLS

---

## 8. Multi-Facility Evolution

When the business expands to multiple locations:

1. **Phase 2**: `facility_id` exposed in UI; owner can switch between facilities
2. **Phase 3**: Cross-facility reporting (aggregate inventory, aggregate AR)
3. **Schema**: No migration needed; `facility_id` is already a foreign key on all operational tables
4. **Auth**: Users are scoped to one or more facilities; permission sets are facility-specific
