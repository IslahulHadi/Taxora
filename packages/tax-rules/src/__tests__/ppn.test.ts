import { describe, it, expect } from 'vitest';
import { calcPpn } from '../ppn.js';
import { fromRupiah, toRupiah } from '../money.js';
import { seedRegistry } from '../__fixtures__/seed.js';

describe('PPN', () => {
  const registry = seedRegistry();

  it('NORMAL: PPN 12% atas DPP = harga jual (2025+)', () => {
    const r = calcPpn({
      hargaJual: fromRupiah('1000000'),
      treatment: 'NORMAL',
      date: new Date('2025-06-01'),
      registry,
    });
    expect(toRupiah(r.dpp)).toBe('1000000');
    expect(toRupiah(r.ppn)).toBe('120000');
  });

  it('NILAI_LAIN_GENERAL: efektif 11% via DPP 11/12 × harga (PMK 131/2024)', () => {
    const r = calcPpn({
      hargaJual: fromRupiah('1200000'),
      treatment: 'NILAI_LAIN_GENERAL',
      date: new Date('2025-06-01'),
      registry,
    });
    // DPP = 1.200.000 * 11/12 = 1.100.000
    expect(toRupiah(r.dpp)).toBe('1100000');
    // PPN = DPP * 12% = 132.000  (= 11% × harga)
    expect(toRupiah(r.ppn)).toBe('132000');
  });

  it('NON_PPN: tidak ada PPN', () => {
    const r = calcPpn({
      hargaJual: fromRupiah('500000'),
      treatment: 'NON_PPN',
      date: new Date('2025-06-01'),
      registry,
    });
    expect(toRupiah(r.ppn)).toBe('0');
  });

  it('uses 11% rate for periods before 2025-01-01', () => {
    const r = calcPpn({
      hargaJual: fromRupiah('1000000'),
      treatment: 'NORMAL',
      date: new Date('2024-06-01'),
      registry,
    });
    expect(toRupiah(r.ppn)).toBe('110000');
  });
});
