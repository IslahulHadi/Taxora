'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2, ArrowRight, AlertTriangle } from 'lucide-react';

import { ApiError, devLogin, isLoggedIn } from '@/lib/api';
import { Button, Card, CardBody, CardHeader, Input, Label } from '@/components/ui';

/**
 * /login — dev login.
 *
 * Demo flow: enter a tenant slug ("demo" works out of the box after
 * `pnpm --filter @taxora/api prisma:seed`). API returns a JWT; we stash it
 * in localStorage and redirect to /dashboard.
 *
 * PR #6 will replace this with email + magic link / Google OIDC.
 */
export default function LoginPage() {
  const router = useRouter();
  const [slug, setSlug] = useState('demo');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoggedIn()) router.replace('/dashboard');
  }, [router]);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await devLogin(slug.trim());
      router.replace('/dashboard');
    } catch (e) {
      if (e instanceof ApiError) {
        setError(`${e.title}${e.detail ? ' — ' + e.detail : ''}`);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-slate-900 text-base font-bold text-white">T</span>
          <span className="text-lg font-semibold text-slate-900">Taxora</span>
        </div>
        <Card>
          <CardHeader
            title="Masuk ke akun kamu"
            subtitle="Pakai slug tenant untuk masuk. Untuk demo, ketik 'demo'."
          />
          <CardBody>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label hint="contoh: demo">Tenant slug</Label>
                <div className="relative mt-1">
                  <Building2 className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <Input
                    type="text"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    autoFocus
                    className="pl-9 text-left"
                    placeholder="demo"
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Masuk…' : (
                  <span className="flex items-center justify-center gap-2">
                    Masuk <ArrowRight size={16} />
                  </span>
                )}
              </Button>
            </form>

            <div className="mt-5 border-t border-slate-100 pt-4 text-center text-sm text-slate-500">
              Belum punya tenant? <Link href="/signup" className="font-medium text-slate-900 hover:underline">Daftar sekarang</Link>
            </div>
          </CardBody>
        </Card>

        <p className="mt-6 text-center text-xs text-slate-400">
          Mode dev: tidak ada password. PR #6 akan tambah email + magic link / OIDC.
        </p>
      </div>
    </div>
  );
}
