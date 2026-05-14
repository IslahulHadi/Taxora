/**
 * @taxora/rule-engine — public types
 *
 * The engine takes:
 *   - a TransactionTemplate (data, declarative)
 *   - typed Inputs from the user
 *   - a Context that resolves accounts, parties, and tax rules
 *
 * It emits:
 *   - a balanced JournalDraft (consumed by @taxora/api/journal-poster)
 *   - zero or more Artifacts (FakturPajak / BuktiPotong stubs)
 *   - zero or more Obligations (compliance deadline rows)
 *   - the Computed map (audit trail of every intermediate value)
 *
 * Determinism is the contract: same inputs + same context = byte-identical output.
 */

import type { JournalDraft, Side } from '@taxora/accounting';
import type { TaxRuleRegistry } from '@taxora/tax-rules';
import { Money as MoneyNs } from '@taxora/tax-rules';
type Money = MoneyNs.Money;

// ─── Template shape (matches transaction_templates.definition JSONB) ─────────

export interface TransactionTemplate {
  code: string;
  version: number;
  effectiveFrom: string;          // ISO date
  effectiveTo?: string;
  inputs: TemplateInputSpec[];
  computations: TemplateComputation[];
  journal: TemplateJournalLine[];
  artifacts?: TemplateArtifact[];
  obligations?: TemplateObligation[];
}

export interface TemplateInputSpec {
  name: string;
  kind: 'string' | 'number' | 'money' | 'boolean' | 'date' | 'uuid';
  required?: boolean;
}

export interface TemplateComputation {
  name: string;                   // becomes a binding in the local scope
  expr: string;                   // expression in the small language
}

export interface TemplateJournalLine {
  side: Side;                     // 'DEBIT' | 'CREDIT'
  account: string;                // expr that resolves to an account id (uuid or via account()/expenseAccount())
  amount: string;                 // expr that resolves to Money
  description?: string;           // optional expr (string)
  if?: string;                    // optional expr (boolean) — line emitted only when truthy
}

export interface TemplateArtifact {
  type: 'FAKTUR_PAJAK' | 'BUKTI_POTONG_PPH23' | 'BUKTI_POTONG_PPH4_2' | 'BUKTI_POTONG_PPH21';
  if?: string;
  fields: Record<string, string>; // field name -> expression
}

export interface TemplateObligation {
  kind: string;                   // 'SETOR_PPH23' | 'LAPOR_PPN' | ...
  /** Day of the *next* month relative to paymentDate/issueDate. */
  dueDay: number;
  amount?: string;                // optional expr (money)
  if?: string;
}

// ─── Engine I/O ──────────────────────────────────────────────────────────────

export type InputValue = string | number | bigint | boolean | Date | Money;

export type Inputs = Record<string, InputValue>;

/**
 * Everything the engine needs to resolve names that aren't in the template.
 * Kept tiny on purpose so the engine remains pure.
 */
export interface ExecutionContext {
  tenantId: string;
  registry: TaxRuleRegistry;
  /** Looks up an account id by tax_purpose (e.g. 'PPN_MASUKAN'). */
  resolveAccountByTaxPurpose(taxPurpose: string): string | undefined;
  /** Looks up an account id by code (e.g. '1.1.01.001' Kas). */
  resolveAccountByCode(code: string): string | undefined;
  /** Maps a kode_objek_pajak to the expense account id used for its DPP. */
  resolveExpenseAccountForKodeObjek(kodeObjekPajak: string): string | undefined;
  /** Resolves party (vendor/customer) for `vendor.npwp`-style member access. */
  resolveParty(partyId: string): { id: string; npwp: string | null; isPkp: boolean } | undefined;
}

export interface ExecutedJournalLine {
  side: Side;
  accountId: string;
  amount: Money;
  description?: string | undefined;
}

export interface ExecutedArtifact {
  type: TemplateArtifact['type'];
  /** Field values are plain serializable shapes ready for persistence. */
  fields: Record<string, ArtifactFieldValue>;
}

/** Value shape allowed inside an artifact's `fields` map. */
export type ArtifactFieldValue =
  | string | number | boolean | null
  | Money | Date
  | { num: number; den: number }
  | Record<string, unknown>;

export interface ExecutedObligation {
  kind: string;
  dueDate: Date;
  amount?: Money | undefined;
}

export interface ExecutionResult {
  templateCode: string;
  templateVersion: number;
  journal: Pick<JournalDraft, 'lines' | 'memo' | 'referenceType' | 'referenceId'> & {
    lines: ExecutedJournalLine[];
  };
  artifacts: ExecutedArtifact[];
  obligations: ExecutedObligation[];
  /** Audit trail: every named computation's resolved value (post-evaluation). */
  computed: Record<string, RuntimeValue>;
}

// ─── Runtime values (what evaluator passes around) ───────────────────────────

export type RuntimeValue =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'money'; value: Money }
  | { kind: 'date'; value: Date }
  | { kind: 'rate'; value: { num: number; den: number } }
  | { kind: 'object'; value: Record<string, RuntimeValue> }
  | { kind: 'null' };

// ─── Errors ──────────────────────────────────────────────────────────────────

export class RuleEngineError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(path ? `[${path}] ${message}` : message);
    this.name = 'RuleEngineError';
  }
}

export class ParseError extends RuleEngineError {
  constructor(message: string, public readonly position: number, source: string) {
    super(`${message} at column ${position} in: ${source}`);
    this.name = 'ParseError';
  }
}

export class EvaluationError extends RuleEngineError {
  constructor(message: string, path?: string) {
    super(message, path);
    this.name = 'EvaluationError';
  }
}
