-- ============================================================================
--  Taxora — DB-level invariants
--  Apply AFTER `prisma migrate deploy` has created the baseline tables.
--
--  This file enforces things Prisma cannot express:
--    1. CHECK constraints on enum-like text columns.
--    2. Append-only journal_lines + audit_events (UPDATE/DELETE forbidden).
--    3. Balanced-journal constraint (deferred trigger, fires at COMMIT).
--    4. Row-Level Security policies for every tenant-scoped table.
--    5. Materialized view for trial balance (refreshed by outbox dispatcher).
--    6. ivfflat index on ai_documents.embedding for ANN search.
--
--  Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. CHECK constraints (enum-like statuses)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE tenants
  DROP CONSTRAINT IF EXISTS tenants_pkp_status_check,
  ADD  CONSTRAINT tenants_pkp_status_check CHECK (pkp_status IN ('PKP','NON_PKP'));

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_type_check,
  ADD  CONSTRAINT accounts_type_check CHECK (type IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE')),
  DROP CONSTRAINT IF EXISTS accounts_normal_side_check,
  ADD  CONSTRAINT accounts_normal_side_check CHECK (normal_side IN ('DEBIT','CREDIT'));

ALTER TABLE fiscal_periods
  DROP CONSTRAINT IF EXISTS fiscal_periods_status_check,
  ADD  CONSTRAINT fiscal_periods_status_check CHECK (status IN ('OPEN','LOCKED','CLOSED')),
  DROP CONSTRAINT IF EXISTS fiscal_periods_month_check,
  ADD  CONSTRAINT fiscal_periods_month_check CHECK (month BETWEEN 1 AND 12);

ALTER TABLE journals
  DROP CONSTRAINT IF EXISTS journals_status_check,
  ADD  CONSTRAINT journals_status_check CHECK (status IN ('DRAFT','POSTED','REVERSED'));

ALTER TABLE journal_lines
  DROP CONSTRAINT IF EXISTS journal_lines_side_check,
  ADD  CONSTRAINT journal_lines_side_check CHECK (side IN ('DEBIT','CREDIT')),
  DROP CONSTRAINT IF EXISTS journal_lines_amount_positive,
  ADD  CONSTRAINT journal_lines_amount_positive CHECK (amount > 0);

ALTER TABLE parties
  DROP CONSTRAINT IF EXISTS parties_type_check,
  ADD  CONSTRAINT parties_type_check CHECK (type IN ('CUSTOMER','VENDOR','EMPLOYEE','BOTH'));

ALTER TABLE faktur_pajak
  DROP CONSTRAINT IF EXISTS faktur_pajak_type_check,
  ADD  CONSTRAINT faktur_pajak_type_check CHECK (type IN ('KELUARAN','MASUKAN'));

ALTER TABLE withholdings
  DROP CONSTRAINT IF EXISTS withholdings_pph_type_check,
  ADD  CONSTRAINT withholdings_pph_type_check
    CHECK (pph_type IN ('PPH21','PPH22','PPH23','PPH26','PPH4_2'));

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Balanced-journal enforcement
--    Two layers, both important:
--      (a) DEFERRED constraint trigger on journal_lines (defense-in-depth for raw
--          SQL paths). Fires at COMMIT.
--      (b) NON-DEFERRED trigger on journals when status transitions to 'POSTED'.
--          This fires inside the app's transaction so ORMs (e.g. Prisma) surface
--          the error correctly to the caller.
--
--    Application convention:
--      INSERT INTO journals (..., status='POSTED');
--      INSERT INTO journal_lines (...) x N;
--      -- both triggers verify sums; at least one will raise on imbalance.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION assert_journal_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d numeric(20,4);
  c numeric(20,4);
  jid uuid := COALESCE(NEW.journal_id, OLD.journal_id);
BEGIN
  IF jid IS NULL THEN RETURN NULL; END IF;
  SELECT
    COALESCE(SUM(CASE WHEN side='DEBIT'  THEN amount END), 0),
    COALESCE(SUM(CASE WHEN side='CREDIT' THEN amount END), 0)
  INTO d, c
  FROM journal_lines WHERE journal_id = jid;
  IF d <> c THEN
    RAISE EXCEPTION
      'Unbalanced journal %: debit=%, credit=%, delta=%',
      jid, d, c, (d - c);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_journal_lines_balance ON journal_lines;
CREATE CONSTRAINT TRIGGER trg_journal_lines_balance
  AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION assert_journal_balanced();

-- (b) Immediate validator: fires when a journal's status transitions to POSTED.
-- Application convention:
--   1. INSERT INTO journals (..., status='DRAFT');
--   2. INSERT INTO journal_lines (...) x N (no validation yet — DRAFT).
--   3. UPDATE journals SET status='POSTED' WHERE id=:id  -- trigger validates.
-- This way the error is caught synchronously by the app driver, not at COMMIT.

CREATE OR REPLACE FUNCTION assert_journal_balanced_on_post() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d numeric(20,4);
  c numeric(20,4);
  n integer;
BEGIN
  IF NEW.status = 'POSTED' AND (OLD.status IS DISTINCT FROM 'POSTED') THEN
    SELECT
      COALESCE(SUM(CASE WHEN side='DEBIT'  THEN amount END), 0),
      COALESCE(SUM(CASE WHEN side='CREDIT' THEN amount END), 0),
      COUNT(*)
    INTO d, c, n
    FROM journal_lines WHERE journal_id = NEW.id;
    IF n < 2 THEN
      RAISE EXCEPTION 'Journal % has only % line(s); need at least 2.', NEW.id, n;
    END IF;
    IF d <> c THEN
      RAISE EXCEPTION
        'Unbalanced journal %: debit=%, credit=%, delta=%',
        NEW.id, d, c, (d - c);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_journals_balance_on_post ON journals;
CREATE TRIGGER trg_journals_balance_on_post
  BEFORE INSERT OR UPDATE OF status ON journals
  FOR EACH ROW
  EXECUTE FUNCTION assert_journal_balanced_on_post();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Append-only enforcement on journal_lines and audit_events
--    The application role must NOT be able to UPDATE/DELETE these.
--    A trigger guards even if grants are misconfigured.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reject_mutation_on_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; UPDATE/DELETE forbidden.', TG_TABLE_NAME;
END $$;

DROP TRIGGER IF EXISTS trg_journal_lines_append_only ON journal_lines;
CREATE TRIGGER trg_journal_lines_append_only
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION reject_mutation_on_append_only();

DROP TRIGGER IF EXISTS trg_audit_events_append_only ON audit_events;
CREATE TRIGGER trg_audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation_on_append_only();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Row-Level Security
--    Every tenant-scoped table has a policy keyed on `app.tenant_id` (set per
--    request via SET LOCAL). Cross-tenant access is impossible by construction.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE v text;
BEGIN
  v := current_setting('app.tenant_id', true);
  IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
  RETURN v::uuid;
END $$;

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'tenants','tenant_memberships','workspace_tenants',
    'accounts','fiscal_periods','journals','journal_lines',
    'parties','invoices','invoice_lines','faktur_pajak',
    'bills','withholdings','payroll_runs',
    'tax_rules','tax_returns','transaction_templates',
    'compliance_deadlines','outbox_events','audit_events',
    'idempotency_records','ai_documents','ai_suggestions'
  ];
  tenant_col text;
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    -- `tenants` itself: id = current_tenant_id().
    -- Everything else: tenant_id = current_tenant_id().
    -- Some tables (tax_rules, transaction_templates, ai_documents) have nullable
    -- tenant_id meaning "global"; allow access if NULL OR matches.
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',  t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_modify ON %I', t);

    IF t = 'tenants' THEN
      EXECUTE format($p$
        CREATE POLICY tenant_isolation_select ON %I
        FOR SELECT USING (id = current_tenant_id())
      $p$, t);
      EXECUTE format($p$
        CREATE POLICY tenant_isolation_modify ON %I
        FOR ALL USING (id = current_tenant_id())
        WITH CHECK (id = current_tenant_id())
      $p$, t);
    ELSIF t IN ('tax_rules','transaction_templates','ai_documents') THEN
      EXECUTE format($p$
        CREATE POLICY tenant_isolation_select ON %I
        FOR SELECT USING (tenant_id IS NULL OR tenant_id = current_tenant_id())
      $p$, t);
      EXECUTE format($p$
        CREATE POLICY tenant_isolation_modify ON %I
        FOR ALL USING (tenant_id IS NULL OR tenant_id = current_tenant_id())
        WITH CHECK (tenant_id IS NULL OR tenant_id = current_tenant_id())
      $p$, t);
    ELSIF t = 'tenant_memberships' THEN
      -- A user may belong to many tenants; the membership row is "owned" by the tenant.
      EXECUTE format($p$
        CREATE POLICY tenant_isolation_select ON %I
        FOR SELECT USING (tenant_id = current_tenant_id())
      $p$, t);
      EXECUTE format($p$
        CREATE POLICY tenant_isolation_modify ON %I
        FOR ALL USING (tenant_id = current_tenant_id())
        WITH CHECK (tenant_id = current_tenant_id())
      $p$, t);
    ELSIF t = 'workspace_tenants' THEN
      EXECUTE format($p$
        CREATE POLICY tenant_isolation_select ON %I
        FOR SELECT USING (tenant_id = current_tenant_id())
      $p$, t);
      EXECUTE format($p$
        CREATE POLICY tenant_isolation_modify ON %I
        FOR ALL USING (tenant_id = current_tenant_id())
        WITH CHECK (tenant_id = current_tenant_id())
      $p$, t);
    ELSE
      tenant_col := 'tenant_id';
      EXECUTE format($p$
        CREATE POLICY tenant_isolation_select ON %I
        FOR SELECT USING (%I = current_tenant_id())
      $p$, t, tenant_col);
      EXECUTE format($p$
        CREATE POLICY tenant_isolation_modify ON %I
        FOR ALL USING (%I = current_tenant_id())
        WITH CHECK (%I = current_tenant_id())
      $p$, t, tenant_col, tenant_col);
    END IF;
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Materialized view: trial balance (per tenant per period per account)
--    Refreshed via outbox listener on JournalPosted. Concurrent refresh
--    requires a unique index.
-- ────────────────────────────────────────────────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_trial_balance AS
SELECT
  jl.tenant_id,
  fp.year,
  fp.month,
  jl.account_id,
  SUM(CASE WHEN jl.side='DEBIT'  THEN jl.amount ELSE 0 END)::numeric(20,4) AS debit,
  SUM(CASE WHEN jl.side='CREDIT' THEN jl.amount ELSE 0 END)::numeric(20,4) AS credit
FROM journal_lines jl
JOIN journals j        ON j.id = jl.journal_id
JOIN fiscal_periods fp ON fp.id = j.fiscal_period_id
WHERE j.status = 'POSTED'
GROUP BY jl.tenant_id, fp.year, fp.month, jl.account_id;

CREATE UNIQUE INDEX IF NOT EXISTS ux_mv_trial_balance
  ON mv_trial_balance (tenant_id, year, month, account_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. ANN index on ai_documents.embedding (cosine distance)
--    Moved to 02_ai_vector.sql which is conditional on pgvector availability.
-- ────────────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Outbox dispatcher hot-path index (partial)
-- ────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS ix_outbox_pending;
CREATE INDEX ix_outbox_pending
  ON outbox_events (created_at)
  WHERE dispatched_at IS NULL;

COMMIT;
