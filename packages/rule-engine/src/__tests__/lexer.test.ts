import { describe, it, expect } from 'vitest';
import { tokenize } from '../lexer.js';
import { ParseError } from '../types.js';

describe('lexer', () => {
  it('tokenizes operators, idents, numbers and strings', () => {
    const tokens = tokenize("amount > 0 && rate(12, 100) == ppn('NORMAL')");
    expect(tokens.map((t) => t.kind)).toEqual([
      'IDENT','GT','NUMBER','AND','IDENT','LPAREN','NUMBER','COMMA','NUMBER','RPAREN','EQ','IDENT','LPAREN','STRING','RPAREN','EOF',
    ]);
  });

  it('accepts underscore separators in numbers', () => {
    const t = tokenize('4_800_000_000');
    expect(t[0]!.kind).toBe('NUMBER');
    expect(t[0]!.value).toBe('4800000000');
  });

  it('keywords true/false/null', () => {
    const t = tokenize('true || false || null');
    expect(t.map((x) => x.kind)).toEqual(['TRUE','OR','FALSE','OR','NULL','EOF']);
  });

  it('rejects unterminated string', () => {
    expect(() => tokenize('"open')).toThrow(ParseError);
  });

  it('rejects unknown character', () => {
    expect(() => tokenize('a # b')).toThrow(ParseError);
  });
});
