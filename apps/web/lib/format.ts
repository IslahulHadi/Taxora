import { Money } from '@taxora/tax-rules';

/**
 * Display helpers — never used for arithmetic, only for rendering.
 * All math goes through @taxora/tax-rules' bigint Money to avoid float drift.
 */

export function formatRupiah(m: Money.Money | string | number): string {
  const raw = typeof m === 'object' ? Money.toRupiah(m) : String(m);
  // raw is already an exact decimal string like "1200000" or "1100000.5"
  const [whole, frac] = raw.split('.');
  const sign = whole!.startsWith('-') ? '-' : '';
  const wholeAbs = whole!.replace('-', '');
  const grouped = wholeAbs.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return frac ? `Rp ${sign}${grouped},${frac}` : `Rp ${sign}${grouped}`;
}

export function formatRate(rate: { num: number; den: number }): string {
  // Convert to percent for human display, with up to 4 decimals trimmed.
  const pct = (rate.num / rate.den) * 100;
  const fixed = pct.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return `${fixed}%`;
}

export function formatDateID(d: Date): string {
  return d.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
