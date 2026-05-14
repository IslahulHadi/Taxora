import { Body, Controller, Post, HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { JwtService } from './jwt.service.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { DomainException } from '../common/errors.js';

/**
 * Dev login. PR #6 replaces this with real OIDC / magic-link.
 *
 * Behavior: given a tenant slug, looks up the tenant in DB and issues a JWT
 * scoped to it. Returns 404 if the tenant doesn't exist. There's NO password
 * yet — this endpoint is gated behind `ENABLE_DEV_LOGIN=true` and disabled
 * by default in production via main.ts wiring.
 *
 * Why we ship this anyway: lets us hit /v1/me and /v1/transactions/execute
 * end-to-end in PR #5 with curl, without waiting for full auth in PR #6.
 */
const DevLoginInput = z.object({
  tenantSlug: z.string().min(1),
  /** Optional dev user id; otherwise we fabricate a deterministic uuid from slug. */
  userId: z.string().uuid().optional(),
});

@Controller('auth/dev-login')
export class AuthDevController {
  // tsx/esbuild doesn't emit decorator metadata, so NestJS DI cannot inject
  // JwtService via constructor params. We instantiate directly here. When we
  // move to a build pipeline that emits metadata (PR #18 production hardening
  // with swc or nest-cli), we can return to constructor injection.
  private readonly prisma = new PrismaClient();
  private readonly jwt = new JwtService();

  @Post()
  async login(
    @Body(new ZodValidationPipe(DevLoginInput)) body: z.infer<typeof DevLoginInput>,
  ): Promise<{ accessToken: string; tenant: { id: string; slug: string; legalName: string } }> {
    if (process.env['ENABLE_DEV_LOGIN'] !== 'true') {
      throw new DomainException(
        'DEV_LOGIN_DISABLED',
        'Dev login is disabled',
        HttpStatus.NOT_FOUND,
        'Set ENABLE_DEV_LOGIN=true to enable. Never enable this in production.',
      );
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: body.tenantSlug },
      select: { id: true, slug: true, legalName: true },
    });
    if (!tenant) {
      throw new DomainException(
        'TENANT_NOT_FOUND',
        `No tenant with slug '${body.tenantSlug}'`,
        HttpStatus.NOT_FOUND,
      );
    }
    const userId = body.userId ?? deterministicUuid(`dev-user::${tenant.slug}`);

    // Ensure the dev user exists in the `users` table so FK constraints
    // (e.g. journals.posted_by) are satisfied. Idempotent.
    await this.prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        email: `dev@${tenant.slug}.local`,
        fullName: `Dev User (${tenant.slug})`,
      },
    });

    const accessToken = await this.jwt.sign({
      sub: userId,
      tnt: tenant.id,
      roles: ['owner'],
      email: `dev@${tenant.slug}.local`,
    });
    return { accessToken, tenant };
  }
}

/**
 * Stable dev-user uuid derived from a string. Avoids storing a fake user.
 * Production replaces this with real user accounts.
 */
function deterministicUuid(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  // Format as v4-shaped uuid; the 13th hex digit is set to '4' and the 17th
  // to one of {8,9,a,b} per RFC 4122 conventions, but we don't need strict
  // version compliance — only uuid SHAPE so DB columns accept it.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
