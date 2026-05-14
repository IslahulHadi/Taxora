import { describe, it, expect } from 'vitest';
import { calcMonthlyPph21Ter } from '../pph21-ter.js';
import { fromRupiah, toRupiah } from '../money.js';
import { seedRegistry } from '../__fixtures__/seed.js';

describe('PPh 21 TER (PMK 168/2023, kategori A)', () => {
  const registry = seedRegistry();

  it('bruto 5.000.000 → 0%', () => {
    const r = calcMonthlyPph21Ter({
      bruto: fromRupiah('5000000'),
      category: 'A',
      hasNpwp: true,
      date: new Date('2025-06-25'),
      registry,
    });
    expect(toRupiah(r.amount)).toBe('0');
  });

  it('bruto 5.500.000 → 0,25% = 13.750', () => {
    const r = calcMonthlyPph21Ter({
      bruto: fromRupiah('5500000'),
      category: 'A',
      hasNpwp: true,
      date: new Date('2025-06-25'),
      registry,
    });
    expect(toRupiah(r.amount)).toBe('13750');
  });

  it('tanpa NPWP: tarif efektif 1.2× (rounded)', () => {
    const withNpwp = calcMonthlyPph21Ter({
      bruto: fromRupiah('10000000'),
      category: 'A',
      hasNpwp: true,
      date: new Date('2025-06-25'),
      registry,
    });
    const withoutNpwp = calcMonthlyPph21Ter({
      bruto: fromRupiah('10000000'),
      category: 'A',
      hasNpwp: false,
      date: new Date('2025-06-25'),
      registry,
    });
    expect(withoutNpwp.amount.amount).toBeGreaterThan(withNpwp.amount.amount);
    expect(withoutNpwp.doubledForNoNpwp).toBe(true);
  });

  it('throws if no rule effective (e.g. before 2024)', () => {
    expect(() =>
      calcMonthlyPph21Ter({
        bruto: fromRupiah('5500000'),
        category: 'A',
        hasNpwp: true,
        date: new Date('2023-06-25'),
        registry,
      }),
    ).toThrow(/PPH21_TER_A/);
  });
});
