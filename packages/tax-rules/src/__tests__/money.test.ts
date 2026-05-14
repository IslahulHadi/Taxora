import { describe, it, expect } from 'vitest';
import { add, sub, mulRate, fromRupiah, toRupiah, eq, zero } from '../money.js';

describe('Money', () => {
  it('add/sub roundtrip', () => {
    const a = fromRupiah('1000000');
    const b = fromRupiah('250000');
    expect(toRupiah(add(a, b))).toBe('1250000');
    expect(toRupiah(sub(a, b))).toBe('750000');
  });

  it('mulRate 12% with banker rounding (no float drift)', () => {
    expect(toRupiah(mulRate(fromRupiah('1000000'), { num: 12, den: 100 }))).toBe('120000');
    expect(toRupiah(mulRate(fromRupiah('123456'),  { num: 12, den: 100 }))).toBe('14814.72');
  });

  it('mulRate 11/12 — DPP nilai lain (exact)', () => {
    expect(toRupiah(mulRate(fromRupiah('1200000'), { num: 11, den: 12 }))).toBe('1100000');
  });

  it('zero is identity for add', () => {
    expect(eq(add(fromRupiah('0'), zero()), zero())).toBe(true);
  });

  it('rejects strings with > 4 decimals', () => {
    expect(() => fromRupiah('1.23456')).toThrow();
  });
});
