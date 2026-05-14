/**
 * Default Chart of Accounts seed for an Indonesian SMB.
 * Codes follow common Indonesian PSAK ETAP / EMKM-friendly numbering.
 * Tenants can extend; the engine resolves "tax_purpose" accounts via this seed
 * so postings remain stable across CoA customization.
 */
export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
export type Side = 'DEBIT' | 'CREDIT';

export interface SeedAccount {
  code: string;
  name: string;
  type: AccountType;
  normalSide: Side;
  taxPurpose?:
    | 'PPN_MASUKAN'
    | 'PPN_KELUARAN'
    | 'PPH21_PAYABLE'
    | 'PPH23_PAYABLE'
    | 'PPH4_2_PAYABLE'
    | 'PPH25_PAYABLE'
    | 'PPH_FINAL_UMKM_PAYABLE';
}

export const DEFAULT_COA_SMB: SeedAccount[] = [
  // Assets
  { code: '1.1.01.001', name: 'Kas',                            type: 'ASSET',     normalSide: 'DEBIT' },
  { code: '1.1.02.001', name: 'Bank',                           type: 'ASSET',     normalSide: 'DEBIT' },
  { code: '1.1.03.001', name: 'Piutang Usaha',                  type: 'ASSET',     normalSide: 'DEBIT' },
  { code: '1.1.04.001', name: 'PPN Masukan',                    type: 'ASSET',     normalSide: 'DEBIT', taxPurpose: 'PPN_MASUKAN' },
  { code: '1.1.05.001', name: 'PPN Lebih Bayar',                type: 'ASSET',     normalSide: 'DEBIT' },
  { code: '1.2.01.001', name: 'Aset Tetap',                     type: 'ASSET',     normalSide: 'DEBIT' },

  // Liabilities
  { code: '2.1.01.001', name: 'Hutang Usaha',                   type: 'LIABILITY', normalSide: 'CREDIT' },
  { code: '2.1.02.001', name: 'Hutang PPN',                     type: 'LIABILITY', normalSide: 'CREDIT', taxPurpose: 'PPN_KELUARAN' },
  { code: '2.1.03.001', name: 'Hutang PPh 21',                  type: 'LIABILITY', normalSide: 'CREDIT', taxPurpose: 'PPH21_PAYABLE' },
  { code: '2.1.04.001', name: 'Hutang PPh 23',                  type: 'LIABILITY', normalSide: 'CREDIT', taxPurpose: 'PPH23_PAYABLE' },
  { code: '2.1.05.001', name: 'Hutang PPh 4(2)',                type: 'LIABILITY', normalSide: 'CREDIT', taxPurpose: 'PPH4_2_PAYABLE' },
  { code: '2.1.06.001', name: 'Hutang PPh 25',                  type: 'LIABILITY', normalSide: 'CREDIT', taxPurpose: 'PPH25_PAYABLE' },
  { code: '2.1.07.001', name: 'Hutang PPh Final UMKM 0,5%',     type: 'LIABILITY', normalSide: 'CREDIT', taxPurpose: 'PPH_FINAL_UMKM_PAYABLE' },

  // Equity
  { code: '3.1.01.001', name: 'Modal Disetor',                  type: 'EQUITY',    normalSide: 'CREDIT' },
  { code: '3.2.01.001', name: 'Laba Ditahan',                   type: 'EQUITY',    normalSide: 'CREDIT' },

  // Income
  { code: '4.1.01.001', name: 'Pendapatan Jasa',                type: 'INCOME',    normalSide: 'CREDIT' },
  { code: '4.1.02.001', name: 'Pendapatan Penjualan Barang',    type: 'INCOME',    normalSide: 'CREDIT' },

  // Expense
  { code: '5.1.01.001', name: 'Beban Gaji',                     type: 'EXPENSE',   normalSide: 'DEBIT' },
  { code: '5.1.02.001', name: 'Beban Sewa',                     type: 'EXPENSE',   normalSide: 'DEBIT' },
  { code: '5.1.03.001', name: 'Beban Jasa Profesional',         type: 'EXPENSE',   normalSide: 'DEBIT' },
  { code: '5.1.04.001', name: 'Beban Utilitas',                 type: 'EXPENSE',   normalSide: 'DEBIT' },
  { code: '5.1.99.001', name: 'Beban Lain-lain',                type: 'EXPENSE',   normalSide: 'DEBIT' },
];
