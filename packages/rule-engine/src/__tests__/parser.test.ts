import { describe, it, expect } from 'vitest';
import { parse } from '../parser.js';
import { ParseError } from '../types.js';

describe('parser', () => {
  it('precedence: * binds tighter than +', () => {
    const ast = parse('1 + 2 * 3');
    expect(ast).toMatchObject({
      kind: 'binary', op: '+',
      left:  { kind: 'number', value: 1 },
      right: { kind: 'binary', op: '*' },
    });
  });

  it('parses ternary right-associatively', () => {
    const ast = parse('a ? b : c ? d : e');
    expect(ast).toMatchObject({
      kind: 'ternary',
      whenFalse: { kind: 'ternary' },
    });
  });

  it('member access and chained call', () => {
    const ast = parse('vendor.npwp == null && rate(12, 100)');
    expect(ast.kind).toBe('binary');
  });

  it('rejects trailing tokens', () => {
    expect(() => parse('1 + 2 garbage')).toThrow(ParseError);
  });

  it('rejects unbalanced parens', () => {
    expect(() => parse('(1 + 2')).toThrow(ParseError);
  });

  it('parses unary minus and not', () => {
    const ast = parse('-1 + !true');
    expect(ast).toMatchObject({
      kind: 'binary', op: '+',
      left: { kind: 'unary', op: '-' },
      right: { kind: 'unary', op: '!' },
    });
  });
});
