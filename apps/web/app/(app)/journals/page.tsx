'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, FileText, RefreshCw } from 'lucide-react';

import { AppShell } from '@/components/AppShell';
import { Badge, Button, Card, CardBody, CardHeader } from '@/components/ui';
import { ApiError, listJournals, type JournalSummary } from '@/lib/api';
import { formatRupiah } from '@/lib/format';

/**
 * /journals — list of all journals posted by this tenant.
 * Each row expands to show the full journal lines + accounts.
 */
export default function JournalsPage() {
  const [rows, setRows] = useState<JournalSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  function load(): void {
    setError(null);
    void listJournals(50)
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e.message : (e as Error).message));
  }

  useEffect(() => { load(); }, []);

  function toggle(id: string): void {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <AppShell
      title="Jurnal"
      subtitle="Setiap baris adalah jurnal seimbang yang sudah ter-post. Klik untuk lihat detail line."
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw size={14} /> Refresh
          </Button>
          <Link
            href="/transactions/new"
            className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Buat baru <ArrowRight size={14} />
          </Link>
        </div>
      }
    >
      {error && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
      )}

      {rows.length === 0 ? (
        <Card>
          <CardBody className="p-10 text-center text-sm text-slate-500">
            <FileText size={20} className="mx-auto mb-2 text-slate-400" />
            Belum ada jurnal. <Link className="font-medium text-slate-900 underline" href="/transactions/new">Buat transaksi pertama</Link>.
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader title={`${rows.length} jurnal`} subtitle="Diurutkan dari yang terbaru" />
          <CardBody className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Tanggal</th>
                  <th className="py-2 pr-4 font-medium">Template / Memo</th>
                  <th className="py-2 pr-4 font-medium">Reff</th>
                  <th className="py-2 text-right font-medium">Total Debit</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((j) => {
                  const totalDebit = j.lines.filter((l) => l.side === 'DEBIT').reduce((a, l) => a + Number(l.amount), 0);
                  const isOpen = open.has(j.id);
                  return (
                    <>
                      <tr
                        key={j.id}
                        onClick={() => toggle(j.id)}
                        className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                      >
                        <td className="py-2.5 pr-4 text-slate-700">{j.postedAt.slice(0, 10)}</td>
                        <td className="py-2.5 pr-4 text-slate-700">
                          {j.templateCode ?? <span className="text-slate-400">manual</span>}
                          {j.memo && <span className="ml-2 text-xs text-slate-500">{j.memo}</span>}
                        </td>
                        <td className="py-2.5 pr-4 text-xs text-slate-500">{j.referenceType}</td>
                        <td className="num py-2.5 pr-4 text-right text-slate-900">{formatRupiah(String(totalDebit))}</td>
                        <td className="py-2.5 pr-4">
                          <Badge variant={j.status === 'POSTED' ? 'success' : 'warning'}>{j.status}</Badge>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${j.id}-detail`}>
                          <td colSpan={5} className="bg-slate-50">
                            <div className="px-5 py-4">
                              <table className="w-full text-xs">
                                <thead className="text-slate-500">
                                  <tr>
                                    <th className="py-1 pr-4 text-left font-medium">Akun</th>
                                    <th className="py-1 pr-4 text-left font-medium">Sisi</th>
                                    <th className="py-1 text-right font-medium">Jumlah</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {j.lines.map((l, i) => (
                                    <tr key={i}>
                                      <td className="py-1 pr-4">
                                        <span className="font-mono text-[10px] text-slate-500">{l.accountCode}</span>{' '}
                                        <span className="text-slate-900">{l.accountName}</span>
                                      </td>
                                      <td className="py-1 pr-4">
                                        <Badge variant={l.side === 'DEBIT' ? 'info' : 'default'}>{l.side}</Badge>
                                      </td>
                                      <td className="num py-1 text-right text-slate-900">{formatRupiah(l.amount)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </AppShell>
  );
}
