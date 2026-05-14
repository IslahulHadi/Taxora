# 03 — Database Schema

## 1. Design principles

1. **Tenant-scoped by default.** Every business table has `tenant_id uuid NOT NULL` and an RLS policy.
2. **Append-only where it matters.** Journal lines, audit events, and tax artifacts are immutable. Corrections are *new* entries (reversal entries), never `UPDATE`.
3. **Effective-dated reference data.** Tax rates, TER brackets, PTKP, kode objek pajak — all have `effective_from` / `effective_to` so historical periods recompute correctly.
4. **Money is `numeric(20, 4)`** — never `float`. Currency is explicit.
5. **All identifiers are `uuid`** (v7 preferred for time-ordered indexes).
6. **Soft delete via `deleted_at`** for user-facing entities; **hard delete forbidden** for journals and tax artifacts.
7. **Foreign keys always enforced.** No orphaned journal lines, ever.

## 2. Core schema (DDL sketch)

The DDL below is illustrative; Prisma will own the canonical schema. The shapes are what matter.

### 2.1 Tenancy & identity

```sql
CREATE TABLE tenants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            citext UNIQUE NOT NULL,
  legal_name      text NOT NULL,
  npwp            varchar(20),                -- 16-digit (NIK-based) or 15 legacy
  pkp_status      text NOT NULL CHECK (pkp_status IN ('PKP','NON_PKP')),
  pph_final_umkm  boolean NOT NULL DEFAULT false,    -- PP 55/2022
  fiscal_year_start_month smallint NOT NULL DEFAULT 1,
  base_currency   char(3) NOT NULL DEFAULT 'IDR',
  tier            text NOT NULL DEFAULT 'standard',  -- standard | pro | enterprise
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext UNIQUE NOT NULL,
  password_hash   text,                       -- nullable when SSO-only
  full_name       text NOT NULL,
  status          text NOT NULL DEFAULT 'active',
  mfa_enabled     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- A user can belong to many tenants with different roles
CREATE TABLE tenant_memberships (
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            text NOT NULL,              -- owner | admin | accountant | tax_officer | viewer
  permissions     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

-- Workspace = accounting firm grouping multiple client tenants
CREATE TABLE workspaces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  owner_user_id   uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_tenants (
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (workspace_id, tenant_id)
);
```

### 2.2 Accounting core (the unbreakable part)

```sql
CREATE TABLE accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  code            text NOT NULL,              -- e.g. '1.1.01.001'
  name            text NOT NULL,
  type            text NOT NULL CHECK (type IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE')),
  normal_side     text NOT NULL CHECK (normal_side IN ('DEBIT','CREDIT')),
  parent_id       uuid REFERENCES accounts(id),
  is_tax_account  boolean NOT NULL DEFAULT false,
  tax_purpose     text,                       -- 'PPN_MASUKAN' | 'PPN_KELUARAN' | 'PPH23_PAYABLE' ...
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE fiscal_periods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  year            smallint NOT NULL,
  month           smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','LOCKED','CLOSED')),
  closed_at       timestamptz,
  closed_by       uuid REFERENCES users(id),
  UNIQUE (tenant_id, year, month)
);

CREATE TABLE journals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  fiscal_period_id uuid NOT NULL REFERENCES fiscal_periods(id),
  posted_at       timestamptz NOT NULL,
  reference_type  text NOT NULL,              -- 'INVOICE' | 'BILL' | 'PAYROLL' | 'MANUAL' | 'REVERSAL'
  reference_id    uuid,                        -- FK to source aggregate
  memo            text,
  posted_by       uuid REFERENCES users(id),
  reversed_by_journal_id uuid REFERENCES journals(id),
  status          text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','REVERSED')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE journal_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  journal_id      uuid NOT NULL REFERENCES journals(id) ON DELETE RESTRICT,
  account_id      uuid NOT NULL REFERENCES accounts(id),
  side            text NOT NULL CHECK (side IN ('DEBIT','CREDIT')),
  amount          numeric(20,4) NOT NULL CHECK (amount > 0),
  currency        char(3) NOT NULL DEFAULT 'IDR',
  fx_rate         numeric(20,8) NOT NULL DEFAULT 1,
  description     text,
  -- Tax-aware metadata (links journal line to the artifact that justified it)
  tax_artifact_type text,                     -- 'FAKTUR_PAJAK' | 'BUKTI_POTONG_PPH23' | 'BUKTI_POTONG_PPH21' | 'SETORAN'
  tax_artifact_id   uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_journal_lines_account_period
  ON journal_lines (tenant_id, account_id, journal_id);

-- The unbreakable invariant: every journal balances. Enforced by a trigger.
CREATE OR REPLACE FUNCTION assert_journal_balanced() RETURNS trigger AS $$
DECLARE
  d numeric(20,4);
  c numeric(20,4);
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN side='DEBIT'  THEN amount END), 0),
    COALESCE(SUM(CASE WHEN side='CREDIT' THEN amount END), 0)
  INTO d, c
  FROM journal_lines WHERE journal_id = NEW.journal_id;
  IF d <> c THEN
    RAISE EXCEPTION 'Unbalanced journal %: debit=%, credit=%', NEW.journal_id, d, c;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Fired by the application after the last line is inserted in the same TX,
-- via a deferrable constraint trigger. Implementation detail in migration.
```

