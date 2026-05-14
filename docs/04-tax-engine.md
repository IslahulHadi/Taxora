# 04 — Indonesian Tax Engine

> Compliance correctness is **the** product. Everything else is supporting infrastructure.

## 1. Architecture: pure rules + effective-dated registry

```
┌──────────────────────────────────────────────────────┐
│  packages/tax-rules  (pure TS, zero side effects)    │
│  ─ ppn.ts           PPN, DPP, DPP nilai lain         │
│  ─ pph21-ter.ts     TER A/B/C, PTKP, koreksi tahunan │
│  ─ pph23.ts         tarif & objek pajak jasa         │
│  ─ pph4-2.ts        sewa tanah/bangunan, dll         │
│  ─ pph25.ts         angsuran                         │
│  ─ pph29.ts         kurang/lebih bayar               │
│  ─ pph-final-umkm.ts PP 55/2022                      │
│  ─ rule-registry.ts effective-dated lookup           │
└────────────────────┬─────────────────────────────────┘
                     │ called by
┌────────────────────▼─────────────────────────────────┐
│  modules/taxation/application                        │
│  ─ CalculateTaxOnInvoice                             │
│  ─ CalculateWithholdingOnPayment                     │
│  ─ CalculatePayrollPph21                             │
│  ─ ReconcilePpnMonthly                               │
│  ─ FinalizeTaxReturn (PPN / PPh)                     │
└────────────────────┬─────────────────────────────────┘
                     │ produces
┌────────────────────▼─────────────────────────────────┐
│  modules/taxation/infrastructure/coretax             │
│  ─ FakturPajakXmlBuilder   (Coretax e-Faktur format) │
│  ─ BuktiPotongCsvBuilder   (e-Bupot 23/26/4(2))      │
│  ─ BuktiPotongA1Builder    (PPh 21 tahunan)          │
│  ─ SptMasaPpnExporter                                │
│  ─ CoretaxArtifactValidator (schema + business rules)│
└──────────────────────────────────────────────────────┘
```

The tax-rules package has **no NestJS, no Prisma, no I/O**. It takes inputs, returns outputs. This is the single most important architectural rule in the whole codebase.

## 2. PPN (Pajak Pertambahan Nilai)

### 2.1 Tarif & DPP

- Standard rate: **12%** as of 1 Januari 2025 (UU HPP), with **DPP Nilai Lain = 11/12 × harga** for general goods/services so the effective rate stays 11% for non-luxury (per PMK 131/2024). Luxury goods bear full 12%.
- Rule registry stores both as effective-dated entries:

```json
{ "code": "PPN_RATE", "effective_from": "2025-01-01", "payload": { "rate": 0.12 } }
{ "code": "PPN_DPP_NILAI_LAIN_GENERAL", "effective_from": "2025-01-01",
  "payload": { "numerator": 11, "denominator": 12 } }
```

### 2.2 Calculation function (illustrative)

```ts
export function calcPpnOnSale(input: {
  hargaJual: Money;
  treatment: 'NORMAL' | 'NILAI_LAIN_GENERAL' | 'DTP' | 'NON_PPN';
  date: Date;
  registry: TaxRuleRegistry;
}): { dpp: Money; ppn: Money } {
  if (input.treatment === 'NON_PPN') return { dpp: input.hargaJual, ppn: zero() };

  const rate = input.registry.lookup('PPN_RATE', input.date).rate;

  if (input.treatment === 'NILAI_LAIN_GENERAL') {
    const { numerator, denominator } =
      input.registry.lookup('PPN_DPP_NILAI_LAIN_GENERAL', input.date);
    const dpp = mul(input.hargaJual, numerator / denominator);
    return { dpp, ppn: mul(dpp, rate) };
  }
  // NORMAL: harga sudah merupakan DPP
  return { dpp: input.hargaJual, ppn: mul(input.hargaJual, rate) };
}
```

### 2.3 Kode Transaksi Faktur Pajak

`01` regular sale, `04` DPP nilai lain, `06` other (BKP/JKP tertentu), `07` PPN tidak dipungut, `08` PPN dibebaskan. The system **derives** the kode from `tax_treatment` + customer status (PKP / non-PKP / instansi pemerintah → `02`/`03`).

### 2.4 Reconciliation PPN Masukan vs Keluaran

Monthly job:

```
Pajak Masukan (kreditable)  =  Σ ppn_amount on bills WHERE creditable = true AND period = M
Pajak Keluaran              =  Σ ppn on faktur_pajak WHERE type='KELUARAN' AND period = M
Lebih/Kurang Bayar          =  Pajak Keluaran − Pajak Masukan
```

Result becomes a `TaxLiability` row + a journal entry to `Hutang PPN` / `Piutang PPN Lebih Bayar`.

## 3. PPh 21 (TER method, PMK 168/2023)

### 3.1 Two-stage calculation

The TER method does **monthly withholding via simple bracket × bruto**, then **annual reconciliation in December** using Tarif Pasal 17.

**Monthly:**
```
PPh21_bulanan = Penghasilan_Bruto × TER(category, bracket)
```

Categories A / B / C depend on PTKP status:
- **A**: TK/0, TK/1, K/0
- **B**: TK/2, TK/3, K/1, K/2
- **C**: K/3

Brackets are stored as effective-dated rule rows:

