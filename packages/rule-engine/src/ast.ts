/**
 * AST types for the small expression language.
 *
 * Grammar (informal):
 *   expr        := ternary
 *   ternary     := logicOr ('?' expr ':' expr)?
 *   logicOr     := logicAnd ('||' logicAnd)*
 *   logicAnd    := equality ('&&' equality)*
 *   equality    := compare (('==' | '!=') compare)*
 *   compare     := addsub (('<' | '<=' | '>' | '>=') addsub)*
 *   addsub      := muldiv (('+' | '-') muldiv)*
 *   muldiv      := unary (('*' | '/') unary)*
 *   unary       := ('!' | '-') unary | call
 *   call        := primary ( '.' IDENT | '(' args ')' )*
 *   primary     := NUMBER | STRING | TRUE | FALSE | NULL | IDENT | '(' expr ')'
 *
 * No assignment, no statements, no closures. Total functions only.
 */

export type Node =
  | NumberLit
  | StringLit
  | BoolLit
  | NullLit
  | Identifier
  | MemberAccess
  | Call
  | Unary
  | Binary
  | Ternary;

export interface NumberLit  { kind: 'number';  value: number }
export interface StringLit  { kind: 'string';  value: string }
export interface BoolLit    { kind: 'boolean'; value: boolean }
export interface NullLit    { kind: 'null' }
export interface Identifier { kind: 'identifier'; name: string }
export interface MemberAccess { kind: 'member'; object: Node; property: string }
export interface Call         { kind: 'call'; callee: Node; args: Node[] }
export interface Unary        { kind: 'unary'; op: '!' | '-'; operand: Node }
export interface Binary {
  kind: 'binary';
  op: '+' | '-' | '*' | '/' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||';
  left: Node;
  right: Node;
}
export interface Ternary { kind: 'ternary'; cond: Node; whenTrue: Node; whenFalse: Node }
