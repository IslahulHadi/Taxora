# Taxora — Indonesian Tax Operating System

> **B2B SaaS to automate Indonesian tax compliance, accounting journals, and Coretax-compatible reporting — with AI built in.**

Taxora is **not** a replacement for Coretax DJP. It is the business-facing layer that sits **between bookkeeping and Coretax**: it captures every transaction, applies the correct tax rules (PPN, PPh 21 TER, PPh 23, PPh 4(2), PPh 25/29), generates double-entry journals automatically, and exports artifacts that Coretax / e-Faktur / e-Bupot accept without manual rework.

## Why this exists

Since Coretax DJP went live, SMBs, accounting firms, and tax consultants have struggled with:

- Confusing UX for non-tax-experts
- Rejected Faktur Pajak / e-Bupot due to malformed input
- No accounting integration — users still re-key numbers
- No audit trail across PPN Masukan / Keluaran reconciliation
- No automation for recurring withholdings (PPh 23, 4(2), 21)
- No AI assistance to interpret PMK / PER DJP changes

Taxora solves this with an **automation-first, compliance-correct, AI-assisted** workflow.

## Target users

UMKM, startups, SMBs, accounting firms (Kantor Jasa Akuntan), payroll providers, tax consultants (Konsultan Pajak).

## Status

`pre-MVP` — architecture and skeleton phase. See [`docs/`](./docs) for the full design.

## Documentation index

| # | Doc | Topic |
|---|---|---|
| 00 | [Vision & Coretax positioning](./docs/00-vision.md) | Why Taxora, who it serves, what it is *not* |
| 01 | [System architecture](./docs/01-architecture.md) | Modular monolith, DDD, clean architecture, event bus |
| 02 | [Multi-tenancy](./docs/02-multi-tenancy.md) | Hybrid RLS + schema-per-tenant, isolation guarantees |
| 03 | [Database schema](./docs/03-database.md) | Core entities, accounting invariants, DDL sketch |
| 04 | [Tax engine](./docs/04-tax-engine.md) | PPN, PPh 21 TER, PPh 23, 4(2), 25, 29 + Coretax adapters |
| 05 | [Rule & journal engine](./docs/05-rule-engine.md) | Transaction templates, formulas, double-entry guarantee |
| 06 | [AI strategy](./docs/06-ai-strategy.md) | Provider abstraction, RAG over peraturan, OCR, guardrails |
| 07 | [API design](./docs/07-api-design.md) | REST + tRPC, contracts, versioning |
| 08 | [Security & compliance](./docs/08-security.md) | RBAC, RLS, audit log, UU PDP |
| 09 | [Deployment](./docs/09-deployment.md) | Docker, CI/CD, environments |
| 10 | [Roadmap](./docs/10-roadmap.md) | MVP → scale → enterprise |

## Tech stack (decided)

- **Frontend:** Next.js 15 (App Router), TailwindCSS, shadcn/ui, TanStack Query
- **Backend:** NestJS (TypeScript), Fastify adapter
- **DB:** PostgreSQL 16 + `pgvector` (RAG), Prisma ORM
- **Cache / queue:** Redis 7, BullMQ
- **AI:** Provider-abstracted (OpenAI / Gemini / Claude), local OCR fallback
- **Infra:** Docker, GitHub Actions, deployable to any K8s / Fly / Railway
- **Auth:** Auth.js (NextAuth) + JWT for API, OIDC-ready for enterprise

## Repository layout

```
apps/
  web/            Next.js frontend (tenant portal)
  api/            NestJS backend (modular monolith)
packages/
  contracts/     Shared DTOs / Zod schemas / OpenAPI types
  tax-rules/     Pure functions for Indonesian tax math (testable in isolation)
  accounting/    Pure double-entry primitives
docs/             Architecture & design documents
docker-compose.yml
turbo.json
pnpm-workspace.yaml
```

See [`docs/01-architecture.md`](./docs/01-architecture.md) for the reasoning.
