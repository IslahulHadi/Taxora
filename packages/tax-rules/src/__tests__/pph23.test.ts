import { describe, it, expect } from 'vitest';
import { calcPph23 } from '../pph23.js';
import { fromRupiah, toRupiah } from '../money.js';
import { seedRegistry } from '../__fixtures__/seed.js';

describe('PPh 23', () => {
  const registry = seedRegistry();

  it('jasa lain 2% dengan NPWP', () => {
    const r = calcPph23({
      dpp: fromRupiah('10000000'),
      kodeObjekPajak: '24-104-01',
      vendorHasNpwp: true,
      date: new Date('2025-06-15'),
      registry,
    });
    expect(toRupiah(r.amount)).toBe('200000');
    expect(r.effectiveRateDoubledForNoNpwp).toBe(false);
  });

  it('jasa lain 4% tanpa NPWP', () => {
    const r = calcPph23({
      dpp: fromRupiah('10000000'),
      kodeObjekPajak: '24-104-01',
      vendorHasNpwp: false,
      date: new Date('2025-06-15'),
      registry,
    });
    expect(toRupiah(r.amount)).toBe('400000');
    expect(r.effectiveRateDoubledForNoNpwp).toBe(true);
  });

  it('royalti 15%', () => {
    const r = calcPph23({
      dpp: fromRupiah('5000000'),
      kodeObjekPajak: '24-003-01',
      vendorHasNpwp: true,
      date: new Date('2025-06-15'),
      registry,
    });
    expect(toRupiah(r.amount)).toBe('750000');
  });

  it('throws untuk kode objek tidak dikenal — never silent default', () => {
    expect(() =>
      calcPph23({
        dpp: fromRupiah('1000000'),
        kodeObjekPajak: '99-999-99',
        vendorHasNpwp: true,
        date: new Date('2025-06-15'),
        registry,
      }),
    ).toThrow(/kode objek/);
  });
});
