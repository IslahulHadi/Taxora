import type { Node } from './ast.js';
import { ParseError } from './types.js';
import { tokenize, type Token, type TokenKind } from './lexer.js';

/**
 * Recursive descent parser. Produces a typed AST.
 * Parses a SINGLE expression (no statements). Throws on trailing input.
 */

class Parser {
  private i = 0;
  constructor(private tokens: Token[], private source: string) {}

  parse(): Node {
    const node = this.parseTernary();
    if (this.peek().kind !== 'EOF') {
      throw new ParseError(`Unexpected token '${this.peek().value}'`, this.peek().pos, this.source);
    }
    return node;
  }

  // ─── grammar (highest -> lowest precedence) ─────────────────────────────

  private parseTernary(): Node {
    const cond = this.parseOr();
    if (this.match('QUESTION')) {
      const whenTrue = this.parseTernary();
      this.expect('COLON');
      const whenFalse = this.parseTernary();
      return { kind: 'ternary', cond, whenTrue, whenFalse };
    }
    return cond;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.match('OR')) {
      const right = this.parseAnd();
      left = { kind: 'binary', op: '||', left, right };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseEquality();
    while (this.match('AND')) {
      const right = this.parseEquality();
      left = { kind: 'binary', op: '&&', left, right };
    }
    return left;
  }

  private parseEquality(): Node {
    let left = this.parseCompare();
    while (this.peek().kind === 'EQ' || this.peek().kind === 'NEQ') {
      const op = this.advance().kind === 'EQ' ? '==' : '!=';
      const right = this.parseCompare();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseCompare(): Node {
    let left = this.parseAddSub();
    while (
      this.peek().kind === 'LT' || this.peek().kind === 'LTE' ||
      this.peek().kind === 'GT' || this.peek().kind === 'GTE'
    ) {
      const k = this.advance().kind;
      const op = k === 'LT' ? '<' : k === 'LTE' ? '<=' : k === 'GT' ? '>' : '>=';
      const right = this.parseAddSub();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseAddSub(): Node {
    let left = this.parseMulDiv();
    while (this.peek().kind === 'PLUS' || this.peek().kind === 'MINUS') {
      const op = this.advance().kind === 'PLUS' ? '+' : '-';
      const right = this.parseMulDiv();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseMulDiv(): Node {
    let left = this.parseUnary();
    while (this.peek().kind === 'STAR' || this.peek().kind === 'SLASH') {
      const op = this.advance().kind === 'STAR' ? '*' : '/';
      const right = this.parseUnary();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseUnary(): Node {
    if (this.match('NOT')) return { kind: 'unary', op: '!', operand: this.parseUnary() };
    if (this.match('MINUS')) return { kind: 'unary', op: '-', operand: this.parseUnary() };
    return this.parseCall();
  }

  private parseCall(): Node {
    let expr = this.parsePrimary();
    while (true) {
      if (this.match('DOT')) {
        const name = this.expect('IDENT').value;
        expr = { kind: 'member', object: expr, property: name };
      } else if (this.match('LPAREN')) {
        const args: Node[] = [];
        if (this.peek().kind !== 'RPAREN') {
          args.push(this.parseTernary());
          while (this.match('COMMA')) args.push(this.parseTernary());
        }
        this.expect('RPAREN');
        expr = { kind: 'call', callee: expr, args };
      } else {
        break;
      }
    }
    return expr;
  }

  private parsePrimary(): Node {
    const t = this.advance();
    switch (t.kind) {
      case 'NUMBER':
        return { kind: 'number', value: Number(t.value) };
      case 'STRING':
        return { kind: 'string', value: t.value };
      case 'TRUE':  return { kind: 'boolean', value: true };
      case 'FALSE': return { kind: 'boolean', value: false };
      case 'NULL':  return { kind: 'null' };
      case 'IDENT': return { kind: 'identifier', name: t.value };
      case 'LPAREN': {
        const expr = this.parseTernary();
        this.expect('RPAREN');
        return expr;
      }
      default:
        throw new ParseError(`Unexpected token '${t.value}'`, t.pos, this.source);
    }
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  private peek(): Token {
    const t = this.tokens[this.i];
    if (!t) throw new ParseError('Unexpected end of input', this.source.length, this.source);
    return t;
  }
  private advance(): Token {
    const t = this.peek();
    this.i++;
    return t;
  }
  private match(kind: TokenKind): boolean {
    if (this.peek().kind === kind) { this.i++; return true; }
    return false;
  }
  private expect(kind: TokenKind): Token {
    const t = this.peek();
    if (t.kind !== kind) {
      throw new ParseError(`Expected ${kind} but got ${t.kind} ('${t.value}')`, t.pos, this.source);
    }
    this.i++;
    return t;
  }
}

export function parse(source: string): Node {
  const tokens = tokenize(source);
  return new Parser(tokens, source).parse();
}
