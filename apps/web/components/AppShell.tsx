'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Calendar, FileText, Gauge, LogOut, PlusCircle } from 'lucide-react';

import { clearSession, getStoredTenant, isLoggedIn } from '@/lib/api';

/**
 * Layout for authenticated customer pages: dashboard, /transactions, /journals.
 *
 * On mount we verify a JWT exists; if not, redirect to /login. We do not yet
 * verify the JWT against the API every render — PR #6 will add a TanStack
 * Query session check on mount.
 */
export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [tenant, setTenant] = useState<{ slug: string; legalName: string } | null>(null);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/login');
      return;
    }
    setTenant(getStoredTenant());
  }, [router]);

  function logout(): void {
    clearSession();
    router.replace('/login');
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white sm:block">
        <div className="px-5 py-5">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-sm font-bold text-white">T</span>
            <span className="text-base font-semibold text-slate-900">Taxora</span>
          </Link>
          {tenant && (
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Tenant aktif</p>
              <p className="mt-0.5 text-sm font-medium text-slate-900">{tenant.legalName}</p>
              <p className="text-xs text-slate-500">{tenant.slug}</p>
            </div>
          )}
        </div>
        <nav className="px-3">
          <NavLink href="/dashboard" pathname={pathname} icon={<Gauge size={16} />} label="Dashboard" />
          <NavLink href="/transactions/new" pathname={pathname} icon={<PlusCircle size={16} />} label="Buat Transaksi" />
          <NavLink href="/journals" pathname={pathname} icon={<FileText size={16} />} label="Jurnal" />
          <NavLink href="/deadlines" pathname={pathname} icon={<Calendar size={16} />} label="Deadline" />
        </nav>
        <div className="mt-auto px-5 py-4">
          <button
            onClick={logout}
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900"
          >
            <LogOut size={14} /> Keluar
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1">
        <div className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-start justify-between gap-4 px-6 py-5">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
              {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
            </div>
            {actions && <div>{actions}</div>}
          </div>
        </div>
        <div className="mx-auto max-w-5xl px-6 py-6">{children}</div>
      </main>
    </div>
  );
}

function NavLink({
  href,
  pathname,
  icon,
  label,
}: {
  href: string;
  pathname: string | null;
  icon: React.ReactNode;
  label: string;
}) {
  const active = pathname === href || pathname?.startsWith(href + '/');
  return (
    <Link
      href={href}
      className={
        'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ' +
        (active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100')
      }
    >
      {icon}
      {label}
    </Link>
  );
}
