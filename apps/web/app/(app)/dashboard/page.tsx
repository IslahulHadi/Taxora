'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Calendar, FileText, Layers, Receipt } from 'lucide-react';

import { AppShell } from '@/components/AppShell';
import { Badge, Card, CardBody, CardHeader, StatRow } from '@/components/ui';
import {
  ApiError,
  getMe,
  listDeadlines,
  listJournals,
  listTemplates,
  type DeadlineSummary,
  type JournalSummary,
  type Me,
  type TemplateSummary,
} from '@/lib/api';
import { formatDateID, formatRupiah } from '@/lib/format';

/**
 * /dashboard — landing after login.
 *
 * Shows: tenant overview, available templates, recent journals, upcoming
 * deadlines. Pure client-side fetches via /lib/api so we exercise the JWT
 * + RLS chain end-to-end on every render.
 */
export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [journals, setJournals] = useState<JournalSummary[]>([]);
  const [deadlines, setDeadlines] = useState<DeadlineSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([getMe(), listTemplates(), listJournals(5), listDeadlines()])
      .then(([m, t, j, d]) => { setMe(m); setTemplates(t); setJournals(j); setDeadlines(d); })
      .catch((e) => setError(e instanceof ApiError ? e.message : (e as Error).message));
  }, []);

  return (
    <AppShell
      title={me ? `Halo, ${me.tenant.legalName}` : 'Dashboard'}
      subtitle={
        me
          ? `Status: ${me.tenant.pkpStatus === 'PKP' ? 'PKP — wajib pungut PPN' : 'Non-PKP'} · Slug: ${me.tenant.slug}`
          : undefined
      }
      actions={
        <Link
          href="/transactions/new"
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Receipt size={16} /> Buat Transaksi
        </Link>
      }
    >
      {error && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Templates */}
        <Card className="lg:col-span-1">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Layers size={16} /> Template tersedia
              </span>
            }
            subtitle="Bisa langsung dipakai untuk buat transaksi"
          />
          <CardBody>
            {templates.length === 0 ? (
              <p className="text-sm text-slate-500">Memuat…</p>
            ) : (
              templates.map((t) => (
                <StatRow
                  key={t.code}
                  label={
                    <span>
                      <span className="font-medium text-slate-900">{t.code}</span>
                      <span className="ml-2">
                        <Badge variant={t.scope === 'tenant' ? 'info' : 'default'}>
                          v{t.version} · {t.scope}
                        </Badge>
                      </span>
                    </span>
                  }
                  value={
                    <Link
                      href={`/transactions/new?template=${t.code}`}
                      className="text-xs text-slate-700 hover:text-slate-900"
                    >
                      Pakai →
                    </Link>
                  }
                  hint={`Berlaku sejak ${t.effectiveFrom}`}
                />
              ))
            )}
          </CardBody>
        </Card>

        {/* Journals */}
        <Card className="lg:col-span-2">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <FileText size={16} /> Jurnal terbaru
              </span>
            }
            subtitle="Setiap transaksi otomatis menjadi jurnal seimbang"
          />
          <CardBody>
            {journals.length === 0 ? (
              <p className="text-sm text-slate-500">Belum ada jurnal. <Link className="font-medium text-slate-900 underline" href="/transactions/new">Buat sekarang</Link>.</p>
            ) : (
              <div className="-mx-5">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-2 font-medium">Tanggal</th>
                      <th className="px-5 py-2 font-medium">Template / Memo</th>
                      <th className="px-5 py-2 text-right font-medium">Total</th>
                      <th className="px-5 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journals.map((j) => {
                      const total = j.lines
                        .filter((l) => l.side === 'DEBIT')
                        .reduce((a, l) => a + Number(l.amount), 0);
                      return (
                        <tr key={j.id} className="border-t border-slate-100">
                          <td className="px-5 py-2 text-slate-700">{j.postedAt.slice(0, 10)}</td>
                          <td className="px-5 py-2 text-slate-700">
                            {j.templateCode ?? <span className="text-slate-400">manual</span>}
                            {j.memo && <span className="ml-2 text-xs text-slate-500">{j.memo}</span>}
                          </td>
                          <td className="num px-5 py-2 text-right text-slate-900">{formatRupiah(String(total))}</td>
                          <td className="px-5 py-2">
                            <Badge variant={j.status === 'POSTED' ? 'success' : 'warning'}>
                              {j.status}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-3 text-right">
              <Link href="/journals" className="text-sm text-slate-700 hover:text-slate-900">
                Lihat semua → <ArrowRight size={14} className="inline" />
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Deadlines */}
      <Card className="mt-6">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Calendar size={16} /> Deadline kepatuhan mendatang
            </span>
          }
          subtitle="Otomatis dihitung dari setiap template yang menerbitkan kewajiban"
        />
        <CardBody>
          {deadlines.length === 0 ? (
            <p className="text-sm text-slate-500">Tidak ada deadline pending.</p>
          ) : (
            deadlines.slice(0, 8).map((d) => (
              <StatRow
                key={d.id}
                label={
                  <span className="flex items-center gap-2">
                    <Badge variant={d.kind.startsWith('SETOR') ? 'info' : 'success'}>{d.kind}</Badge>
                    {d.amount && <span className="text-xs text-slate-500">{formatRupiah(d.amount)}</span>}
                  </span>
                }
                value={
                  <span className="num text-slate-900">{formatDateID(new Date(d.dueDate + 'T00:00:00Z'))}</span>
                }
              />
            ))
          )}
        </CardBody>
      </Card>
    </AppShell>
  );
}
