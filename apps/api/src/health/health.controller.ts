import { Controller, Get } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * /health   — liveness. Returns 200 if the process is up. No DB call.
 * /readyz   — readiness. Returns 200 only if we can ping the DB. Used by
 *             load balancers / k8s to gate traffic.
 *
 * NOT @UseGuards(TenantGuard) — these are infra endpoints.
 */
@Controller()
export class HealthController {
  private readonly prisma = new PrismaClient();

  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('readyz')
  async ready(): Promise<{ status: 'ready' | 'degraded'; db: 'ok' | 'fail' }> {
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return { status: 'ready', db: 'ok' };
    } catch {
      return { status: 'degraded', db: 'fail' };
    }
  }
}
