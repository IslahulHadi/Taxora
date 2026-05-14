'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSignature } from 'lucide-react';
import { Money } from '@taxora/tax-rules';
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
} from '@/components/ui';
import { ACCOUNT_NAMES, buildDemoContext } from '@/lib/demo-context';
import { TPL_ISSUE_INVOICE_PPN } from '@/lib/templates';
import { formatRupiah } from '@/lib/format';

type Treatment = 'NORMAL' | 'NILAI_LAIN_GENERAL' | 'NON_PPN';

interface FormState {
  subtotal: string;
  treatment: Treatment;
  issueDate: string;
}

const DEFAULT_FORM: FormState = {
  subtotal: '1000000',
  treatment: 'NORMAL',
  issueDate: '2025-06-15',
};

export default function IssueInvoicePage() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const ctx = useMemo(() => buildDemoContext(), []);
  const result = useMemo(() => runEngine(ctx, form), [ctx, form]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  return (
    <PageShell
      title="Buat Faktur Pajak Keluaran"
      subtitle="UU HPP berlaku: PPN 12% sejak 1 Januari 2025. Untuk barang non-mewah, gunakan DPP Nilai Lain (PMK 131/2024) supaya efektif tetap 11%."
      back={{ href: '/', label: 'Kembali' }}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Form */}
        <Card>
          <CardHeader
            title="Input invoice"
            subtitle="Tanggal terbit menentukan tarif PPN yang dipakai—bukan tanggal hari ini."
          />
          <CardBody className="space-y-4">
            <div>
              <Label hint="rupiah, tanpa titik">Subtotal</Label>
              <Input
                type="text"
                inputMode="numeric"
                value={form.subtotal}
                onChange={(e) =>
                  update('subtotal', e.target.value.replace(/[^\d.]/g, ''))
                }
              />
            </div>

            <div>
              <Label>Treatment PPN</Label>
              <Select
                value={form.treatment}
                onChange={(e) =>
                  update('treatment', e.target.value as Treatment)
                }
              >
                <option value="NORMAL">NORMAL — DPP = harga jual, PPN 12%</option>
                <option value="NILAI_LAIN_GENERAL">
                  NILAI_LAIN_GENERAL — DPP 11/12 × harga (efektif 11%)
                </option>
                <option value="NON_PPN">NON_PPN — bukan BKP/JKP</option>
              </Select>
              <p className="mt-2 text-xs text-slate-500">
                {form.treatment === 'NILAI_LAIN_GENERAL'
                  ? 'Mode PMK 131/2024 untuk barang/jasa non-mewah. PPN 12% dikalikan ke DPP yang sudah dikecilkan.'
                  : form.treatment === 'NON_PPN'
                    ? 'Tidak ada PPN. Faktur Pajak tidak diterbitkan.'
                    : 'Mode standar 12% atas DPP penuh — biasanya untuk barang mewah / kondisi khusus.'}
              </p>
            </div>

            <div>
              <Label>Tanggal terbit</Label>
              <Input
                type="date"
                value={form.issueDate}
                onChange={(e) => update('issueDate', e.target.value)}
              />
              <p className="mt-2 text-xs text-slate-500">
                Coba ganti ke tahun 2024 → engine otomatis pakai tarif 11%.
              </p>
            </div>
          </CardBody>
        </Card>

        {/* Output */}
        <div className="space-y-6">
          {result.kind === 'ok' ? (
            <ResultPanels result={result.value} treatment={form.treatment} />
          ) : (
            <Card className="border-rose-200 bg-rose-50">
              <CardBody className="flex items-start gap-3 p-5">
                <AlertTriangle className="shrink-0 text-rose-600" size={20} />
                <div>
                  <p className="font-medium text-rose-900">
                    Engine menolak input ini
                  </p>
                  <p className="mt-1 text-sm text-rose-800">{result.message}</p>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </PageShell>
  );
}

function ResultPanels({
  result,
  treatment,
}: {
  result: ExecutionResult;
  treatment: Treatment;
}) {
  const c = result.computed;
  const dpp    = (c['dpp']    as { value: Money.Money }).value;
  const ppnAmt = (c['ppnAmt'] as { value: Money.Money }).value;
  const total  = (c['total']  as { value: Money.Money }).value;

  const debit = result.journal.lines
    .filter((l) => l.side === 'DEBIT')
    .reduce((a, l) => Money.add(a, l.amount), Money.zero());
  const credit = result.journal.lines
    .filter((l) => l.side === 'CREDIT')
    .reduce((a, l) => Money.add(a, l.amount), Money.zero());

  return (
    <>
      <Card>
        <CardHeader title="Ringkasan Faktur" />
        <CardBody>
          <StatRow label="DPP" value={formatRupiah(dpp)} />
          <StatRow
            label="PPN"
            value={formatRupiah(ppnAmt)}
            hint={
              treatment === 'NON_PPN'
                ? 'Tidak ada PPN — non-BKP/JKP'
                : treatment === 'NILAI_LAIN_GENERAL'
                  ? 'Efektif 11% (DPP 11/12 × harga × 12%)'
                  : 'Tarif penuh 12% atas harga jual'
            }
          />
          <StatRow label="Total tagihan" value={formatRupiah(total)} emphasis />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              Jurnal otomatis
              <Badge variant={Money.eq(debit, credit) ? 'success' : 'danger'}>
                {Money.eq(debit, credit) ? (
                  <>
                    <CheckCircle2 size={12} className="mr-1 inline" /> balanced
                  </>
                ) : (
                  <>Δ {formatRupiah(Money.sub(debit, credit))}</>
                )}
              </Badge>
            </span>
          }
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
                    {ACCOUNT_NAMES[l.accountId] ?? l.accountId}
                  </td>
                  <td className="py-2 pr-4">
                    <Badge variant={l.side === 'DEBIT' ? 'info' : 'default'}>
                      {l.side}
                    </Badge>
                  </td>
                  <td className="num py-2 text-right text-slate-900">
                    {formatRupiah(l.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {result.artifacts.length > 0 ? (
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <FileSignature size={16} /> Faktur Pajak Keluaran (struktur Coretax)
              </span>
            }
          />
          <CardBody>
            <pre className="overflow-x-auto rounded-md bg-slate-900 p-4 text-xs text-slate-50">
              {JSON.stringify(result.artifacts[0], replacer, 2)}
            </pre>
          </CardBody>
        </Card>
      ) : (
        <Card className="border-slate-200 bg-slate-50">
          <CardBody className="flex items-start gap-3">
            <AlertTriangle className="shrink-0 text-slate-500" size={20} />
            <p className="text-sm text-slate-600">
              Tidak ada Faktur Pajak diterbitkan: transaksi non-PPN.
            </p>
          </CardBody>
        </Card>
      )}
    </>
  );
}

type RunResult =
  | { kind: 'ok'; value: ExecutionResult }
  | { kind: 'err'; message: string };

function runEngine(
  ctx: ReturnType<typeof buildDemoContext>,
  form: FormState,
): RunResult {
  try {
    const subtotal = form.subtotal.trim() === ''
      ? Money.zero()
      : Money.fromRupiah(form.subtotal);
    if (subtotal.amount <= 0n) {
      return { kind: 'err', message: 'Masukkan subtotal > 0.' };
    }
    const result = execute(
      TPL_ISSUE_INVOICE_PPN,
      {
        subtotal,
        treatment: form.treatment,
        issueDate: new Date(form.issueDate + 'T00:00:00Z'),
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

function replacer(_key: string, value: unknown): unknown {
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
