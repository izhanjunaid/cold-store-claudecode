# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ColdChain** is a management platform for agricultural cold storage facilities integrated into Pakistan's mandi (wholesale market) supply chain. MVP targets a single facility in Lahore. The repository is currently in the **specification phase** — all 15 documents in `docs/` define the system to be built. No implementation code exists yet.

## Planned Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router) + React + shadcn/ui + Tailwind CSS |
| State | Zustand (global) + React Query (server state) |
| Backend | Node.js 20 LTS + Fastify + TypeScript |
| Validation | Zod schemas on all request/response boundaries |
| Database | PostgreSQL 15 (JSONB, Row-Level Security, audit triggers) |
| Migrations | Flyway or Prisma Migrate (versioned) |
| Cache/Jobs | Redis + BullMQ |
| File Storage | Cloudflare R2 / AWS S3 (pre-signed URLs) |
| PDF | Puppeteer + HTML/Handlebars templates (bilingual: English + Urdu) |
| Auth | Supabase Auth or NextAuth.js (JWT, RBAC) |
| Deployment | Railway / Render / Supabase |

## Architecture Patterns

- **Layered**: Controllers → Services → Repositories → Database
- **Multi-tenant ready**: All tables namespaced by `facility_id` from day 1
- **Audit-first**: Every mutation logged to immutable `audit_log` table; no hard deletes on operational records
- **Dual ledger**: `book_type` enum (`KATCHI` vs `PACCI`) — KATCHI is mutable informal records, PACCI is immutable official records
- **REST API versioned**: All endpoints under `/v1/`, facility scoped via `X-Facility-ID` header
- **Background jobs**: BullMQ workers for PDF generation, SMS dispatch, month-end billing runs

## Modules (11)

| # | Module | What it does |
|---|--------|-------------|
| M1 | Party Management | Farmers, traders, arhtis, buyers — profiles, credit limits, ledgers |
| M2 | Inbound & Lot | Produce intake, lot creation, weigh-in, chamber assignment, storage receipt |
| M3 | Ownership Transfer | Mid-storage ownership changes (full/partial) with complete chain history |
| M4 | Outbound & Dispatch | Withdrawals, weigh-out, invoice generation, dispatch notes |
| M5 | Billing Engine | Configurable rates (seasonal/monthly/daily per bag), service charges, invoices |
| M6 | Quality & Spoilage | Inspections, damage records, lot quantity adjustments |
| M7 | Financial Ledger | AR/AP, payment recording, receivables aging, credit limit enforcement |
| M8 | Chamber Management | Physical chamber tracking, capacity, occupancy |
| M9 | Reporting | Dashboards, aging reports, commodity inventory, financial summaries |
| M10 | Gate Pass | Security — vehicle inward/outward logging linked to operations |
| M11 | Peshgi (Loans) | Informal cash advances to farmers/arhtis and automated recovery |

## Documentation Map (`docs/`)

| File | Contents |
|------|---------|
| `01_domain_exploration.md` | Mandi ecosystem actors, produce lifecycle, pain points |
| `02_scope_definition.md` | MVP boundaries, in/out of scope, module list |
| `03_PRD.md` | Product requirements, personas, 80+ feature specs, success metrics |
| `04_BRD.md` | Business requirements and stakeholder needs |
| `05_functional_specs.md` | Feature-by-feature functional breakdown |
| `06_system_architecture.md` | Tech stack, logical/deployment architecture, component design |
| `07_user_roles_permissions.md` | RBAC roles and permission matrix |
| `08_data_model.md` | Database schema — entities, relationships, indexes, constraints |
| `09_accounting_spec.md` | Chart of accounts, journal entry patterns, dual ledger rules |
| `10_api_design.md` | RESTful API spec — 19 endpoint groups, error codes, examples |
| `11_non_functional_requirements.md` | Performance (<500ms API), security (OWASP), availability (99.5%) |
| `12_e2e_workflows.md` | End-to-end user workflows across modules |
| `13_screen_inventory.md` | UI/UX screens to build |
| `14_state_machines.md` | Status transitions for lots, invoices, transfers |
| `15_accounting_audit.md` | Audit trail and reconciliation rules |

## Domain Terminology

| Term | Meaning |
|------|---------|
| **Mandi** | Agricultural wholesale market |
| **Arhti** | Commission agent / middleman in mandi trade |
| **Peshgi** | Informal cash advance/loan given to farmers or arhtis |
| **Katchi** | Informal/rough ledger (mutable records) |
| **Pacci** | Official/final ledger (immutable records) |
| **Parchi** | Storage receipt given at inbound |
| **Chamber** | Refrigerated storage room within the cold store |
| **Lot** | A discrete batch of produce from one party, tracked through its lifecycle |
