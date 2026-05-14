# 10 — Roadmap (MVP → Scale → Enterprise)

The plan is intentionally ruthless about scope. Tax compliance is a "do it correctly or don't ship" domain — better to ship fewer features perfectly than many features ambiguously.

## Phase 0 — Foundations (weeks 1–4)

Goal: every later feature stands on a correct ledger.

- [ ] Monorepo: pnpm + turbo + tsconfig refs.
- [ ] NestJS app skeleton with DDD module template generator.
- [ ] Postgres + Prisma + RLS scaffolding + migration story (expand/contract).
- [ ] `packages/accounting` double-entry primitives + balanced-journal trigger.
- [ ] `packages/tax-rules` skeleton + effective-dated registry + golden test harness.
- [ ] `packages/contracts` with Zod and OpenAPI generation.
- [ ] Auth (Auth.js + JWT) + tenant resolution + RBAC guard.
- [ ] Audit-log middleware + outbox dispatcher.
- [ ] CI: lint, type-check, unit, integration, container build.

**Definition of Done:** I can sign up, create a tenant, get a default Chart of Accounts seeded, post a manual journal, see it on a trial balance, and the action shows up in audit log. RLS prevents another tenant from reading it.

## Phase 1 — MVP (weeks 5–14)

Target user: **Konsultan Pajak managing UMKM/SMB clients**.

- [ ] **Sales**: Invoice CRUD → issue → posts journal + creates Faktur Pajak draft.
- [ ] **Purchase**: Bill CRUD → post → posts journal (PPN Masukan if PKP).
- [ ] **Payments**: pay bill → withholding pipeline (PPh 23 auto-detect by kode objek).
- [ ] **Tax engine v1**: PPN (12% / DPP nilai lain), PPh 23, PPh 4(2), PPh Final UMKM (PP 55/2022).
- [ ] **Coretax exporters**: Faktur Pajak XML, e-Bupot 23 CSV, validator runs first.
- [ ] **Reports**: Trial balance, P&L, Balance sheet, PPN recap, withholding recap.
- [ ] **Compliance calendar**: per-tax-type deadlines, reminders by email.
- [ ] **AI v1**: Tax Q&A with RAG over PMK/PER/UU corpus + Invoice OCR.
- [ ] **Multi-client workspace**: firm-level dashboard for konsultan.

**Beta criteria**: 10 design-partner firms, 50 client tenants, < 5 critical bugs/month, average SPT Masa PPN preparation time < 30 min.

## Phase 2 — Payroll + Comprehensive (weeks 15–24)

- [ ] **Payroll**: employees, contracts, payroll runs, PPh 21 TER, BPJS, payslips, A1.
- [ ] **PPh 21 annual reconciliation** (Desember), 1721 export.
- [ ] **PPh 25/29** angsuran scheduler + SPT Tahunan data prep.
- [ ] **Bank reconciliation** (CSV import + AI classification).
- [ ] **AI v2**: Journal suggestion from NL, transaction classifier on bank lines, anomaly detector.
- [ ] **Webhooks** + public API (with API keys + scopes).
- [ ] **WhatsApp reminders** (vendor: WA Business API).
- [ ] **Multi-currency** (FX rate from Bank Indonesia daily).

## Phase 3 — Scale (months 7–12)

- [ ] Detach `payroll` and `ai` modules into separate services (still same DB cluster, different services).
- [ ] Read replicas for reporting; materialized views per tenant tier.
- [ ] `pg_partman` partitioning on `audit_events`, `journal_lines` for largest tenants.
- [ ] Open banking (Brick / Finantier) for auto-import.
- [ ] Tenant-pinned LLM provider; sovereign deployment region.
- [ ] ISO 27001 / SOC 2 Type II readiness.
- [ ] White-label option for accounting firms.

## Phase 4 — Enterprise (year 2)

- [ ] Schema-per-tenant tier with per-tenant encryption keys.
- [ ] Multi-entity consolidation (PSAK).
- [ ] Configurable approval workflows (n-eyes posting, segregation of duties).
- [ ] On-prem / private-cloud installer for regulated customers.
- [ ] SAML / SCIM for enterprise SSO.
- [ ] Marketplace for tenant-built `TransactionTemplate`s and integrations.

## Risks we explicitly track

| Risk | Mitigation |
|---|---|
| **Coretax format changes** | Adapter layer + contract tests against published schemas; staging tenant runs validator nightly. |
| **Regulation churn (PMK/PER)** | RAG corpus auto-ingest from JDIH RSS; tax-rules effective-dating; rule-change PR template. |
| **AI hallucination causes wrong filing** | AI never auto-files; structured-output + citation validators; human review required. |
| **Data loss / corruption** | PITR, append-only journal, daily reconciliation between artifacts and journals. |
| **Tenant takes data and leaves** | Full export on demand (signed PDF + CSV + JSON); honoring UU PDP. |
| **Low margin per UMKM** | Tiered pricing; firms (multi-tenant) are the high-LTV segment. |
