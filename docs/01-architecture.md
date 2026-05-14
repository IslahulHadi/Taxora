# 01 — System Architecture

## 1. Architectural style: Modular Monolith → Microservice-ready

We deliberately **start as a modular monolith** with strict module boundaries, then extract services only when scale or team topology demands it. Premature microservices on a fintech/tax product cause:

- Distributed transactions across journal + tax + reporting → eventual consistency leaks into the books → audit failure.
- 10x infra cost for a product that needs zero downtime more than zero latency.
- Slower iteration on regulatory changes (a single PMK can touch 4 services at once).

The monolith is **decomposable**: each module exposes only its public application service and emits domain events. When we extract `payroll` to its own service, no other module's code changes — only the transport.

## 2. Layering — Clean / Hexagonal Architecture per module

Every domain module follows the same layered shape:

```
apps/api/src/modules/<bounded-context>/
├── domain/              # Pure business logic. No framework, no DB.
│   ├── entities/        # Aggregates (Journal, Invoice, TaxReturn)
│   ├── value-objects/   # Money, NPWP, TaxPeriod, DPP
│   ├── events/          # Domain events (JournalPosted, FakturIssued)
│   └── services/        # Domain services (cross-entity logic)
├── application/         # Use cases / orchestration
│   ├── commands/        # CQRS write side
│   ├── queries/         # CQRS read side
│   └── ports/           # Interfaces the domain needs (repos, clients)
├── infrastructure/      # Adapters: Prisma repos, HTTP clients, queues
│   ├── persistence/
│   ├── messaging/
│   └── external/        # Coretax adapter, OCR adapter, AI adapter
└── interface/           # Inbound: HTTP controllers, GraphQL resolvers, queue consumers
    ├── http/
    └── consumers/
```

**Why this matters for tax software specifically:**
The domain layer (`tax-rules` package + module domain) contains the actual Indonesian tax math. It is **pure functions**, fully testable, and **versioned independently**. When PMK 168/2023 (PPh 21 TER) changes again, we update one package, run 1000+ unit tests against historical scenarios, and ship with confidence.

## 3. Bounded contexts (DDD)

| Context | Aggregate roots | Owns |
|---|---|---|
| `iam` | User, Tenant, Role, ApiKey | Auth, RBAC, tenant lifecycle |
| `accounting` | Journal, Account, FiscalPeriod | Chart of Accounts, double-entry, closing |
| `taxation` | TaxReturn, TaxRule, TaxLiability | PPN, PPh calculation, period locks |
| `invoicing` | Invoice, FakturPajak, BuktiPotong | Sales invoice + tax artifact emission |
| `payables` | Bill, Payment, Vendor, Withholding | AP + automatic withholding |
| `payroll` | Employee, PayrollRun, Payslip | PPh 21 TER, BPJS, A1 |
| `reporting` | Report, ReportSnapshot | P&L, BS, SPT data, e-Faktur export |
| `compliance` | ComplianceCheck, Deadline, Reminder | Calendar, anomaly detection |
| `ai` | Conversation, Suggestion, Embedding | Assistant, OCR, classification |
| `audit` | AuditEvent | Append-only event log |
| `notifications` | NotificationChannel | Email, WA, in-app |

Contexts communicate via **domain events on an in-process bus** today (NestJS `EventEmitter2` + outbox table for durability), and via **Redis Streams / Kafka** when extracted.

## 4. Event-driven backbone (Outbox pattern)

Critical invariant: **a journal is posted IFF its consequent events are eventually delivered.** We enforce this with the **transactional outbox**:

```sql
-- Inside the same Postgres TX as the journal insert:
INSERT INTO journals (...) VALUES (...);
INSERT INTO journal_lines (...) VALUES (...);
INSERT INTO outbox_events (id, type, payload, created_at)
  VALUES (uuid_generate_v4(), 'JournalPosted', jsonb_build_object(...), now());
```

