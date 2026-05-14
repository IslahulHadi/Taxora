'use client';

import { useEffect, useState } from 'react';
import { Calendar, RefreshCw } from 'lucide-react';

import { AppShell } from '@/components/AppShell';
import { Badge, Button, Card, CardBody } from '@/components/ui';
import { ApiError, listDeadlines, type DeadlineSummary } from '@/lib/api';
import { formatDateID, formatRupiah } from '@/lib/format';

/**
 * /deadlines — upcoming compliance deadlines for this tenant.
 *
 * Server-side these are auto-created when a TransactionTemplate that
 * declares obligations is executed. Today the only consumer is the API
 * (see queries.controller.ts). PR #10 will add reminder workers + mark-done.
 */
export default function DeadlinesPage() {
  const [rows, setRows] = useState<DeadlineSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load(): void {
    setError(null);
    void listDeadlines()
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e.message : (e as Error).message));
  }
  useEffect(() => { load(); }, []);

  return (
    <AppShell
      title="Deadline kepatuhan"
      subtitle="Kewajiban setor & lapor — otomatis dibuat dari setiap transaksi yang menerbitkan kewajiban."
      actions={
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw size={14} /> Refresh
        </Button>
      }
    >
      {error && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
      )}

      {rows.length === 0 ? (
        <Card>
          <CardBody className="p-10 text-center text-sm text-slate-500">
            <Calendar size={20} className="mx-auto mb-2 text-slate-400" />
            Tidak ada deadline pending. Semua sudah dipenuhi 🎉
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Jenis</th>
                  <th className="px-5 py-3 font-medium">Jatuh tempo</th>
                  <th className="px-5 py-3 text-right font-medium">Jumlah</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="border-t border-slate-100">
                    <td className="px-5 py-3">
                      <Badge variant={d.kind.startsWith('SETOR') ? 'info' : 'success'}>{d.kind}</Badge>
                    </td>
                    <td className="px-5 py-3 text-slate-700">{formatDateID(new Date(d.dueDate + 'T00:00:00Z'))}</td>
                    <td className="num px-5 py-3 text-right text-slate-900">
                      {d.amount ? formatRupiah(d.amount) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-5 py-3">
                      <Badge variant={d.status === 'PENDING' ? 'warning' : 'success'}>{d.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      <p className="mt-4 text-xs text-slate-500">
        Reminder email & WhatsApp H-3 / H-1 akan diaktifkan di PR #10.
      </p>
    </AppShell>
  );
}
