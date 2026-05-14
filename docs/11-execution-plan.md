# 11 — Execution Plan to MVP & Beyond

> Single source of truth for "what's left to build." Each PR is small, reviewable, has a clear Definition of Done, and never breaks what came before.

## Phase status

| # | Title | Status | PR |
|---|---|---|---|
| 0 | Foundation (architecture, tax math, double-entry) | ✅ shipped | merged baseline |
| 1 | DB schema + RLS + invariants | ✅ shipped | PR #1 |
| 2 | Rule engine (template → balanced journal) | ✅ shipped | PR #2 |
| 3 | Web playground (Next.js, real engine) | ✅ shipped | PR #3 |
| **4** | **NestJS API foundation + tenant guard** | **⏳ in progress** | **PR #4** |
| 5 | API: transactions, invoices, bills | 🔜 next | PR #5 |
| 6 | Web ↔ API wiring + auth (login, tenant switcher) | 🔜 | PR #6 |
| 7 | Tenant onboarding wizard | 🔜 | PR #7 |
| 8 | Dashboard + reports (Trial Balance, P&L, PPN recap) | 🔜 | PR #8 |
| 9 | Coretax exporters (Faktur Pajak XML, e-Bupot CSV) | 🔜 | PR #9 |
| 10 | Compliance calendar + email reminders | 🔜 | PR #10 |
| 11 | Outbox dispatcher + materialized view refresh | 🔜 | PR #11 |
| 12 | AI module v1: Tax Q&A with RAG | 🔜 | PR #12 |
| 13 | AI module v2: Invoice OCR + journal suggestion | 🔜 | PR #13 |
| 14 | Payroll module: PPh 21 TER, BPJS, payslips, A1 | 🔜 | PR #14 |
| 15 | Workspace mode for accounting firms (multi-client) | 🔜 | PR #15 |
| 16 | Webhooks + public API keys | 🔜 | PR #16 |
| 17 | Observability: OTel tracing + dashboards | 🔜 | PR #17 |
| 18 | Production hardening (RPO/RTO drills, runbook) | 🔜 | PR #18 |
| 19 | Beta launch checklist & sign-off | 🔜 | PR #19 |

End state: **MVP ready for design partners**. Phases 14-19 cross into "scale" territory but are still on the path to production.

---

## Detailed PR specs

Each PR below has: scope, files touched, definition of done (DoD), risks, and what it deliberately defers.

### PR #4 — NestJS API foundation + tenant guard *(this PR)*

