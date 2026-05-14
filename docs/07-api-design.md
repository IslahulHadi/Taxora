# 07 — API Design

## 1. Surface choice

| Surface | Use | Why |
|---|---|---|
| **REST + OpenAPI 3.1** | Public API for tenants/integrators | Cacheable, well-tooled, easy to grant API keys, friendly to non-JS clients (Accurate plugins, accountants' tools). |
| **tRPC** | Internal: Next.js web ↔ NestJS api | End-to-end types, no codegen step, faster iteration in monorepo. |
| **WebSocket** | AI streaming chat, long-running jobs | Token streaming + job progress. |
| **Webhooks** | Tenant-to-tenant integrations (SaaS → tenant's app) | HMAC-signed, retried, replayable. |

**Both surfaces wrap the same application services**, so a feature is never built twice. tRPC routers and REST controllers are thin adapters over `@taxora/api/modules/<ctx>/application`.

## 2. URL & resource shape (REST)

```
Base URL: https://api.taxora.id/v1
Tenant scoping: implicit via JWT (claim `tnt`). Never via path.
```

### Conventions

- `kebab-case` paths, plural resources: `/invoices`, `/faktur-pajak`, `/bukti-potong`.
- `id`s are uuids, never tenant slug + number in path.
- Filtering via query string: `?status=ISSUED&period=2025-06`.
- Pagination: cursor-based (`?cursor=...&limit=50`), never offset for hot tables.
- Always return `Idempotency-Key`-honoring writes for POST that create money-affecting resources.

### Example endpoints

```
POST   /invoices                       create draft
POST   /invoices/{id}/issue            issue + post journal + emit faktur stub
POST   /invoices/{id}/void             reversal journal
GET    /invoices/{id}
GET    /invoices?customerId=&status=

POST   /bills                          create
POST   /bills/{id}/post                post journal (PPN Masukan)
POST   /bills/{id}/pay                 PaymentMade event → withholding pipeline

POST   /payments                       standalone payments (non-bill)

POST   /faktur-pajak/{id}/approve      mark APPROVED, allocate nomor seri
POST   /faktur-pajak/exports           batch export (Coretax XML)
GET    /faktur-pajak/exports/{id}      download

POST   /bukti-potong/exports           batch e-Bupot

POST   /payroll/runs                   create draft
POST   /payroll/runs/{id}/finalize     compute PPh21 TER + post + payslips
GET    /payroll/runs/{id}/a1-export

GET    /reports/trial-balance?period=2025-06
GET    /reports/profit-loss?from=&to=
GET    /reports/balance-sheet?asOf=
GET    /reports/ppn-recap?period=2025-06

POST   /ai/conversations               start chat
POST   /ai/conversations/{id}/messages stream answer (WS upgrade)
POST   /ai/ocr/invoices                upload PDF/image → extracted fields
POST   /ai/journal-suggestions         NL → suggested template + inputs
POST   /ai/compliance-scans            run on tenant's last N days

GET    /compliance/deadlines?from=&to=
POST   /compliance/deadlines/{id}/complete

GET    /audit-events?resourceType=&resourceId=
```

## 3. Request/response contract style

All DTOs live in `packages/contracts` as **Zod schemas**, then OpenAPI is generated from Zod (`zod-to-openapi`). Same schema validates both REST controllers (NestJS pipe) and tRPC procedures.

```ts
// packages/contracts/invoices.ts
export const CreateInvoiceInput = z.object({
  customerId: z.string().uuid(),
  issueDate:  z.string().date(),
  dueDate:    z.string().date(),
  currency:   z.literal('IDR'),
  lines: z.array(z.object({
    description: z.string().min(1),
    quantity:    z.number().positive(),
    unitPrice:   Money,
    incomeAccountId: z.string().uuid(),
    taxTreatment: z.enum(['PPN_NORMAL','PPN_DTP','NON_PPN','PPN_NILAI_LAIN']),
  })).min(1),
});

export type CreateInvoiceInput = z.infer<typeof CreateInvoiceInput>;
```

`Money` is a branded `numeric(20,4)` string in transit (never `number` — JS floats lose precision around 2^53; not catastrophic for IDR but disastrous for FX scenarios).

## 4. Idempotency

Every state-changing POST accepts `Idempotency-Key: <uuid>`:

```
1. Hash (tenant_id, route, idempotency_key, body_hash) → idempotency_id
2. INSERT INTO idempotency_records ON CONFLICT DO NOTHING
3. If conflict, return the saved response from the first attempt
4. Otherwise, run handler, save response, return.
```

This makes client retries (network flap, browser back) safe for "create invoice", "post payment", "finalize payroll".

## 5. Errors

A single error envelope, RFC 7807-flavored:

```json
{
  "type":   "https://taxora.id/errors/journal-unbalanced",
  "title":  "Journal is unbalanced",
  "status": 422,
  "detail": "Total debit 10,000,000 ≠ total credit 9,800,000",
  "code":   "JOURNAL_UNBALANCED",
  "tenantId": "…",
  "traceId":  "…",
  "fields": [
    { "path": "lines[2].amount", "message": "Missing PPN line for invoice with PPN treatment" }
  ]
}
```

`code` is stable and machine-actionable; `detail` is for humans; `traceId` ties to logs.

## 6. Versioning

- URL-versioned major: `/v1`, `/v2` only on breaking changes (rare).
- Additive changes: ship under `/v1` with `Sunset` header for replaced fields.
- Deprecation policy: 6 months minimum notice via `Deprecation` header + email to API key owners.

## 7. Auth & permissions

```
Authorization: Bearer <jwt>           # web sessions, short-lived
Authorization: ApiKey <prefix>.<key>  # M2M
```

JWT claims: `sub` (user), `tnt` (tenant), `wsp` (workspace, optional), `roles[]`, `perms[]`, `scp` (API scopes), `exp`, `iat`.

Per-route policy (NestJS guard):

```ts
@Permissions('invoice:issue')        // RBAC permission
@Scope('invoices:write')             // API key scope (M2M)
@RateLimit({ perTenant: '60/min' })
@Audit('invoice.issue')
@Post(':id/issue')
issue(@Param('id') id: string, @TenantCtx() ctx: TenantContext) { ... }
```

## 8. Webhooks (outbound)

Tenants can register webhook endpoints per event type. Delivery:

- HMAC-SHA256 signature in `X-Taxora-Signature: t=…, v1=…`.
- At-least-once delivery with exponential backoff (1m, 5m, 30m, 3h, 12h, 1d).
- Replayable from `webhook_deliveries` for 30 days.
- Subscribed events from the same outbox stream that drives internal handlers.

## 9. Rate limits

- Per-tenant: `1000 req / minute` default, bursts of 100.
- Per-route override for hot endpoints (AI: `30 req / min` per tenant).
- Returned via `RateLimit-*` standard headers.

## 10. What we explicitly do NOT do

- ❌ Tenant id in path or body (it's only in JWT).
- ❌ Offset pagination on `journal_lines` or `audit_events`.
- ❌ Free-form filter DSL — explicit query params only, validated by Zod.
- ❌ GraphQL on the public surface (we'd need to invest in cost analysis & persisted queries; not worth it for this product).