```json
{
  "code": "PPH21_TER_A",
  "effective_from": "2024-01-01",
  "source_ref": "PMK 168/2023 Lampiran",
  "payload": {
    "brackets": [
      { "upTo": 5400000, "rate": 0.0000 },
      { "upTo": 5650000, "rate": 0.0025 },
      { "upTo": 5950000, "rate": 0.0050 },
      { "upTo": 6300000, "rate": 0.0075 }
      /* … 30+ brackets … */
    ]
  }
}
```

**Annual (Masa Pajak Desember):**
```
PKP_tahunan       = (Bruto_setahun − Biaya_Jabatan − Iuran − PTKP)
PPh21_tahunan     = ProgressiveTax(PKP_tahunan, Pasal17)
PPh21_Desember    = PPh21_tahunan − Σ PPh21_Jan..Nov
```

If the result is negative, it becomes a kelebihan that the employer must restitute or compensate.

### 3.2 PTKP (effective-dated)

```json
{
  "code": "PTKP", "effective_from": "2016-01-01",
  "payload": {
    "TK0": 54000000, "K0": 58500000,
    "tambahan_kawin": 4500000, "tambahan_tanggungan": 4500000, "max_tanggungan": 3
  }
}
```

### 3.3 Edge cases the engine MUST handle

- Pegawai masuk/keluar di tengah tahun (proporsional).
- Bonus / THR (gross-up vs gross).
- Penghasilan tidak teratur (joined to annual reconciliation).
- WP yang tidak punya NPWP → **tarif 20% lebih tinggi** (Pasal 21(5a) UU PPh, kept by UU HPP).
- Ekspatriat (PPh 26 instead of 21).

Each edge case has dedicated unit tests with PMK examples as fixtures.

## 4. PPh 23 (jasa, sewa, royalti)

### 4.1 Tarif

- 15% untuk dividen, bunga, royalti, hadiah.
- 2% untuk sewa harta selain tanah/bangunan dan jasa lainnya (PMK 141/2015 list).
- **Tarif 100% lebih tinggi (= 4%)** jika rekanan tidak ber-NPWP.

### 4.2 Trigger

Triggered automatically when:
- A `Bill` from a vendor is recorded with a kode objek pajak in PPh 23 list, OR
- A `Payment` is made for jasa where `pph23_default_rate` on the vendor is set.

### 4.3 Output

- `Withholding` row.
- Journal: Dr `Beban Jasa`, Cr `Hutang PPh 23`, Cr `Kas/Bank`.
- `BuktiPotong` artifact (e-Bupot 23 format) — generated on demand or in monthly batch.

## 5. PPh 4(2) — final tax

Most common: sewa tanah/bangunan (10%), bunga deposito (20%), penjualan saham di bursa (0.1%), pengalihan tanah/bangunan (2.5%), UMKM omzet (0.5% via PP 55/2022).

The engine treats PPh 4(2) as a **terminal tax** — it does not enter the annual SPT 1771/1770 calculation, just the bukti potong + setoran flow.

## 6. PPh 25 / 29

- **PPh 25** angsuran bulanan = (PPh terutang tahun lalu − kredit pajak) ÷ 12. Auto-scheduled as a recurring liability.
- **PPh 29** = kurang bayar tahunan saat penyusunan SPT Tahunan.

Both link to the same `tax_returns` aggregate, just different `kind`.

## 7. Coretax artifact contracts

| Artifact | Format | Source aggregate | Validator rules |
|---|---|---|---|
| **Faktur Pajak Keluaran** | XML (Coretax schema) | `faktur_pajak` + `invoice` | NPWP 16-digit, kode transaksi valid, DPP/PPN tie out, NIK present if non-NPWP buyer |
| **Faktur Pajak Masukan (rekap)** | per Coretax import flow | derived from `bills` + uploaded faktur | creditability check (90 hari) |
| **e-Bupot PPh 23** | Coretax CSV/XML | `withholdings` where pph_type='PPH23' | NPWP/NIK lawan transaksi, kode objek pajak valid |
| **e-Bupot PPh 26** | Coretax CSV/XML | `withholdings` where pph_type='PPH26' | TIN negara mitra, P3B applied |
| **A1 / 1721** | Coretax format | `payroll_runs` aggregated | tahun pajak match, total bruto = sum of payslip bruto |
| **SPT Masa PPN data** | per Coretax intake | `mv_ppn_recap` | total faktur match, PM/PK reconciled |

The **`CoretaxArtifactValidator`** runs the same checks Coretax runs, *before* export, with friendly error messages tied to UI rows. This is the single biggest user value-add: no more rejected uploads.

## 8. Effective-dated rule lookup (the only safe way)

```ts
class TaxRuleRegistry {
  lookup<T>(code: string, asOf: Date, tenantId?: string): T {
    // 1. tenant override matching effective_from <= asOf < effective_to
    // 2. fall back to global default
    // 3. throw if none — never silently default to 0
  }
}
```

Mistake we explicitly prevent: **ever using `new Date()` in tax math.** Always pass the transaction's own date. A 2024 invoice posted late in 2025 must use the 2024 rule.

## 9. Testing strategy

- **Golden-file tests** per peraturan: input scenarios from PMK/PER examples → expected output.
- **Property-based tests** (`fast-check`): for any random valid input, journal balances, DPP+PPN tie out, withholding ≤ DPP × max-rate.
- **Migration tests**: when a rule changes, replay 12 months of historical journals → confirm only future periods change.
- **Round-trip artifact tests**: build → validate → parse → match input.
