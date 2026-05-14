# 09 — Deployment & Environments

## 1. Environment topology

| Env | Purpose | Data |
|---|---|---|
| `local` | Developer laptop via docker-compose | seeded fixtures |
| `ci` | GitHub Actions ephemeral | per-job throwaway DB |
| `dev` | Internal team | sanitized seeds |
| `staging` | Pre-prod, tenant beta program | sanitized prod copy weekly |
| `prod` | Live tenants | prod |
| `prod-id-sovereign` | Enterprise tenants requiring ID-region only | prod |

## 2. Containers

- Single multi-stage `Dockerfile` per app (web, api, worker).
- Distroless base for runtime (`gcr.io/distroless/nodejs:20`).
- Non-root user, read-only FS, drop ALL caps.
- Image signed with cosign; signature verified at admission.

## 3. Orchestration

- **MVP**: Fly.io / Railway / Render — single region, zero infra team.
- **Pro tier**: Kubernetes (EKS / GKE) with Helm chart per service.
- **Enterprise**: K8s with per-tenant namespace isolation for schema-per-tenant tier.

## 4. CI/CD (GitHub Actions)

```
on: pull_request
jobs:
  lint           : eslint, prettier, tsc --noEmit
  unit-test      : vitest --run packages/* apps/api
  integration    : spin postgres+redis service, run NestJS e2e
  tax-rules-test : run packages/tax-rules golden + property tests
  contracts-check: zod → openapi diff vs main; fail on breaking change without /v2
  build          : turbo build, push image to GHCR with sha tag
  trivy          : container scan; fail on CRITICAL
on: push to main
jobs:
  deploy-staging : helm upgrade --install
  smoke-tests    : hit staging /health, /readyz, post-and-reverse fixture journal
on: tag v*
jobs:
  deploy-prod    : manual approval gate; canary 10% → 50% → 100%
```

Migrations: forward-only; deploy in two phases (expand → contract) for breaking schema changes; never blocked by app code at any single deploy.

## 5. Observability

- **Logs**: structured JSON via `pino`; tenant_id, trace_id, user_id required fields; PII-redacted by middleware.
- **Metrics**: OpenTelemetry → Prometheus; SLOs:
  - API p99 < 500ms (excluding AI/OCR)
  - Journal post p99 < 200ms
  - Outbox dispatch lag p99 < 30s
  - AI call success > 99%
- **Traces**: OTel; sampled at 10% on success, 100% on error.
- **Alerting**: Pager on outbox lag, RLS bypass attempts, audit-table mutation attempts, journal-unbalanced refusals spiking, AI cost overrun.
- **Dashboards**: per-tenant cost (DB rows, AI tokens, OCR pages) for billing & abuse detection.

## 6. Disaster recovery

- **RPO**: 5 minutes (PITR window).
- **RTO**: 1 hour (Pro), 4 hours (Standard).
- Quarterly restore drills with pass/fail recorded.
- Cross-region read replica for enterprise.

## 7. Database operations

- Migrations run via `prisma migrate deploy` from a one-shot job in CI/CD pipeline (never from app boot).
- `pg_dump` daily, encrypted with KMS, retained 35 days.
- Long-running queries killed at 60s default; reporting queries hit replicas with longer budgets.

## 8. Cost guardrails

- AI per-tenant monthly cap (configurable; defaults by tier).
- OCR per-tenant page cap.
- Webhook delivery cap per tenant per day to prevent feedback loops.
- Budget alerts on cloud spend per service.

## 9. Local development

`docker compose up` brings up:
- `postgres:16` with extensions: `pgcrypto`, `pgvector`, `citext`
- `redis:7`
- `mailhog` for email testing
- `minio` for object storage (faktur PDFs, OCR uploads)

Then `pnpm -w dev` starts:
- `apps/api` (NestJS) in watch mode
- `apps/web` (Next.js) in watch mode
- worker process for outbox + queues
