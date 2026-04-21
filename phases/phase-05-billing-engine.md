# Phase 5: Billing Engine (M5)

**Objective**: Full invoice lifecycle, storage charge calculation (3 rate types), service charges, invoice PDF.
**Branch**: `phase/05-billing-engine`
**Prerequisites**: Phase 4

## Status: COMPLETED (2026-04-21)

## Tasks

- [x] 5.1 — Migration `0005_invoices` — Invoice + InvoiceLineItem models, InvoiceStatus/InvoiceLineType enums
- [x] 5.2 — Storage Charge Calculation Engine — storage-charge.ts (SEASONAL/MONTHLY/DAILY), 8 unit tests
- [x] 5.3 — Invoice Lifecycle Backend — invoice-number.ts, repository, builder (idempotent), service, controller (7 routes)
- [x] 5.4 — Wire Outbound Finalize → Invoice Creation — auto-creates DRAFT invoice in same tx; invoice_id in response
- [x] 5.5 — Invoice PDF (bilingual) — A5 Handlebars template, DRAFT watermark, renderInvoice in pdf.service.ts
- [x] 5.6 — S-20 Invoice List — /invoices page, status/party/date filters, role guard, 12 integration tests
- [x] 5.7 — S-21 Invoice Detail/Preview — add/delete line modals, finalize, PDF print, disabled payment; lot billing tab live

## Definition of Done
- All 3 rate types correct ✓; outbound→invoice auto ✓; finalize locks ✓; PDF bilingual ✓; WF-03/WF-04 ✓; 20 tests (8 unit + 12 integration) ✓
