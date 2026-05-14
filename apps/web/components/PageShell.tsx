import Link from 'next/link';

export function PageShell({
  title,
  subtitle,
  back,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  back?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-4">
          <Link href="/" className="flex items-center gap-2 text-slate-900">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-sm font-bold text-white">
              T
            </span>
            <span className="text-base font-semibold">Taxora</span>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
              pre-MVP
            </span>
          </Link>
          <nav className="hidden gap-5 text-sm text-slate-600 sm:flex">
            <Link href="/playground/pay-vendor" className="hover:text-slate-900">
              Bayar Vendor
            </Link>
            <Link href="/playground/issue-invoice" className="hover:text-slate-900">
              Buat Faktur
            </Link>
            <a
              href="https://github.com/IslahulHadi/Taxora"
              className="hover:text-slate-900"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {back && (
          <Link
            href={back.href}
            className="mb-3 inline-block text-sm text-slate-500 hover:text-slate-900"
          >
            ← {back.label}
          </Link>
        )}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1 max-w-3xl text-slate-600">{subtitle}</p>
          )}
        </div>
        {children}
      </main>

      <footer className="mx-auto max-w-6xl px-6 py-12 text-xs text-slate-400">
        Taxora menjembatani pembukuan kamu dengan Coretax DJP. Bukan pengganti
        Coretax — pelengkap yang menjamin data yang kamu kirim ke DJP sudah
        rapi, sah, dan ter-jurnal dengan benar.
      </footer>
    </div>
  );
}
