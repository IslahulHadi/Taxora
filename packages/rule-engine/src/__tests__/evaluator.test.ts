import { describe, it, expect } from 'vitest';
import { parse } from '../parser.js';
import { evaluate, type Scope } from '../evaluator.js';
import { Money as M } from '@taxora/tax-rules';
import { TaxRuleRegistry } from '@taxora/tax-rules';
import { DEFAULT_BUILTINS } from '../builtins.js';
import { RBool, RDate, RMoney, RNumber, RString } from '../runtime.js';
import { EvaluationError } from '../types.js';

function makeScope(extraVars: Record<string, ReturnType<typeof RNumber>> = {}): Scope {
  return {
    vars: {
      x: RNumber(10),
      flag: RBool(true),
      ...extraVars,
    },
    builtins: DEFAULT_BUILTINS,
    context: {
      tenantId: '00000000-0000-0000-0000-000000000001',
      registry: new TaxRuleRegistry(),
      resolveAccountByTaxPurpose: () => undefined,
      resolveAccountByCode: () => undefined,
      resolveExpenseAccountForKodeObjek: () => undefined,
      resolveParty: () => undefined,
    },
  };
}

describe('evaluator', () => {
  it('arithmetic on plain numbers', () => {
    expect(evaluate(parse('1 + 2 * 3'), makeScope())).toMatchObject({ kind: 'number', value: 7 });
  });

  it('short-circuits ||', () => {
    // Right operand would throw if evaluated, but || stops at the first truthy.
    expect(evaluate(parse('true || boom'), makeScope())).toMatchObject({ kind: 'boolean', value: true });
  });

  it('short-circuits &&', () => {
    expect(evaluate(parse('false && boom'), makeScope())).toMatchObject({ kind: 'boolean', value: false });
  });

  it('throws on unknown identifier', () => {
    expect(() => evaluate(parse('unknown_thing + 1'), makeScope())).toThrow(EvaluationError);
  });

  it('money + money = money', () => {
    const scope = makeScope({
      a: RMoney(M.fromRupiah('1000000')) as never,
      b: RMoney(M.fromRupiah('250000')) as never,
    });
    const v = evaluate(parse('a + b'), scope);
    expect(v.kind).toBe('money');
    if (v.kind === 'money') expect(M.toRupiah(v.value)).toBe('1250000');
  });

  it('money * rate uses banker rounding (no float drift)', () => {
    const scope = makeScope({
      harga: RMoney(M.fromRupiah('1000000')) as never,
    });
    const v = evaluate(parse('harga * rate(12, 100)'), scope);
    if (v.kind !== 'money') throw new Error('expected money');
    expect(M.toRupiah(v.value)).toBe('120000');
  });

  it('builtin call: ppn() with NILAI_LAIN_GENERAL @ 2025', () => {
    const registry = new TaxRuleRegistry();
    registry.add({
      code: 'PPN_RATE', effectiveFrom: new Date('2025-01-01'),
      payload: { rate: { num: 12, den: 100 } },
    });
    registry.add({
      code: 'PPN_DPP_NILAI_LAIN_GENERAL', effectiveFrom: new Date('2025-01-01'),
      payload: { numerator: 11, denominator: 12 },
    });
    const scope: Scope = { ...makeScope(), context: { ...makeScope().context, registry } };
    scope.vars['harga'] = RMoney(M.fromRupiah('1200000'));
    scope.vars['issueDate'] = RDate(new Date('2025-06-01'));
    const v = evaluate(parse("ppn(harga, 'NILAI_LAIN_GENERAL', issueDate).ppn"), scope);
    if (v.kind !== 'money') throw new Error('expected money');
    expect(M.toRupiah(v.value)).toBe('132000'); // = 11% × 1.200.000
  });

  it('member access on object', () => {
    const scope = makeScope();
    scope.vars['obj'] = { kind: 'object', value: { foo: RString('bar') } } as never;
    expect(evaluate(parse('obj.foo'), scope)).toMatchObject({ kind: 'string', value: 'bar' });
  });

  it('cannot call non-builtin', () => {
    expect(() => evaluate(parse('x(1)'), makeScope())).toThrow(/unknown function/);
  });

  it('ternary chooses correct branch', () => {
    expect(evaluate(parse('flag ? 1 : 2'), makeScope())).toMatchObject({ kind: 'number', value: 1 });
  });

  it('division by zero throws', () => {
    expect(() => evaluate(parse('1 / 0'), makeScope())).toThrow(/division by zero/);
  });
});
