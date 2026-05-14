# 08 — Security & Compliance

## 1. Threat model (top 5 risks for a tax SaaS)

| Risk | Mitigation |
|---|---|
| **Cross-tenant data leak** | Postgres RLS on every business table + JWT-only tenant resolution + integration tests that try to bypass. |
| **Tampering with posted journals** | Append-only `journal_lines`; corrections are reversal entries; DB role lacks UPDATE/DELETE. |
| **Filed tax artifact divergence from books** | Every artifact links to its source journal via `tax_artifact_id`; reconciliation job runs daily. |
| **Account takeover** | MFA mandatory for `owner`/`admin`; WebAuthn supported; 24h step-up for sensitive actions (export e-Faktur, change NPWP). |
| **AI prompt injection / data exfiltration** | PII redaction at boundary; structured outputs only; AI cannot call repository writes. |

## 2. Identity & access (RBAC + ABAC hybrid)

### 2.1 Roles (default)

| Role | Capabilities |
|---|---|
| `owner` | full control on tenant, billing, deletion |
| `admin` | full ops, no billing/deletion |
| `accountant` | post journals, manage invoices/bills, run reports |
| `tax_officer` | manage tax artifacts, finalize returns, export Coretax |
| `payroll_officer` | manage payroll runs, payslips |
| `viewer` | read-only |
| `external_auditor` | read-only + signed export |

### 2.2 Permissions

Permissions are atomic strings: `invoice:issue`, `journal:reverse`, `tax-return:finalize`, `coretax:export`, `payroll:finalize`, `ai:use`.

Roles bundle permissions. Tenants can create custom roles. Permissions are checked at the controller via `@Permissions()` and at the service layer for defense-in-depth.

### 2.3 ABAC overlays

Beyond role-based, certain actions check **attributes**:

- A user with `accountant` role cannot post into a `LOCKED` fiscal period.
- A user can edit only the entities they created within the last 24h, unless they have `admin`.
- A user accessing a workspace's tenants must have an active `tenant_membership` for each.

## 3. Authentication

- **Web**: Auth.js with email + password (Argon2id), Google/Microsoft OIDC, optional WebAuthn passkeys. Sessions issued as short-lived JWTs (15 min) + rotating refresh tokens.
- **MFA**: TOTP (RFC 6238) and WebAuthn. Required for `owner` and `admin`. Step-up MFA on:
  - Coretax export
  - Tax-return finalization
  - NPWP / PKP status change
  - Adding a payment account
- **API keys**: prefixed (`txk_live_…`), stored as Argon2 hash, scoped, IP-allowlistable, rotatable, immediately revocable.

## 4. Secrets & encryption

- Secrets in **AWS Secrets Manager / GCP Secret Manager**; never in env files committed.
- DB at-rest encryption (managed PG service).
- **Field-level encryption** for: `npwp`, `nik`, salary fields (`pgcrypto` AES-GCM with KMS-managed DEK; key rotation logged).
- TLS 1.2+ everywhere; HSTS preload; mTLS for internal worker→DB if running on shared infra.

## 5. Audit log (the immutable spine)

`audit_events` records every business-meaningful action. Properties:

- Append-only (DB role has no UPDATE/DELETE on this table).
- Daily Merkle hash of the day's audit chunk written to a separate audit-bucket; auditor can verify nothing was tampered with retroactively.
- Retention: **10 years** (UU KUP pasal 28 ayat 11 retention obligation for tax records).
- Exportable as signed PDF/CSV per tenant on request.

What we audit (non-exhaustive):
- auth: login, MFA enroll, password reset, API key create/revoke
- permission: role grant/revoke, custom role change
- accounting: journal post/reverse, period close
- tax: rule override, artifact issue/cancel, return finalize, Coretax export
- AI: suggestion accepted/rejected, prompt version change, model switch
- data: tenant create/delete, user invite/remove, export request

## 6. Privacy (UU PDP 27/2022)

- **Data subject rights**: access, rectification, deletion (with legal-hold caveat for tax retention), portability — all served via tenant admin UI.
- **DPIA** required for AI features that process personal data; ours is on file because OCR + journal classify can read NIK/NPWP/salary.
- **Cross-border transfers**: only with tenant consent. Tenants on Pro/Enterprise can pin processing region (ID-region for sovereign).
- **Retention**: configurable per data class. Tax artifacts: 10 years (legal). Logs: 1 year. AI conversation: 90 days default, tenant-configurable.
- **DPA** with sub-processors (LLM, OCR, email, hosting).

## 7. Operational security

- **Least privilege** DB roles:
  - `app_rw` — RLS-enforced, no DDL, no audit table mutation
  - `app_outbox` — RLS-bypassed for outbox dispatcher only
  - `app_ro_reporting` — read-only for materialized view refresh
  - `migrate` — DDL, used by CI only with break-glass approval
- **Per-environment isolation**: prod creds never present in dev/staging.
- **Build supply chain**: pinned dependencies (`pnpm` lockfile + audit), Dependabot, signed commits, Sigstore for container images.
- **Backups**: PITR + daily logical backups, restore drills quarterly.
- **DR**: cross-region replica for enterprise tier; documented RTO/RPO.

## 8. Compliance posture (target)

| Standard | Why | Plan |
|---|---|---|
| **UU PDP 27/2022** | Required by law (Indonesia) | Day-1 |
| **ISO 27001** | Buyer expectation for accounting firms | Year 1 |
| **SOC 2 Type II** | Buyer expectation for SaaS | Year 1 |
| **PCI DSS** | Only if we touch card data | We use a PSP; out of scope. |

## 9. Things explicitly forbidden

- ❌ Logging secrets, full NPWP, full NIK, salary numbers (mask in logs).
- ❌ Hardcoded fallback rates ("if rule lookup fails, use 11%"). Never. Fail loud.
- ❌ Any developer access to production tenant data outside an audited break-glass session.
- ❌ Disabling RLS for "convenience". The RLS-bypass role is monitored and alarmed on.
