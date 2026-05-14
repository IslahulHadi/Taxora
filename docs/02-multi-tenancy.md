# 02 — Multi-Tenancy Strategy

## 1. The decision: Hybrid (RLS by default, schema-per-tenant for enterprise)

| Tier | Isolation model | Why |
|---|---|---|
| **Standard / Pro** (UMKM, SMB, accounting firms) | **Shared DB, shared schema, Postgres Row-Level Security (RLS)** keyed on `tenant_id` | Cheapest, fastest onboarding, scales to thousands of tenants. |
| **Enterprise** (large firms, regulated) | **Schema-per-tenant** (one Postgres schema per tenant) inside a shared DB cluster | Easier per-tenant backup/restore, custom retention, audit isolation. |
| **Sovereign / on-prem** | **Database-per-tenant** | For tenants that contractually require it (rare). |

The same application code serves all three. Tenant resolution chooses the binding at runtime.

## 2. Tenant resolution pipeline

```
HTTP request
  → JWT verified
  → tenant_id extracted from JWT claim `tnt`
  → TenantContext (AsyncLocalStorage) populated for request lifetime
  → Prisma middleware sets `SET LOCAL app.tenant_id = '<uuid>'`
  → All queries automatically filtered by RLS policies
```

Key points:
- **`tenant_id` is never accepted from the request body.** Only from a verified JWT claim.
- **Cross-tenant queries are impossible by construction.** A developer cannot accidentally leak data because the DB itself rejects mismatched rows.
- **AsyncLocalStorage** propagates context through async boundaries (queues, workers) without leaking globals.

## 3. RLS policy template

Every tenant-owned table follows the same pattern:

```sql
ALTER TABLE journals ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON journals
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_modify ON journals
  FOR ALL
  USING      (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

The `WITH CHECK` clause prevents inserting/updating rows into a *different* tenant — critical to stop privilege escalation through API.

A `BYPASSRLS` role exists only for: migrations, the outbox dispatcher (which signs events with the row's own `tenant_id`), and break-glass support tooling (audited).

## 4. Tenant lifecycle

```
SignupRequested
  → email + NPWP/NIK PIC verified
  → ProvisioningJob enqueued
    → create Tenant row
    → create default Chart of Accounts (PSAK ETAP / EMKM template per tenant tier)
    → seed default tax rules (effective-dated, current period)
    → create Owner user + initial RBAC role bindings
    → emit TenantProvisioned event
  → onboarding wizard (NPWP, status PKP, tahun buku, mata uang)
```

Deprovisioning is **soft-delete + scheduled hard-delete** (UU PDP requires we delete on request, but tax records have 10-year retention obligations under UU KUP — we honor the longer of the two unless the tenant explicitly waives via signed export).

## 5. Per-tenant configuration

Stored in `tenant_settings` (JSONB), with a typed accessor in code:

```ts
type TenantSettings = {
  fiscalYear: { startMonth: 1 | 2 | ... | 12 };
  baseCurrency: 'IDR';
  pkpStatus: 'PKP' | 'NON_PKP';
  npwp: string;          // 16-digit (NIK-based for OP) or 15-digit legacy
  ppnRate: number;       // override only with explicit reasoning
  pphFinalUmkm: boolean; // PP 55/2022
  fiscalCalendar: 'gregorian';
  taxNumberSeries: { faktur: string; bupot23: string; bupot42: string; };
  features: { ai: boolean; ocr: boolean; payroll: boolean; multiCompany: boolean; };
};
```

## 6. Cross-tenant features (multi-company under one parent)

Accounting firms manage many client tenants. We model this as:

- A `Workspace` entity (the firm) groups N `Tenants` (clients).
- A user can be a member of one workspace and have roles in many tenants.
- The firm-level dashboard is **a separate read-model** that aggregates *only the tenants the user has access to* — enforced by RLS on a `tenant_membership` junction.

This means a Konsultan Pajak can switch between 50 client tenants in one session without ever loading data they shouldn't see.

## 7. What we explicitly do NOT do

- ❌ Filter by `tenant_id` in application code only (RLS makes the DB the last line of defense).
- ❌ Let the frontend send `tenant_id` in headers (only JWT claim is trusted).
- ❌ Share connection pools across tenants without `SET LOCAL` reset between checkouts.
- ❌ Use a single `audit_log` table without partitioning by tenant for enterprise tier.
