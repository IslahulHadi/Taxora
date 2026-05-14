# 00 — Product Vision & Coretax Positioning

## 1. The problem (concrete, not abstract)

Coretax DJP, launched 1 Januari 2025, replaced DJP Online / e-Faktur / e-Bupot / e-SPT into a single portal. In practice, business users hit four walls:

1. **Coretax expects clean, validated input** (NPWP 16-digit, NIK linkage, kode objek pajak, DPP nilai lain, etc.). Most SMBs do not produce that from their bookkeeping.
2. **Coretax has no accounting brain.** It does not generate journals, does not reconcile PPN Masukan vs Keluaran, does not track tax payable balances over time.
3. **Coretax does not automate withholdings.** When you pay a vendor jasa, nothing reminds you to potong PPh 23, generate bukti potong, post the journal, or schedule the setoran.
4. **Coretax UX is built for tax officers, not business owners.** Konsultan Pajak end up re-entering data their clients already typed into Excel/Accurate.

## 2. What Taxora is

Taxora is a **B2B SaaS that owns the business-side workflow** and emits artifacts Coretax accepts:

```
+------------------+    +-------------------------+    +------------------+
|  Business event  | -> |  Taxora                 | -> |  Coretax DJP     |
|  (sale, payroll, |    |  (rules + journal +     |    |  (official       |
|   vendor pmt)    |    |   tax calc + AI assist) |    |   filing)        |
+------------------+    +-------------------------+    +------------------+
                                  |
                                  v
                        +------------------+
                        | Accounting books |
                        | (always in sync) |
                        +------------------+
```

**Taxora is the system of record for the business. Coretax is the system of record for the tax authority. We bridge them.**

## 3. What Taxora is NOT

- Not a replacement for Coretax / DJP Online.
- Not a "free e-Faktur clone" — we file *through* Coretax APIs / exports, not around them.
- Not a generic global accounting app re-skinned. Indonesian tax is the **first-class domain**, not a plugin.
- Not a pure CRUD ledger. Every UI action triggers rules, journals, tax calculations, and reminders.

## 4. Target users (priority order)

| Segment | Pain we solve | MVP fit |
|---|---|---|
| **Akuntan / Konsultan Pajak** (multi-client) | Re-keying client data into Coretax, tracking 50+ deadlines | ⭐ Primary MVP user |
| **UMKM PPh Final 0.5%** (PP 55/2022) | Don't know when omzet melewati 4.8M / kapan harus PKP | ⭐ Primary MVP user |
| **SMB PKP** | PPN reconciliation, Faktur Pajak Keluaran, Pajak Masukan kredit | ⭐ Primary MVP user |
| **Startups dengan payroll** | PPh 21 TER, BPJS, bukti potong A1 | Phase 2 |
| **Payroll providers** | Bulk PPh 21 TER untuk klien-klien mereka | Phase 3 |

## 5. Product principles

1. **Compliance correctness over UX cleverness.** A wrong tax number is worse than an ugly form.
2. **AI proposes, human approves.** No AI output is auto-filed. Every AI suggestion has an explanation and a source citation (PMK/PER/UU pasal).
3. **Every transaction creates a journal.** No "tax-only" entries floating outside the books.
4. **Effective-dated everything.** Tarif PPN, TER PPh 21, PTKP, kode objek pajak — all change. Rules are dated, not hard-coded.
5. **Auditable by default.** Append-only journal lines, immutable audit log, signed exports.
6. **Multi-tenant from line 1.** No "we'll add multi-tenancy later" — that always corrupts the data model.

## 6. Success metrics (12-month)

- Time to file SPT Masa PPN: from ~4 hours to **< 15 minutes**.
- Bukti Potong PPh 23 generation: from manual per-vendor to **bulk auto-generate**.
- Journal accuracy on AI-OCR'd faktur: **> 95%** before human edit.
- Tenant onboarding (first journal posted): **< 30 minutes**.

## 7. Non-goals (explicit)

- Direct integration with bank accounts (open banking) — Phase 3+.
- Inventory / manufacturing / POS — out of scope. We integrate, not own.
- IFRS/PSAK consolidation across legal entities — Phase 4 (enterprise).
- Direct e-filing automation that bypasses Coretax — never. We respect DJP's perimeter.