**Scope**
- `apps/api/src/main.ts` — NestJS bootstrap, Fastify adapter, global pipes
- `apps/api/src/app.module.ts` — root module composition
- `apps/api/src/common/` — Zod ValidationPipe, exception filter (RFC 7807), idempotency interceptor
- `apps/api/src/auth/` — JWT module, dev login endpoint (real OIDC arrives in PR #6)
- `apps/api/src/tenant/` — `TenantContext` (AsyncLocalStorage) + `TenantGuard` that calls `withTenant()`
- `apps/api/src/health/` — `/health` and `/readyz`
- `apps/api/src/audit/` — `AuditInterceptor` that writes `audit_events` for every mutation
- Smoke test: spin Fastify, hit `/health`, get 200; hit `/v1/me` without JWT, get 401; with JWT, get tenant id back

**DoD**
- `pnpm --filter @taxora/api dev` boots and serves http://localhost:4000
- `curl http://localhost:4000/health` → `{"status":"ok"}`
- `curl -H "Authorization: Bearer <devjwt>" http://localhost:4000/v1/me` returns the tenant
- Existing 58 tests still green; CI typecheck across 5 packages still clean

**Risks**
- Fastify + NestJS adapter version mismatch → pin tested versions
- AsyncLocalStorage propagation in async handlers → tested in unit test

**Defers**
- Real auth providers (Google/Microsoft OIDC) → PR #6
- Rate limiting (BullMQ-backed) → PR #16

---

### PR #5 — Transaction-execute endpoint + invoices/bills CRUD

**Scope**
- `POST /v1/transactions/execute` — request body { templateCode, version, inputs }, runs `@taxora/rule-engine` execute(), persists journal via `journal-poster`, returns the audit trail. Idempotency-Key honored.
- `POST /v1/invoices` (draft) → `POST /v1/invoices/:id/issue` (template `ISSUE_INVOICE_PPN`)
- `POST /v1/bills` (draft) → `POST /v1/bills/:id/post` (PPN Masukan if PKP)
- `POST /v1/payments` → triggers `PAY_VENDOR_JASA_PPH23` template
- Zod schemas in a new `packages/contracts` (shared with web)

**DoD**
- Postman/HTTPie can post a Faktur transaction → see new journal in DB
- `apps/web` switches one file (`lib/templates.ts`) to fetch from API; UI unchanged

---

### PR #6 — Web ↔ API wiring + auth

**Scope**
- Auth.js in `apps/web` with email magic link + Google OIDC
- JWT issuance, refresh tokens, secure cookie
- Tenant switcher in `PageShell`
- `lib/api.ts` typed client generated from contracts
- Feature flag: `data-source: in-memory | api`

---

### PR #7 — Tenant onboarding wizard

- `/onboarding/welcome` → NPWP + status PKP + tahun buku
- Auto-seed default Chart of Accounts on first sign-in
- Redirect to dashboard once `settings.onboardingComplete = true`

---

### PR #8 — Dashboard + reports

- `/dashboard` — PPN bulan ini (Masukan/Keluaran/net), 5 transaksi terbaru, deadline 7-hari ke depan
- `/reports/trial-balance` — pakai `mv_trial_balance` materialized view
- `/reports/profit-loss` — derived dari journal_lines
- `/reports/balance-sheet`
- `/reports/ppn-recap` — PM vs PK reconciliation siap di-export ke Coretax

---

### PR #9 — Coretax exporters

- `packages/coretax/`:
  - `FakturPajakXmlBuilder` — Coretax e-Faktur XML schema
  - `BuktiPotongCsvBuilder` — e-Bupot 23 CSV
  - `BuktiPotongA1Builder` — PPh 21 tahunan format
  - `CoretaxArtifactValidator` — same checks Coretax runs, with friendly error pointing to row
- `POST /v1/coretax/exports/faktur-pajak` (batch) → returns signed download URL

**Why valuable**: this is the single most concrete "save your konsultan 4 hours" feature. Output goes straight to Coretax Web upload.

---

### PR #10 — Compliance calendar + reminders

- Worker: every day, scan `compliance_deadlines`, mark OVERDUE, send email H-3 / H-1 / H+1
- `/compliance` page: Kanban of PENDING / DONE / OVERDUE
- Mark-complete action with optional setoran proof attachment

---

### PR #11 — Outbox dispatcher + MV refresh

- BullMQ worker tails `outbox_events`, fans out by event type
- On `JournalPosted`: refresh `mv_trial_balance` concurrently
- On `WithholdingCalculated`: enqueue Bukti Potong PDF job
- Webhook delivery (HMAC-signed) deferred to PR #16

---

### PR #12 — AI module v1: Tax Q&A with RAG

- `packages/ai/`:
  - `LLMProvider` port + OpenAI / Gemini / Claude adapters
  - RAG pipeline: peraturan corpus → ai_documents → hybrid retrieval (BM25 + cosine)
  - Citation validator (every claim must cite a real ai_document chunk)
  - PII redactor (NPWP, NIK, salary) at the boundary
- `POST /v1/ai/conversations/:id/messages` (WS streaming)
- UI: chat panel in dashboard

---

### PR #13 — AI module v2: OCR + journal suggestion

- OCR adapter (Textract/DocumentAI/Tesseract fallback)
- `POST /v1/ai/ocr/invoices` upload → structured fields
- `POST /v1/ai/journal-suggestions` NL ("bayar listrik PLN 2.5jt") → template + inputs proposal
- All AI suggestions pass through `engine.execute()` for validation; user must accept

---

### PR #14 — Payroll module

- Employee CRUD + contracts
- PPh 21 TER (PMK 168/2023) monthly + December annual reconciliation
- BPJS Kesehatan + JHT + JP + JKK + JKM
- Payslip PDF
- A1 export (1721 format)
- New transaction templates: `PAYROLL_RUN_FINALIZE`

---

### PR #15 — Workspace mode for accounting firms

- Sign up as "Akuntan / Konsultan" → creates a Workspace (firm)
- Add client tenants under it
- Switch tenant from any page in 1 click
- Aggregated firm-level dashboard (only tenants the user has access to)

---

### PR #16 — Webhooks + public API keys

- `tenant_settings.webhooks[]` — register URL + secret
- HMAC-signed delivery with retry + replay
- API keys with prefix scopes (`txk_live_…`)
- Rate limiting per tenant via Redis token bucket

---

### PR #17 — Observability

- OpenTelemetry SDK in API + workers
- Prometheus metrics: API p99, journal-post p99, outbox dispatch lag
- Structured logging with PII scrubbing
- Per-tenant cost dashboard (DB rows, AI tokens, OCR pages)

---

### PR #18 — Production hardening

- PITR backup tested with restore drill (documented)
- RTO / RPO measured
- Runbook for: tenant offboarding, key rotation, data export, incident response
- Status page

---

### PR #19 — Beta launch sign-off

- Security review checklist (UU PDP, basic ISO 27001 mapping)
- Test plan execution: golden-file PMK examples, property-based tests
- Design partner onboarding script
- Pricing page + billing (Stripe / Xendit)
- Public docs site

---

## Operating principles for every PR

1. **Never break what's green.** Every PR runs `pnpm -r test` and `pnpm -r typecheck` before commit.
2. **Small PRs.** If a PR exceeds 1500 LOC of net code (excluding generated/lockfile), split it.
3. **Definition of Done is binary.** Each PR's DoD is testable; if not, it's not done.
4. **Defer don't delete.** Each PR explicitly lists what it defers, so we don't lose track.
5. **Compliance correctness > UX cleverness.** A wrong tax number ships nothing; a clunky form ships.
6. **Effective-dated everything.** Tarif, TER, PTKP — never hardcoded constants.
7. **AI proposes, human approves.** No AI output ever auto-files or auto-posts.

## Estimated time to MVP

Working solo at the pace of these PRs (1 PR per session-equivalent), the path to **PR #11 (full MVP for konsultan pajak)** is **~11 PRs from here**. After PR #11, the product can be demoed end-to-end:

```
sign up → onboarding → buat invoice (PPN) → bayar vendor (PPh 23)
   → lihat trial balance → export Faktur Pajak XML → upload ke Coretax
```

PRs #12-#19 are scale/AI/enterprise hardening, layered on top.
