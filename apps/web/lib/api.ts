/**
 * Typed HTTP client for the Taxora API.
 *
 * Storage:
 *   - JWT lives in `localStorage['taxora.jwt']` for dev. Production (PR #6)
 *     will use httpOnly cookies set by an auth route.
 *
 * Errors:
 *   Every non-2xx response is parsed as RFC 7807 and thrown as ApiError so
 *   UI can render the `code` + `title` + optional `fields[]`.
 */

const TOKEN_KEY = 'taxora.jwt';
const TENANT_KEY = 'taxora.tenant';

export interface AuthSession {
  accessToken: string;
  tenant: { id: string; slug: string; legalName: string };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly title: string,
    public readonly detail?: string,
    public readonly fields?: Array<{ path: string; message: string }>,
  ) {
    super(`[${code}] ${title}${detail ? ': ' + detail : ''}`);
  }
}

function apiBase(): string {
  // Browser side: same-origin proxy via Next rewrites OR explicit env.
  // For dev, we hit the API directly on :4000.
  if (typeof window === 'undefined') return process.env['NEXT_PUBLIC_API_BASE'] ?? 'http://localhost:4000';
  return (window as { __TAXORA_API_BASE__?: string }).__TAXORA_API_BASE__
    ?? process.env['NEXT_PUBLIC_API_BASE']
    ?? 'http://localhost:4000';
}

function readToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function isLoggedIn(): boolean {
  return !!readToken();
}

export function getStoredTenant(): AuthSession['tenant'] | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(TENANT_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as AuthSession['tenant']; }
  catch { return null; }
}

export function setSession(s: AuthSession): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_KEY, s.accessToken);
  window.localStorage.setItem(TENANT_KEY, JSON.stringify(s.tenant));
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(TENANT_KEY);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = readToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    credentials: 'omit',
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const e = (json ?? {}) as Partial<{
      code: string;
      title: string;
      detail: string;
      fields: Array<{ path: string; message: string }>;
    }>;
    throw new ApiError(
      res.status,
      e.code ?? 'HTTP_ERROR',
      e.title ?? `HTTP ${res.status}`,
      e.detail,
      e.fields,
    );
  }
  return json as T;
}

// ─── auth ────────────────────────────────────────────────────────────────────

export async function devLogin(tenantSlug: string): Promise<AuthSession> {
  const session = await request<AuthSession>('POST', '/auth/dev-login', { tenantSlug });
  setSession(session);
  return session;
}

// ─── me / data ───────────────────────────────────────────────────────────────

export interface Me {
  user: { id: string };
  tenant: { id: string; slug: string; legalName: string; pkpStatus: string };
  roles: string[];
}

export const getMe = () => request<Me>('GET', '/v1/me');

export interface TemplateSummary {
  code: string;
  version: number;
  effectiveFrom: string;
  scope: 'tenant' | 'global';
}

export interface TemplateDetail extends TemplateSummary {
  definition: {
    inputs: Array<{ name: string; kind: string; required?: boolean }>;
    computations: Array<{ name: string; expr: string }>;
    journal: Array<{ side: 'DEBIT' | 'CREDIT'; account: string; amount: string; if?: string }>;
    artifacts?: Array<{ type: string; fields: Record<string, string>; if?: string }>;
    obligations?: Array<{ kind: string; dueDay: number; amount?: string; if?: string }>;
  };
}

export const listTemplates = () => request<TemplateSummary[]>('GET', '/v1/me/templates');
export const getTemplate = (code: string) => request<TemplateDetail>('GET', `/v1/me/templates/${code}`);

export interface AccountSummary {
  id: string;
  code: string;
  name: string;
  type: string;
  normalSide: string;
  taxPurpose: string | null;
}

export const listAccounts = () => request<AccountSummary[]>('GET', '/v1/me/accounts');

export interface JournalSummary {
  id: string;
  postedAt: string;
  referenceType: string;
  templateCode: string | null;
  memo: string | null;
  status: string;
  lines: Array<{
    accountCode: string;
    accountName: string;
    side: 'DEBIT' | 'CREDIT';
    amount: string;
  }>;
}

export const listJournals = (limit = 20) =>
  request<JournalSummary[]>('GET', `/v1/me/journals?limit=${limit}`);

export interface DeadlineSummary {
  id: string;
  kind: string;
  dueDate: string;
  amount: string | null;
  status: string;
}

export const listDeadlines = () => request<DeadlineSummary[]>('GET', '/v1/me/deadlines');

// ─── transactions ────────────────────────────────────────────────────────────

export interface ExecuteRequest {
  templateCode: string;
  templateVersion?: number;
  inputs: Record<string, unknown>;
  postedAt?: string;
  dryRun?: boolean;
}

export interface ExecuteResponse {
  dryRun: boolean;
  templateCode: string;
  templateVersion: number;
  journalId?: string;
  computed: Record<string, unknown>;
  journalLines: Array<{ accountId: string; side: 'DEBIT' | 'CREDIT'; amount: string }>;
  artifacts: Array<{ type: string; fields: Record<string, unknown> }>;
  obligations: Array<{ kind: string; dueDate: string; amount?: string }>;
}

export const executeTransaction = (req: ExecuteRequest) =>
  request<ExecuteResponse>('POST', '/v1/transactions/execute', req);
