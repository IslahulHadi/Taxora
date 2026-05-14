'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSignature, Calendar } from 'lucide-react';
import { Money, type TaxRuleRegistry } from '@taxora/tax-rules';
import {
  execute,
  EvaluationError,
  RuleEngineError,
  type ExecutionResult,
} from '@taxora/rule-engine';

import { PageShell } from '@/components/PageShell';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  Input,
  Label,
  Select,
  StatRow,
  Switch,
} from '@/components/ui';
import {
  ACCOUNT_NAMES,
  buildDemoContext,
  KODE_OBJEK_PAJAK_OPTIONS,
} from '@/lib/demo-context';
import { TPL_PAY_VENDOR_JASA_PPH23 } from '@/lib/templates';
import { formatDateID, formatRate, formatRupiah } from '@/lib/format';

interface FormState {
  amountBruto: string;     // raw rupiah string, no separators
  isPpn: boolean;
  kodeObjekPajak: string;
  vendorHasNpwp: boolean;
  paymentDate: string;     // yyyy-mm-dd
}

const DEFAULT_FORM: FormState = {
  amountBruto: '10000000',
  isPpn: true,
  kodeObjekPajak: '24-104-01',
  vendorHasNpwp: true,
  paymentDate: '2025-06-15',
};

export default function PayVendorPage() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);

  // Build context once. (TaxRuleRegistry is plain memory, no I/O.)
  const ctx = useMemo(() => buildDemoContext(), []);

  const result = useMemo(
    () => runEngine(ctx, form),
    [ctx, form],
  );

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  return (
    <PageShell
      title="Bayar Vendor + Potong PPh 23"
      subtitle="Skenario paling sering bikin pusing konsultan pajak. Engine yang sama persis dengan production: pure TypeScript, hitungan bigint scale-4, jurnal selalu seimbang."
      back={{ href: '/', label: 'Kembali' }}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Form */}
        <Card>
          <CardHeader
            title="Input transaksi"
            subtitle="Ubah angka apa pun → engine re-evaluate live di kanan."
          />
          <CardBody className="space-y-4">
            <div>
              <Label hint="rupiah, tanpa titik">Jumlah bruto</Label>
              <Input
                type="text"
                inputMode="numeric"
                value={form.amountBruto}
                onChange={(e) =>
                  update(
                    'amountBruto',
                    e.target.value.replace(/[^\d.]/g, ''),
                  )
                }
              />
            </div>

            <div>
              <Label>Kode Objek Pajak (PPh 23)</Label>
              <Select
                value={form.kodeObjekPajak}
                onChange={(e) => update('kodeObjekPajak', e.target.value)}
              >
                {KODE_OBJEK_PAJAK_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.code} — {o.label}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label>Tanggal pembayaran</Label>
              <Input
                type="date"
                value={form.paymentDate}
                onChange={(e) => update('paymentDate', e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between rounded-md bg-slate-50 p-3">
              <div>
                <p className="text-sm font-medium text-slate-700">
                  Vendor PKP / kena PPN
                </p>
                <p className="text-xs text-slate-500">
                  Kalau aktif, vendor menerbitkan Faktur Pajak Masukan kepada kamu.
                </p>
              </div>
              <Switch
                checked={form.isPpn}
                onChange={(v) => update('isPpn', v)}
                label="PPN"
              />
            </div>

            <div className="flex items-center justify-between rounded-md bg-slate-50 p-3">
              <div>
                <p className="text-sm font-medium text-slate-700">
                  Vendor punya NPWP
                </p>
                <p className="text-xs text-slate-500">
                  Tanpa NPWP, tarif PPh 23 100% lebih tinggi (UU PPh ps. 23 ayat 1a).
                </p>
              </div>
              <Switch
                checked={form.vendorHasNpwp}
                onChange={(v) => update('vendorHasNpwp', v)}
                label="NPWP"
              />
            </div>
          </CardBody>
        </Card>

        {/* Output */}
        <div className="space-y-6">
          {result.kind === 'ok' ? (
            <ResultPanels result={result.value} form={form} />
          ) : (
            <Card className="border-rose-200 bg-rose-50">
              <CardBody className="flex items-start gap-3 p-5">
                <AlertTriangle className="shrink-0 text-rose-600" size={20} />
                <div>
                  <p className="font-medium text-rose-900">
                    Engine menolak input ini
                  </p>
                  <p className="mt-1 text-sm text-rose-800">{result.message}</p>
                  <p className="mt-2 text-xs text-rose-700">
                    Ini fitur, bukan bug. Engine tidak akan diam-diam memakai
                    nilai default ketika input atau aturan pajak tidak lengkap.
                  </p>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </PageShell>
  );
}

// ─── Result panels ───────────────────────────────────────────────────────────

function ResultPanels({
  result,
  form,
}: {
  result: ExecutionResult;
  form: FormState;
}) {
  const c = result.computed;

  const dpp     = (c['dpp']      as { value: Money.Money }).value;
  const ppnAmt  = (c['ppnAmt']   as { value: Money.Money }).value;
  const pph23   = (c['pph23Amt'] as { value: Money.Money }).value;
  const netPay  = (c['netToPay'] as { value: Money.Money }).value;
  const wht     = c['wht'];
  const rate =
    wht?.kind === 'object' && wht.value['rate']?.kind === 'rate'
      ? wht.value['rate'].value
      : { num: 0, den: 1 };

  const debit = result.journal.lines
    .filter((l) => l.side === 'DEBIT')
    .reduce((a, l) => Money.add(a, l.amount), Money.zero());
  const credit = result.journal.lines
    .filter((l) => l.side === 'CREDIT')
    .reduce((a, l) => Money.add(a, l.amount), Money.zero());

  return (
    <>
      <Card>
        <CardHeader
          title="Ringkasan hitungan"
          subtitle="Setiap angka ditelusuri ke `tax_rules` berdasarkan tanggal transaksi."
        />
        <CardBody>
          <StatRow label="DPP (dasar pengenaan pajak)" value={formatRupiah(dpp)} />
          <StatRow
            label={form.isPpn ? 'PPN Masukan' : 'PPN'}
            value={formatRupiah(ppnAmt)}
            hint={
              form.isPpn
                ? `Tarif berdasarkan PMK 131/2024 untuk tanggal ${form.paymentDate}`
                : 'Vendor non-PKP atau transaksi non-PPN'
            }
          />
          <StatRow
            label="PPh 23 dipotong"
            value={formatRupiah(pph23)}
            hint={
              <>
                Tarif efektif {formatRate(rate)}{' '}
                {!form.vendorHasNpwp && (
                  <Badge variant="warning">+100% karena tanpa NPWP</Badge>
                )}
              </>
            }
          />
          <StatRow
            label="Net yang dibayarkan ke vendor"
            value={formatRupiah(netPay)}
            emphasis
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              Jurnal otomatis{' '}
              <BalancedBadge
                balanced={Money.eq(debit, credit)}
                debit={debit}
                credit={credit}
              />
            </span>
          }
          subtitle="Empat baris (atau tiga, kalau non-PPN). Engine menolak post jika tidak balanced."
        />
        <CardBody className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-4 font-medium">Akun</th>
                <th className="py-2 pr-4 font-medium">Sisi</th>
                <th className="py-2 text-right font-medium">Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {result.journal.lines.map((l, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-2 pr-4 text-slate-700">
                    {ACCOUNT_NAMES[l.accountId] ?? (
                      <span className="text-slate-400">{l.accountId}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <Badge
                      variant={l.side === 'DEBIT' ? 'info' : 'default'}
                    >
                      {l.side}
                    </Badge>
                  </td>
                  <td className="num py-2 text-right text-slate-900">
                    {formatRupiah(l.amount)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 font-medium">
                <td className="py-2 pr-4">Total</td>
                <td className="py-2 pr-4 text-slate-500">DR / CR</td>
                <td className="num py-2 text-right">
                  {formatRupiah(debit)} / {formatRupiah(credit)}
                </td>
              </tr>
            </tbody>
          </table>
        </CardBody>
      </Card>

      {result.artifacts.length > 0 && (
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <FileSignature size={16} /> Bukti Potong PPh 23 (siap di-export)
              </span>
            }
            subtitle="Format Coretax e-Bupot. Akan jadi PDF/CSV setelah export aktif."
          />
          <CardBody>
            <pre className="overflow-x-auto rounded-md bg-slate-900 p-4 text-xs text-slate-50">
              {JSON.stringify(
                result.artifacts[0],
                stringifyReplacer,
                2,
              )}
            </pre>
          </CardBody>
        </Card>
      )}

      {result.obligations.length > 0 && (
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Calendar size={16} /> Deadline kepatuhan otomatis
              </span>
            }
            subtitle="Kalender ini akan masuk ke modul Compliance dan kirim WA reminder H-3."
          />
          <CardBody>
            {result.obligations.map((o, i) => (
              <StatRow
                key={i}
                label={
                  <span className="flex items-center gap-2">
                    <Badge
                      variant={o.kind.startsWith('SETOR') ? 'info' : 'success'}
                    >
                      {o.kind}
                    </Badge>
                    {o.amount && (
                      <span className="text-xs text-slate-500">
                        {formatRupiah(o.amount)}
                      </span>
                    )}
                  </span>
                }
                value={
                  <span className="num text-slate-900">
                    {formatDateID(o.dueDate)}
                  </span>
                }
              />
            ))}
          </CardBody>
        </Card>
      )}
    </>
  );
}

function BalancedBadge({
  balanced,
  debit,
  credit,
}: {
  balanced: boolean;
  debit: Money.Money;
  credit: Money.Money;
}) {
  if (balanced) {
    return (
      <Badge variant="success">
        <CheckCircle2 size={12} className="mr-1 inline" />
        balanced
      </Badge>
    );
  }
  return (
    <Badge variant="danger">
      Δ {formatRupiah(Money.sub(debit, credit))}
    </Badge>
  );
}

// ─── engine adapter ──────────────────────────────────────────────────────────

type RunResult =
  | { kind: 'ok'; value: ExecutionResult }
  | { kind: 'err'; message: string };

function runEngine(
  ctx: ReturnType<typeof buildDemoContext>,
  form: FormState,
): RunResult {
  try {
    const amount = form.amountBruto.trim() === ''
      ? Money.zero()
      : Money.fromRupiah(form.amountBruto);
    if (amount.amount <= 0n) {
      return { kind: 'err', message: 'Masukkan nilai bruto > 0.' };
    }
    const result = execute(
      TPL_PAY_VENDOR_JASA_PPH23,
      {
        amountBruto: amount,
        isPpn: form.isPpn,
        kodeObjekPajak: form.kodeObjekPajak,
        vendorHasNpwp: form.vendorHasNpwp,
        paymentDate: new Date(form.paymentDate + 'T00:00:00Z'),
      },
      ctx,
    );
    return { kind: 'ok', value: result };
  } catch (e) {
    if (e instanceof RuleEngineError || e instanceof EvaluationError) {
      return { kind: 'err', message: e.message };
    }
    return { kind: 'err', message: (e as Error).message };
  }
}

// stringifies bigint (Money) and Date into something readable for the JSON box
function stringifyReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (
    typeof value === 'object' &&
    value !== null &&
    'amount' in value &&
    'currency' in value
  ) {
    return formatRupiah(value as Money.Money);
  }
  return value;
}

// `_TaxRuleRegistry` import-elision suppressor for tsc
type _TaxRuleRegistry = TaxRuleRegistry;
