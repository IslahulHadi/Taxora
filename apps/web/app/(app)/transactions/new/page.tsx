'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, FileSignature, RotateCcw, Sparkles } from 'lucide-react';

import { AppShell } from '@/components/AppShell';
import {
  Badge, Button, Card, CardBody, CardHeader, Input, NumberInput, Label, Select, StatRow, Switch,
} from '@/components/ui';
import {
  ApiError,
  executeTransaction,
  getTemplate,
  listTemplates,
  type ExecuteResponse,
  type TemplateDetail,
  type TemplateSummary,
} from '@/lib/api';
import { formatDateID, formatRupiah } from '@/lib/format';

/**
 * /transactions/new — generic, template-driven transaction form.
 *
 * Step 1: pick a template (or load from `?template=` query).
 * Step 2: fill inputs as defined by template.inputs[].
 * Step 3: live "preview" calls /v1/transactions/execute with dryRun=true on
 *         every change, debounced. Shows DPP, PPN, PPh23, journal lines.
 * Step 4: "Posting" submits dryRun=false; on success → redirect to /journals.
 *
 * The UI never reaches into rule engine internals — it only reads
 * input specs and shows what the API computes. This is the same flow
 * we'll wire when AI suggestions arrive in PR #13: AI proposes inputs,
 * user edits, same execute() endpoint persists.
 */
export default function NewTransactionPage() {
  return (
    <Suspense fallback={
      <AppShell title="Buat Transaksi">
        <p className="text-sm text-slate-500">Memuat…</p>
      </AppShell>
    }>
      <NewTransactionInner />
    </Suspense>
  );
}

