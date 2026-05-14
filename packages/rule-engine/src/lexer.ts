import { ParseError } from './types.js';

/**
 * Lexer for the small expression language.
 * Total function: returns Token[] or throws ParseError.
 */

export type TokenKind =
  | 'NUMBER' | 'STRING' | 'IDENT'
  | 'TRUE' | 'FALSE' | 'NULL'
  | 'PLUS' | 'MINUS' | 'STAR' | 'SLASH'
  | 'EQ' | 'NEQ' | 'LT' | 'LTE' | 'GT' | 'GTE'
  | 'AND' | 'OR' | 'NOT'
  | 'QUESTION' | 'COLON' | 'COMMA' | 'DOT'
  | 'LPAREN' | 'RPAREN'
  | 'EOF';

export interface Token {
  kind: TokenKind;
  value: string;
  /** 0-based column where this token starts. Useful for error messages. */
  pos: number;
}

const SINGLE: Record<string, TokenKind> = {
  '+': 'PLUS', '-': 'MINUS', '*': 'STAR', '/': 'SLASH',
  '?': 'QUESTION', ':': 'COLON', ',': 'COMMA', '.': 'DOT',
  '(': 'LPAREN', ')': 'RPAREN',
};

const KEYWORDS: Record<string, TokenKind> = {
  true: 'TRUE', false: 'FALSE', null: 'NULL',
};

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const N = source.length;

  const isDigit = (c: string) => c >= '0' && c <= '9';
  const isAlpha = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
  const isAlphaNum = (c: string) => isAlpha(c) || isDigit(c);

  while (i < N) {
    const c = source[i]!;

    // whitespace
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++; continue;
    }

    // multi-char operators
    if (c === '=' && source[i + 1] === '=') { tokens.push({ kind: 'EQ',  value: '==', pos: i }); i += 2; continue; }
    if (c === '!' && source[i + 1] === '=') { tokens.push({ kind: 'NEQ', value: '!=', pos: i }); i += 2; continue; }
    if (c === '<' && source[i + 1] === '=') { tokens.push({ kind: 'LTE', value: '<=', pos: i }); i += 2; continue; }
    if (c === '>' && source[i + 1] === '=') { tokens.push({ kind: 'GTE', value: '>=', pos: i }); i += 2; continue; }
    if (c === '&' && source[i + 1] === '&') { tokens.push({ kind: 'AND', value: '&&', pos: i }); i += 2; continue; }
    if (c === '|' && source[i + 1] === '|') { tokens.push({ kind: 'OR',  value: '||', pos: i }); i += 2; continue; }

    if (c === '<') { tokens.push({ kind: 'LT',  value: '<', pos: i }); i++; continue; }
    if (c === '>') { tokens.push({ kind: 'GT',  value: '>', pos: i }); i++; continue; }
    if (c === '!') { tokens.push({ kind: 'NOT', value: '!', pos: i }); i++; continue; }

    if (c in SINGLE) {
      tokens.push({ kind: SINGLE[c]!, value: c, pos: i });
      i++; continue;
    }

    // string: single or double quoted, with simple \" \\ \n escapes
    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      i++;
      let s = '';
      while (i < N && source[i] !== quote) {
        const ch = source[i]!;
        if (ch === '\\' && i + 1 < N) {
          const nx = source[i + 1]!;
          if (nx === 'n') s += '\n';
          else if (nx === 't') s += '\t';
          else s += nx;
          i += 2;
        } else {
          s += ch;
          i++;
        }
      }
      if (i >= N) throw new ParseError('Unterminated string', start, source);
      i++; // closing quote
      tokens.push({ kind: 'STRING', value: s, pos: start });
      continue;
    }

    // number: integer or decimal; underscores allowed for readability (e.g. 4_800_000)
    if (isDigit(c)) {
      const start = i;
      let s = '';
      while (i < N && (isDigit(source[i]!) || source[i] === '_')) {
        if (source[i] !== '_') s += source[i];
        i++;
      }
      if (source[i] === '.' && i + 1 < N && isDigit(source[i + 1]!)) {
        s += '.';
        i++;
        while (i < N && (isDigit(source[i]!) || source[i] === '_')) {
          if (source[i] !== '_') s += source[i];
          i++;
        }
      }
      tokens.push({ kind: 'NUMBER', value: s, pos: start });
      continue;
    }

    // identifier / keyword
    if (isAlpha(c)) {
      const start = i;
      let s = '';
      while (i < N && isAlphaNum(source[i]!)) { s += source[i]; i++; }
      if (s in KEYWORDS) {
        tokens.push({ kind: KEYWORDS[s]!, value: s, pos: start });
      } else {
        tokens.push({ kind: 'IDENT', value: s, pos: start });
      }
      continue;
    }

    throw new ParseError(`Unexpected character '${c}'`, i, source);
  }

  tokens.push({ kind: 'EOF', value: '', pos: N });
  return tokens;
}
