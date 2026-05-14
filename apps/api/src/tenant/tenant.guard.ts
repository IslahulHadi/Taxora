import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { JwtService } from '../auth/jwt.service.js';
import { UnauthenticatedException, TenantContextMissingException } from '../common/errors.js';
import { runWithTenant } from './tenant.context.js';

/**
 * Reads `Authorization: Bearer <jwt>` and:
 *   1. Verifies the JWT.
 *   2. Extracts (tnt, sub, roles) into a TenantStore.
 *   3. Wraps the rest of the request handler in AsyncLocalStorage.run so any
 *      downstream code can resolve `requireTenantId()` without re-parsing.
 *
 * The handler resolves _inside_ the ALS frame because NestJS evaluates the
 * controller method only after `canActivate` returns. To keep the ALS scope
 * across that, we monkey-patch by attaching the store to the Fastify request
 * AND we register a global onSend-like hook? No — simpler: we mutate Node's
 * call stack by storing it on `req` and have an interceptor wrap each handler.
 *
 * Implementation chosen: this guard sets `req.tenantStore` AND a separate
 * `TenantContextInterceptor` calls `runWithTenant()` so that the ALS is
 * active while the controller method runs. (Guards can't wrap async work.)
 *
 * IMPORTANT: instantiates JwtService directly (not via DI) for the same
 * reason as AuthDevController — tsx/esbuild doesn't emit decorator metadata.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger = new Logger('TenantGuard');
  private readonly jwt = new JwtService();

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest & { tenantStore?: unknown }>();
    const auth = req.headers['authorization'];
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      throw new UnauthenticatedException('Missing or malformed Authorization header');
    }
    const token = auth.slice('Bearer '.length).trim();
    let claims;
    try {
      claims = await this.jwt.verify(token);
    } catch (e) {
      this.logger.warn(`JWT verification failed: ${(e as Error).message}`);
      throw new UnauthenticatedException('Invalid or expired token');
    }
    if (!claims.tnt) {
      throw new TenantContextMissingException();
    }
    req.tenantStore = {
      tenantId: claims.tnt,
      userId: claims.sub,
      roles: claims.roles ?? [],
    };
    return true;
  }
}

export { runWithTenant };
