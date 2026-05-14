import Link from 'next/link';
import { ArrowRight, CheckCircle2, Layers, Receipt, ScrollText, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { PageShell } from '@/components/PageShell';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui';

export default function HomePage() {
  return (
    <PageShell
      title={
        <>
          Sistem Operasi Pajak <span className="text-emerald-600">Indonesia</span>
        </>
      }
      subtitle="Taxora menjadi otak akuntansi yang berbicara langsung ke Coretax. Setiap transaksi otomatis menghasilkan jurnal seimbang, hitungan pajak yang benar, dan artefak yang siap diterima DJP."
    >
      {/* Coretax positioning */}
      <Card className="mb-8 overflow-hidden border-emerald-200 bg-gradient-to-br from-white to-emerald-50">
        <CardBody className="grid gap-6 p-8 md:grid-cols-3">
          <div>
            <Badge variant="success">Posisi Taxora</Badge>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">
              Antara Pembukuan dan Coretax
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Coretax DJP butuh data rapi (NPWP 16 digit, kode objek pajak,
              DPP yang benar). Taxora memastikan apa yang kamu kirim ke
              Coretax sudah lengkap dan sah—tanpa rework.
            </p>
          </div>
          <div className="flex items-center justify-center">
            <FlowDiagram />
          </div>
          <div className="space-y-3">
            <Bullet>Bukan pengganti Coretax — pelengkap.</Bullet>
            <Bullet>Setiap transaksi otomatis jadi jurnal.</Bullet>
            <Bullet>Tarif PMK selalu berbasis tanggal transaksi.</Bullet>
          </div>
        </CardBody>
      </Card>

      {/* Playground links */}
      <section className="mb-12">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-slate-500">
          Coba sekarang (engine asli, hitungan sungguhan)
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <PlaygroundLink
            href="/playground/pay-vendor"
            icon={<Receipt size={20} />}
            title="Bayar Vendor + Potong PPh 23"
            blurb="Skenario yang paling sering bikin pusing. Masukkan tagihan vendor; engine hitung PPN, PPh 23, net pay, dan jurnal 4 baris—otomatis seimbang."
          />
          <PlaygroundLink
            href="/playground/issue-invoice"
            icon={<ScrollText size={20} />}
            title="Buat Faktur Pajak Keluaran"
            blurb="PPN normal, DPP nilai lain (PMK 131/2024), atau non-PPN. Lihat DPP, tarif efektif, dan struktur Faktur Pajak yang akan diserahkan ke Coretax."
          />
        </div>
      </section>

      {/* Capability grid */}
      <section className="mb-10">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-slate-500">
          Kapabilitas pondasi (sudah jadi & teruji)
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Capability
            icon={<Layers size={18} />}
            title="Tax engine berbasis tanggal"
            body="Tarif PPN 11% (sebelum 2025) vs 12% (sejak 1 Jan 2025), DPP nilai lain 11/12, PPh 21 TER (PMK 168/2023), PPh 23 dengan denda 100% non-NPWP. Semua dengan rujukan PMK."
          />
          <Capability
            icon={<Zap size={18} />}
            title="Rule engine deklaratif"
            body="Template seperti PAY_VENDOR_JASA_PPH23 disimpan sebagai data, bukan kode. Mudah diaudit, mudah di-version, mudah di-rollback per tanggal efektif."
          />
          <Capability
            icon={<ShieldCheck size={18} />}
            title="Multi-tenant aman by-construction"
            body="Postgres RLS dengan FORCE pada 23 tabel. Cross-tenant access mustahil—diuji dengan 8 invariants end-to-end (lihat scripts/proof.ts)."
          />
        </div>
      </section>

      {/* What's next */}
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Sparkles size={16} /> Roadmap dekat
            </span>
          }
          subtitle="Pondasi sudah ada (math + DB + engine). Yang berikutnya tinggal di-expose."
        />
        <CardBody className="grid gap-2 md:grid-cols-2">
          <RoadItem done>Tax math (PPN, PPh 21 TER, PPh 23, fixed-point IDR)</RoadItem>
          <RoadItem done>Double-entry primitives + balanced trigger</RoadItem>
          <RoadItem done>DB multi-tenant + RLS + outbox</RoadItem>
          <RoadItem done>Rule engine: template → jurnal seimbang</RoadItem>
          <RoadItem>Frontend playground (kamu sedang melihatnya)</RoadItem>
          <RoadItem>NestJS HTTP API + auth</RoadItem>
          <RoadItem>Coretax exporters (Faktur Pajak XML, e-Bupot CSV)</RoadItem>
          <RoadItem>AI assistant (RAG atas peraturan, OCR Faktur)</RoadItem>
        </CardBody>
      </Card>
    </PageShell>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm text-slate-600">
      <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
      <span>{children}</span>
    </div>
  );
}

function PlaygroundLink({
  href,
  icon,
  title,
  blurb,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  blurb: string;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-900 hover:shadow"
    >
      <div className="flex items-center gap-2 text-slate-900">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white">
          {icon}
        </span>
        <span className="font-semibold">{title}</span>
        <ArrowRight
          size={16}
          className="ml-auto text-slate-400 transition group-hover:translate-x-1 group-hover:text-slate-900"
        />
      </div>
      <p className="mt-2 text-sm text-slate-600">{blurb}</p>
    </Link>
  );
}

function Capability({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card>
      <CardBody className="p-5">
        <div className="flex items-center gap-2 text-slate-900">
          <span className="text-emerald-600">{icon}</span>
          <span className="font-medium">{title}</span>
        </div>
        <p className="mt-2 text-sm text-slate-600">{body}</p>
      </CardBody>
    </Card>
  );
}

function RoadItem({ children, done }: { children: React.ReactNode; done?: boolean }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {done ? (
        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
      ) : (
        <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-slate-300" />
      )}
      <span className={done ? 'text-slate-600' : 'text-slate-500'}>{children}</span>
    </div>
  );
}

function FlowDiagram() {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Box label="Transaksi bisnis" sub="invoice / pembayaran" />
      <ArrowRight size={14} className="text-slate-400" />
      <Box label="Taxora" sub="rules + jurnal + AI" highlight />
      <ArrowRight size={14} className="text-slate-400" />
      <Box label="Coretax DJP" sub="filing resmi" />
    </div>
  );
}

function Box({
  label,
  sub,
  highlight,
}: {
  label: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        'rounded-lg border px-3 py-2 text-center ' +
        (highlight
          ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
          : 'border-slate-200 bg-white text-slate-700')
      }
    >
      <div className="font-semibold">{label}</div>
      <div className="text-[10px] text-slate-500">{sub}</div>
    </div>
  );
}
