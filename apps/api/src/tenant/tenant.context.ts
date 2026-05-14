import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request tenant context, propagated through async boundaries.
 *
 * Why AsyncLocalStorage:
 *   - Avoids passing tenantId as a function argument to every service method.
 *   - Survives Promise/await/queue boundaries (BullMQ workers can opt-in by
 *     wrapping their handlers in `runWith`).
 *   - Cannot be set from outside the framework — only the TenantGuard writes it.
 *
 * IMPORTANT INVARIANT:
 *   - The tenant id stored here MUST come from a verified JWT claim, never
 *     from a request header or body. Otherwise RLS protection is bypassed.
 */
export interface TenantStore {
  tenantId: string;
  userId: string;
  roles: string[];
}

const als = new AsyncLocalStorage<TenantStore>();

export function runWithTenant<T>(store: TenantStore, fn: () => T | Promise<T>): T | Promise<T> {
  return als.run(store, fn);
}

export function getTenantStore(): TenantStore | undefined {
  return als.getStore();
}

export function requireTenantId(): string {
  const s = als.getStore();
  if (!s) throw new Error('TenantContext not set — wrap the call in TenantGuard or runWithTenant');
  return s.tenantId;
}

export function requireUserId(): string {
  const s = als.getStore();
  if (!s) throw new Error('TenantContext not set');
  return s.userId;
}