A separate worker tails `outbox_events`, publishes to Redis Streams, and marks rows `dispatched_at`. This gives us **exactly-once-effective** semantics without 2PC.

### Key events

```
JournalPosted          -> reporting (rebuild balances), audit
InvoiceIssued          -> accounting (post AR + PPN Keluaran), taxation
BillReceived           -> accounting (post AP + PPN Masukan), payables
PaymentMade            -> accounting, payables (trigger withholding)
WithholdingCalculated  -> invoicing (issue BuktiPotong), taxation
PayrollRunFinalized    -> accounting, taxation (PPh 21 liability), payroll (payslips)
TaxReturnFinalized     -> reporting (export Coretax artifact), compliance (mark deadline done)
```

## 5. CQRS — selective, not dogmatic

We use CQRS **only** where read and write models genuinely diverge:

- **Reporting** (read): denormalized monthly snapshots in materialized views. Writes go to journals, reads come from `mv_trial_balance`, `mv_ppn_recap`. Refreshed via outbox events, not on every read.
- **Tax dashboards** (read): pre-aggregated per tenant per period.
- **CRUD entities** (vendors, customers, employees): plain repository pattern. CQRS would be ceremony.

## 6. High-level component diagram

```
                 ┌───────────────────────────────────────────┐
                 │              Next.js Web (apps/web)       │
                 │   tenant portal · admin · AI chat UI      │
                 └───────────────┬───────────────────────────┘
                                 │ HTTPS · JWT (tenant-scoped)
                 ┌───────────────▼───────────────────────────┐
                 │        NestJS API Gateway (apps/api)      │
                 │  · Auth guard (JWT + tenant resolution)   │
                 │  · RBAC guard · Rate limit · Audit hook   │
                 └───────┬─────────────────────┬─────────────┘
                         │                     │
        ┌────────────────▼──────┐   ┌──────────▼─────────────┐
        │  Domain modules       │   │  AI module             │
        │  iam · accounting ·   │   │  · Provider router     │
        │  taxation · invoicing │   │  · RAG (pgvector)      │
        │  payables · payroll · │   │  · OCR adapter         │
        │  reporting · audit    │   │  · Guardrails          │
        └───────┬───────────────┘   └──────────┬─────────────┘
                │                              │
        ┌───────▼──────────────────────────────▼────────────┐
        │         PostgreSQL 16  (RLS-enforced)             │
        │  + pgvector  + outbox  + audit_log (append-only)  │
        └──────────────────┬────────────────────────────────┘
                           │
        ┌──────────────────▼────────────────────────────────┐
        │  Redis · BullMQ workers · Outbox dispatcher       │
        │  · OCR queue · AI queue · Reporting refresh queue │
        │  · Reminder scheduler · Coretax export queue      │
        └───────────────────────────────────────────────────┘
                           │
        ┌──────────────────▼────────────────────────────────┐
        │  External adapters (out-of-process)               │
        │  · Coretax artifact validator/exporter            │
        │  · LLM providers (OpenAI / Gemini / Claude)       │
        │  · OCR provider (Textract / Document AI / Tesseract│
        │  · Email (Resend) · WA Business API               │
        └───────────────────────────────────────────────────┘
```

## 7. Why these choices, briefly

| Decision | Rationale |
|---|---|
| **Modular monolith first** | Tax/accounting requires strong consistency. Distributed TX is a footgun here. |
| **NestJS + TypeScript** | DI + decorators map cleanly to DDD; one language across web + api; good DX. |
| **Postgres + RLS** | Bullet-proof tenant isolation enforced at DB, not app. Plus `pgvector` for RAG without a second store. |
| **Outbox + BullMQ** | Durable events without Kafka complexity at MVP. Easy to swap for Kafka later. |
| **Pure tax-rules package** | Regulatory math must be testable, version-pinned, and bisectable when PMK changes. |
| **AI as a module, not a layer** | AI is a feature with the same governance as any other (audit, RBAC, rate limit). |
