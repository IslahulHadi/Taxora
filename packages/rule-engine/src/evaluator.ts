/**
 * Evaluator: walks an AST against a Scope and returns a RuntimeValue.
 * Total function (returns or throws). No side effects.
 */

import type { Node } from './ast.js';
import { EvaluationError, type ExecutionContext, type RuntimeValue } from './types.js';
import {
  RBool, RNull, RNumber, RString, RMoney,
  add, sub, mul, div, eq, cmp, asBoolean, asNumber,
} from './runtime.js';
import type { BuiltinFn } from './builtins.js';
import { Money as M } from '@taxora/tax-rules';

export interface Scope {
  /** Local bindings (inputs + computations + iteration vars). */
  vars: Record<string, RuntimeValue>;
  /** Function names available as call() targets. */
  builtins: Record<string, BuiltinFn>;
  /** Engine context for builtins that need DB-shaped lookups. */
  context: ExecutionContext;
}

export function evaluate(node: Node, scope: Scope, path: string = ''): RuntimeValue {
  switch (node.kind) {
    case 'number':  return RNumber(node.value);
    case 'string':  return RString(node.value);
    case 'boolean': return RBool(node.value);
    case 'null':    return RNull;

    case 'identifier': {
      const v = scope.vars[node.name];
      if (v === undefined) {
        throw new EvaluationError(`unknown identifier '${node.name}'`, path);
      }
      return v;
    }

    case 'member': {
      const obj = evaluate(node.object, scope, path);
      if (obj.kind === 'object') {
        const v = obj.value[node.property];
        if (v === undefined) {
          throw new EvaluationError(`object has no field '${node.property}'`, path);
        }
        return v;
      }
      throw new EvaluationError(`cannot access .${node.property} on ${obj.kind}`, path);
    }

    case 'call': {
      // The callee must be a bare identifier — i.e. a builtin. We do not allow
      // first-class functions; this keeps the surface minimal and auditable.
      if (node.callee.kind !== 'identifier') {
        throw new EvaluationError(`only top-level builtin calls are allowed`, path);
      }
      const fn = scope.builtins[node.callee.name];
      if (!fn) {
        throw new EvaluationError(`unknown function '${node.callee.name}()'`, path);
      }
      const args = node.args.map((a, i) => evaluate(a, scope, `${path}.arg[${i}]`));
      return fn(args, scope.context);
    }

    case 'unary': {
      const v = evaluate(node.operand, scope, path);
      if (node.op === '!') return RBool(!asBoolean(v, path));
      // op === '-'
      if (v.kind === 'number') return RNumber(-v.value);
      if (v.kind === 'money')  return RMoney(M.sub(M.zero(v.value.currency), v.value));
      throw new EvaluationError(`cannot negate ${v.kind}`, path);
    }

    case 'binary': {
      // short-circuit logical ops
      if (node.op === '&&') {
        const l = evaluate(node.left, scope, path);
        return asBoolean(l, path) ? RBool(asBoolean(evaluate(node.right, scope, path), path)) : RBool(false);
      }
      if (node.op === '||') {
        const l = evaluate(node.left, scope, path);
        return asBoolean(l, path) ? RBool(true) : RBool(asBoolean(evaluate(node.right, scope, path), path));
      }

      const l = evaluate(node.left, scope, path);
      const r = evaluate(node.right, scope, path);
      switch (node.op) {
        case '+':  return add(l, r);
        case '-':  return sub(l, r);
        case '*':  return mul(l, r);
        case '/':  return div(l, r);
        case '==': return RBool(eq(l, r));
        case '!=': return RBool(!eq(l, r));
        case '<':  return RBool(cmp(l, r) < 0);
        case '<=': return RBool(cmp(l, r) <= 0);
        case '>':  return RBool(cmp(l, r) > 0);
        case '>=': return RBool(cmp(l, r) >= 0);
      }
      // exhaustiveness fallback (TS narrowing covers above; this is just defense)
      throw new EvaluationError(`unsupported operator '${(node as { op: string }).op}'`, path);
    }

    case 'ternary': {
      const c = evaluate(node.cond, scope, path);
      return asBoolean(c, path)
        ? evaluate(node.whenTrue, scope, path)
        : evaluate(node.whenFalse, scope, path);
    }
  }
  // Exhaustive: every Node.kind is handled.
  const _exhaustive: never = node;
  throw new EvaluationError(`unreachable: ${(_exhaustive as { kind: string }).kind}`);
}

// Tiny helper kept unused locally but exported for tests/users to coerce manually.
export { asNumber };