### 2.3 Subjects (vendor / customer / employee)

```sql
CREATE TABLE parties (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  type            text NOT NULL CHECK (type IN ('CUSTOMER','VENDOR','EMPLOYEE','BOTH')),
  legal_name      text NOT NULL,
  npwp            varchar(20),
  nik             varchar(20),
  is_pkp          boolean NOT NULL DEFAULT false,
  email           citext,
  phone           text,
  address         jsonb,
  pph23_default_rate numeric(5,4),            -- per-vendor override
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  UNIQUE (tenant_id, npwp) WHERE deleted_at IS NULL AND npwp IS NOT NULL
);
```

### 2.4 Sales side (Invoice + Faktur Pajak)

```sql
CREATE TABLE invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  number          text NOT NULL,
  customer_id     uuid NOT NULL REFERENCES parties(id),
  issue_date      date NOT NULL,
  due_date        date NOT NULL,
  currency        char(3) NOT NULL DEFAULT 'IDR',
  subtotal        numeric(20,4) NOT NULL,
  ppn_rate        numeric(5,4) NOT NULL DEFAULT 0.11,
  ppn_amount      numeric(20,4) NOT NULL DEFAULT 0,
  total           numeric(20,4) NOT NULL,
  dpp             numeric(20,4) NOT NULL,
  dpp_basis       text NOT NULL DEFAULT 'NORMAL', -- 'NORMAL' | 'NILAI_LAIN'
  status          text NOT NULL DEFAULT 'DRAFT', -- DRAFT|ISSUED|PAID|VOID
  issued_at       timestamptz,
  posted_journal_id uuid REFERENCES journals(id),
  UNIQUE (tenant_id, number)
);

CREATE TABLE invoice_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  invoice_id      uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description     text NOT NULL,
  quantity        numeric(20,4) NOT NULL,
  unit_price      numeric(20,4) NOT NULL,
  amount          numeric(20,4) NOT NULL,
  income_account_id uuid NOT NULL REFERENCES accounts(id),
  tax_treatment   text NOT NULL DEFAULT 'PPN_NORMAL' -- 'PPN_NORMAL'|'PPN_DTP'|'NON_PPN'|'PPN_NILAI_LAIN'
);

CREATE TABLE faktur_pajak (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  invoice_id      uuid REFERENCES invoices(id),
  type            text NOT NULL CHECK (type IN ('KELUARAN','MASUKAN')),
  nomor_seri      text,                       -- 16-digit, after DJP allocation
  status          text NOT NULL DEFAULT 'DRAFT', -- DRAFT|APPROVED|REPLACED|CANCELLED
  kode_transaksi  varchar(2) NOT NULL,        -- '01','04','06','07','08' ...
  dpp             numeric(20,4) NOT NULL,
  ppn             numeric(20,4) NOT NULL,
  ppnbm           numeric(20,4) NOT NULL DEFAULT 0,
  customer_npwp   varchar(20),
  customer_nik    varchar(20),
  issued_date     date NOT NULL,
  coretax_export_id uuid,                     -- links to the export batch
  raw_xml         text,                       -- Coretax-format XML once generated
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

### 2.5 Purchase side (Bill + Withholding)

```sql
CREATE TABLE bills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  vendor_id       uuid NOT NULL REFERENCES parties(id),
  number          text NOT NULL,
  vendor_invoice_no text,
  issue_date      date NOT NULL,
  due_date        date NOT NULL,
  subtotal        numeric(20,4) NOT NULL,
  ppn_amount      numeric(20,4) NOT NULL DEFAULT 0,
  pph_withheld    numeric(20,4) NOT NULL DEFAULT 0,
  total           numeric(20,4) NOT NULL,
  status          text NOT NULL DEFAULT 'DRAFT',
  posted_journal_id uuid REFERENCES journals(id)
);

