import { PrismaClient } from '@prisma/client';

/**
 * Singleton Prisma client.
 * IMPORTANT: never use this directly in request handlers.
 * Use `withTenant(tenantId, fn)` so every query runs inside a TX with
 * `SET LOCAL app.tenant_id = '<uuid>'`. RLS policies depend on it.
 */
export const prisma = new PrismaClient({
  log: process.env['NODE_ENV'] === 'production' ? ['error'] : ['error', 'warn'],
});

/**
 * Run `fn` inside a Postgres transaction with the tenant context set.
 * RLS policies on every table use `current_setting('app.tenant_id')`.
 *
 * Why a TX: SET LOCAL only applies to the current TX; using `$transaction`
 * guarantees the setting is dropped at COMMIT/ROLLBACK and doesn't leak
 * across connection-pool checkouts.
 *
 * @throws if tenantId is not a UUID — defense against header smuggling.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>,
): Promise<T> {
  if (!isUuid(tenantId)) {
    throw new Error(`Invalid tenantId: ${tenantId}`);
  }
  return prisma.$transaction(async (tx) => {
    // Cannot bind a parameter to SET LOCAL; tenantId is uuid-validated above.
    await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);
    return fn(tx);
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}
