import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { JwtService } from './auth/jwt.service.js';
import { AuthDevController } from './auth/auth.controller.js';
import { TenantGuard } from './tenant/tenant.guard.js';
import { TenantContextInterceptor } from './tenant/tenant.interceptor.js';
import { MeController } from './me/me.controller.js';

/**
 * Root module composition.
 *
 * For PR #4 we keep this flat. As modules grow (PR #5 adds invoices/bills/
 * transactions, PR #14 adds payroll), we'll split into feature modules and
 * import them here. Don't preemptively split — wait for genuine reuse pain.
 */
@Module({
  controllers: [HealthController, AuthDevController, MeController],
  providers: [JwtService, TenantGuard, TenantContextInterceptor],
})
export class AppModule {}
