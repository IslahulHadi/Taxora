/**
 * Effective-dated tax rule registry.
 *
 * INVARIANT: lookup never silently defaults. If no rule covers the date,
 * it throws. This is critical: a missing PPh21 bracket cannot become 0%.
 */
export interface TaxRule<P = unknown> {
  code: string;
  effectiveFrom: Date;
  effectiveTo?: Date | undefined;
  payload: P;
  sourceRef?: string;
  tenantId?: string | undefined;
}

export class TaxRuleNotFoundError extends Error {
  constructor(code: string, asOf: Date) {
    super(`No tax rule '${code}' effective on ${asOf.toISOString().slice(0, 10)}`);
    this.name = 'TaxRuleNotFoundError';
  }
}

export class TaxRuleRegistry {
  private rules: TaxRule[] = [];

  add<P>(rule: TaxRule<P>): void {
    this.rules.push(rule as TaxRule);
  }

  addMany(rules: TaxRule[]): void {
    this.rules.push(...rules);
  }

  /**
   * Find the rule with this code that is effective on `asOf`.
   * Tenant-specific overrides win over global rules.
   */
  lookup<P>(code: string, asOf: Date, tenantId?: string): P {
    const time = asOf.getTime();
    let best: TaxRule | undefined;
    for (const r of this.rules) {
      if (r.code !== code) continue;
      if (r.effectiveFrom.getTime() > time) continue;
      if (r.effectiveTo && r.effectiveTo.getTime() <= time) continue;
      if (tenantId && r.tenantId && r.tenantId !== tenantId) continue;
      // Prefer tenant-specific over global, then most recent effectiveFrom.
      if (!best) {
        best = r;
        continue;
      }
      const bestIsTenant = !!best.tenantId;
      const rIsTenant = !!r.tenantId;
      if (rIsTenant && !bestIsTenant) {
        best = r;
      } else if (rIsTenant === bestIsTenant && r.effectiveFrom > best.effectiveFrom) {
        best = r;
      }
    }
    if (!best) throw new TaxRuleNotFoundError(code, asOf);
    return best.payload as P;
  }
}