CREATE TABLE withholdings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  bill_id         uuid REFERENCES bills(id),
  payroll_run_id  uuid,                       -- for PPh 21
  pph_type        text NOT NULL CHECK (pph_type IN ('PPH21','PPH23','PPH4_2','PPH26','PPH22')),
  kode_objek_pajak text NOT NULL,             -- e.g. '24-104-01' (jasa lain)
  dpp             numeric(20,4) NOT NULL,
  rate            numeric(7,5) NOT NULL,      -- 0.02000 for 2%
  amount          numeric(20,4) NOT NULL,
  bukti_potong_no text,                       -- once generated
  status          text NOT NULL DEFAULT 'CALCULATED', -- CALCULATED|ISSUED|REPORTED
  period_year     smallint NOT NULL,
  period_month    smallint NOT NULL,
  issued_at       timestamptz,
  coretax_export_id uuid
);
```

### 2.6 Tax rules (effective-dated)

```sql
CREATE TABLE tax_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid REFERENCES tenants(id),  -- NULL = global default
  code            text NOT NULL,                 -- 'PPN_RATE' | 'PPH23_JASA_LAIN' | 'PPH21_TER_TK0' ...
  payload         jsonb NOT NULL,                -- the rule (rate, brackets, formula expr)
  effective_from  date NOT NULL,
  effective_to    date,                          -- NULL = open
  source_ref      text,                          -- 'PMK 168/2023' etc. — citation
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_tax_rules_lookup
  ON tax_rules (code, effective_from DESC, effective_to);
```

### 2.7 Outbox & audit (durability + traceability)

```sql
CREATE TABLE outbox_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  type            text NOT NULL,                -- 'JournalPosted' etc.
  aggregate_id    uuid NOT NULL,
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  dispatched_at   timestamptz,
  attempts        smallint NOT NULL DEFAULT 0,
  last_error      text
);
CREATE INDEX ix_outbox_pending ON outbox_events (created_at) WHERE dispatched_at IS NULL;

CREATE TABLE audit_events (
  id              bigserial PRIMARY KEY,
  tenant_id       uuid NOT NULL,
  actor_user_id   uuid,
  actor_kind      text NOT NULL,                -- USER | SYSTEM | AI
  action          text NOT NULL,                -- 'invoice.issue', 'journal.post', 'ai.suggest.accept'
  resource_type   text NOT NULL,
  resource_id     uuid,
  before          jsonb,
  after           jsonb,
  ip              inet,
  user_agent      text,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
-- Append-only: revoke UPDATE/DELETE from app role on this table.
```

### 2.8 AI

```sql
CREATE TABLE ai_documents (        -- ingested PMK/PER/UU + tenant docs for RAG
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid,                          -- NULL = global (peraturan)
  source_type     text NOT NULL,                 -- 'PMK'|'PER_DJP'|'UU'|'TENANT_POLICY'
  citation        text,                          -- 'PMK 168/2023 ps. 5 ayat 2'
  content         text NOT NULL,
  embedding       vector(1536),                  -- pgvector
  metadata        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_ai_documents_embedding
  ON ai_documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE TABLE ai_suggestions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  kind            text NOT NULL,                 -- 'JOURNAL'|'CLASSIFY'|'OCR_FIELD'|'COMPLIANCE_CHECK'
  input           jsonb NOT NULL,
  output          jsonb NOT NULL,
  citations       jsonb,                         -- list of {doc_id, citation, score}
  model           text NOT NULL,
  prompt_version  text NOT NULL,
  status          text NOT NULL DEFAULT 'PROPOSED', -- PROPOSED|ACCEPTED|REJECTED|EDITED
  reviewed_by     uuid REFERENCES users(id),
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

## 3. Indexing strategy (operational)

- All tenant-scoped tables: composite `(tenant_id, <natural lookup>)` indexes — NEVER `(natural_lookup)` alone, because RLS forces every query to include `tenant_id`.
- `journal_lines (tenant_id, account_id)` — trial balance.
- `journal_lines (tenant_id, journal_id)` — line lookup.
- `outbox_events (created_at) WHERE dispatched_at IS NULL` — partial index, dispatcher's hot path.
- `ai_documents` ivfflat on `embedding` for ANN search.
- Partition `audit_events` and `journal_lines` by `tenant_id` hash for enterprise tier (future).

## 4. Reporting (materialized views)

```sql
CREATE MATERIALIZED VIEW mv_trial_balance AS
SELECT
  jl.tenant_id,
  fp.year, fp.month,
  jl.account_id,
  SUM(CASE WHEN jl.side='DEBIT'  THEN jl.amount ELSE 0 END) AS debit,
  SUM(CASE WHEN jl.side='CREDIT' THEN jl.amount ELSE 0 END) AS credit
FROM journal_lines jl
JOIN journals j ON j.id = jl.journal_id
JOIN fiscal_periods fp ON fp.id = j.fiscal_period_id
WHERE j.status = 'POSTED'
GROUP BY jl.tenant_id, fp.year, fp.month, jl.account_id;
```

Refreshed via outbox listener on `JournalPosted` (concurrent refresh).

## 5. Things explicitly avoided

- ❌ A single `transactions` table that mixes tax + accounting.
- ❌ Storing computed totals (`balance`) on `accounts` — it's a denormalization landmine. Always derive from `journal_lines`.
- ❌ `enum` types in Postgres for business statuses — they're hard to migrate. Use `text + CHECK`.
- ❌ Boolean `is_deleted` for tax artifacts. Tax artifacts have explicit `status` lifecycles (`REPLACED`, `CANCELLED`).
