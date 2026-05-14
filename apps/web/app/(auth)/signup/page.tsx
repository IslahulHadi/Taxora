'use client';

import Link from 'next/link';
import { ArrowRight, CheckCircle2, Sparkles } from 'lucide-react';

import { Card, CardBody } from '@/components/ui';

/**
 * /signup — public landing page for sign-up interest. We don't actually
 * create tenants from the web yet; PR #6 will wire this to a real flow
 * with email verification + NPWP capture. For now we explain Taxora and
 * push users to /login for the demo experience.
 */
export default function SignupPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-emerald-50 to-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-sm font-bold text-white">T</span>
          <span className="text-base font-semibold text-slate-900">Taxora</span>
        </Link>
        <Link href="/login" className="text-sm text-slate-600 hover:text-slate-900">
          Sudah punya akun? Masuk →
        </Link>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
            <Sparkles size={12} /> Pre-MVP — coba sekarang dengan tenant demo
          </div>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
            Hentikan rework di Coretax. Otomatis dari pembukuan ke filing.
          </h1>
          <p className="mt-5 text-lg text-slate-600">
            Taxora menjadi otak akuntansi yang berbicara langsung ke Coretax DJP.
            Setiap transaksi otomatis menjadi jurnal seimbang, hitungan pajak yang benar,
            dan artefak siap diunggah ke Coretax — tanpa entry ulang.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-800"
            >
              Coba demo sekarang <ArrowRight size={16} />
            </Link>
            <Link
              href="/playground/pay-vendor"
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Eksplorasi tanpa daftar
            </Link>
          </div>
        </div>

        {/* Pricing-style 3 tiers — values explanatory, billing wired in PR #19 */}
        <section className="mt-16 grid gap-6 md:grid-cols-3">
          <Card className="border-slate-200">
            <CardBody className="p-6">
              <h3 className="text-sm font-medium uppercase tracking-wide text-slate-500">Standard</h3>
              <p className="mt-2 text-3xl font-semibold text-slate-900">Free</p>
              <p className="text-xs text-slate-500">selama beta — UMKM & PPh Final</p>
              <ul className="mt-5 space-y-2 text-sm text-slate-700">
                <Feature>Pembukuan single-entity</Feature>
                <Feature>PPh Final UMKM 0,5% (PP 55/2022)</Feature>
                <Feature>Faktur Pajak Keluaran (XML siap Coretax)</Feature>
                <Feature>Bukti Potong PPh 23 (e-Bupot CSV)</Feature>
                <Feature>Kalender deadline + reminder email</Feature>
                <Feature>Dukungan email standar</Feature>
              </ul>
            </CardBody>
          </Card>

          <Card className="border-emerald-300 ring-2 ring-emerald-200">
            <CardBody className="p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium uppercase tracking-wide text-emerald-700">Pro</h3>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium uppercase text-emerald-800">populer</span>
              </div>
              <p className="mt-2 text-3xl font-semibold text-slate-900">Rp 299rb<span className="text-base font-normal text-slate-500">/bulan</span></p>
              <p className="text-xs text-slate-500">SMB PKP yang serius soal PPN</p>
              <ul className="mt-5 space-y-2 text-sm text-slate-700">
                <Feature>Semua di Standard +</Feature>
                <Feature>Rekonsiliasi PPN Masukan/Keluaran otomatis</Feature>
                <Feature>SPT Masa PPN siap submit</Feature>
                <Feature>Payroll PPh 21 TER + A1 (PMK 168/2023)</Feature>
                <Feature>AI Tax Q&A (RAG atas PMK/PER/UU)</Feature>
                <Feature>OCR Faktur Pajak Masukan</Feature>
                <Feature>WhatsApp reminder H-3 / H-1</Feature>
              </ul>
            </CardBody>
          </Card>

          <Card className="border-slate-200">
            <CardBody className="p-6">
              <h3 className="text-sm font-medium uppercase tracking-wide text-slate-500">Konsultan / Akuntan</h3>
              <p className="mt-2 text-3xl font-semibold text-slate-900">Rp 99rb<span className="text-base font-normal text-slate-500">/klien/bulan</span></p>
              <p className="text-xs text-slate-500">untuk Kantor Jasa Akuntan & Konsultan Pajak</p>
              <ul className="mt-5 space-y-2 text-sm text-slate-700">
                <Feature>Workspace multi-klien (1 login → N tenant)</Feature>
                <Feature>Switch klien dalam 1 klik</Feature>
                <Feature>Aggregated firm dashboard</Feature>
                <Feature>White-label opsional</Feature>
                <Feature>SLA respon 2 jam (jam kerja)</Feature>
                <Feature>Onboarding bareng tim Taxora</Feature>
              </ul>
            </CardBody>
          </Card>
        </section>

        <p className="mt-12 text-center text-sm text-slate-500">
          Punya pertanyaan? Email{' '}
          <a href="mailto:hello@taxora.id" className="font-medium text-slate-700 hover:underline">
            hello@taxora.id
          </a>
        </p>
      </main>
    </div>
  );
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
      <span>{children}</span>
    </li>
  );
}
