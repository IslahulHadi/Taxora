# 05 — Rule & Journal Engine

## 1. The core abstraction: Transaction Template

A **Transaction Template** is a declarative, versioned recipe that turns a business intent into:

1. A set of **journal lines** (always balanced).
2. Zero or more **tax artifacts** (faktur, bukti potong).
3. Zero or more **scheduled obligations** (setoran due dates).

Templates are data, not code. They live in `tax_rules` / `transaction_templates` tables and are effective-dated.

## 2. Example: "Bayar Jasa Konsultan + Potong PPh 23"

### 2.1 Input the user provides

```json
{
  "templateCode": "PAY_VENDOR_JASA_PPH23",
  "vendorId": "…",
  "amountBruto": 10000000,
  "isPpn": true,
  "kodeObjekPajak": "24-104-01",
  "paymentDate": "2025-06-15",
  "memo": "Konsultasi pajak Mei 2025"
}
```

### 2.2 Template definition (stored)

```json
{
  "code": "PAY_VENDOR_JASA_PPH23",
  "version": 3,
  "effective_from": "2025-01-01",
  "inputs": ["amountBruto", "isPpn", "kodeObjekPajak", "vendorId", "paymentDate"],
  "computations": [
    { "name": "dpp",       "expr": "amountBruto" },
    { "name": "ppn",       "expr": "isPpn ? dpp * rule('PPN_RATE', paymentDate) : 0" },
    { "name": "pph23Rate", "expr": "rule('PPH23_TARIF', kodeObjekPajak, paymentDate, vendor.npwp)" },
    { "name": "pph23",     "expr": "dpp * pph23Rate" },
    { "name": "netToPay",  "expr": "dpp + ppn - pph23" }
  ],
  "journal": [
    { "side": "DEBIT",  "account": "expense_for(kodeObjekPajak)", "amount": "dpp" },
    { "side": "DEBIT",  "account": "PPN_MASUKAN",                 "amount": "ppn",   "if": "isPpn" },
    { "side": "CREDIT", "account": "HUTANG_PPH23",                "amount": "pph23" },
    { "side": "CREDIT", "account": "KAS_BANK",                    "amount": "netToPay" }
  ],
  "artifacts": [
    { "type": "BUKTI_POTONG_PPH23", "from": "withholdingFromComputation" }
  ],
  "obligations": [
    { "type": "SETOR_PPH23", "dueDay": 10, "amount": "pph23" },
    { "type": "LAPOR_PPH23", "dueDay": 20, "linkedTo": "SETOR_PPH23" }
  ]
}
```

### 2.3 What the engine does (deterministic pipeline)

```
1. Resolve template @ paymentDate (effective-dated).
2. Resolve all `rule(...)` calls against TaxRuleRegistry.
3. Resolve `account: 'PPN_MASUKAN'` → real account_id via tenant's tax_purpose mapping.
4. Resolve `expense_for(kodeObjekPajak)` → account_id from kode→account map.
5. Evaluate computations in dependency order (topological sort).
6. Build journal lines.
7. ASSERT: Σ debit == Σ credit.  If not, refuse to post (engine bug, never silently fix).
8. Build artifacts (Withholding row, BuktiPotong stub).
9. Build obligations (rows in `compliance_deadlines`).
10. Persist everything inside ONE Postgres transaction.
11. Insert outbox events: BillPaid, WithholdingCalculated, JournalPosted.
12. Commit.
```

If step 7 fails, **nothing is persisted**. The user sees the engine's diagnosis ("expected debit 10,000,000, got 9,800,000 — missing PPN line"). This is how we make the system bisectable.

## 3. The expression language

Constraints: pure, sandboxed, no I/O, deterministic. Implemented as a tiny AST evaluator (no `eval`, no `vm`).

Supported:
- arithmetic, ternary, comparison
- `rule(code, ...args)` — looks up TaxRuleRegistry
- `account(taxPurpose)` — resolves account by tax_purpose
- `vendor.npwp`, `customer.isPkp` — bound from input
- bracket lookup helpers: `bracket('PPH21_TER_A', bruto, date)`

Unsupported (deliberately):
- loops, function definitions, recursion (use multiple computations)
- date arithmetic (compute in TS code; pass results in)
- string manipulation (UI concern, not engine)

## 4. Why declarative templates instead of hard-coded TS

| Property | Hard-coded TS handlers | Declarative templates |
|---|---|---|
| Add new transaction type | dev + PR + deploy | data migration only |
| Audit a specific posting | read code + git blame | query `transaction_templates` by version |
| Tenant override (e.g. KAP custom mapping) | impossible without forking | per-tenant template row |
| Replay historical postings under new rules | rewrite handler | re-evaluate template @ historical date |
| Property-test the rule engine | duplicates logic | test the engine once, data-driven |

Hard-coded handlers exist only for transactions whose **journal shape is genuinely complex** (e.g. payroll run with 100+ lines per employee). Even those call into `tax-rules` for the math.

## 5. Integration with AI suggestions

When an AI suggestion produces a journal proposal:

```
AI → JournalSuggestion (raw lines + reasoning + citations)
   → engine validates: balanced? accounts exist for tenant? amounts > 0?
   → if valid, presented to user as a one-click "Accept" template
   → if accepted, runs through normal posting pipeline (audit, outbox)
```

AI **never** posts directly. It only generates a candidate the same engine validates as if a human typed it.

## 6. Versioning & rollouts

Templates have `version` and `effective_from`. Changing a template = inserting a new row. Old postings retain their `template_version_id`, so:

- We can re-render the explanation page exactly as the user saw it the day they posted.
- We can compute "what would this transaction look like under the new rule?" without mutating history.
- Auditors can reproduce any posting from inputs + template + rule registry.

## 7. Failure modes & guardrails

| Failure | Engine behavior |
|---|---|
| Unbalanced journal | abort, log, surface diff to user |
| Missing tenant account mapping | abort, suggest creating the account |
| Rule not found at date | abort with "no PPH23 rule effective on 2025-06-15" — never default |
| Negative amount | abort |
| Posting into LOCKED period | abort with "period 2025-05 is locked" |
| AI-generated lines mention non-existent account | abort, mark suggestion REJECTED |
| Same source already posted (idempotency) | return existing journal |

Idempotency key: `(tenant_id, reference_type, reference_id, template_version)`. Prevents double-posting on retries.