function NewTransactionInner() {
  const router = useRouter();
  const params = useSearchParams();
  const initialCode = params.get('template') ?? 'PAY_VENDOR_JASA_PPH23';

  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [code, setCode] = useState<string>(initialCode);
  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [inputs, setInputs] = useState<Record<string, unknown>>({});
  const [preview, setPreview] = useState<ExecuteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [postedJournalId, setPostedJournalId] = useState<string | null>(null);

  // Bootstrap: load template list and initial template detail.
  useEffect(() => {
    void listTemplates().then(setTemplates).catch((e) => setError(asMessage(e)));
  }, []);

  useEffect(() => {
    setError(null);
    setPreview(null);
    setPostedJournalId(null);
    void getTemplate(code)
      .then((t) => {
        setTemplate(t);
        // Seed default inputs based on input kinds.
        const seed: Record<string, unknown> = {};
        for (const spec of t.definition.inputs) {
          seed[spec.name] = defaultForKind(spec.kind);
        }
        setInputs(seed);
      })
      .catch((e) => { setTemplate(null); setError(asMessage(e)); });
  }, [code]);

  // Live preview (debounced).
  useEffect(() => {
    if (!template) return;
    setError(null);
    const t = setTimeout(async () => {
      try {
        const res = await executeTransaction({
          templateCode: template.code,
          templateVersion: template.version,
          inputs,
          dryRun: true,
        });
        setPreview(res);
      } catch (e) {
        setPreview(null);
        if (e instanceof ApiError && e.code === 'RULE_ENGINE_REJECTED') {
          // Don't show big red banner while user is still typing — just wait.
          // We keep the previous preview to avoid flicker.
          setError(null);
        } else {
          setError(asMessage(e));
        }
      }
    }, 250);
    return () => clearTimeout(t);
  }, [template, inputs]);

  async function post(): Promise<void> {
    if (!template) return;
    setPosting(true);
    setError(null);
    try {
      const res = await executeTransaction({
        templateCode: template.code,
        templateVersion: template.version,
        inputs,
        dryRun: false,
      });
      if (res.journalId) setPostedJournalId(res.journalId);
      setPreview(res);
      // Wait a beat for the success banner to flash before navigating away.
      setTimeout(() => router.push('/journals'), 1100);
    } catch (e) {
      setError(asMessage(e));
    } finally {
      setPosting(false);
    }
  }

  return (
    <AppShell
      title="Buat Transaksi"
      subtitle="Pilih template, isi input bisnis. Engine akan menghasilkan jurnal seimbang otomatis."
    >
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {postedJournalId && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <CheckCircle2 size={16} />
          <span>Jurnal berhasil di-post (ID: <code className="font-mono">{postedJournalId.slice(0, 8)}…</code>). Mengarahkan ke daftar jurnal…</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* INPUT */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="1. Pilih template transaksi" />
            <CardBody>
              <Select value={code} onChange={(e) => setCode(e.target.value)}>
                {templates.map((t) => (
                  <option key={t.code} value={t.code}>{t.code} (v{t.version})</option>
                ))}
              </Select>
            </CardBody>
          </Card>

          {template && (
            <Card>
              <CardHeader
                title="2. Isi input bisnis"
                subtitle={`Berlaku sejak ${template.effectiveFrom} · ${template.definition.inputs.length} field${template.definition.inputs.length === 1 ? '' : 's'}`}
              />
              <CardBody className="space-y-4">
                {template.definition.inputs.map((spec) => (
                  <DynamicField
                    key={spec.name}
                    spec={spec}
                    value={inputs[spec.name]}
                    onChange={(v) => setInputs((s) => ({ ...s, [spec.name]: v }))}
                  />
                ))}
              </CardBody>
            </Card>
          )}
        </div>

        {/* PREVIEW */}
        <div className="space-y-4">
          {preview ? (
            <PreviewPanels preview={preview} />
          ) : (
            <Card className="border-dashed bg-slate-50/60">
              <CardBody className="p-8 text-center text-sm text-slate-500">
                <Sparkles size={20} className="mx-auto mb-2 text-slate-400" />
                Mulai isi input di kiri, preview akan muncul otomatis di sini.
              </CardBody>
            </Card>
          )}

          {preview && (
            <Card>
              <CardBody className="flex items-center justify-between p-4">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <RotateCcw size={14} />
                  Preview di atas adalah dry-run. Tidak ada apa pun yang ter-post sampai kamu tekan tombol di kanan.
                </div>
                <Button
                  variant="default"
                  onClick={post}
                  disabled={posting || !template}
                >
                  {posting ? 'Posting…' : (
                    <span className="flex items-center gap-2">
                      Post Jurnal <ArrowRight size={14} />
                    </span>
                  )}
                </Button>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      <p className="mt-8 text-center text-xs text-slate-500">
        <Link href="/dashboard" className="hover:text-slate-700">← Kembali ke Dashboard</Link>
      </p>
    </AppShell>
  );
}

function DynamicField({
  spec,
  value,
  onChange,
}: {
  spec: { name: string; kind: string; required?: boolean };
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = humanizeFieldName(spec.name);
  switch (spec.kind) {
    case 'money':
      return (
        <div>
          <Label hint="rupiah">{label}</Label>
          <NumberInput
            inputMode="numeric"
            value={typeof value === 'number' ? String(value) : (value as string ?? '')}
            onChange={(e) => {
              const s = e.target.value.replace(/[^\d.]/g, '');
              onChange(s === '' ? '' : Number(s));
            }}
          />
        </div>
      );
    case 'boolean':
      return (
        <div className="flex items-center justify-between rounded-md bg-slate-50 p-3">
          <span className="text-sm text-slate-700">{label}</span>
          <Switch checked={!!value} onChange={onChange} label={spec.name} />
        </div>
      );
    case 'date':
      return (
        <div>
          <Label>{label}</Label>
          <Input
            type="date"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
    case 'string':
      // Special-case kodeObjekPajak: predefined dropdown matching the seeded rules.
      if (spec.name === 'kodeObjekPajak') {
        return (
          <div>
            <Label>{label}</Label>
            <Select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
              <option value="">Pilih kode objek pajak…</option>
              <option value="24-104-01">24-104-01 — Jasa lain (2%)</option>
              <option value="24-100-01">24-100-01 — Sewa selain T/B (2%)</option>
              <option value="24-003-01">24-003-01 — Royalti (15%)</option>
              <option value="24-002-01">24-002-01 — Bunga (15%)</option>
              <option value="24-001-01">24-001-01 — Dividen (15%)</option>
            </Select>
          </div>
        );
      }
      // Special-case treatment for ISSUE_INVOICE_PPN.
      if (spec.name === 'treatment') {
        return (
          <div>
            <Label>{label}</Label>
            <Select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
              <option value="">Pilih treatment…</option>
              <option value="NORMAL">NORMAL — PPN 12% atas DPP penuh</option>
              <option value="NILAI_LAIN_GENERAL">NILAI_LAIN_GENERAL — efektif 11% (PMK 131/2024)</option>
              <option value="NON_PPN">NON_PPN — bukan BKP/JKP</option>
            </Select>
          </div>
        );
      }
      return (
        <div>
          <Label>{label}</Label>
          <Input
            type="text"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
    case 'number':
      return (
        <div>
          <Label>{label}</Label>
          <NumberInput
            type="number"
            value={typeof value === 'number' ? String(value) : (value as string ?? '')}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          />
        </div>
      );
    case 'uuid':
      return (
        <div>
          <Label hint="uuid">{label}</Label>
          <Input
            type="text"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
    default:
      return (
        <div>
          <Label>{label} <span className="text-rose-500">unsupported kind: {spec.kind}</span></Label>
        </div>
      );
  }
}

function PreviewPanels({ preview }: { preview: ExecuteResponse }) {
  const debit = preview.journalLines
    .filter((l) => l.side === 'DEBIT')
    .reduce((a, l) => a + Number(l.amount), 0);
  const credit = preview.journalLines
    .filter((l) => l.side === 'CREDIT')
    .reduce((a, l) => a + Number(l.amount), 0);
  const balanced = debit === credit;

  return (
    <>
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              Ringkasan hitungan
              <Badge variant={balanced ? 'success' : 'danger'}>
                {balanced ? <><CheckCircle2 size={12} className="mr-1 inline" /> balanced</> : `Δ ${formatRupiah(String(debit - credit))}`}
              </Badge>
            </span>
          }
        />
        <CardBody>
          {Object.entries(preview.computed).map(([k, v]) => {
            const display = renderComputed(v);
            if (display === null) return null;
            return <StatRow key={k} label={k} value={display} />;
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Jurnal" subtitle={`${preview.journalLines.length} baris`} />
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
              {preview.journalLines.map((l, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-2 pr-4 font-mono text-xs text-slate-600">{l.accountId.slice(0, 8)}…</td>
                  <td className="py-2 pr-4">
                    <Badge variant={l.side === 'DEBIT' ? 'info' : 'default'}>{l.side}</Badge>
                  </td>
                  <td className="num py-2 text-right text-slate-900">{formatRupiah(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {preview.artifacts.length > 0 && (
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <FileSignature size={16} /> Artefak (siap di-export ke Coretax)
              </span>
            }
          />
          <CardBody>
            <pre className="overflow-x-auto rounded-md bg-slate-900 p-4 text-xs text-slate-50">
              {JSON.stringify(preview.artifacts, null, 2)}
            </pre>
          </CardBody>
        </Card>
      )}

      {preview.obligations.length > 0 && (
        <Card>
          <CardHeader title="Deadline kepatuhan otomatis" />
          <CardBody>
            {preview.obligations.map((o, i) => (
              <StatRow
                key={i}
                label={
                  <span className="flex items-center gap-2">
                    <Badge variant={o.kind.startsWith('SETOR') ? 'info' : 'success'}>{o.kind}</Badge>
                    {o.amount && <span className="text-xs text-slate-500">{formatRupiah(o.amount)}</span>}
                  </span>
                }
                value={<span className="num text-slate-900">{formatDateID(new Date(o.dueDate + 'T00:00:00Z'))}</span>}
              />
            ))}
          </CardBody>
        </Card>
      )}
    </>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function defaultForKind(kind: string): unknown {
  switch (kind) {
    case 'money':   return 1000000;
    case 'number':  return 0;
    case 'boolean': return false;
    case 'date':    return new Date().toISOString().slice(0, 10);
    case 'string':  return '';
    case 'uuid':    return '';
    default:        return '';
  }
}

function humanizeFieldName(name: string): string {
  // amountBruto -> "Amount Bruto"
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function renderComputed(v: unknown): React.ReactNode {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v.toString();
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('amount' in o && 'currency' in o) return formatRupiah(String(o['amount']));
    if ('num' in o && 'den' in o) return `${(((o['num'] as number) / (o['den'] as number)) * 100).toFixed(2)}%`;
    return null;
  }
  return null;
}

function asMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const list = e.fields?.map((f) => `${f.path}: ${f.message}`).join('; ');
    return [e.title, e.detail, list].filter(Boolean).join(' — ');
  }
  return (e as Error).message;
}
