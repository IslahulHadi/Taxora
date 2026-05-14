import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { JwtService } from './auth/jwt.service.js';
import { AuthDevController } from './auth/auth.controller.js';
import { TenantGuard } from './tenant/tenant.guard.js';
import { TenantContextInterceptor } from './tenant/tenant.interceptor.js';
import { MeController } from './me/me.controller.js';
import { TransactionsController } from './modules/transactions/transactions.controller.js';
import { MeQueriesController } from './modules/transactions/queries.controller.js';

/**
 * Root module composition.
 *
 * Keeping this flat at PR #5 — once feature modules acquire their own
 * services / queues / consumers (PR #11 outbox, PR #14 payroll), we'll
 * split into a feature-module-per-context arrangement.
 */
@Module({
  controllers: [
    HealthController,
    AuthDevController,
    MeController,
    TransactionsController,
    MeQueriesController,
  ],
  providers: [JwtService, TenantGuard, TenantContextInterceptor],
})
export class AppModule {}
