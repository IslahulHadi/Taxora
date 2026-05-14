import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantGuard } from '../tenant/tenant.guard.js';
import { TenantContextInterceptor } from '../tenant/tenant.interceptor.js';
import { requireTenantId, requireUserId, getTenantStore } from '../tenant/tenant.context.js';
import { withTenant } from '../infrastructure/persistence/prisma.js';

/**
 * /v1/me — sanity check that auth + tenant context plumbing works.
 *
 * Smoke test: with a JWT minted by /auth/dev-login, this endpoint should
 * return the tenant the JWT is scoped to. The DB query goes through
 * `withTenant()` which sets `app.tenant_id` for RLS, so this is also a
 * proof that the entire RLS chain is wired correctly.
 */
@Controller('v1/me')
@UseGuards(TenantGuard)
@UseInterceptors(TenantContextInterceptor)
export class MeController {
  private readonly prisma = new PrismaClient();

  @Get()
  async me(): Promise<{
    user: { id: string };
    tenant: { id: string; slug: string; legalName: string; pkpStatus: string };
    roles: string[];
  }> {
    const userId = requireUserId();
    const tenantId = requireTenantId();
    const roles = getTenantStore()?.roles ?? [];
    const tenant = await withTenant(tenantId, (tx) =>
      tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { id: true, slug: true, legalName: true, pkpStatus: true },
      }),
    );
    return {
      user: { id: userId },
      tenant,
      roles,
    };
  }
}
